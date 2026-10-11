//! GitLab client errors and their mapping to `AppError` (docs/05 › GitLab REST API v4: 401 →
//! `GITLAB_UNAUTHORIZED`, 403 → `GITLAB_FORBIDDEN` with GitLab's message, 404 →
//! `GITLAB_NOT_FOUND`, 429 → `GITLAB_RATE_LIMITED` with `Retry-After`).

use std::time::Duration;

use serde_json::Value;

use super::tls::TlsProblem;
use crate::error::{AppError, ErrorCode};

/// Longest GitLab message kept in an error.
const MESSAGE_LIMIT: usize = 300;

/// Why GitLab could not be reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "tls")]
pub enum NetworkProblem {
    /// The host name could not be resolved (wrong URL, no VPN).
    Dns,
    Refused,
    Timeout,
    Tls(TlsProblem),
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GitlabError {
    #[error("the GitLab server URL is invalid")]
    InvalidUrl,
    #[error("the token can't be sent in an HTTP header")]
    InvalidToken,
    #[error("the HTTP client could not be created: {0}")]
    Setup(String),
    #[error("GitLab is unreachable: {0:?}")]
    Unreachable(NetworkProblem),
    #[error("GitLab rejected the token (401)")]
    Unauthorized,
    #[error("GitLab refused the request (403)")]
    Forbidden { message: Option<String> },
    #[error("not found on GitLab (404)")]
    NotFound,
    #[error("GitLab rate limit (429)")]
    RateLimited { retry_after: Option<Duration> },
    #[error("GitLab answered {status}")]
    Status {
        status: u16,
        message: Option<String>,
    },
    #[error("GitLab's answer could not be read: {0}")]
    Decode(String),
}

impl GitlabError {
    /// The error for an HTTP error status; `body` is GitLab's JSON error, if any.
    pub fn from_status(status: u16, retry_after: Option<Duration>, body: &Value) -> Self {
        match status {
            401 => Self::Unauthorized,
            403 => Self::Forbidden {
                message: error_message(body),
            },
            404 => Self::NotFound,
            429 => Self::RateLimited { retry_after },
            _ => Self::Status {
                status,
                message: error_message(body),
            },
        }
    }
}

/// GitLab's error text: `message` (a string, or an object/array of field errors), else
/// `error_description` or `error`; shortened to [`MESSAGE_LIMIT`] characters.
pub fn error_message(body: &Value) -> Option<String> {
    let text = match body.get("message") {
        Some(Value::String(message)) => message.clone(),
        Some(message @ (Value::Object(_) | Value::Array(_))) => message.to_string(),
        _ => ["error_description", "error"]
            .iter()
            .find_map(|key| body.get(*key).and_then(Value::as_str))?
            .to_owned(),
    };
    Some(text.chars().take(MESSAGE_LIMIT).collect())
}

impl From<GitlabError> for AppError {
    fn from(error: GitlabError) -> Self {
        let detail = error.to_string();
        match error {
            GitlabError::Unauthorized => AppError::new(
                ErrorCode::GitlabUnauthorized,
                "GitLab didn't accept the token. Check it in Settings › GitLab.",
            ),
            GitlabError::Forbidden { message } => {
                let e = AppError::new(
                    ErrorCode::GitlabForbidden,
                    "GitLab doesn't allow this for your account.",
                );
                match message {
                    Some(message) => e.with_detail(message),
                    None => e,
                }
            }
            GitlabError::NotFound => {
                AppError::new(ErrorCode::GitlabNotFound, "GitLab didn't find it.")
            }
            GitlabError::RateLimited { retry_after } => {
                let e = AppError::new(
                    ErrorCode::GitlabRateLimited,
                    "GitLab asks to slow down. Try again in a moment.",
                );
                match retry_after {
                    Some(wait) => e.with_detail(format!("Retry after {} s.", wait.as_secs())),
                    None => e,
                }
            }
            GitlabError::Unreachable(problem) => {
                AppError::new(ErrorCode::GitlabUnreachable, unreachable_message(problem))
                    .with_detail(detail)
            }
            GitlabError::Status { status: 409, .. } => {
                AppError::new(ErrorCode::Conflict, "GitLab reports a conflict.").with_detail(detail)
            }
            GitlabError::Status { status, .. } if status >= 500 => {
                AppError::new(ErrorCode::GitlabUnreachable, "GitLab had a server error.")
                    .with_detail(detail)
            }
            GitlabError::InvalidUrl => {
                AppError::new(ErrorCode::InvalidInput, "The GitLab server URL is invalid.")
            }
            GitlabError::InvalidToken => AppError::new(
                ErrorCode::GitlabUnauthorized,
                "The token contains characters GitLab tokens never have.",
            ),
            GitlabError::Status { .. } | GitlabError::Decode(_) | GitlabError::Setup(_) => {
                AppError::internal("GitLab's answer was unexpected.").with_detail(detail)
            }
        }
    }
}

fn unreachable_message(problem: NetworkProblem) -> &'static str {
    match problem {
        NetworkProblem::Dns => {
            "The GitLab server name can't be resolved. Check the URL and the VPN."
        }
        NetworkProblem::Refused => "The GitLab server refused the connection.",
        NetworkProblem::Timeout => "GitLab didn't answer in time.",
        NetworkProblem::Tls(TlsProblem::UnknownIssuer) => {
            "Windows doesn't trust GitLab's certificate. Its CA must be in the Windows certificate store."
        }
        NetworkProblem::Tls(TlsProblem::Expired | TlsProblem::NotYetValid) => {
            "GitLab's certificate isn't valid at this date."
        }
        NetworkProblem::Tls(TlsProblem::NameMismatch) => {
            "GitLab's certificate is for another server name."
        }
        NetworkProblem::Tls(TlsProblem::Revoked) => "GitLab's certificate was revoked.",
        NetworkProblem::Tls(_) => "The secure connection to GitLab failed (certificate or TLS).",
        NetworkProblem::Other => "GitLab can't be reached.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_statuses_to_errors() {
        assert_eq!(
            GitlabError::from_status(401, None, &json!({"message": "401 Unauthorized"})),
            GitlabError::Unauthorized
        );
        assert_eq!(
            GitlabError::from_status(403, None, &json!({"message": "403 Forbidden"})),
            GitlabError::Forbidden {
                message: Some("403 Forbidden".into())
            }
        );
        assert_eq!(
            GitlabError::from_status(404, None, &Value::Null),
            GitlabError::NotFound
        );
        assert_eq!(
            GitlabError::from_status(429, Some(Duration::from_secs(30)), &Value::Null),
            GitlabError::RateLimited {
                retry_after: Some(Duration::from_secs(30))
            }
        );
        assert_eq!(
            GitlabError::from_status(409, None, &json!({"message": "SHA does not match"})),
            GitlabError::Status {
                status: 409,
                message: Some("SHA does not match".into())
            }
        );
    }

