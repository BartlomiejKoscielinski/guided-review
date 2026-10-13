//! The plan task (F-06.2; docs/05 › Tasks: Review plan, opus · high, `prompts/plan.md`,
//! `schemas/plan.schema.json`). Inputs are files in the task folder, readable through
//! `--add-dir`; the argv comes only from `runner::read_only_args` (ADR-022, ADR-025 risk). The
//! result is validated (`review::plan`, F-06.3), gets the app's config risk (F-06.13) and is
//! cached by `review::plan_cache` (F-02.5). A cache hit is validated again and starts no
//! `claude` process.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use super::plan_inputs::{self, PlanSource};
use crate::claude::discover::ClaudeExecutable;
use crate::claude::error::ClaudeError;
use crate::claude::exec;
use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts;
use crate::claude::queue::{Priority, Queue};
use crate::claude::runner::{self, OutputFormat, Task};
use crate::claude::task_dir::TaskDir;
use crate::git::Git;
use crate::git::model::FileDiff;
use crate::gitlab::discussions::{self, Thread};
use crate::os::process::Cancel;
use crate::review::coverage::{self, HunkRef};
use crate::review::plan_cache::{self, CacheKey, TaskSettings};
use crate::review::plan_model::Plan;
use crate::review::{config_risk, plan};
use crate::settings::ClaudeSettings;
use crate::store::Store;

const TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// Team rules, read from the target branch only (docs/claude/README.md).
const RULES_PATH: &str = ".review/rules.md";

/// What the plan is made of.
pub struct PlanRequest<'a> {
    pub repo_id: i64,
    /// `{{project}}`: the GitLab project path.
    pub project: &'a str,
    pub source: PlanSource,
    pub base_sha: &'a str,
    pub head_sha: &'a str,
    /// The review worktree (others' MR) or the repository root; Claude's working directory.
    pub cwd: &'a Path,
    pub description: Option<&'a str>,
    /// Every file of the change with its hunks, `Hunk.mechanical` set (F-05.5).
    pub files: &'a [FileDiff],
    /// MR sessions only (decision 5); empty otherwise.
    pub threads: &'a [Thread],
    /// From [`team_rules`].
    pub rules: Option<&'a str>,
}

/// Everything a run needs from the app.
pub struct Context<'a> {
    pub exe: &'a ClaudeExecutable,
    pub settings: &'a ClaudeSettings,
    pub tmp_root: &'a Path,
    pub queue: &'a Queue,
    pub store: &'a Store,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanOutcome {
    pub plan: Plan,
    /// Came from `claude_cache` (S-02 "Cached" state).
    pub cached: bool,
}

/// `.review/rules.md` at `base_sha` (the target branch), never from the MR head; `None` when
/// the file doesn't exist there.
pub async fn team_rules(
    git: &Git,
    base_sha: &str,
    cancel: &Cancel,
) -> Result<Option<String>, ClaudeError> {
    let spec = git.spec(["show".to_owned(), format!("{base_sha}:{RULES_PATH}")]);
    let output = git
        .run_spec(spec, cancel, &[0, 128])
        .await
        .map_err(|e| ClaudeError::failed(e.to_string()))?;
    Ok((output.code == Some(0)).then_some(output.stdout))
}

/// The cache key of a request under the current settings.
pub fn key(ctx: &Context<'_>, req: &PlanRequest<'_>) -> CacheKey {
    CacheKey::new(
        plan_cache::TASK,
        req.repo_id,
        req.source.subject(),
        req.base_sha,
        req.head_sha,
        coverage::hunk_refs(req.files)
            .into_iter()
            .map(|h| h.id.to_owned()),
        req.rules,
        TaskSettings::plan(ctx.settings),
    )
}

/// Validation (F-06.3) and the app's config risk (F-06.13); the same for fresh and cached output.
fn finish(output: &Value, hunks: &[HunkRef], files: &[FileDiff]) -> Result<Plan, ClaudeError> {
    let mut plan = plan::validate(Some(output), hunks)?;
    config_risk::add_config_risk(&mut plan, files);
    Ok(plan)
}

/// The cached plan, or a run of `claude` that is cached on success.
pub async fn run(
    ctx: &Context<'_>,
    req: &PlanRequest<'_>,
    cancel: &Cancel,
) -> Result<PlanOutcome, ClaudeError> {
    let hunks = coverage::hunk_refs(req.files);
    let key = key(ctx, req);
    match ctx.store.with_conn(|conn| plan_cache::get(conn, &key)) {
        Ok(Some(cached)) => match finish(&cached, &hunks, req.files) {
            Ok(plan) => return Ok(PlanOutcome { plan, cached: true }),
            Err(error) => tracing::warn!(%error, "cached plan is invalid; planning again"),
        },
        Ok(None) => {}
        Err(error) => tracing::warn!(%error, "plan cache unavailable"),
    }

    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let file = |name: &str, content: &str| {
        dir.write(name, content)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io)
    };
    let prompt = prompts::render(
        prompts::PLAN,
        &[
            ("source_label", &req.source.label()),
            ("project", req.project),
            (
                "source_block",
                &req.source.block(req.base_sha, req.head_sha),
            ),
            (
                "description_file",
                &file("description.md", &plan_inputs::or_none(req.description))?,
            ),
            (
                "hunk_index_file",
                &file("hunk-index.tsv", &plan_inputs::hunk_index(req.files))?,
            ),
            (
                "diff_file",
                &file("change.diff", &plan_inputs::diff_text(req.files))?,
            ),
            (
                "threads_file",
                &file("threads.txt", &discussions::render(req.threads))?,
            ),
            (
                "rules_file",
                &file("rules.md", &plan_inputs::or_none(req.rules))?,
            ),
            (
                "mechanical_file",
                &file("mechanical.tsv", &plan_inputs::mechanical_file(req.files))?,
            ),
        ],
    );
    let system = dir
        .write(
            "system-common.md",
            &prompts::system_common(ctx.settings.lang),
        )
        .map_err(io)?;
    let resolved = models::resolve(ctx.settings, TaskGroup::Plan);
    let task = Task {
        output: OutputFormat::Json,
        json_schema: Some(prompts::PLAN_SCHEMA.trim().to_owned()),
        model: resolved.model,
        effort: resolved.effort,
        system_prompt_file: system,
        task_dir: dir.path().to_path_buf(),
        persist_session: false,
        resume: None,
    };
    let _permit = ctx.queue.acquire(Priority::Plan, cancel).await?;
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
    let plan = finish(&output, &hunks, req.files)?;
    if let Err(error) = ctx
        .store
        .with_conn(|conn| plan_cache::put(conn, &key, &output))
    {
        tracing::warn!(%error, "plan not cached");
    }
    Ok(PlanOutcome {
        plan,
        cached: false,
    })
}
