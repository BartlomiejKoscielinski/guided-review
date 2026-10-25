//! The fix task (F-25.2; docs/05 › Fix on own code, ADR-018, ADR-022, M7 decision 3;
//! `prompts/fix.md`, `schemas/fix-result.schema.json`). Claude runs with the fix profile of
//! `runner::fix_args`: read-only tools plus `Edit` allowed for the one file, the working
//! directory is the scratch worktree (never the user's checkout). The model and effort come
//! from the "Fixes on your code" group. A fix run is never cached: the file differs each time.
//! The caller runs `fix::guard::verify` after this returns.

use std::time::Duration;

use serde::Deserialize;

use super::plan::Context;
use crate::claude::error::ClaudeError;
use crate::claude::exec;
use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts;
use crate::claude::queue::Priority;
use crate::claude::runner::{self, OutputFormat, Task};
use crate::claude::task_dir::TaskDir;
use crate::git::scratch::Scratch;
use crate::os::process::Cancel;

/// The line the fix card shows above Claude's sentence when nothing was edited (decision 3).
pub const NO_CHANGE: &str = "Claude made no change.";
const TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// One fix: the scratch worktree with its one file, and what to address.
pub struct FixRequest<'a> {
    pub scratch: &'a Scratch,
    /// Where the request comes from ("a self-review note", "a review thread").
    pub origin: &'a str,
    /// The note's or thread's text.
    pub request: &'a str,
    /// Where in the file (file and line, the hunk around it).
    pub context: &'a str,
}

/// Claude's answer (`FixResult`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixOutcome {
    /// False when Claude made no edit; the card then shows [`NO_CHANGE`].
    pub changed: bool,
    /// One sentence shown under the proposed diff.
    pub explanation: String,
}

/// Runs `claude` in the scratch worktree (`Priority::Interactive`: the user clicked and
/// waits). `on_started` runs once the queue lets the run start.
pub async fn run(
    ctx: &Context<'_>,
    req: &FixRequest<'_>,
    on_started: &(dyn Fn() + Sync),
    cancel: &Cancel,
) -> Result<FixOutcome, ClaudeError> {
    let file = req.scratch.file.to_string_lossy().replace('\\', "/");
    // Validate before queueing: a bad path never starts a run.
    runner::edit_rule(&req.scratch.file).map_err(|e| ClaudeError::Invalid(e.to_string()))?;

    let _permit = ctx.queue.acquire(Priority::Interactive, cancel).await?;
    on_started();

    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let prompt = prompts::render(
        prompts::FIX,
        &[
            ("file", &file),
            ("origin", req.origin),
            ("request", req.request),
            ("context", req.context),
        ],
    );
    let system = dir
        .write(
            "system-common.md",
            &prompts::system_common(ctx.settings.lang),
        )
        .map_err(io)?;
    let resolved = models::resolve(ctx.settings, TaskGroup::Fix);
    let task = Task {
        output: OutputFormat::Json,
        json_schema: Some(prompts::FIX_SCHEMA.trim().to_owned()),
        model: resolved.model,
        effort: resolved.effort,
        system_prompt_file: system,
        task_dir: dir.path().to_path_buf(),
        persist_session: false,
        resume: None,
    };
    let args = runner::fix_args(&task, &req.scratch.file)
        .map_err(|e| ClaudeError::Invalid(e.to_string()))?;
    let result = exec::run_task(
        ctx.exe,
        args,
        &req.scratch.path,
        &prompt,
        dir.path(),
        TIMEOUT,
        cancel,
    )
    .await?;
    let output = result
        .structured_output
        .ok_or_else(|| ClaudeError::Schema("no structured output".into()))?;
    serde_json::from_value(output).map_err(|e| ClaudeError::Schema(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f25_2_the_prompt_fills_every_placeholder() {
        let prompt = prompts::render(
            prompts::FIX,
            &[
                ("file", "src/A b.cs"),
                ("origin", "a self-review note"),
                ("request", "Guard it."),
                ("context", "line 2"),
            ],
        );
        assert!(!prompt.contains("{{"), "{prompt}");
        assert!(prompt.contains("exactly one file: src/A b.cs."));
    }

    #[test]
    fn f25_2_the_schema_is_fix_result() {
        let schema: serde_json::Value = serde_json::from_str(prompts::FIX_SCHEMA).unwrap();
        assert_eq!(schema["title"], "FixResult");
        let extra = serde_json::json!({ "changed": true, "explanation": "x", "more": 1 });
        assert!(serde_json::from_value::<FixOutcome>(extra).is_err());
    }
}
