//! S-10 Your MR (F-26.1): my merge request as the author answers it, read only. The MR (title,
//! branches), the head of its pipeline for the title bar, and the thread list of
//! `author_threads`. An MR someone else wrote is refused: S-10 is author mode only.

use std::collections::HashSet;

use serde::Serialize;
use ts_rs::TS;

use super::author_threads::{self, AuthorThread, ResolvedSummary};
use super::pipeline_view::{self, PipelineHead};
use crate::error::{AppError, ErrorCode};
use crate::gitlab::client::GitlabClient;
use crate::gitlab::discussions;
use crate::gitlab::error::GitlabError;
use crate::gitlab::mr::{self, MrInfo};

/// What S-10 shows of my MR.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AuthorMr {
    #[ts(type = "number")]
    pub iid: u64,
    pub title: String,
    pub source_branch: String,
    pub target_branch: String,
    /// The head pipeline; `None` when the MR has none.
    pub pipeline: Option<PipelineHead>,
    /// The open threads in GitLab's order.
    pub threads: Vec<AuthorThread>,
    /// "N threads to answer".
    #[ts(type = "number")]
    pub to_answer: usize,
    pub resolved: ResolvedSummary,
}

/// Why my MR could not be read.
#[derive(Debug, thiserror::Error)]
pub enum AuthorMrError {
    #[error("This merge request isn’t yours.")]
    NotMine,
    #[error(transparent)]
    Gitlab(#[from] GitlabError),
}

impl From<AuthorMrError> for AppError {
    fn from(error: AuthorMrError) -> Self {
        match error {
            AuthorMrError::NotMine => AppError::new(ErrorCode::InvalidInput, error.to_string()),
            AuthorMrError::Gitlab(e) => e.into(),
        }
    }
}

/// Whether `info` was written by `me` (the signed-in username).
pub fn is_mine(info: &MrInfo, me: &str) -> bool {
    info.author
        .as_ref()
        .and_then(|a| a.username.as_deref())
        .is_some_and(|username| username == me)
}

/// Reads MR `iid` of `project` for S-10; `me` is the signed-in username, `queued` the discussions
/// with a reply queued for the next push (F-26.5). No proposals exist yet when the screen opens
/// (they come from F-25.3).
pub async fn load(
    client: &GitlabClient,
    project: &str,
    iid: u64,
    me: &str,
    queued: &HashSet<String>,
) -> Result<AuthorMr, AuthorMrError> {
    let info = mr::get(client, project, iid).await?;
    if !is_mine(&info, me) {
        return Err(AuthorMrError::NotMine);
    }
    let threads = discussions::list(client, project, iid).await?;
    let pipeline = match info.head_pipeline.as_ref().and_then(|p| p.id) {
        Some(id) => Some(pipeline_view::head(client, project, iid, id, me).await?),
        None => None,
    };
    let list = author_threads::of(&threads, me, &HashSet::new(), queued);
    Ok(AuthorMr {
        iid: info.iid,
        title: info.title,
        source_branch: info.source_branch,
        target_branch: info.target_branch,
        pipeline,
        threads: list.threads,
        to_answer: list.to_answer,
        resolved: list.resolved,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use serde_json::json;

    fn info(author: serde_json::Value) -> MrInfo {
        serde_json::from_value(json!({
            "iid": 480, "title": "Retry", "source_branch": "feature/upload-retry",
            "target_branch": "develop", "sha": null, "state": "opened",
            "author": author, "head_pipeline": { "id": 7, "status": "success" }
        }))
        .unwrap()
    }

    #[test]
    fn f26_1_only_the_author_s_own_mr_is_mine() {
        let mine = info(json!({ "name": "Bartek K.", "username": "bartek.k" }));
        assert!(is_mine(&mine, "bartek.k"));
        assert!(!is_mine(&mine, "marta.k"));
        assert_eq!(mine.head_pipeline.unwrap().id, Some(7));
        let unnamed = info(json!({ "name": "Bartek K." }));
        assert!(!is_mine(&unnamed, "bartek.k"));
    }

    #[test]
    fn f26_1_someone_else_s_mr_is_invalid_input_with_plain_copy() {
        let error = AppError::from(AuthorMrError::NotMine);
        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value["code"], json!("INVALID_INPUT"));
        assert_eq!(value["message"], json!("This merge request isn’t yours."));
    }
}
