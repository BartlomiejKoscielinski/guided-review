//! One MR (`GET /projects/:id/merge_requests/:iid`): what preparation needs before it fetches
//! (title for the S-02 heading, target branch, head SHA) and the rest of the S-02 header
//! (author, age, pipeline; F-06.1), stored with the session. A 404 stays
//! `GitlabError::NotFound`; the caller turns it into the F-01.5 copy.

use serde::Deserialize;

use super::client::{GitlabClient, project_id};
use super::error::GitlabError;
use super::mrs::PipelineState;

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
    #[serde(default)]
    pub author: Option<MrAuthor>,
    /// ISO 8601.
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub head_pipeline: Option<MrPipeline>,
    /// Markdown; input of the plan task (F-06.8).
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct MrAuthor {
    pub name: String,
    /// Compared with the signed-in user: S-10 opens only the author's own MR (F-26.1).
    #[serde(default)]
    pub username: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct MrPipeline {
    /// REST status in lower case (`success`, `failed`, `running`, …).
    pub status: String,
    /// The pipeline id, for its head on S-10 (F-26.1).
    #[serde(default)]
    pub id: Option<u64>,
}

impl MrInfo {
    /// The head pipeline in S-01's terms; REST statuses are GraphQL's in lower case.
    pub fn pipeline_state(&self) -> Option<PipelineState> {
        self.head_pipeline
            .as_ref()
            .map(|p| PipelineState::from_graphql(&p.status.to_ascii_uppercase()))
    }
}

pub async fn get(client: &GitlabClient, project: &str, iid: u64) -> Result<MrInfo, GitlabError> {
    let path = format!("/projects/{}/merge_requests/{iid}", project_id(project));
    let response = client.get(&path, &[]).await?;
    serde_json::from_value(response.body)
        .map_err(|e| GitlabError::Decode(format!("merge request: {e}")))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use serde_json::json;

    #[test]
    fn f06_1_rest_pipeline_status_maps_to_the_s01_states() {
        let info: MrInfo = serde_json::from_value(json!({
            "iid": 482, "title": "Torch", "source_branch": "feature/torch",
            "target_branch": "develop", "sha": null, "state": "opened",
            "author": { "name": "Marta K." }, "created_at": "2026-10-12T08:00:00Z",
            "head_pipeline": { "status": "success" }
        }))
        .unwrap();
        assert_eq!(info.pipeline_state(), Some(PipelineState::Passed));
        assert_eq!(info.author.unwrap().name, "Marta K.");
        let bare: MrInfo = serde_json::from_value(json!({
            "iid": 1, "title": "t", "source_branch": "a", "target_branch": "b",
            "sha": null, "state": "opened", "head_pipeline": null
        }))
        .unwrap();
        assert_eq!(bare.pipeline_state(), None);
    }
}
