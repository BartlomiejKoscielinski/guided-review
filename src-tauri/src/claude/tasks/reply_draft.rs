//! The reply draft of S-10 (F-26.7, docs/plans/M7.md F-26.7; docs/05 › Tasks: Reply draft, the
//! "Questions" group, `prompts/reply-draft.md`, `schemas/reply-draft.schema.json`). **Draft with
//! Claude** on a question thread of my own MR asks for a proposed answer. Inputs are two files in
//! the task folder, readable through `--add-dir`: the thread (its notes in order, who wrote what)
//! and the code at the thread's line, read from my own checkout (Claude's working directory). The
//! argv comes only from `runner::read_only_args` (ADR-022, ADR-025 risk). The answer only fills
//! the text area, so nothing is cached: every click asks again, and nothing is sent.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use super::plan::Context;
use crate::claude::error::ClaudeError;
use crate::claude::exec;
use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts;
use crate::claude::queue::Priority;
use crate::claude::result::clamp;
use crate::claude::runner::{self, OutputFormat, Task};
use crate::claude::task_dir::TaskDir;
use crate::git::scratch::git_path;
use crate::gitlab::discussions::{self, NOTE_MAX, Thread};
use crate::os::process::Cancel;

/// The schema's `maxLength` of the reply; a longer one is clamped with "…".
pub const REPLY_MAX: usize = 800;
/// Lines of code shown before and after the thread's line.
pub const EXCERPT_AROUND: u32 = 10;
/// Bytes of the file read for the excerpt; a larger file is drafted without code.
const FILE_MAX: u64 = 5 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// One draft: my checkout (Claude's working directory, where the thread's file is read) and the
/// thread to answer.
pub struct ReplyDraftRequest<'a> {
    pub cwd: &'a Path,
    pub thread: &'a Thread,
}

/// The IPC result of `claude_reply_draft`: the proposed answer, trimmed, at most 800 characters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReplyDraft {
    pub reply: String,
}

/// The thread file: its place, then every note in order with its author. Note bodies are
/// teammates' text: untrusted data for Claude (`system-common.md`).
pub fn thread_file(thread: &Thread) -> String {
    let mut out = format!(
        "Thread {} · {}\n",
        thread.id,
        discussions::place(thread.position.as_ref())
    );
    for note in &thread.notes {
        let body = clamp(note.body.trim(), NOTE_MAX).replace('\n', "\n    ");
        out.push_str(&format!(
            "  - {} ({}, {}): {body}\n",
            note.author.username, note.author.name, note.created_at
        ));
    }
    out
}

/// The thread's file inside `root`, or `None` for a position that would leave it (`..`, an
/// absolute path, a link pointing out).
fn file_in(root: &Path, path: &str) -> Option<PathBuf> {
    let relative = git_path(Path::new(path)).ok()?;
    let file = root.join(relative);
    let root = root.canonicalize().ok()?;
    let real = file.canonicalize().ok()?;
    real.starts_with(&root).then_some(real)
}

/// The lines around `line` (1-based), numbered, cut to the file.
pub fn excerpt(text: &str, line: u32) -> String {
    let first = line.saturating_sub(EXCERPT_AROUND).max(1);
    let last = line.saturating_add(EXCERPT_AROUND);
    text.lines()
        .zip(1u32..)
        .filter(|(_, n)| (first..=last).contains(n))
        .map(|(code, n)| {
            let mark = if n == line { '>' } else { ' ' };
            format!("{mark}{n:>5} | {code}\n")
        })
        .collect()
}

/// The code file: the lines around the thread's line in my checkout, or a sentence saying why
/// there is none (a thread on the MR itself, a file gone or unreadable).
pub fn code_file(root: &Path, thread: &Thread) -> String {
    let Some(position) = thread.position.as_ref() else {
        return "No code: the thread is on the merge request itself, not on a line.\n".into();
    };
    let line = thread
        .placed_line
        .or(position.new_line)
        .or(position.old_line);
    let (path, line) = match (position.new_path.as_str(), line) {
        ("", _) | (_, None) => return "No code: the thread has no line.\n".into(),
        (path, Some(line)) => (path, line),
    };
    let text = file_in(root, path)
        .filter(|f| std::fs::metadata(f).is_ok_and(|m| m.is_file() && m.len() <= FILE_MAX))
        .and_then(|f| std::fs::read_to_string(f).ok());
    match text {
        Some(text) => format!("{path}, line {line}:\n{}", excerpt(&text, line)),
        None => format!("No code: {path} is not in the checkout.\n"),
    }
}

