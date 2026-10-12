//! Errors of Claude tasks and how a `claude -p` run maps to them (docs/05 › Errors from Claude,
//! in this order): missing executable, usage limit (429), not signed in, any other failure.
//! `subtype` is never used to detect failure (S1). A Read of the task folder that was denied
//! fails the task, because the answer was built without its inputs (R-04).

use std::path::Path;

use serde_json::Value;

use super::result::{ClaudeResult, parse_result};
use crate::error::{AppError, ErrorCode};
use crate::os::process::{ProcessError, ProcessOutput};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ClaudeError {
    #[error("Claude Code was not found")]
    NotFound,
    #[error("Claude Code {found} is older than 2.1.248")]
    TooOld { found: String },
    #[error("Claude Code is not signed in")]
    NotSignedIn { detail: Option<String> },
    /// F-18.7. `resets_at`: Unix seconds when Claude gives a reset time.
    #[error("Claude usage limit reached")]
    Limited {
        resets_at: Option<i64>,
        detail: Option<String>,
    },
    #[error("{message}")]
    Failed {
        message: String,
        detail: Option<String>,
    },
    #[error("Claude's answer didn't fit the expected format: {0}")]
    Schema(String),
    #[error("{0}")]
    Invalid(String),
    #[error("cancelled")]
    Cancelled,
}

impl ClaudeError {
    pub fn failed(detail: impl Into<String>) -> Self {
        Self::Failed {
            message: "Claude couldn't finish the task.".to_owned(),
            detail: Some(detail.into()),
        }
    }

    pub fn from_process(error: ProcessError) -> Self {
        match error {
            ProcessError::NotFound { .. } => Self::NotFound,
            ProcessError::Cancelled { .. } => Self::Cancelled,
            ProcessError::TimedOut { .. } => Self::failed("Claude Code didn't finish in time."),
            other => Self::failed(other.to_string()),
        }
    }
}

impl From<ClaudeError> for AppError {
    fn from(error: ClaudeError) -> Self {
        match error {
            ClaudeError::NotFound => {
                AppError::new(ErrorCode::ClaudeNotFound, "Claude Code: not found")
            }
            ClaudeError::TooOld { found } => AppError::new(
                ErrorCode::ClaudeFailed,
                "Guided Review needs Claude Code 2.1.248 or later.",
            )
            .with_detail(found),
            ClaudeError::NotSignedIn { detail } => {
                let e = AppError::new(ErrorCode::ClaudeNotSignedIn, "Claude Code: not signed in");
                match detail {
                    Some(d) => e.with_detail(d),
                    None => e,
                }
            }
            ClaudeError::Limited { detail, .. } => {
                let e = AppError::new(ErrorCode::ClaudeLimited, "Claude usage limit reached");
                match detail {
                    Some(d) => e.with_detail(d),
                    None => e,
                }
            }
            ClaudeError::Failed { message, detail } => {
                let e = AppError::new(ErrorCode::ClaudeFailed, message);
                match detail {
                    Some(d) => e.with_detail(d),
                    None => e,
                }
            }
            ClaudeError::Schema(detail) => AppError::new(
                ErrorCode::ClaudeSchema,
                "Claude's answer didn't fit the expected format.",
            )
            .with_detail(detail),
            ClaudeError::Invalid(message) => AppError::new(ErrorCode::InvalidInput, message),
            ClaudeError::Cancelled => AppError::new(ErrorCode::Cancelled, "Cancelled."),
        }
    }
}

const NOT_SIGNED_IN: [&str; 2] = ["Not logged in", "Failed to authenticate"];

/// Maps a finished run to its result or error. `task_dir` is the folder whose Reads must not
/// be denied.
pub fn map_output(
    output: &ProcessOutput,
    task_dir: Option<&Path>,
) -> Result<ClaudeResult, ClaudeError> {
    let Some((result, _raw)) = parse_result(&output.stdout) else {
        let detail = output.stderr.trim();
        return Err(ClaudeError::failed(if detail.is_empty() {
            "Claude Code ended without a result.".to_owned()
        } else {
            detail.to_owned()
        }));
    };
    if result.is_error {
        let text = result.result.clone().unwrap_or_default();
        if result.api_error_status == Some(429) {
            return Err(ClaudeError::Limited {
                resets_at: resets_at(&output.stdout),
                detail: (!text.is_empty()).then_some(text),
            });
        }
        if result.terminal_reason.as_deref() == Some("api_error")
            && NOT_SIGNED_IN.iter().any(|p| text.starts_with(p))
        {
            return Err(ClaudeError::NotSignedIn { detail: Some(text) });
        }
        return Err(ClaudeError::failed(if text.is_empty() {
            format!(
                "{} (api status {:?})",
                result.terminal_reason.as_deref().unwrap_or("error"),
                result.api_error_status
            )
        } else {
            text
        }));
    }
    if task_dir.is_some_and(|dir| denied_input_read(&result, dir)) {
        return Err(ClaudeError::Failed {
            message: "Claude couldn't read the task inputs.".to_owned(),
            detail: None,
        });
    }
    Ok(result)
}

