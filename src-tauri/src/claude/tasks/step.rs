//! The step task (F-09.6; docs/05 › Tasks: Step analysis, sonnet · medium, `prompts/step.md`,
//! `schemas/step-findings.schema.json`). Inputs are files in the task folder, readable through
//! `--add-dir`: the step's diff, the whole change's hunk index, the threads on the step's lines
//! (F-09.5) and the team rules; the argv comes only from `runner::read_only_args` (ADR-022,
//! ADR-025 risk) and Claude works in the review worktree. The result is validated
//! (`review::findings`, F-09.1) and cached in `claude_cache` under the step's hunks; a cache hit
//! is validated again and starts no `claude` process.
//!
//! Queue (docs/04 › Background work): the step the user opens runs as `CurrentStep`, ahead of
//! the plan; only the next step is prefetched ([`schedule`]).

use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use super::plan::Context;
use super::plan_inputs::{self, PlanSource};
use super::step_inputs::{self, Dismissal};
use crate::claude::error::ClaudeError;
use crate::claude::exec;
use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts;
use crate::claude::queue::Priority;
use crate::claude::runner::{self, OutputFormat, Task};
use crate::claude::task_dir::TaskDir;
use crate::git::model::FileDiff;
use crate::gitlab::discussions::{self, Thread};
use crate::os::process::Cancel;
use crate::review::finding_model::StepAnalysis;
use crate::review::findings::{self, StepScope};
use crate::review::plan_cache::{self, CacheKey, STEP_TASK, TaskSettings};
use crate::review::plan_model::{Plan, Step};

const TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// One step of a planned review.
pub struct StepRequest<'a> {
    pub repo_id: i64,
    pub source: &'a PlanSource,
    pub base_sha: &'a str,
    pub head_sha: &'a str,
    /// The review worktree (others' MR) or the repository root; Claude's working directory and
    /// the tree evidence is checked against.
    pub cwd: &'a Path,
    /// Every file of the change with its hunks.
    pub files: &'a [FileDiff],
    pub plan: &'a Plan,
    pub step_id: &'a str,
    /// The steps in the reader's order (`strategy::step_order`): "step N of M".
    pub order: &'a [String],
    /// The MR's threads; MR sessions only (decision 5), empty otherwise.
    pub threads: &'a [Thread],
    /// From `plan::team_rules`.
    pub rules: Option<&'a str>,
    /// Dismissed notes of this head (F-09.4).
    pub dismissed: &'a [Dismissal],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepOutcome {
    pub analysis: StepAnalysis,
    /// Came from `claude_cache`.
    pub cached: bool,
}

/// What opening a step starts: the step itself as `CurrentStep` and the next one in the
/// reader's order as `Prefetch`, never more (saves the user's Claude usage). Steps already
/// analyzed come back from the cache without a `claude` run.
pub fn schedule(order: &[String], opened: &str) -> Vec<(String, Priority)> {
    let Some(at) = order.iter().position(|id| id == opened) else {
        return Vec::new();
    };
    let mut runs = vec![(opened.to_owned(), Priority::CurrentStep)];
    if let Some(next) = order.get(at + 1) {
        runs.push((next.clone(), Priority::Prefetch));
    }
    runs
}

fn step<'a>(req: &StepRequest<'a>) -> Result<&'a Step, ClaudeError> {
    req.plan
        .steps
        .iter()
        .find(|s| s.id == req.step_id)
        .ok_or_else(|| ClaudeError::failed("the step is not in the plan"))
}

/// The cache key of a step under the current settings (docs/04: the step's hunk IDs).
pub fn key(ctx: &Context<'_>, req: &StepRequest<'_>) -> Result<CacheKey, ClaudeError> {
    Ok(CacheKey::new(
        STEP_TASK,
        req.repo_id,
        req.source.subject(),
        req.base_sha,
        req.head_sha,
        step(req)?.hunk_ids.iter().cloned(),
        req.rules,
        TaskSettings::step(ctx.settings),
    ))
}

/// Validation (F-09.1) against the worktree; the same for fresh and cached output.
fn finish(
    output: &Value,
    scope: &StepScope<'_>,
    req: &StepRequest<'_>,
) -> Result<StepAnalysis, ClaudeError> {
    let dismissed: HashSet<String> = req
        .dismissed
        .iter()
        .map(|d| d.fingerprint.clone())
        .collect();
    findings::validate(
        Some(output),
        scope,
        &dismissed,
        |p| findings::relative(req.cwd, p),
        findings::worktree_lines(req.cwd),
    )
}

