//! The jobs of a pipeline over REST (F-20.2, docs/05 › GitLab REST API v4): `pipeline_jobs`
//! (`GET …/pipelines/:id/jobs`, paged, `per_page=100`, optionally with the retried attempts) and
//! the two job actions that act at once, `retry_job` and `cancel_job`
//! (`POST …/jobs/:id/retry` / `…/cancel`), each answering with the job it leaves; `job` and
//! `trace` (F-20.5): one job (`GET …/jobs/:id`) and its log as text (`GET …/jobs/:id/trace`);
//! `play_job` (F-20.6): a manual job played with the variables for this run
//! (`POST …/jobs/:id/play` with `job_variables_attributes`).

use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;

use super::client::{GitlabClient, project_id};
use super::discussions::MAX_PAGES;
use super::error::GitlabError;

/// One job as S-08 needs it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Job {
    pub id: u64,
    pub name: String,
    pub stage: String,
    pub status: String,
    #[serde(default)]
    pub allow_failure: bool,
    /// An earlier attempt of a job that was retried.
    #[serde(default)]
    pub retried: bool,
    /// Seconds, fractional; `None` while the job has none.
    #[serde(default)]
    pub duration: Option<f64>,
    /// The job's page in GitLab (Full log opens it).
    #[serde(default)]
    pub web_url: Option<String>,
}

/// One variable of a manual job's run (F-20.6, M6 decision 11): sent and stored as typed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct JobVariable {
    pub key: String,
    pub value: String,
}

fn decode<T: for<'de> Deserialize<'de>>(
    path: &str,
    value: serde_json::Value,
) -> Result<T, GitlabError> {
    serde_json::from_value(value).map_err(|e| GitlabError::Decode(format!("{path}: {e}")))
}

/// The jobs of one pipeline (all pages), in the order GitLab answers; with `include_retried` the
/// earlier attempts of retried jobs too (marked `retried`).
pub async fn pipeline_jobs(
    client: &GitlabClient,
    project: &str,
    pipeline: u64,
    include_retried: bool,
) -> Result<Vec<Job>, GitlabError> {
    let path = format!(
        "/projects/{}/pipelines/{pipeline}/jobs",
        project_id(project)
    );
    let query = if include_retried {
        vec![("include_retried", "true".to_owned())]
    } else {
        Vec::new()
    };
    let (items, _) = client.get_pages(&path, &query, MAX_PAGES).await?;
    items.into_iter().map(|item| decode(&path, item)).collect()
}

/// Retries job `job`; GitLab answers with the new attempt (a new id).
pub async fn retry_job(client: &GitlabClient, project: &str, job: u64) -> Result<Job, GitlabError> {
    let path = format!("/projects/{}/jobs/{job}/retry", project_id(project));
    let response = client.post(&path, &json!({})).await?;
    decode(&path, response.body)
}

/// Cancels job `job`; GitLab answers with the job as it now is.
pub async fn cancel_job(
    client: &GitlabClient,
    project: &str,
    job: u64,
) -> Result<Job, GitlabError> {
    let path = format!("/projects/{}/jobs/{job}/cancel", project_id(project));
    let response = client.post(&path, &json!({})).await?;
    decode(&path, response.body)
}

/// Job `job` as it now is.
pub async fn job(client: &GitlabClient, project: &str, job: u64) -> Result<Job, GitlabError> {
    let path = format!("/projects/{}/jobs/{job}", project_id(project));
    let response = client.get(&path, &[]).await?;
    decode(&path, response.body)
}

/// The raw log of job `job` as GitLab has it so far (ANSI escapes and section markers included).
pub async fn trace(client: &GitlabClient, project: &str, job: u64) -> Result<String, GitlabError> {
    let path = format!("/projects/{}/jobs/{job}/trace", project_id(project));
    client.get_text(&path).await
}

/// Plays manual job `job` with `variables` in the given order (none: no variable in the body);
/// GitLab answers with the job as it now is.
pub async fn play_job(
    client: &GitlabClient,
    project: &str,
    job: u64,
    variables: &[JobVariable],
) -> Result<Job, GitlabError> {
    let path = format!("/projects/{}/jobs/{job}/play", project_id(project));
    let body = if variables.is_empty() {
        json!({})
    } else {
        json!({ "job_variables_attributes": variables })
    };
    let response = client.post(&path, &body).await?;
    decode(&path, response.body)
}
