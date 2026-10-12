//! Runs Claude Code: `--version`, `auth status`, the startup probe and tasks (docs/05 ›
//! Startup checks). Command lines come only from `runner.rs`; processes only from
//! `os/process.rs`. Prompts, stdout and stderr are never logged (NFR-08).

use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use super::discover::ClaudeExecutable;
use super::error::{ClaudeError, map_output};
use super::result::ClaudeResult;
use super::runner;
use crate::os::process::{self, Cancel};

/// Minimum Claude Code version (`--restricted`, ADR-022).
pub const MIN_VERSION: (u32, u32, u32) = (2, 1, 248);
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const PROBE_TIMEOUT: Duration = Duration::from_secs(120);

/// "2.1.296 (Claude Code)" → (2, 1, 296).
pub fn parse_version(text: &str) -> Option<(u32, u32, u32)> {
    let version = text.split_whitespace().next()?;
    let mut parts = version.split('.').map(|p| p.parse::<u32>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

/// `claude --version`; `TooOld` below 2.1.248. Returns the version text ("2.1.296").
pub async fn version(
    exe: &ClaudeExecutable,
    cwd: &Path,
    cancel: &Cancel,
) -> Result<String, ClaudeError> {
    let spec = runner::process_spec(exe, runner::version_args(), cwd, None, CHECK_TIMEOUT);
    let output = process::run(&spec, cancel)
        .await
        .map_err(ClaudeError::from_process)?;
    let text = output.stdout.trim().to_owned();
    let short = text
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_owned();
    match parse_version(&text) {
        Some(v) if v >= MIN_VERSION => Ok(short),
        Some(_) => Err(ClaudeError::TooOld { found: short }),
        None => Err(ClaudeError::failed(format!(
            "unexpected version output: {short}"
        ))),
    }
}

/// `loggedIn` and `authMethod` of `claude auth status`; nothing else is read or logged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthStatus {
    pub logged_in: bool,
    pub auth_method: Option<String>,
}

impl AuthStatus {
    pub fn signed_in(&self) -> bool {
        self.logged_in && self.auth_method.as_deref() != Some("none")
    }
}

pub fn parse_auth_status(stdout: &str) -> Option<AuthStatus> {
    let v: Value = serde_json::from_str(stdout.trim()).ok()?;
    Some(AuthStatus {
        logged_in: v["loggedIn"].as_bool().unwrap_or(false),
        auth_method: v["authMethod"].as_str().map(str::to_owned),
    })
}

pub async fn auth_status(
    exe: &ClaudeExecutable,
    cwd: &Path,
    cancel: &Cancel,
) -> Result<AuthStatus, ClaudeError> {
    let spec = runner::process_spec(exe, runner::auth_status_args(), cwd, None, CHECK_TIMEOUT);
    let output = process::run(&spec, cancel)
        .await
        .map_err(ClaudeError::from_process)?;
    // Exit 1 when signed out, still with JSON.
    parse_auth_status(&output.stdout)
        .ok_or_else(|| ClaudeError::failed("claude auth status printed no status"))
}

/// The startup probe: "Reply with OK" without tools; `--model haiku` first, without a model
/// when the organization doesn't allow Haiku (docs/05 › Startup checks).
pub async fn probe(exe: &ClaudeExecutable, cwd: &Path, cancel: &Cancel) -> Result<(), ClaudeError> {
    match probe_with(exe, cwd, Some("haiku"), cancel).await {
        Err(ClaudeError::Failed { .. }) => probe_with(exe, cwd, None, cancel).await,
        other => other,
    }
}

async fn probe_with(
    exe: &ClaudeExecutable,
    cwd: &Path,
    model: Option<&str>,
    cancel: &Cancel,
) -> Result<(), ClaudeError> {
    let spec = runner::process_spec(
        exe,
        runner::probe_args(model),
        cwd,
        Some(runner::PROBE_PROMPT),
        PROBE_TIMEOUT,
    );
    let output = process::run(&spec, cancel)
        .await
        .map_err(ClaudeError::from_process)?;
    map_output(&output, None).map(drop)
}

/// Runs a task with prepared arguments (read-only or fix profile) and maps the result. When a
/// failure isn't recognised, `auth status` decides whether it was a sign-in problem.
pub async fn run_task(
    exe: &ClaudeExecutable,
    args: Vec<OsString>,
    cwd: &Path,
    prompt: &str,
    task_dir: &Path,
    timeout: Duration,
    cancel: &Cancel,
) -> Result<ClaudeResult, ClaudeError> {
    let spec = runner::process_spec(exe, args, cwd, Some(prompt), timeout);
    let output = process::run(&spec, cancel)
        .await
        .map_err(ClaudeError::from_process)?;
    match map_output(&output, Some(task_dir)) {
        Err(ClaudeError::Failed { message, detail }) => match auth_status(exe, cwd, cancel).await {
            Ok(auth) if !auth.signed_in() => Err(ClaudeError::NotSignedIn { detail }),
            _ => Err(ClaudeError::Failed { message, detail }),
        },
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions_and_the_minimum() {
        assert_eq!(parse_version("2.1.296 (Claude Code)"), Some((2, 1, 296)));
        assert!(parse_version("2.1.247 (Claude Code)").unwrap() < MIN_VERSION);
        assert!(parse_version("2.2.0").unwrap() > MIN_VERSION);
        assert_eq!(parse_version("garbage"), None);
    }

    #[test]
    fn f18_1_auth_status_reads_only_two_fields() {
        let s = parse_auth_status(
            r#"{"loggedIn":true,"authMethod":"claude.ai","email":"secret@example.invalid","orgName":"X"}"#,
        )
        .unwrap();
        assert!(s.signed_in());
        let out = parse_auth_status(r#"{"loggedIn":true,"authMethod":"none"}"#).unwrap();
        assert!(!out.signed_in());
        let out = parse_auth_status(r#"{"loggedIn":false}"#).unwrap();
        assert!(!out.signed_in());
    }
}