fn cached(
    ctx: &Context<'_>,
    key: &CacheKey,
    scope: &StepScope<'_>,
    req: &StepRequest<'_>,
) -> Option<StepAnalysis> {
    match ctx.store.with_conn(|conn| plan_cache::get(conn, key)) {
        Ok(Some(output)) => match finish(&output, scope, req) {
            Ok(analysis) => Some(analysis),
            Err(error) => {
                tracing::warn!(%error, "cached step analysis is invalid; analyzing again");
                None
            }
        },
        Ok(None) => None,
        Err(error) => {
            tracing::warn!(%error, "step cache unavailable");
            None
        }
    }
}

/// The cached analysis, or a run of `claude` at `priority` that is cached on success.
pub async fn run(
    ctx: &Context<'_>,
    req: &StepRequest<'_>,
    priority: Priority,
    cancel: &Cancel,
) -> Result<StepOutcome, ClaudeError> {
    let step = step(req)?;
    let scope = StepScope::new(&step.id, req.files, &step.hunk_ids);
    let key = key(ctx, req)?;
    let hit = |analysis| StepOutcome {
        analysis,
        cached: true,
    };
    if let Some(analysis) = cached(ctx, &key, &scope, req) {
        return Ok(hit(analysis));
    }
    let _permit = ctx.queue.acquire(priority, cancel).await?;
    // Another run of the same step may have finished while this one waited.
    if let Some(analysis) = cached(ctx, &key, &scope, req) {
        return Ok(hit(analysis));
    }

    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let file = |name: &str, content: &str| {
        dir.write(name, content)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io)
    };
    let step_files = scope.files();
    let number = req
        .order
        .iter()
        .position(|id| *id == step.id)
        .map_or(0, |i| i + 1);
    let prompt = prompts::render(
        prompts::STEP,
        &[
            ("step_number", &number.to_string()),
            ("step_count", &req.order.len().to_string()),
            ("source_label", &req.source.label()),
            ("step_title", &step.title),
            ("step_description", &step.description),
            (
                "builds_on_summary",
                &step_inputs::builds_on_summary(req.plan, &step.id, req.order),
            ),
            (
                "step_diff_file",
                &file("step.diff", &plan_inputs::diff_text(&step_files))?,
            ),
            (
                "hunk_index_file",
                &file("hunk-index.tsv", &plan_inputs::hunk_index(req.files))?,
            ),
            (
                "threads_file",
                &file(
                    "threads.txt",
                    &discussions::render(&step_inputs::threads_on_step(req.threads, &step_files)),
                )?,
            ),
            (
                "rules_file",
                &file("rules.md", &plan_inputs::or_none(req.rules))?,
            ),
            (
                "dismissed_kinds",
                &step_inputs::dismissed_kinds(req.dismissed),
            ),
        ],
    );
    let system = dir
        .write(
            "system-common.md",
            &prompts::system_common(ctx.settings.lang),
        )
        .map_err(io)?;
    let resolved = models::resolve(ctx.settings, TaskGroup::Step);
    let task = Task {
        output: OutputFormat::Json,
        json_schema: Some(prompts::STEP_SCHEMA.trim().to_owned()),
        model: resolved.model,
        effort: resolved.effort,
        system_prompt_file: system,
        task_dir: dir.path().to_path_buf(),
        persist_session: false,
        resume: None,
    };
    let result = exec::run_task(
        ctx.exe,
        runner::read_only_args(&task),
        req.cwd,
        &prompt,
        dir.path(),
        TIMEOUT,
        cancel,
    )
    .await?;
    let output = result
        .structured_output
        .ok_or_else(|| ClaudeError::Schema("no structured output".into()))?;
    let analysis = finish(&output, &scope, req)?;
    if let Err(error) = ctx
        .store
        .with_conn(|conn| plan_cache::put(conn, &key, &output))
    {
        tracing::warn!(%error, "step analysis not cached");
    }
    Ok(StepOutcome {
        analysis,
        cached: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order() -> Vec<String> {
        ["s3", "s1", "s2"].map(str::to_owned).to_vec()
    }

    #[test]
    fn f09_6_opening_a_step_prefetches_only_the_next() {
        assert_eq!(
            schedule(&order(), "s3"),
            [
                ("s3".to_owned(), Priority::CurrentStep),
                ("s1".to_owned(), Priority::Prefetch)
            ]
        );
        // The last step has nothing to prefetch; an unknown step starts nothing.
        assert_eq!(
            schedule(&order(), "s2"),
            [("s2".to_owned(), Priority::CurrentStep)]
        );
        assert!(schedule(&order(), "s9").is_empty());
    }
}
