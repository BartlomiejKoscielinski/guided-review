//! Questions (F-10.1, F-10.2; docs/05 › Tasks: Questions, default · low, `prompts/ask.md`, plain
//! text, streams). Asked in the context of a step and, if any, the selected lines; the argv
//! comes only from `runner::read_only_args` with stream-json and a kept session. The first
//! question of a step starts a Claude session saved in `claude_sessions`; follow-ups on the
//! same step continue it with `--resume`. Runs as `Priority::Interactive`.
//!
//! Text deltas (`stream_event` / `content_block_delta` / `text_delta`) go to the caller as they
//! arrive; the answer is the result's `result` text, which leaves out any text Claude wrote
//! before reading files.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use super::plan::Context;
use super::plan_inputs::PlanSource;
use crate::claude::error::ClaudeError;
use crate::claude::exec;
use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts;
use crate::claude::queue::Priority;
use crate::claude::runner::{self, OutputFormat, Task};
use crate::claude::task_dir::TaskDir;
use crate::git::model::{FileDiff, LineKind};
use crate::os::process::Cancel;
use crate::review::finding_model::Side;
use crate::review::plan_model::Plan;
use crate::review::position::LineSelection;
use crate::store::claude_sessions;

const TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Claude Code's message when `--resume` names a session it no longer has.
const SESSION_GONE: &str = "No conversation found";

/// A question on one step of a planned review.
pub struct AskRequest<'a> {
    /// The review session (`claude_sessions.session_id`).
    pub session_id: &'a str,
    pub source: &'a PlanSource,
    /// The review worktree (others' MR) or the repository root.
    pub cwd: &'a Path,
    /// Every file of the change with its hunks.
    pub files: &'a [FileDiff],
    pub plan: &'a Plan,
    pub step_id: &'a str,
    /// The steps in the reader's order: "step N".
    pub order: &'a [String],
    pub question: &'a str,
    pub selection: Option<&'a LineSelection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AskAnswer {
    pub text: String,
    /// Continued the step's earlier Claude session.
    pub follow_up: bool,
}

/// The text of a stream-json `text_delta` line, or `None` for any other line.
pub fn text_delta(line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let event = &v["event"];
    (v["type"] == "stream_event"
        && event["type"] == "content_block_delta"
        && event["delta"]["type"] == "text_delta")
        .then(|| event["delta"]["text"].as_str().map(str::to_owned))
        .flatten()
}

/// `{{selection_block}}`: the selected lines with their diff markers; empty without a
/// selection. A selection outside the step is invalid input.
pub fn selection_block(
    selection: Option<&LineSelection>,
    step_files: &[FileDiff],
) -> Result<String, ClaudeError> {
    let Some(sel) = selection else {
        return Ok(String::new());
    };
    let lines = sel.lines(step_files);
    if lines.is_empty() {
        return Err(ClaudeError::Invalid(
            "The selected lines are not in this step.".into(),
        ));
    }
    let side = match sel.side {
        Side::New => "new",
        Side::Old => "old",
    };
    let (low, high) = (sel.start.min(sel.end), sel.start.max(sel.end));
    let mut block = format!(
        "The reviewer selected lines {low}-{high} of {} ({side} side):\n```\n",
        sel.file
    );
    for line in lines {
        let marker = match line.kind {
            LineKind::Ctx => ' ',
            LineKind::Add => '+',
            LineKind::Del => '-',
        };
        block.push(marker);
        block.push_str(&line.text);
        block.push('\n');
    }
    block.push_str("```\n");
    Ok(block)
}

/// The read-only task of a question: stream-json, the session kept for follow-ups, resumed
/// when the step already has one.
pub fn task(
    ctx: &Context<'_>,
    system_prompt_file: &Path,
    task_dir: &Path,
    resume: Option<String>,
) -> Task {
    let resolved = models::resolve(ctx.settings, TaskGroup::Ask);
    Task {
        output: OutputFormat::StreamJson,
        json_schema: None,
        model: resolved.model,
        effort: resolved.effort,
        system_prompt_file: system_prompt_file.to_path_buf(),
        task_dir: task_dir.to_path_buf(),
        persist_session: true,
        resume,
    }
}