    #[test]
    fn reads_gitlab_error_shapes() {
        assert_eq!(
            error_message(&json!({"message": {"base": ["Branch is protected"]}})),
            Some(r#"{"base":["Branch is protected"]}"#.into())
        );
        assert_eq!(
            error_message(&json!({"error": "invalid_token", "error_description": "Token expired"})),
            Some("Token expired".into())
        );
        assert_eq!(
            error_message(&json!({"error": "insufficient_scope"})),
            Some("insufficient_scope".into())
        );
        assert_eq!(error_message(&json!({"other": 1})), None);
        let long = "x".repeat(1000);
        assert_eq!(
            error_message(&json!({ "message": long }))
                .unwrap()
                .chars()
                .count(),
            MESSAGE_LIMIT
        );
    }

    #[test]
    fn maps_to_app_error_codes() {
        let cases = [
            (GitlabError::Unauthorized, ErrorCode::GitlabUnauthorized),
            (
                GitlabError::Forbidden { message: None },
                ErrorCode::GitlabForbidden,
            ),
            (GitlabError::NotFound, ErrorCode::GitlabNotFound),
            (
                GitlabError::RateLimited { retry_after: None },
                ErrorCode::GitlabRateLimited,
            ),
            (
                GitlabError::Unreachable(NetworkProblem::Dns),
                ErrorCode::GitlabUnreachable,
            ),
            (
                GitlabError::Unreachable(NetworkProblem::Tls(TlsProblem::UnknownIssuer)),
                ErrorCode::GitlabUnreachable,
            ),
            (
                GitlabError::Status {
                    status: 409,
                    message: None,
                },
                ErrorCode::Conflict,
            ),
            (
                GitlabError::Status {
                    status: 502,
                    message: None,
                },
                ErrorCode::GitlabUnreachable,
            ),
            (GitlabError::InvalidUrl, ErrorCode::InvalidInput),
            (GitlabError::Decode("x".into()), ErrorCode::Internal),
        ];
        for (error, code) in cases {
            assert_eq!(AppError::from(error.clone()).code, code, "{error:?}");
        }
    }

    #[test]
    fn forbidden_shows_gitlab_message_and_tls_problems_explain_themselves() {
        let e = AppError::from(GitlabError::Forbidden {
            message: Some("insufficient_scope".into()),
        });
        assert_eq!(e.detail.as_deref(), Some("insufficient_scope"));
        let e = AppError::from(GitlabError::Unreachable(NetworkProblem::Tls(
            TlsProblem::UnknownIssuer,
        )));
        assert!(e.message.contains("certificate"), "{}", e.message);
        let e = AppError::from(GitlabError::RateLimited {
            retry_after: Some(Duration::from_secs(30)),
        });
        assert!(e.retryable);
        assert_eq!(e.detail.as_deref(), Some("Retry after 30 s."));
    }
}
