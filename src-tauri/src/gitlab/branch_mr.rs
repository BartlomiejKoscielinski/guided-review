//! "An MR for this branch already exists" of S-11 (F-27.5, M7 decision 19):
//! `GET /projects/:id/merge_requests?source_branch=<branch>&state=opened`, of which the first (the
//! newest, GitLab's default order) is named in the banner. Reads only.

use serde::Deserialize;

use super::client::{GitlabClient, project_id};
use super::error::GitlabError;

/// An open MR of a branch.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BranchMr {
    pub iid: u64,
    pub title: String,
    pub web_url: String,
}

/// The first open MR whose source branch is `branch` in `project` (`group/project`), if any.
pub async fn open_for_branch(
    client: &GitlabClient,
    project: &str,
    branch: &str,
) -> Result<Option<BranchMr>, GitlabError> {
    let path = format!("/projects/{}/merge_requests", project_id(project));
    let response = client
        .get(
            &path,
            &[
                ("source_branch", branch.to_owned()),
                ("state", "opened".to_owned()),
            ],
        )
        .await?;
    let found: Vec<BranchMr> =
        serde_json::from_value(response.body).map_err(|e| GitlabError::Decode(e.to_string()))?;
    Ok(found.into_iter().next())
}
