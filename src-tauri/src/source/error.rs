//! Errors of source detection and session opening, with the S-01 copy (F-01.5, M2 decision 5).

use crate::error::{AppError, ErrorCode};
use crate::git::GitError;

#[derive(Debug, thiserror::Error)]
pub enum SourceError {
    /// Nothing the input could name was found.
    #[error("No commit, branch or repository matches “{0}”.")]
    NoMatch(String),
    /// An MR URL on another host (the host is the payload).
    #[error("{0} is not the configured GitLab server.")]
    OtherServer(String),
    /// An MR URL of a project without a configured repository.
    #[error("{0} is not one of your repositories. Add it in Settings › GitLab.")]
    UnknownProject(String),
    /// No GitLab server configured yet.
    #[error("Add a GitLab token in Settings › GitLab.")]
    NoServer,
    /// `!iid` while the active repository's origin isn't a project on the server.
    #[error("The repository's origin isn't a project on the configured GitLab server.")]
    NoProject,
    #[error("Pick a repository first.")]
    NoRepository,
    /// A commit range, scope or branch that the repository doesn't have.
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Git(#[from] GitError),
}

impl From<SourceError> for AppError {
    fn from(error: SourceError) -> Self {
        match error {
            SourceError::Git(e) => e.into(),
            SourceError::NoServer => {
                AppError::new(ErrorCode::GitlabUnauthorized, error.to_string())
            }
            other => AppError::new(ErrorCode::InvalidInput, other.to_string()),
        }
    }
}
