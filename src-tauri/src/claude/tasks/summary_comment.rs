//! The summary comment (F-12.4, M5 decision 11; docs/05 › Tasks: Summary comment, the "MR
//! description and pipeline" group, `prompts/summary-comment.md`,
//! `schemas/summary-comment.schema.json`). Ticking "Add a summary comment" on S-05 runs it once to
//! prefill the area with a short overall summary. Inputs are files in the task folder, readable
//! through `--add-dir`: the drafts that go out with the summary (ticked, not yet published) and the
//! MR's open threads; the argv comes only from `runner::read_only_args` (ADR-022, ADR-025 risk).
//! The result is clamped to 600 characters and cached in `claude_cache` under the inputs and head;
//! a cache hit starts no `claude` process.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use super::plan::Context;
use super::plan_inputs::PlanSource;
use crate::claude::error::ClaudeError;
use crate::claude::exec;
use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts;
use crate::claude::queue::Priority;
use crate::claude::result::clamp;
use crate::claude::runner::{self, OutputFormat, Task};
use crate::claude::task_dir::TaskDir;
use crate::gitlab::discussions::{self, Thread};
use crate::os::process::Cancel;
use crate::review::drafts::Draft;
use crate::review::plan_cache::{self, CacheKey, TaskSettings};
use crate::review::plan_model::Plan;

/// `claude_cache.task` of summary comments.
pub const TASK: &str = "summary-comment";
/// The schema's `maxLength`: a longer answer is clamped with "…".
pub const SUMMARY_MAX: usize = 600;
const TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// The summary of an MR session's Publish.
pub struct SummaryRequest<'a> {
    pub repo_id: i64,
    /// An MR: the prompt names its `!iid` and title.
    pub source: &'a PlanSource,
    pub base_sha: &'a str,
    pub head_sha: &'a str,
    /// The review worktree; Claude's working directory.
    pub cwd: &'a Path,
    /// `{{intent}}`: what the change does.
    pub plan: &'a Plan,
    /// Every draft of the session; only the ticked, unpublished ones are inputs.
    pub drafts: &'a [Draft],
    /// The MR's threads; only the open ones are inputs.
    pub threads: &'a [Thread],
}

/// What prefills the area (the IPC result of `claude_summary_comment`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SummaryComment {
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SummaryOutcome {
    pub summary: String,
    /// Came from `claude_cache`.
    pub cached: bool,
}

/// The drafts file: the drafts published with the summary, each with its place, or "none".
/// Draft bodies are the reviewer's words; teammates' text never gets here.
pub fn drafts_file(drafts: &[Draft]) -> String {
    let mut out = String::new();
    let going = drafts
        .iter()
        .filter(|d| d.include && d.published_note_id.is_none());
    for (index, draft) in going.enumerate() {
        let place = draft.position.as_ref().map_or_else(
            || "on the merge request".to_owned(),
            |p| format!("{}:{}", p.file, p.line),
        );
        let body = draft.body.trim().replace('\n', "\n    ");
        out.push_str(&format!("Draft {} · {place}\n    {body}\n", index + 1));
    }
    if out.is_empty() {
        "none\n".to_owned()
    } else {
        out
    }
}

/// The threads file: the open threads as the plan and step tasks render them, or "none".
pub fn threads_file(threads: &[Thread]) -> String {
    let open: Vec<Thread> = threads.iter().filter(|t| t.is_open()).cloned().collect();
    discussions::render(&open)
}

/// Everything the summary depends on besides the head: the intent and both files.
fn inputs(req: &SummaryRequest<'_>) -> (String, String, String) {
    (
        req.plan.intent.trim().to_owned(),
        drafts_file(req.drafts),
        threads_file(req.threads),
    )
}

/// The cache key (plan M5: the drafts' text, the head and the prompt version). The summary has no
/// team rules; its inputs take their place in the key, so an edited draft writes it again.
pub fn key(ctx: &Context<'_>, req: &SummaryRequest<'_>) -> CacheKey {
    let (intent, drafts, threads) = inputs(req);
    CacheKey::new(
        TASK,
        req.repo_id,
        req.source.subject(),
        req.base_sha,
        req.head_sha,
        std::iter::empty(),
        Some(&format!("{intent}\0{drafts}\0{threads}")),
        TaskSettings::for_group(ctx.settings, TaskGroup::Mr),
    )
}

/// The summary in `structured_output`, trimmed and clamped; anything else is `CLAUDE_SCHEMA`.
pub fn summary_of(output: &Value) -> Result<String, ClaudeError> {
    let summary = output
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or_else(|| ClaudeError::Schema("summary is missing or not a string".into()))?;
    if summary.is_empty() {
        return Err(ClaudeError::Schema("summary is empty".into()));
    }
    Ok(clamp(summary, SUMMARY_MAX))
}

fn cached(ctx: &Context<'_>, key: &CacheKey) -> Option<String> {
    match ctx.store.with_conn(|conn| plan_cache::get(conn, key)) {
        Ok(Some(output)) => summary_of(&output).ok(),
        Ok(None) => None,
        Err(error) => {
            tracing::warn!(%error, "summary cache unavailable");
            None
        }
    }
}

/// The cached summary, or a run of `claude` (`Priority::Interactive`: the reviewer ticked the box
/// and waits) that is cached on success. `on_started` runs once the queue lets the run start
/// (never on a cache hit).
pub async fn run(
    ctx: &Context<'_>,
    req: &SummaryRequest<'_>,
    on_started: &(dyn Fn() + Sync),
    cancel: &Cancel,
) -> Result<SummaryOutcome, ClaudeError> {
    let PlanSource::Mr { iid, title, .. } = req.source else {
        return Err(ClaudeError::Invalid(
            "A summary comment is written for a merge request.".into(),
        ));
    };
    let key = key(ctx, req);
    let hit = |summary| SummaryOutcome {
        summary,
        cached: true,
    };
    if let Some(summary) = cached(ctx, &key) {
        return Ok(hit(summary));
    }
    let _permit = ctx.queue.acquire(Priority::Interactive, cancel).await?;
    if let Some(summary) = cached(ctx, &key) {
        return Ok(hit(summary));
    }
    on_started();

    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let file = |name: &str, content: &str| {
        dir.write(name, content)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io)
    };
    let (intent, drafts, threads) = inputs(req);
    let prompt = prompts::render(
        prompts::SUMMARY_COMMENT,
        &[
            ("iid", &iid.to_string()),
            ("title", title),
            ("intent", &intent),
            ("drafts_file", &file("drafts.txt", &drafts)?),
            ("threads_file", &file("threads.txt", &threads)?),
        ],
    );
    let system = dir
        .write(
            "system-common.md",
            &prompts::system_common(ctx.settings.lang),
        )
        .map_err(io)?;
    let resolved = models::resolve(ctx.settings, TaskGroup::Mr);
    let task = Task {
        output: OutputFormat::Json,
        json_schema: Some(prompts::SUMMARY_COMMENT_SCHEMA.trim().to_owned()),
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
    let summary = summary_of(&output)?;
    if let Err(error) = ctx
        .store
        .with_conn(|conn| plan_cache::put(conn, &key, &output))
    {
        tracing::warn!(%error, "summary comment not cached");
    }
    Ok(SummaryOutcome {
        summary,
        cached: false,
    })
}

#[cfg(test)]
#[path = "summary_comment_tests.rs"]
mod tests;
