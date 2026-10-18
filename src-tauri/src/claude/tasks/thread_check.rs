//! The thread check (F-13.3, M5 decision 12; docs/05 › Tasks: Thread check, the "Step analysis"
//! group, `prompts/thread-check.md`, `schemas/thread-check.schema.json`). **Check with Claude** on
//! S-05's Threads tab asks which of the MR's open threads, written on an older head, a later
//! commit addressed. Inputs are files in the task folder, readable through `--add-dir`: the
//! candidate threads with the commits since each one's head, and those commits with their diffs
//! (`git log -p`, size-capped; `thread_check_inputs.rs`); the argv comes only from
//! `runner::read_only_args` (ADR-022, ADR-025 risk). The answer is checked again here and cached
//! in `claude_cache` under the head and the thread set; a cache hit starts no `claude` process,
//! and without a candidate nothing runs. Claude resolves nothing: the hints are chips only.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

use super::plan::Context;
use super::plan_inputs::PlanSource;
use super::thread_check_inputs::{self as inputs, Candidate};
use crate::claude::error::ClaudeError;
use crate::claude::exec;
use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts;
use crate::claude::queue::Priority;
use crate::claude::runner::{self, OutputFormat, Task};
use crate::claude::task_dir::TaskDir;
use crate::git::Git;
use crate::gitlab::discussions::Thread;
use crate::os::process::Cancel;
use crate::review::plan_cache::{self, CacheKey, TaskSettings};

/// `claude_cache.task` of thread checks.
pub const TASK: &str = "thread-check";
const TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// The thread check of an MR session's summary.
pub struct ThreadCheckRequest<'a> {
    pub repo_id: i64,
    /// An MR: the prompt names its `!iid` and title.
    pub source: &'a PlanSource,
    pub base_sha: &'a str,
    /// The reviewed head: the end of every thread's range.
    pub head_sha: &'a str,
    /// The review worktree; Claude's working directory.
    pub cwd: &'a Path,
    /// git in the review worktree: the ranges and `git log -p`.
    pub git: &'a Git,
    /// The MR's threads; only the open ones written on an older head are checked.
    pub threads: &'a [Thread],
}

/// A thread Claude judges addressed: "Claude: <hint> in <commit, 7 characters>" on S-05.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThreadHint {
    pub discussion_id: String,
    /// The full id of the later commit that addressed it.
    pub commit: String,
    pub hint: String,
}

/// The IPC result of `claude_thread_check`: empty when Claude found none addressed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThreadCheck {
    pub hints: Vec<ThreadHint>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadCheckOutcome {
    pub hints: Vec<ThreadHint>,
    /// Came from `claude_cache` (or nothing to check).
    pub cached: bool,
}

/// The cache key (plan M5: per head and thread set). The threads file stands in for the team
/// rules: the candidates' ids, notes and later commits, so a resolved thread, a new reply or a
/// new head asks Claude again.
pub fn key(ctx: &Context<'_>, req: &ThreadCheckRequest<'_>, threads_file: &str) -> CacheKey {
    CacheKey::new(
        TASK,
        req.repo_id,
        req.source.subject(),
        req.base_sha,
        req.head_sha,
        std::iter::empty(),
        Some(threads_file),
        TaskSettings::for_group(ctx.settings, TaskGroup::Step),
    )
}

fn cached(
    ctx: &Context<'_>,
    key: &CacheKey,
    candidates: &[Candidate<'_>],
) -> Option<Vec<ThreadHint>> {
    match ctx.store.with_conn(|conn| plan_cache::get(conn, key)) {
        Ok(Some(output)) => inputs::hints_of(&output, candidates).ok(),
        Ok(None) => None,
        Err(error) => {
            tracing::warn!(%error, "thread check cache unavailable");
            None
        }
    }
}

/// The cached hints, or a run of `claude` (`Priority::Interactive`: the reviewer clicked and
/// waits) that is cached on success. `on_started` runs once the queue lets the run start (never
/// on a cache hit or without a candidate).
pub async fn run(
    ctx: &Context<'_>,
    req: &ThreadCheckRequest<'_>,
    on_started: &(dyn Fn() + Sync),
    cancel: &Cancel,
) -> Result<ThreadCheckOutcome, ClaudeError> {
    let PlanSource::Mr { iid, title, .. } = req.source else {
        return Err(ClaudeError::Invalid(
            "Threads are checked for a merge request.".into(),
        ));
    };
    let candidates = inputs::candidates(req.git, req.threads, req.head_sha, cancel).await?;
    if candidates.is_empty() {
        return Ok(ThreadCheckOutcome {
            hints: Vec::new(),
            cached: false,
        });
    }
    let threads = inputs::threads_file(&candidates);
    let key = key(ctx, req, &threads);
    let hit = |hints| ThreadCheckOutcome {
        hints,
        cached: true,
    };
    if let Some(hints) = cached(ctx, &key, &candidates) {
        return Ok(hit(hints));
    }
    let _permit = ctx.queue.acquire(Priority::Interactive, cancel).await?;
    if let Some(hints) = cached(ctx, &key, &candidates) {
        return Ok(hit(hints));
    }
    on_started();

    let commits = inputs::commits_file(req.git, &candidates, cancel).await?;
    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let file = |name: &str, content: &str| {
        dir.write(name, content)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io)
    };
    let prompt = prompts::render(
        prompts::THREAD_CHECK,
        &[
            ("iid", &iid.to_string()),
            ("title", title),
            ("threads_file", &file("threads.txt", &threads)?),
            ("commits_file", &file("commits.txt", &commits)?),
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
        json_schema: Some(prompts::THREAD_CHECK_SCHEMA.trim().to_owned()),
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
    let hints = inputs::hints_of(&output, &candidates)?;
    if let Err(error) = ctx
        .store
        .with_conn(|conn| plan_cache::put(conn, &key, &output))
    {
        tracing::warn!(%error, "thread check not cached");
    }
    Ok(ThreadCheckOutcome {
        hints,
        cached: false,
    })
}
