//! S-08's pipeline tabs and status block (F-20.1, M6 decisions 1 to 3), read only: the MR's
//! pipelines newest first with the MR version of each SHA ("version 3 · latest"), and the head of
//! the selected pipeline (status word, allowed failures, number, kind, SHA, version, author, start,
//! duration). The UI formats the age and the duration. And its jobs as S-08's stage columns
//! (F-20.2, M6 decisions 5 and 6): the stages in the order GitLab created the jobs, one row per
//! latest attempt with one of eight states and at most one action, plus the row-level Retry and
//! Cancel, which act at once. And Run new pipeline (F-20.3): the MR's head SHA the confirmation
//! names, and the one POST that starts a merge request pipeline, as the new latest tab.

use std::collections::HashMap;

use serde::Serialize;
use ts_rs::TS;

use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::jobs::{self, Job};
use crate::gitlab::mr;
use crate::gitlab::mrs::PipelineState;
use crate::gitlab::pipelines::{self, kind_of};
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

/// The full head SHA of the MR (F-20.3's confirmation shows 7 chars). Read only.
pub async fn mr_head_sha(
    client: &GitlabClient,
    project: &str,
    iid: u64,
) -> Result<String, GitlabError> {
    mr::get(client, project, iid)
        .await?
        .sha
        .ok_or_else(|| GitlabError::Decode("merge request: no head SHA".to_owned()))
}

/// Starts a merge request pipeline on the MR's latest commit (F-20.3): one POST, then the new
/// pipeline as the latest tab with the MR version of its SHA.
pub async fn run_mr_pipeline(
    client: &GitlabClient,
    project: &str,
    iid: u64,
) -> Result<PipelineTab, GitlabError> {
    let created = pipelines::create_mr_pipeline(client, project, iid).await?;
    let versions = versions::list(client, project, iid).await?;
    Ok(PipelineTab {
        id: created.id,
        number: created.id,
        version: versions::number_of(&versions, &created.sha),
        status: PipelineState::from_rest(&created.status),
        sha: created.sha,
        latest: true,
    })
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
        allowed_failures(&jobs::pipeline_jobs(client, project, pipeline_id, false).await?)
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
fn allowed_failures(jobs: &[Job]) -> u32 {
    let count = jobs
        .iter()
        .filter(|j| j.allow_failure && j.status == "failed")
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// The state a job row shows (F-20.2): its status square, its label and its right-hand text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum JobState {
    Passed,
    Failed,
    /// Failed, but allowed to fail.
    FailedAllowed,
    Running,
    /// Created, pending, preparing, waiting for a resource or scheduled.
    Waiting,
    Manual,
    Canceled,
    Skipped,
}

/// The one action button of a row (M6 decision 6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum JobAction {
    /// Acts at once.
    Retry,
    /// Only selects the job and opens its form (F-20.6); never plays it.
    Run,
    /// Acts at once.
    Cancel,
}

/// One job row of a stage column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct JobRow {
    #[ts(type = "number")]
    pub id: u64,
    pub name: String,
    pub state: JobState,
    pub action: Option<JobAction>,
    /// Whole seconds; `None` while GitLab has none.
    #[ts(type = "number | null")]
    pub duration_secs: Option<u64>,
}

/// One stage of the pipeline with its jobs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StageColumn {
    /// GitLab's stage name as it is (CSS uppercases it).
    pub name: String,
    pub jobs: Vec<JobRow>,
}

impl JobState {
    /// From a REST job `status` and `allow_failure` (plan M6, docs/05 job states).
    pub fn from_rest(status: &str, allow_failure: bool) -> Self {
        match status {
            "success" => Self::Passed,
            "failed" if allow_failure => Self::FailedAllowed,
            "failed" => Self::Failed,
            "running" => Self::Running,
            "manual" => Self::Manual,
            "canceled" | "canceling" => Self::Canceled,
            "skipped" => Self::Skipped,
            _ => Self::Waiting,
        }
    }

    /// The row's one button (M6 decision 6): none on passed and skipped jobs.
    pub fn action(self) -> Option<JobAction> {
        match self {
            Self::Failed | Self::FailedAllowed | Self::Canceled => Some(JobAction::Retry),
            Self::Running | Self::Waiting => Some(JobAction::Cancel),
            Self::Manual => Some(JobAction::Run),
            Self::Passed | Self::Skipped => None,
        }
    }
}

/// The row of one job.
pub fn row_of(job: &Job) -> JobRow {
    let state = JobState::from_rest(&job.status, job.allow_failure);
    JobRow {
        id: job.id,
        name: job.name.clone(),
        state,
        action: state.action(),
        duration_secs: job
            .duration
            .filter(|d| d.is_finite() && *d >= 0.0)
            .map(|d| d.round() as u64),
    }
}

