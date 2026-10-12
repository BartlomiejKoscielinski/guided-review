//! "Claude Code: signed in" (F-18.1): the latest of `auth status`, the startup probe and the
//! last task result (docs/05 › Startup checks). The probe runs when the version changed since
//! the last successful probe, or after a task failed with `CLAUDE_NOT_SIGNED_IN`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use ts_rs::TS;

use super::discover::{ClaudeExecutable, DiscoveryInput, discover};
use super::error::ClaudeError;
use super::exec;
use crate::os::process::Cancel;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ClaudeState {
    Checking,
    SignedIn,
    NotSignedIn,
    NotFound,
    TooOld,
    Limited,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClaudeStatus {
    pub state: ClaudeState,
    /// The executable the app uses (F-18.6).
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// "2.1.296".
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Usage limit reset, Unix seconds (F-18.7).
    #[ts(optional, type = "number")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<i64>,
    /// Claude Code's own message for failures.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl ClaudeStatus {
    pub fn checking() -> Self {
        Self {
            state: ClaudeState::Checking,
            path: None,
            version: None,
            resets_at: None,
            detail: None,
        }
    }

    fn with(&self, state: ClaudeState) -> Self {
        Self {
            state,
            resets_at: None,
            detail: None,
            ..self.clone()
        }
    }
}

/// The status shown in the UI, updated by checks and task results.
#[derive(Debug)]
pub struct StatusCell(Mutex<ClaudeStatus>);

impl Default for StatusCell {
    fn default() -> Self {
        Self(Mutex::new(ClaudeStatus::checking()))
    }
}

impl StatusCell {
    pub fn get(&self) -> ClaudeStatus {
        self.0
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|_| ClaudeStatus::checking())
    }

    pub fn set(&self, status: ClaudeStatus) {
        if let Ok(mut s) = self.0.lock() {
            *s = status;
        }
    }

    /// A finished task: success means signed in; sign-in and limit errors change the status;
    /// other failures don't say anything about the login.
    pub fn task_result(&self, result: Result<(), &ClaudeError>) {
        let current = self.get();
        let next = match result {
            Ok(()) => current.with(ClaudeState::SignedIn),
            Err(ClaudeError::NotSignedIn { .. }) => current.with(ClaudeState::NotSignedIn),
            Err(ClaudeError::NotFound) => current.with(ClaudeState::NotFound),
            Err(ClaudeError::Limited { resets_at, detail }) => ClaudeStatus {
                resets_at: *resets_at,
                detail: detail.clone(),
                ..current.with(ClaudeState::Limited)
            },
            Err(_) => return,
        };
        self.set(next);
    }
}

/// What a check needs to know besides the executable.
#[derive(Debug, Clone)]
pub struct CheckInput {
    /// `claude.path` from Settings.
    pub configured: Option<PathBuf>,
    /// Version of the last successful probe (`app_state`).
    pub probed_version: Option<String>,
    /// A task failed with `CLAUDE_NOT_SIGNED_IN` since then.
    pub reprobe: bool,
    /// Working directory for the checks (the app's tmp folder).
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckOutcome {
    pub status: ClaudeStatus,
    /// Set when the probe ran and succeeded: store it as the probed version.
    pub probed: Option<String>,
    pub executable: Option<ClaudeExecutable>,
}

/// Resolves the executable (ADR-021) and runs the startup checks.
pub async fn check(input: &CheckInput, cancel: &Cancel) -> CheckOutcome {
    let Some(exe) = discover(&DiscoveryInput::from_env(input.configured.clone())) else {
        return CheckOutcome {
            status: ClaudeStatus::checking().with(ClaudeState::NotFound),
            probed: None,
            executable: None,
        };
    };
    let mut status = ClaudeStatus {
        path: Some(exe.display_path().to_string_lossy().into_owned()),
        ..ClaudeStatus::checking()
    };
    let outcome = |status: ClaudeStatus, probed: Option<String>| CheckOutcome {
        status,
        probed,
        executable: Some(exe.clone()),
    };
    let cwd: &Path = &input.cwd;
    let version = match exec::version(&exe, cwd, cancel).await {
        Ok(v) => v,
        Err(error) => return outcome(from_error(&status, &error), None),
    };
    status.version = Some(version.clone());
    match exec::auth_status(&exe, cwd, cancel).await {
        Ok(auth) if !auth.signed_in() => {
            return outcome(status.with(ClaudeState::NotSignedIn), None);
        }
        Ok(_) => {}
        Err(error) => return outcome(from_error(&status, &error), None),
    }
    let needs_probe = input.reprobe || input.probed_version.as_deref() != Some(version.as_str());
    if !needs_probe {
        return outcome(status.with(ClaudeState::SignedIn), None);
    }
    match exec::probe(&exe, cwd, cancel).await {
        Ok(()) => outcome(status.with(ClaudeState::SignedIn), Some(version)),
        Err(error) => outcome(from_error(&status, &error), None),
    }
}

fn from_error(status: &ClaudeStatus, error: &ClaudeError) -> ClaudeStatus {
    match error {
        ClaudeError::NotFound => status.with(ClaudeState::NotFound),
        ClaudeError::TooOld { found } => ClaudeStatus {
            version: Some(found.clone()),
            ..status.with(ClaudeState::TooOld)
        },
        ClaudeError::NotSignedIn { .. } => status.with(ClaudeState::NotSignedIn),
        ClaudeError::Limited { resets_at, detail } => ClaudeStatus {
            resets_at: *resets_at,
            detail: detail.clone(),
            ..status.with(ClaudeState::Limited)
        },
        other => ClaudeStatus {
            detail: Some(other.to_string()),
            ..status.with(ClaudeState::Failed)
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f18_1_task_results_update_the_status() {
        let cell = StatusCell::default();
        cell.task_result(Ok(()));
        assert_eq!(cell.get().state, ClaudeState::SignedIn);
        cell.task_result(Err(&ClaudeError::failed("model hiccup")));
        assert_eq!(
            cell.get().state,
            ClaudeState::SignedIn,
            "other failures keep it"
        );
        cell.task_result(Err(&ClaudeError::NotSignedIn { detail: None }));
        assert_eq!(cell.get().state, ClaudeState::NotSignedIn);
        cell.task_result(Err(&ClaudeError::Limited {
            resets_at: Some(5),
            detail: None,
        }));
        assert_eq!(cell.get().state, ClaudeState::Limited);
        assert_eq!(cell.get().resets_at, Some(5));
    }
}