fn schema(detail: impl Into<String>) -> ClaudeError {
    ClaudeError::Schema(detail.into())
}

/// The reply in `structured_output`: a non-blank string, trimmed and clamped to 800 characters.
pub fn reply_of(output: &Value) -> Result<ReplyDraft, ClaudeError> {
    let object = output.as_object().ok_or_else(|| schema("not an object"))?;
    if let Some(other) = object.keys().find(|k| k.as_str() != "reply") {
        return Err(schema(format!("unexpected field {other}")));
    }
    let reply = object
        .get("reply")
        .and_then(Value::as_str)
        .ok_or_else(|| schema("reply is not a string"))?
        .trim();
    if reply.is_empty() {
        return Err(schema("the reply is empty"));
    }
    Ok(ReplyDraft {
        reply: clamp(reply, REPLY_MAX),
    })
}

/// Runs `claude` in my checkout (`Priority::Interactive`: the author clicked and waits).
/// `on_started` runs once the queue lets the run start.
pub async fn run(
    ctx: &Context<'_>,
    req: &ReplyDraftRequest<'_>,
    on_started: &(dyn Fn() + Sync),
    cancel: &Cancel,
) -> Result<ReplyDraft, ClaudeError> {
    let _permit = ctx.queue.acquire(Priority::Interactive, cancel).await?;
    on_started();

    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let file = |name: &str, content: &str| {
        dir.write(name, content)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io)
    };
    let prompt = prompts::render(
        prompts::REPLY_DRAFT,
        &[
            (
                "thread_file",
                &file("thread.txt", &thread_file(req.thread))?,
            ),
            (
                "code_excerpt_file",
                &file("code.txt", &code_file(req.cwd, req.thread))?,
            ),
        ],
    );
    let system = dir
        .write(
            "system-common.md",
            &prompts::system_common(ctx.settings.lang),
        )
        .map_err(io)?;
    let resolved = models::resolve(ctx.settings, TaskGroup::Ask);
    let task = Task {
        output: OutputFormat::Json,
        json_schema: Some(prompts::REPLY_DRAFT_SCHEMA.trim().to_owned()),
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
        .ok_or_else(|| schema("no structured output"))?;
    reply_of(&output)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use serde_json::json;

    #[test]
    fn f26_7_the_prompt_fills_every_placeholder() {
        let prompt = prompts::render(
            prompts::REPLY_DRAFT,
            &[("thread_file", "T"), ("code_excerpt_file", "C")],
        );
        assert!(!prompt.contains("{{"), "{prompt}");
    }

    #[test]
    fn f26_7_the_schema_is_reply_draft() {
        let schema: Value = serde_json::from_str(prompts::REPLY_DRAFT_SCHEMA).unwrap();
        assert_eq!(schema["title"], "ReplyDraft");
        assert_eq!(schema["properties"]["reply"]["maxLength"], REPLY_MAX);
    }

    #[test]
    fn f26_7_the_excerpt_marks_the_line_and_stops_at_the_file() {
        let text: String = (1..=30).map(|n| format!("l{n}\n")).collect();
        let cut = excerpt(&text, 3);
        assert!(cut.starts_with("     1 | l1\n"), "{cut}");
        assert!(cut.contains(">    3 | l3\n"), "{cut}");
        assert!(cut.contains("l13\n") && !cut.contains("l14\n"), "{cut}");
        assert_eq!(excerpt(&text, 30).lines().count(), 11);
    }

    #[test]
    fn f26_7_a_reply_is_trimmed_and_other_shapes_are_schema() {
        assert_eq!(
            reply_of(&json!({ "reply": " Fine. " })).unwrap().reply,
            "Fine."
        );
        for bad in [
            json!({ "reply": "Fine.", "extra": 1 }),
            json!("Fine."),
            json!({ "reply": null }),
        ] {
            assert!(
                matches!(reply_of(&bad), Err(ClaudeError::Schema(_))),
                "{bad}"
            );
        }
    }
}
