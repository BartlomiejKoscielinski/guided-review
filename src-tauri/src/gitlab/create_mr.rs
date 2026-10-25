//! "Create merge request" of S-11 (F-27.6): `POST /projects/:id/merge_requests` with the source
//! and target branch, the title (`Draft: ` in front when Mark as draft is on, never twice), the
//! description, `reviewer_ids`, `remove_source_branch` and `squash`. Sent only by the explicit
//! click, once per call: a refusal is never retried. GitLab's own words for a refusal (409 an
//! open MR of the branch exists, 422 invalid) become the `AppError` message (`error.rs`).

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use super::client::{GitlabClient, project_id};
use super::error::GitlabError;
use super::mrs::PipelineState;

/// The prefix GitLab reads as a draft MR.
const DRAFT_PREFIX: &str = "Draft: ";

/// What S-11 sends for a new MR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewMr {
    pub source_branch: String,
    pub target_branch: String,
    /// As typed; [`create`] adds `Draft: ` when `draft` is on.
    pub title: String,
    pub description: String,
    pub reviewer_ids: Vec<u64>,
    pub draft: bool,
    pub remove_source_branch: bool,
    pub squash: bool,
}

/// **Create merge request** / **Create draft MR** as S-11 asks for it: the source branch is the
/// checked-out one, read by the core.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CreateMrRequest {
    /// A branch on origin.
    pub target: String,
    /// As typed; the core adds `Draft: ` when `draft` is on.
    pub title: String,
    pub description: String,
    /// In the order of the Reviewer list.
    #[ts(type = "Array<number>")]
    pub reviewer_ids: Vec<u64>,
    pub draft: bool,
    pub remove_source_branch: bool,
    pub squash: bool,
}

/// The head pipeline of a new MR (the success view's pipeline tile).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct CreatedPipeline {
    #[ts(type = "number")]
    pub id: u64,
    pub status: PipelineState,
}

/// The MR GitLab made: S-11's success view ("!483", the title GitLab stored, the link).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CreatedMr {
    #[ts(type = "number")]
    pub iid: u64,
    pub title: String,
    pub web_url: String,
    /// `None` while GitLab has started none yet.
    pub pipeline: Option<CreatedPipeline>,
}

#[derive(Deserialize)]
struct Answer {
    iid: u64,
    title: String,
    web_url: String,
    #[serde(default)]
    head_pipeline: Option<AnswerPipeline>,
}

#[derive(Deserialize)]
struct AnswerPipeline {
    id: u64,
    status: String,
}

/// The title GitLab gets: `Draft: ` in front when `draft` is on and the title has none yet.
pub fn sent_title(title: &str, draft: bool) -> String {
    if draft && !title.starts_with(DRAFT_PREFIX) {
        format!("{DRAFT_PREFIX}{title}")
    } else {
        title.to_owned()
    }
}

/// The request body of `POST …/merge_requests`.
pub fn body(mr: &NewMr) -> Value {
    json!({
        "source_branch": mr.source_branch,
        "target_branch": mr.target_branch,
        "title": sent_title(&mr.title, mr.draft),
        "description": mr.description,
        "reviewer_ids": mr.reviewer_ids,
        "remove_source_branch": mr.remove_source_branch,
        "squash": mr.squash,
    })
}

/// Creates the MR in `project` (`group/project`): one POST, never retried.
pub async fn create(
    client: &GitlabClient,
    project: &str,
    mr: &NewMr,
) -> Result<CreatedMr, GitlabError> {
    let path = format!("/projects/{}/merge_requests", project_id(project));
    let response = client.post(&path, &body(mr)).await?;
    let answer: Answer =
        serde_json::from_value(response.body).map_err(|e| GitlabError::Decode(e.to_string()))?;
    Ok(CreatedMr {
        iid: answer.iid,
        title: answer.title,
        web_url: answer.web_url,
        pipeline: answer.head_pipeline.map(|p| CreatedPipeline {
            id: p.id,
            status: PipelineState::from_rest(&p.status),
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f27_6_draft_prefix_once_and_only_with_draft() {
        assert_eq!(sent_title("Fix", true), "Draft: Fix");
        assert_eq!(sent_title("Draft: Fix", true), "Draft: Fix");
        assert_eq!(sent_title("Draft: Fix", false), "Draft: Fix");
        assert_eq!(sent_title("Fix", false), "Fix");
    }

    #[test]
    fn f27_6_body_carries_the_options() {
        let mr = NewMr {
            source_branch: "a".into(),
            target_branch: "b".into(),
            title: "T".into(),
            description: "D".into(),
            reviewer_ids: vec![7],
            draft: true,
            remove_source_branch: false,
            squash: true,
        };
        let body = body(&mr);
        assert_eq!(body["title"], "Draft: T");
        assert_eq!(body["reviewer_ids"], json!([7]));
        assert_eq!(body["remove_source_branch"], false);
        assert_eq!(body["squash"], true);
    }
}
