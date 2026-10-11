//! The only place that builds `claude` command lines (CLAUDE.md non-negotiables, docs/05 ›
//! Invocation profiles, ADR-022). Two profiles: read-only (every task) and fix (own code only,
//! one file, in a scratch worktree, ADR-018). The prompt always goes through stdin.
//!
//! Never `--bare` (no subscription login), never `--dangerously-skip-permissions`, never Bash.

use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use super::discover::ClaudeExecutable;
use crate::os::process::ProcessSpec;
use crate::settings::Effort;

/// Built-in tools of the read-only profile.
pub const READ_ONLY_TOOLS: &str = "Read,Grep,Glob";
/// Built-in tools of the fix profile.
pub const FIX_TOOLS: &str = "Read,Grep,Glob,Edit";
/// Prompt of the startup probe (docs/05 › Startup checks).
pub const PROBE_PROMPT: &str = "Reply with OK";

/// How results come back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    /// One JSON object at the end.
    Json,
    /// stream-json events with partial messages; the last line is the result.
    StreamJson,
}

/// One task run with the read-only profile (or, through [`fix_args`], the fix profile).
#[derive(Debug, Clone)]
pub struct Task {
    pub output: OutputFormat,
    /// JSON Schema for `structured_output` (structured tasks).
    pub json_schema: Option<String>,
    /// Full model ID; `None` = "Same as Claude Code" (flag omitted).
    pub model: Option<String>,
    /// `None` leaves the effort to Claude Code.
    pub effort: Option<Effort>,
    /// Rendered `system-common.md` in the task folder.
    pub system_prompt_file: PathBuf,
    /// `%APPDATA%\GuidedReview\tmp\<task-id>`, readable through `--add-dir`.
    pub task_dir: PathBuf,
    /// Keep the session for follow-ups (`--resume`); one-shot tasks don't.
    pub persist_session: bool,
    /// Continue this Claude session.
    pub resume: Option<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RunnerError {
    #[error("the file to fix must be a relative path inside the worktree: {0}")]
    InvalidFixPath(String),
}

/// Arguments of the read-only profile.
pub fn read_only_args(task: &Task) -> Vec<OsString> {
    profile_args(task, READ_ONLY_TOOLS, None)
}

/// Arguments of the fix profile: the read-only profile plus Edit, allowed for one file only.
/// `file` is relative to the scratch worktree (the working directory of the run).
pub fn fix_args(task: &Task, file: &Path) -> Result<Vec<OsString>, RunnerError> {
    Ok(profile_args(task, FIX_TOOLS, Some(edit_rule(file)?)))
}

fn profile_args(task: &Task, tools: &str, edit_rule: Option<String>) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["-p".into(), "--output-format".into()];
    match task.output {
        OutputFormat::Json => args.push("json".into()),
        OutputFormat::StreamJson => args
            .extend(["stream-json", "--verbose", "--include-partial-messages"].map(OsString::from)),
    }
    if let Some(schema) = &task.json_schema {
        args.extend(["--json-schema".into(), schema.into()]);
    }
    if let Some(model) = &task.model {
        args.extend(["--model".into(), model.into()]);
    }
    if let Some(effort) = task.effort {
        args.extend(["--effort".into(), effort_arg(effort).into()]);
    }
    args.extend(["--tools", tools].map(OsString::from));
    if let Some(rule) = edit_rule {
        args.extend(["--allowedTools".into(), rule.into()]);
    }
    args.extend(
        [
            "--permission-mode",
            "dontAsk",
            "--restricted",
            "--strict-mcp-config",
            "--disallowedTools",
            "mcp__*",
            "--append-system-prompt-file",
        ]
        .map(OsString::from),
    );
    args.push(task.system_prompt_file.clone().into_os_string());
    args.push("--add-dir".into());
    args.push(task.task_dir.clone().into_os_string());
    if !task.persist_session {
        args.push("--no-session-persistence".into());
    }
    if let Some(session) = &task.resume {
        args.extend(["--resume".into(), session.into()]);
    }
    args
}

fn effort_arg(effort: Effort) -> &'static str {
    match effort {
        Effort::Low => "low",
        Effort::Medium => "medium",
        Effort::High => "high",
        Effort::Xhigh => "xhigh",
        Effort::Max => "max",
    }
}