/// Asks the question, streaming text deltas to `on_text`; saves the Claude session of the step.
pub async fn run(
    ctx: &Context<'_>,
    req: &AskRequest<'_>,
    on_text: &mut (dyn FnMut(&str) + Send),
    cancel: &Cancel,
) -> Result<AskAnswer, ClaudeError> {
    let step = req
        .plan
        .steps
        .iter()
        .find(|s| s.id == req.step_id)
        .ok_or_else(|| ClaudeError::Invalid("The step is not in the plan.".into()))?;
    let step_files =
        crate::review::findings::StepScope::new(&step.id, req.files, &step.hunk_ids).files();
    let number = req
        .order
        .iter()
        .position(|id| *id == step.id)
        .map_or(0, |i| i + 1);
    let prompt = prompts::render(
        prompts::ASK,
        &[
            ("step_number", &number.to_string()),
            ("step_title", &step.title),
            ("source_label", &req.source.label()),
            (
                "selection_block",
                &selection_block(req.selection, &step_files)?,
            ),
            ("question", req.question),
        ],
    );
    let store_err = |e: crate::store::StoreError| ClaudeError::failed(format!("database: {e}"));
    let previous = ctx
        .store
        .with_conn(|c| claude_sessions::get(c, req.session_id, req.step_id))
        .map_err(store_err)?;

    let _permit = ctx.queue.acquire(Priority::Interactive, cancel).await?;
    let result = match ask_once(ctx, req, &prompt, previous.clone(), on_text, cancel).await {
        Err(ClaudeError::Failed { message, detail })
            if previous.is_some()
                && [Some(&message), detail.as_ref()]
                    .into_iter()
                    .flatten()
                    .any(|t| t.contains(SESSION_GONE)) =>
        {
            tracing::info!("the step's Claude session is gone; asking in a new one");
            ctx.store
                .with_conn(|c| claude_sessions::delete(c, req.session_id, req.step_id))
                .map_err(store_err)?;
            ask_once(ctx, req, &prompt, None, on_text, cancel)
                .await
                .map(|r| (r, false))
        }
        other => other.map(|r| (r, previous.is_some())),
    };
    let (result, follow_up) = result?;
    match &result.session_id {
        Some(id) => ctx
            .store
            .with_conn(|c| claude_sessions::put(c, req.session_id, req.step_id, id))
            .map_err(store_err)?,
        None => tracing::warn!("the answer has no session id; follow-ups start a new session"),
    }
    Ok(AskAnswer {
        text: result.result.unwrap_or_default().trim().to_owned(),
        follow_up,
    })
}

async fn ask_once(
    ctx: &Context<'_>,
    req: &AskRequest<'_>,
    prompt: &str,
    resume: Option<String>,
    on_text: &mut (dyn FnMut(&str) + Send),
    cancel: &Cancel,
) -> Result<crate::claude::result::ClaudeResult, ClaudeError> {
    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let system = dir
        .write(
            "system-common.md",
            &prompts::system_common(ctx.settings.lang),
        )
        .map_err(io)?;
    let task = task(ctx, &system, dir.path(), resume);
    let mut on_line = |line: &str| {
        if let Some(text) = text_delta(line) {
            on_text(&text);
        }
    };
    exec::run_task_streaming(
        ctx.exe,
        runner::read_only_args(&task),
        req.cwd,
        prompt,
        dir.path(),
        TIMEOUT,
        cancel,
        &mut on_line,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f10_2_text_deltas_only_from_stream_events() {
        let delta = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Yes, "}}}"#;
        assert_eq!(text_delta(delta).as_deref(), Some("Yes, "));
        for other in [
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}}"#,
            r#"{"type":"stream_event","event":{"type":"message_start"}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Yes"}]}}"#,
            r#"{"type":"result","result":"Yes"}"#,
            "not json",
        ] {
            assert_eq!(text_delta(other), None, "{other}");
        }
    }
}
