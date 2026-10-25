//! The commit message task (F-16.4 Suggest; docs/05 › Tasks: Commit message, haiku · low,
//! `prompts/commit-message.md`, `schemas/commit-message.schema.json`). It runs with the
//! read-only profile in the repository root; the staged diff is a file in the task folder.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use super::discover::ClaudeExecutable;
use super::error::ClaudeError;
use super::exec;
use super::models::{self, TaskGroup};
use super::prompts;
use super::queue::{Priority, Queue};
use super::result::clamp;
use super::runner::{self, OutputFormat, Task};
use super::task_dir::TaskDir;
use crate::git::Git;
use crate::os::process::Cancel;
use crate::settings::ClaudeSettings;

const TIMEOUT: Duration = Duration::from_secs(5 * 60);
const SUMMARY_MAX: usize = 72;
const BODY_MAX: usize = 1200;
const RECENT_SUBJECTS: &str = "20";

/// What the task reads from git.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inputs {
    pub staged_diff: String,
    pub recent_subjects: Vec<String>,
}

/// `git diff --cached` and the last 20 subjects. `Invalid` when nothing is staged.
pub async fn inputs(git: &Git, cancel: &Cancel) -> Result<Inputs, ClaudeError> {
    inputs_for(git, &[], cancel).await
}

/// As [`inputs`]; with `only` (S-10's commit of a fix, F-26.4) the diff is what
/// `git commit -- <only>` takes instead: `git diff HEAD -- <only>`, staged and unstaged edits
/// of those files alike, and nothing else that is staged (M7 decision 10).
pub async fn inputs_for(
    git: &Git,
    only: &[String],
    cancel: &Cancel,
) -> Result<Inputs, ClaudeError> {
    let git_error = |e: crate::git::GitError| ClaudeError::failed(e.to_string());
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-M"];
    if only.is_empty() {
        args.push("--cached");
    } else {
        args.extend(["HEAD", "--"]);
        args.extend(only.iter().map(String::as_str));
    }
    let diff = git.run(args, cancel).await.map_err(git_error)?;
    if diff.stdout.trim().is_empty() {
        let message = if only.is_empty() {
            "Stage something first; Claude writes the message from the staged changes."
        } else {
            "The file has no changes to describe."
        };
        return Err(ClaudeError::Invalid(message.to_owned()));
    }
    let spec = git.spec(["log", "-n", RECENT_SUBJECTS, "--format=%s"]);
    // A repository without commits has no subjects (exit 128).
    let log = git
        .run_spec(spec, cancel, &[0, 128])
        .await
        .map_err(git_error)?;
    Ok(Inputs {
        staged_diff: diff.stdout,
        recent_subjects: log
            .stdout
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(str::to_owned)
            .collect(),
    })
}

/// Renders the prompt; the diff is referenced by its path in the task folder.
pub fn prompt(diff_file: &Path, subjects: &[String]) -> String {
    let subjects = if subjects.is_empty() {
        "none".to_owned()
    } else {
        subjects
            .iter()
            .map(|s| format!("- {s}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    prompts::render(
        prompts::COMMIT_MESSAGE,
        &[
            ("staged_diff_file", &diff_file.to_string_lossy()),
            ("recent_subjects", &format!("\n{subjects}\n")),
        ],
    )
}

/// Validates `structured_output` again (docs/05: Rust validation is authoritative): two
/// strings; too long text is clamped with "…". Returns "summary" or "summary\n\nbody".
pub fn message_from(structured: Option<&Value>) -> Result<String, ClaudeError> {
    let value = structured.ok_or_else(|| ClaudeError::Schema("no structured output".into()))?;
    let field = |name: &str| {
        value[name]
            .as_str()
            .map(str::trim)
            .ok_or_else(|| ClaudeError::Schema(format!("`{name}` is not a string")))
    };
    let summary = clamp(
        field("summary")?.lines().next().unwrap_or_default(),
        SUMMARY_MAX,
    );
    if summary.is_empty() {
        return Err(ClaudeError::Schema("empty summary".into()));
    }
    let body = clamp(field("body")?, BODY_MAX);
    Ok(if body.is_empty() {
        summary
    } else {
        format!("{summary}\n\n{body}")
    })
}

/// Everything a run needs from the app.
pub struct Context<'a> {
    pub exe: &'a ClaudeExecutable,
    pub settings: &'a ClaudeSettings,
    pub git: &'a Git,
    pub tmp_root: &'a Path,
    pub queue: &'a Queue,
}

/// Writes the inputs, waits for a queue slot and runs the task (the staged changes, S-06).
pub async fn run(ctx: &Context<'_>, cancel: &Cancel) -> Result<String, ClaudeError> {
    run_for(ctx, &[], cancel).await
}

/// As [`run`]; a non-empty `only` describes those files' changes against HEAD (S-10).
pub async fn run_for(
    ctx: &Context<'_>,
    only: &[String],
    cancel: &Cancel,
) -> Result<String, ClaudeError> {
    let inputs = inputs_for(ctx.git, only, cancel).await?;
    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let diff_file = dir.write("staged.diff", &inputs.staged_diff).map_err(io)?;
    let system = dir
        .write(
            "system-common.md",
            &prompts::system_common(ctx.settings.lang),
        )
        .map_err(io)?;
    let resolved = models::resolve(ctx.settings, TaskGroup::Commit);
    let task = Task {
        output: OutputFormat::Json,
        json_schema: Some(prompts::COMMIT_MESSAGE_SCHEMA.trim().to_owned()),
        model: resolved.model,
        effort: resolved.effort,
        system_prompt_file: system,
        task_dir: dir.path().to_path_buf(),
        persist_session: false,
        resume: None,
    };
    let _permit = ctx.queue.acquire(Priority::Interactive, cancel).await?;
    let result = exec::run_task(
        ctx.exe,
        runner::read_only_args(&task),
        ctx.git.repo(),
        &prompt(&diff_file, &inputs.recent_subjects),
        dir.path(),
        TIMEOUT,
        cancel,
    )
    .await?;
    message_from(result.structured_output.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn f16_4_message_from_structured_output() {
        assert_eq!(
            message_from(Some(
                &json!({ "summary": "Enable compiled bindings", "body": "" })
            ))
            .unwrap(),
            "Enable compiled bindings"
        );
        assert_eq!(
            message_from(Some(&json!({ "summary": "A", "body": "- one\n- two" }))).unwrap(),
            "A\n\n- one\n- two"
        );
        let long = "x".repeat(80);
        let clamped = message_from(Some(&json!({ "summary": long, "body": "" }))).unwrap();
        assert_eq!(clamped.chars().count(), 72);
        assert!(clamped.ends_with('…'));
        assert!(matches!(
            message_from(Some(&json!({ "summary": 1, "body": "" }))),
            Err(ClaudeError::Schema(_))
        ));
        assert!(matches!(message_from(None), Err(ClaudeError::Schema(_))));
    }

    #[test]
    fn the_prompt_references_the_diff_file_and_subjects() {
        let p = prompt(
            Path::new(r"C:\Users\Zażółć\AppData\Roaming\GuidedReview\tmp\t\staged.diff"),
            &["Fix login".into(), "Add map".into()],
        );
        assert!(p.contains(
            r"Staged diff: C:\Users\Zażółć\AppData\Roaming\GuidedReview\tmp\t\staged.diff"
        ));
        assert!(p.contains("- Fix login\n- Add map"));
        assert!(!p.contains("{{"));
    }
}
