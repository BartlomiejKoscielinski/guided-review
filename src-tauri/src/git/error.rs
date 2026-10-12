//! Errors of the git module, mapped to `AppError` at the command boundary.

use crate::error::{AppError, ErrorCode};
use crate::os::process::ProcessError;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git was not found")]
    NotFound,
    #[error("git {found} is older than 2.40")]
    TooOld { found: String },
    /// git ran and failed. `stderr` is git's own message (paths and refs, never file contents).
    #[error("git {command} failed (exit {code:?}): {stderr}")]
    Failed {
        command: String,
        code: Option<i32>,
        stderr: String,
    },
    #[error("git {command} printed output that isn't a valid {what}")]
    Parse { command: String, what: &'static str },
    #[error("not a git repository: {0}")]
    NotARepository(String),
    #[error("{0}")]
    Invalid(String),
    /// Push refused by the remote (non-fast-forward, fetch first, hook).
    #[error("push rejected: {0}")]
    PushRejected(String),
    /// A commit hook failed; carries the hook output.
    #[error("a commit hook failed")]
    HookFailed { output: String },
    #[error("the operation was cancelled")]
    Cancelled,
    #[error(transparent)]
    Process(ProcessError),
}

impl From<ProcessError> for GitError {
    fn from(error: ProcessError) -> Self {
        match error {
            ProcessError::NotFound { .. } => Self::NotFound,
            ProcessError::Cancelled { .. } => Self::Cancelled,
            other => Self::Process(other),
        }
    }
}

impl From<GitError> for AppError {
    fn from(error: GitError) -> Self {
        match error {
            GitError::NotFound => AppError::new(
                ErrorCode::GitNotFound,
                "Git was not found. Install Git for Windows or set its path in Settings.",
            ),
            GitError::TooOld { found } => AppError::new(
                ErrorCode::GitTooOld,
                "Guided Review needs git 2.40 or later.",
            )
            .with_detail(found),
            GitError::NotARepository(path) => AppError::new(
                ErrorCode::InvalidInput,
                "This folder isn't a git repository.",
            )
            .with_detail(path),
            GitError::Invalid(message) => AppError::new(ErrorCode::InvalidInput, message),
            GitError::PushRejected(detail) => AppError::new(
                ErrorCode::Conflict,
                "Push rejected: the remote has commits you don't have.",
            )
            .with_detail(detail),
            GitError::HookFailed { output } => {
                AppError::new(ErrorCode::GitFailed, "Commit failed. A hook rejected it.")
                    .with_detail(output)
            }
            GitError::Cancelled => AppError::new(ErrorCode::Cancelled, "Cancelled."),
            other => AppError::new(ErrorCode::GitFailed, "A git command failed.")
                .with_detail(other.to_string()),
        }
    }
}
