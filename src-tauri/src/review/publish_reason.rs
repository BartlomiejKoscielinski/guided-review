//! Why a Publish request failed, in the words of M5 decision 9 (F-12.5).

use crate::gitlab::error::GitlabError;

pub const LINE_GONE: &str = "the line is no longer in the MR";
pub const REFUSED: &str = "GitLab refused the token";
pub const UNREACHABLE: &str = "GitLab is unreachable";
/// GitLab no longer lists the version the user reviewed: its line numbers can't be anchored.
pub const VERSION_GONE: &str = "the reviewed version is no longer in the MR";

/// Why a request for a draft failed, in the words of decision 9.
pub fn reason(error: &GitlabError) -> String {
    match error {
        GitlabError::Unauthorized | GitlabError::TokenExpired | GitlabError::TokenRevoked => {
            REFUSED.to_owned()
        }
        GitlabError::Unreachable(_) => UNREACHABLE.to_owned(),
        GitlabError::Status {
            status: 400,
            message: Some(message),
        } if is_about_the_line(message) => LINE_GONE.to_owned(),
        GitlabError::Status {
            message: Some(message),
            ..
        }
        | GitlabError::Forbidden {
            message: Some(message),
        } => message.clone(),
        GitlabError::Status {
            status,
            message: None,
        } => format!("GitLab answered {status}"),
        GitlabError::Forbidden { message: None } => {
            "GitLab doesn't allow this for your account".to_owned()
        }
        GitlabError::NotFound => "GitLab didn't find the merge request".to_owned(),
        GitlabError::RateLimited { .. } => "GitLab asks to slow down".to_owned(),
        GitlabError::Decode(_) => "GitLab's answer could not be read".to_owned(),
        other => other.to_string(),
    }
}

/// GitLab's 400 for a position on a line that isn't in the diff names the line code or position.
fn is_about_the_line(message: &str) -> bool {
    let message = message.to_lowercase();
    message.contains("line_code") || message.contains("position")
}

/// The failures after which no further request can succeed.
pub fn stops_the_run(error: &GitlabError) -> bool {
    matches!(
        error,
        GitlabError::Unauthorized
            | GitlabError::TokenExpired
            | GitlabError::TokenRevoked
            | GitlabError::Unreachable(_)
    )
}