/// `Edit(/<path>)`: anchored to the working directory, forward slashes, gitignore specials
/// escaped (S4). Backslashes would match nothing and a bare name would match at any depth.
pub fn edit_rule(file: &Path) -> Result<String, RunnerError> {
    let invalid = || RunnerError::InvalidFixPath(file.to_string_lossy().into_owned());
    let mut parts = Vec::new();
    // `Path` splits on `\` and `/` on Windows; elsewhere backslashes are split here too.
    let text = file.to_string_lossy().replace('\\', "/");
    for component in Path::new(&text).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(invalid());
            }
        }
    }
    if parts.is_empty() || text.starts_with('/') {
        return Err(invalid());
    }
    let mut path = String::new();
    for (index, part) in parts.iter().enumerate() {
        path.push('/');
        for (position, ch) in part.chars().enumerate() {
            let leading = index == 0 && position == 0 && matches!(ch, '!' | '#');
            if leading || matches!(ch, '*' | '?' | '[' | ']') {
                path.push('\\');
            }
            path.push(ch);
        }
    }
    Ok(format!("Edit({path})"))
}

/// Arguments of the startup probe (no tools, no session, restricted).
pub fn probe_args(model: Option<&str>) -> Vec<OsString> {
    let mut args: Vec<OsString> = ["-p", "--output-format", "json"].map(OsString::from).into();
    if let Some(model) = model {
        args.extend(["--model", model].map(OsString::from));
    }
    args.extend(
        [
            "--tools",
            "",
            "--no-session-persistence",
            "--restricted",
            "--strict-mcp-config",
        ]
        .map(OsString::from),
    );
    args
}

/// `claude --version`.
pub fn version_args() -> Vec<OsString> {
    vec!["--version".into()]
}

/// `claude auth status` (JSON; only `loggedIn` and `authMethod` are read, never logged).
pub fn auth_status_args() -> Vec<OsString> {
    vec!["auth".into(), "status".into()]
}

/// Variables removed from the child's environment when the app runs inside a Claude Code
/// session (`CLAUDECODE` is set, development only); otherwise none (docs/05 › Environment).
pub fn env_removals<I, K, V>(vars: I) -> Vec<OsString>
where
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<OsStr>,
    V: AsRef<OsStr>,
{
    let vars: Vec<(OsString, OsString)> = vars
        .into_iter()
        .map(|(k, v)| (k.as_ref().to_owned(), v.as_ref().to_owned()))
        .collect();
    let upper = |name: &OsStr| name.to_string_lossy().to_uppercase();
    if !vars.iter().any(|(name, _)| upper(name) == "CLAUDECODE") {
        return Vec::new();
    }
    vars.into_iter()
        .map(|(name, _)| name)
        .filter(|name| {
            let name = upper(name);
            matches!(
                name.as_str(),
                "CLAUDECODE" | "CLAUDE_PID" | "CLAUDE_EFFORT" | "ANTHROPIC_BASE_URL"
            ) || name.starts_with("CLAUDE_CODE_")
                || name.starts_with("CLAUDE_AGENT_SDK_")
        })
        .collect()
}

/// The process to run: the executable (native, or node with the npm `cli.js`), the arguments,
/// the working directory, the prompt on stdin and the cleaned environment.
pub fn process_spec(
    executable: &ClaudeExecutable,
    args: Vec<OsString>,
    cwd: &Path,
    prompt: Option<&str>,
    timeout: Duration,
) -> ProcessSpec {
    let spec = match executable {
        ClaudeExecutable::Native(exe) => ProcessSpec::new(exe),
        ClaudeExecutable::NodeScript { node, script } => ProcessSpec::new(node).arg(script),
    };
    let spec = env_removals(std::env::vars_os())
        .into_iter()
        .fold(spec.args(args).cwd(cwd).timeout(timeout), |spec, name| {
            spec.env_remove(name)
        });
    match prompt {
        Some(prompt) => spec.stdin(prompt.as_bytes()),
        None => spec,
    }
}

#[cfg(test)]
mod tests;
