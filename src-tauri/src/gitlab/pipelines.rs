//! The pipelines of an MR over REST (F-20.1, docs/05 › GitLab REST API v4), read only:
//! `mr_pipelines` (`GET …/merge_requests/:iid/pipelines`, paged; no `user` or `duration` there),
//! `pipeline` (`GET …/pipelines/:id`, the full object) and `pipeline_jobs`
//! (`GET …/pipelines/:id/jobs`, for the allowed failures).

use serde::Deserialize;

use super::client::{GitlabClient, project_id};
use super::discussions::MAX_PAGES;
use super::error::GitlabError;
use super::mrs::PipelineState;

/// One entry of the MR's pipeline list.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ListedPipeline {
    pub id: u64,
    pub sha: String,
    pub status: String,
}

/// Who started a pipeline.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PipelineUser {
    pub username: String,
    pub name: String,
}

/// `GET …/pipelines/:id`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Pipeline {
    pub id: u64,
    pub sha: String,
    pub status: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub user: Option<PipelineUser>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub duration: Option<u64>,
    #[serde(default)]
    pub web_url: Option<String>,
}

/// One job of a pipeline, as far as the head needs it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PipelineJob {
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub allow_failure: bool,
}

impl PipelineState {
    /// From a REST pipeline `status` (M6 decision 1): created, pending and preparing read as
    /// Running; waiting for a resource and scheduled as Waiting.
    pub fn from_rest(status: &str) -> Self {
        match status {
            "success" => Self::Passed,
            "failed" => Self::Failed,
            "running" | "pending" | "created" | "preparing" => Self::Running,
            "canceled" | "canceling" => Self::Canceled,
            "skipped" => Self::Skipped,
            "manual" => Self::Manual,
            _ => Self::Waiting,
        }
    }
}

/// GitLab's pipeline `source` in the words of S-08's meta line ("Merge request pipeline").
pub fn kind_of(source: Option<&str>) -> String {
    let words = match source.unwrap_or("") {
        "merge_request_event" => "Merge request",
        "push" => "Branch",
        "schedule" => "Schedule",
        "web" => "Web",
        "api" => "API",
        "trigger" => "Trigger",
        "pipeline" | "parent_pipeline" => "Child",
        "external" | "external_pull_request_event" => "External",
        "chat" => "Chat",
        "" => return "Pipeline".to_owned(),
        other => return format!("{} pipeline", capitalized(&other.replace('_', " "))),
    };
    format!("{words} pipeline")
}

fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

fn decode<T: for<'de> Deserialize<'de>>(
    path: &str,
    value: serde_json::Value,
) -> Result<T, GitlabError> {
    serde_json::from_value(value).map_err(|e| GitlabError::Decode(format!("{path}: {e}")))
}

/// Every pipeline of the MR (all pages), in the order GitLab answers.
pub async fn mr_pipelines(
    client: &GitlabClient,
    project: &str,
    iid: u64,
) -> Result<Vec<ListedPipeline>, GitlabError> {
    let path = format!(
        "/projects/{}/merge_requests/{iid}/pipelines",
        project_id(project)
    );
    let (items, _) = client.get_pages(&path, &[], MAX_PAGES).await?;
    items.into_iter().map(|item| decode(&path, item)).collect()
}

/// One pipeline with its user, start and duration.
pub async fn pipeline(
    client: &GitlabClient,
    project: &str,
    id: u64,
) -> Result<Pipeline, GitlabError> {
    let path = format!("/projects/{}/pipelines/{id}", project_id(project));
    let response = client.get(&path, &[]).await?;
    decode(&path, response.body)
}

/// The jobs of one pipeline (all pages).
pub async fn pipeline_jobs(
    client: &GitlabClient,
    project: &str,
    id: u64,
) -> Result<Vec<PipelineJob>, GitlabError> {
    let path = format!("/projects/{}/pipelines/{id}/jobs", project_id(project));
    let (items, _) = client.get_pages(&path, &[], MAX_PAGES).await?;
    items.into_iter().map(|item| decode(&path, item)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f20_1_rest_states_follow_decision_1() {
        for (status, state) in [
            ("success", PipelineState::Passed),
            ("failed", PipelineState::Failed),
            ("running", PipelineState::Running),
            ("pending", PipelineState::Running),
            ("created", PipelineState::Running),
            ("preparing", PipelineState::Running),
            ("waiting_for_resource", PipelineState::Waiting),
            ("scheduled", PipelineState::Waiting),
            ("canceled", PipelineState::Canceled),
            ("skipped", PipelineState::Skipped),
            ("manual", PipelineState::Manual),
        ] {
            assert_eq!(PipelineState::from_rest(status), state, "{status}");
        }
    }

    #[test]
    fn f20_1_unknown_sources_read_as_words() {
        assert_eq!(
            kind_of(Some("merge_request_event")),
            "Merge request pipeline"
        );
        assert_eq!(
            kind_of(Some("security_orchestration_policy")),
            "Security orchestration policy pipeline"
        );
        assert_eq!(kind_of(None), "Pipeline");
    }
}