/// Groups the jobs of a pipeline (with the retried attempts) into stage columns (decision 5):
/// the stages in the order their first job was created (job id ascending), each job of a stage
/// in the order its first attempt was created, one row per latest attempt. A retry keeps the row
/// in its place.
pub fn columns(jobs: &[Job]) -> Vec<StageColumn> {
    let mut stage_rank: HashMap<&str, u64> = HashMap::new();
    let mut name_rank: HashMap<(&str, &str), u64> = HashMap::new();
    let mut newest: HashMap<(&str, &str), u64> = HashMap::new();
    for job in jobs {
        let stage = stage_rank.entry(job.stage.as_str()).or_insert(job.id);
        *stage = (*stage).min(job.id);
        let key = (job.stage.as_str(), job.name.as_str());
        let name = name_rank.entry(key).or_insert(job.id);
        *name = (*name).min(job.id);
        let last = newest.entry(key).or_insert(job.id);
        *last = (*last).max(job.id);
    }
    let rank = |job: &Job| {
        (
            stage_rank
                .get(job.stage.as_str())
                .copied()
                .unwrap_or(job.id),
            name_rank
                .get(&(job.stage.as_str(), job.name.as_str()))
                .copied()
                .unwrap_or(job.id),
            job.id,
        )
    };
    // An attempt is superseded when GitLab marks it `retried` or when the pipeline has a later
    // job (higher id) with the same stage and name, so a missing `retried` field hides it too.
    let is_latest = |job: &Job| {
        !job.retried
            && newest
                .get(&(job.stage.as_str(), job.name.as_str()))
                .is_none_or(|&id| id == job.id)
    };
    let mut latest: Vec<&Job> = jobs.iter().filter(|j| is_latest(j)).collect();
    latest.sort_by_key(|j| rank(j));
    let mut out: Vec<StageColumn> = Vec::new();
    for job in latest {
        match out.last_mut() {
            Some(column) if column.name == job.stage => column.jobs.push(row_of(job)),
            _ => out.push(StageColumn {
                name: job.stage.clone(),
                jobs: vec![row_of(job)],
            }),
        }
    }
    out
}

/// The stage columns of pipeline `pipeline_id`.
pub async fn stages(
    client: &GitlabClient,
    project: &str,
    pipeline_id: u64,
) -> Result<Vec<StageColumn>, GitlabError> {
    let listed = jobs::pipeline_jobs(client, project, pipeline_id, true).await?;
    Ok(columns(&listed))
}

/// Retries job `job_id` at once; the row of the new attempt.
pub async fn retry_job(
    client: &GitlabClient,
    project: &str,
    job_id: u64,
) -> Result<JobRow, GitlabError> {
    Ok(row_of(&jobs::retry_job(client, project, job_id).await?))
}

/// Cancels job `job_id` at once; the row as GitLab now has it.
pub async fn cancel_job(
    client: &GitlabClient,
    project: &str,
    job_id: u64,
) -> Result<JobRow, GitlabError> {
    Ok(row_of(&jobs::cancel_job(client, project, job_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: u64, name: &str, stage: &str, retried: bool) -> Job {
        Job {
            id,
            name: name.to_owned(),
            stage: stage.to_owned(),
            status: "success".to_owned(),
            allow_failure: false,
            retried,
            duration: Some(1.4),
        }
    }

    #[test]
    fn f20_2_a_retried_job_keeps_its_place_in_its_column() {
        let jobs = [
            job(1, "lint", "test", true),
            job(2, "unit", "test", false),
            job(9, "lint", "test", false),
        ];

        let names: Vec<String> = columns(&jobs)
            .into_iter()
            .flat_map(|c| c.jobs.into_iter().map(|j| j.name))
            .collect();

        assert_eq!(names, vec!["lint", "unit"]);
    }

    #[test]
    fn f20_2_an_earlier_attempt_is_hidden_without_the_retried_field() {
        let jobs = [
            job(1, "lint", "test", false),
            job(2, "unit", "test", false),
            job(9, "lint", "test", false),
        ];

        let rows: Vec<(String, u64)> = columns(&jobs)
            .into_iter()
            .flat_map(|c| c.jobs.into_iter().map(|j| (j.name, j.id)))
            .collect();

        assert_eq!(rows, vec![("lint".to_owned(), 9), ("unit".to_owned(), 2)]);
    }

    #[test]
    fn f20_2_a_stage_with_only_retried_attempts_has_no_column() {
        let jobs = [job(1, "old", "build", true), job(2, "unit", "test", false)];

        let names: Vec<String> = columns(&jobs).into_iter().map(|c| c.name).collect();

        assert_eq!(names, vec!["test"]);
    }

    #[test]
    fn f20_2_canceling_reads_canceled_and_unknown_words_wait() {
        assert_eq!(JobState::from_rest("canceling", false), JobState::Canceled);
        assert_eq!(
            JobState::from_rest("something_new", false),
            JobState::Waiting
        );
    }

    #[test]
    fn f20_2_a_negative_duration_is_none() {
        let mut odd = job(1, "x", "test", false);
        odd.duration = Some(-3.0);

        assert_eq!(row_of(&odd).duration_secs, None);
    }
}
