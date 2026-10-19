//! S-08's pipeline tabs and status block (F-20.1, M6 decisions 1 to 3), read only: the MR's
//! pipelines newest first with the MR version of each SHA ("version 3 · latest"), and the head of
//! the selected pipeline (status word, allowed failures, number, kind, SHA, version, author, start,
//! duration). The UI formats the age and the duration.

use serde::Serialize;
use ts_rs::TS;

use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::mrs::PipelineState;
use crate::gitlab::pipelines::{self, PipelineJob, kind_of};
use crate::gitlab::versions;

/// One tab of S-08's pipeline strip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PipelineTab {
    #[ts(type = "number")]
    pub id: u64,
    /// GitLab's pipeline id, as its page shows it ("#18342").
    #[ts(type = "number")]
    pub number: u64,
    /// The full SHA (the screen shows 7 characters).
    pub sha: String,
    /// The 1-based MR version whose head is `sha`; `None` when no version has that head.
    pub version: Option<u32>,
    /// The newest pipeline of the MR.
    pub latest: bool,
    pub status: PipelineState,
}

/// The status block and meta line of the selected pipeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PipelineHead {
    pub status: PipelineState,
    /// Failed jobs allowed to fail; counted only on a passed pipeline ("1 allowed failure").
    pub allowed_failures: u32,
    #[ts(type = "number")]
    pub number: u64,
    /// GitLab's `source` in words ("Merge request pipeline").
    pub kind: String,
    pub sha: String,
    pub version: Option<u32>,
    /// The display name of who started it.
    pub author: Option<String>,
    /// Started by the signed-in user ("started by you").
    pub started_by_me: bool,
    /// ISO 8601: when it started (when it was created while it hasn't started yet).
    pub started_at: Option<String>,
    /// Seconds; `None` while it runs or when GitLab has none.
    #[ts(type = "number | null")]
    pub duration_secs: Option<u64>,
}

/// The MR's pipelines newest first (highest id first, whatever order GitLab answers in).
pub async fn tabs(
    client: &GitlabClient,
    project: &str,
    iid: u64,
) -> Result<Vec<PipelineTab>, GitlabError> {
    let mut listed = pipelines::mr_pipelines(client, project, iid).await?;
    if listed.is_empty() {
        return Ok(Vec::new());
    }
    let versions = versions::list(client, project, iid).await?;
    listed.sort_by_key(|p| std::cmp::Reverse(p.id));
    Ok(listed
        .into_iter()
        .enumerate()
        .map(|(index, p)| PipelineTab {
            id: p.id,
            number: p.id,
            version: versions::number_of(&versions, &p.sha),
            sha: p.sha,
            latest: index == 0,
            status: PipelineState::from_rest(&p.status),
        })
        .collect())
}

/// The head of pipeline `pipeline_id` of the MR; `me` is the signed-in username.
pub async fn head(
    client: &GitlabClient,
    project: &str,
    iid: u64,
    pipeline_id: u64,
    me: &str,
) -> Result<PipelineHead, GitlabError> {
    let pipeline = pipelines::pipeline(client, project, pipeline_id).await?;
    let versions = versions::list(client, project, iid).await?;
    let status = PipelineState::from_rest(&pipeline.status);
    let allowed_failures = if status == PipelineState::Passed {
        allowed_failures(&pipelines::pipeline_jobs(client, project, pipeline_id).await?)
    } else {
        0
    };
    Ok(PipelineHead {
        status,
        allowed_failures,
        number: pipeline.id,
        kind: kind_of(pipeline.source.as_deref()),
        version: versions::number_of(&versions, &pipeline.sha),
        sha: pipeline.sha,
        author: pipeline.user.as_ref().map(|u| u.name.clone()),
        started_by_me: pipeline.user.as_ref().is_some_and(|u| u.username == me),
        started_at: pipeline.started_at.or(pipeline.created_at),
        duration_secs: pipeline.duration,
    })
}

/// The failed jobs that were allowed to fail.
fn allowed_failures(jobs: &[PipelineJob]) -> u32 {
    let count = jobs
        .iter()
        .filter(|j| j.allow_failure && j.status == "failed")
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}
