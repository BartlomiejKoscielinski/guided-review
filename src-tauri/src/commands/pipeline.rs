//! `pipeline_list` and `pipeline_get` (F-20.1): S-08's pipeline tabs and the head of the selected
//! pipeline of an MR, read only; `pipeline_jobs`, `job_retry` and `job_cancel` (F-20.2): its stage
//! columns and the two row actions that act at once (`iid` names the MR the job belongs to; GitLab
//! needs only the job id). The screen calls them when it opens by navigation, never on a restored
//! start (F-30.4). `pipeline_mr_head` and `pipeline_run_mr` (F-20.3): the SHA Run new pipeline
//! names, and the one POST it sends after the user confirmed.

use tauri::State;

use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error, not_connected};
use crate::error::AppResult;
use crate::review::pipeline_view::{self, JobRow, PipelineHead, PipelineTab, StageColumn};
use crate::store::Store;

/// The MR's pipelines newest first.
#[tauri::command]
pub async fn pipeline_list(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
) -> AppResult<Vec<PipelineTab>> {
    let (client, _) = connected_client(&gitlab, &store).await?;
    let result = pipeline_view::tabs(&client, &project, iid).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

/// The status block and meta line of pipeline `id` of the MR.
#[tauri::command]
pub async fn pipeline_get(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
    id: u64,
) -> AppResult<PipelineHead> {
    let (client, status) = connected_client(&gitlab, &store).await?;
    let Some(user) = status.user.as_ref() else {
        return Err(not_connected(&status));
    };
    let result = pipeline_view::head(&client, &project, iid, id, &user.username).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

/// The stage columns of pipeline `pipeline` of the MR (F-20.2), the retried attempts hidden.
#[tauri::command]
pub async fn pipeline_jobs(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
    pipeline: u64,
) -> AppResult<Vec<StageColumn>> {
    let _ = iid;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let result = pipeline_view::stages(&client, &project, pipeline).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

/// Retries job `job` of the MR's pipeline at once (F-20.2, decision 6); the row of the new attempt.
#[tauri::command]
pub async fn job_retry(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
    job: u64,
) -> AppResult<JobRow> {
    let _ = iid;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let result = pipeline_view::retry_job(&client, &project, job).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

/// Cancels job `job` of the MR's pipeline at once (F-20.2, decision 6); the row as it now is.
#[tauri::command]
pub async fn job_cancel(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
    job: u64,
) -> AppResult<JobRow> {
    let _ = iid;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let result = pipeline_view::cancel_job(&client, &project, job).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

/// The full head SHA of the MR, read when Run new pipeline's confirmation opens (F-20.3).
#[tauri::command]
pub async fn pipeline_mr_head(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
) -> AppResult<String> {
    let (client, _) = connected_client(&gitlab, &store).await?;
    let result = pipeline_view::mr_head_sha(&client, &project, iid).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

/// Starts a new merge request pipeline after the user confirmed (F-20.3); the new latest tab.
#[tauri::command]
pub async fn pipeline_run_mr(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
) -> AppResult<PipelineTab> {
    let (client, _) = connected_client(&gitlab, &store).await?;
    let result = pipeline_view::run_mr_pipeline(&client, &project, iid).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}
