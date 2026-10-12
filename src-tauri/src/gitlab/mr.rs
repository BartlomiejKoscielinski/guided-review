//! One MR (`GET /projects/:id/merge_requests/:iid`): what preparation needs before it fetches
//! (title for the S-02 heading, target branch, head SHA). A 404 stays `GitlabError::NotFound`;
//! the caller turns it into the F-01.5 copy.

use serde::Deserialize;

use super::client::{GitlabClient, project_id};
use super::error::GitlabError;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct MrInfo {
    pub iid: u64,
    pub title: String,
    pub source_branch: String,
    pub target_branch: String,
    /// The head SHA GitLab knows.
    pub sha: Option<String>,
    /// `opened`, `closed`, `locked` or `merged`.
    pub state: String,
}

pub async fn get(client: &GitlabClient, project: &str, iid: u64) -> Result<MrInfo, GitlabError> {
    let path = format!("/projects/{}/merge_requests/{iid}", project_id(project));
    let response = client.get(&path, &[]).await?;
    serde_json::from_value(response.body)
        .map_err(|e| GitlabError::Decode(format!("merge request: {e}")))
}
