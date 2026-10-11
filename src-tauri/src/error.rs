//! `AppError`: the one error type that crosses the IPC boundary (docs/04-architecture.md › IPC contract).
//!
//! Modules define their own `thiserror` errors and map them to `AppError` at the command boundary.
//! Messages are user-facing English; `detail` carries technical context and must never contain
//! tokens, prompts, Claude output or file contents (NFR-08, T4).

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum ErrorCode {
    GitNotFound,
    GitTooOld,
    GitFailed,
    WorktreeFailed,
    GitlabUnauthorized,
    GitlabForbidden,
    GitlabNotFound,
    GitlabRateLimited,
    GitlabUnreachable,
    ClaudeNotFound,
    ClaudeNotSignedIn,
    ClaudeFailed,
    ClaudeSchema,
    ClaudeGuardViolation,
    ClaudeLimited,
    NavUnavailable,
    Cancelled,
    Conflict,
    InvalidInput,
    Internal,
}

impl ErrorCode {
    /// Whether trying the same action again can succeed without the user changing anything first.
    pub const fn is_retryable(self) -> bool {
        matches!(
            self,
            Self::GitlabRateLimited
                | Self::GitlabUnreachable
                | Self::ClaudeFailed
                | Self::ClaudeSchema
                | Self::ClaudeLimited
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, thiserror::Error)]
#[error("{message}")]
#[ts(export)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
    pub retryable: bool,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
            retryable: code.is_retryable(),
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_codes_as_in_the_ipc_contract() {
        let codes = [
            (ErrorCode::GitlabUnauthorized, "GITLAB_UNAUTHORIZED"),
            (ErrorCode::ClaudeGuardViolation, "CLAUDE_GUARD_VIOLATION"),
            (ErrorCode::ClaudeNotSignedIn, "CLAUDE_NOT_SIGNED_IN"),
            (ErrorCode::NavUnavailable, "NAV_UNAVAILABLE"),
            (ErrorCode::InvalidInput, "INVALID_INPUT"),
        ];
        for (code, wire) in codes {
            assert_eq!(serde_json::to_value(code).unwrap(), json!(wire));
        }
    }

    #[test]
    fn omits_detail_when_absent() {
        let e = AppError::new(ErrorCode::GitNotFound, "Git was not found.");
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({ "code": "GIT_NOT_FOUND", "message": "Git was not found.", "retryable": false })
        );
    }

    #[test]
    fn keeps_detail_and_retryable_default() {
        let e = AppError::new(ErrorCode::GitlabUnreachable, "GitLab is unreachable.")
            .with_detail("connect timeout after 10 s");
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["detail"], json!("connect timeout after 10 s"));
        assert_eq!(v["retryable"], json!(true));
        assert_eq!(e.to_string(), "GitLab is unreachable.");
    }

    #[test]
    fn retryable_only_for_transient_codes() {
        assert!(ErrorCode::ClaudeLimited.is_retryable());
        assert!(!ErrorCode::ClaudeNotSignedIn.is_retryable());
        assert!(!ErrorCode::ClaudeGuardViolation.is_retryable());
        assert!(!ErrorCode::Internal.is_retryable());
    }
}