/// Whether a denied tool call tried to read a file under the task folder.
fn denied_input_read(result: &ClaudeResult, task_dir: &Path) -> bool {
    let dir = normalize(&task_dir.to_string_lossy());
    result.permission_denials.iter().any(|denial| {
        let input = &denial["tool_input"];
        ["file_path", "path"]
            .iter()
            .filter_map(|key| input[key].as_str())
            .any(|p| normalize(p).starts_with(&dir))
    })
}

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// `resetsAt` of a rejected `rate_limit_event` in stream-json output (Unix seconds).
pub fn resets_at(stdout: &str) -> Option<i64> {
    stdout.lines().rev().find_map(|line| {
        let v: Value = serde_json::from_str(line.trim()).ok()?;
        if v["type"] != "rate_limit_event" {
            return None;
        }
        let info = &v["rate_limit_info"];
        if info["status"] != "rejected" {
            return None;
        }
        info["resetsAt"]
            .as_i64()
            .or_else(|| info["resetsAt"].as_str()?.parse().ok())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn output(stdout: &str, code: i32) -> ProcessOutput {
        ProcessOutput {
            code: Some(code),
            stdout: stdout.to_owned(),
            stderr: String::new(),
            lossy: false,
            duration: Duration::ZERO,
        }
    }

    #[test]
    fn f18_7_usage_limit_maps_to_limited_with_the_reset_time() {
        let stdout = concat!(
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","errorCode":"credits_required","resetsAt":1791800000}}"#,
            "\n",
            r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"Usage limit reached"}"#
        );
        let err = map_output(&output(stdout, 1), None).unwrap_err();
        assert_eq!(
            err,
            ClaudeError::Limited {
                resets_at: Some(1_791_800_000),
                detail: Some("Usage limit reached".into())
            }
        );
        let app: AppError = err.into();
        assert_eq!(app.code, ErrorCode::ClaudeLimited);
        assert!(app.retryable);
        assert_eq!(app.message, "Claude usage limit reached");
    }

    #[test]
    fn f18_1_sign_in_texts_map_to_not_signed_in() {
        for text in [
            "Not logged in · Please run /login",
            "Failed to authenticate: OAuth session expired and could not be refreshed",
        ] {
            let stdout = serde_json::json!({
                "type": "result", "is_error": true, "terminal_reason": "api_error", "result": text
            })
            .to_string();
            assert!(matches!(
                map_output(&output(&stdout, 1), None),
                Err(ClaudeError::NotSignedIn { .. })
            ));
        }
    }

    #[test]
    fn other_failures_and_missing_results() {
        let unknown_model = r#"{"type":"result","is_error":true,"api_error_status":404,"terminal_reason":"api_error","result":"model not found"}"#;
        assert!(matches!(
            map_output(&output(unknown_model, 1), None),
            Err(ClaudeError::Failed { .. })
        ));
        let mut flag_error = output("", 1);
        flag_error.stderr = "error: unknown option '--x'".into();
        assert_eq!(
            map_output(&flag_error, None),
            Err(ClaudeError::failed("error: unknown option '--x'"))
        );
        // subtype "success" with is_error true is still an error (S1).
        let s = r#"{"type":"result","subtype":"success","is_error":true,"result":"x"}"#;
        assert!(map_output(&output(s, 0), None).is_err());
    }

    #[test]
    fn a_denied_read_of_the_task_folder_fails_the_task() {
        let dir = Path::new(r"C:\Users\x\AppData\Roaming\GuidedReview\tmp\abc");
        let stdout = serde_json::json!({
            "type": "result", "is_error": false, "structured_output": {},
            "permission_denials": [{ "tool_name": "Read", "tool_input": { "file_path": "C:/Users/x/AppData/Roaming/GuidedReview/tmp/abc/staged.diff" } }]
        })
        .to_string();
        let err = map_output(&output(&stdout, 0), Some(dir)).unwrap_err();
        assert_eq!(err.to_string(), "Claude couldn't read the task inputs.");
        // Denials elsewhere don't fail the task.
        let other = stdout.replace("GuidedReview/tmp/abc/staged.diff", "Other/file.txt");
        assert!(map_output(&output(&other, 0), Some(dir)).is_ok());
    }
}
