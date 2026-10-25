//! `pipeline_list` and `pipeline_get` (F-20.1): S-08's pipeline tabs and the head of the selected
//! pipeline of an MR, read only; `pipeline_jobs`, `job_retry` and `job_cancel` (F-20.2): its stage
//! columns and the two row actions that act at once (`iid` names the MR the job belongs to; GitLab
//! needs only the job id). The screen calls them when it opens by navigation, never on a restored
//! start (F-30.4). `pipeline_mr_head` and `pipeline_run_mr` (F-20.3): the SHA Run new pipeline
//! names, and the one POST it sends after the user confirmed. `pipeline_retry` and
//! `pipeline_cancel` (F-20.4): Retry failed jobs and Cancel pipeline, each at once on its click.
//! `job_play` and `job_variables_get` (F-20.6): the manual-job form's Run `<job>` (the only play)
//! and the variables that job name last ran with on this machine. `job_details` (F-20.9): whether a
//! failed job failed again on the same tests.

use tauri::State;

use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error, not_connected};
use crate::error::AppResult;
use crate::gitlab::jobs::JobVariable;
use crate::review::pipeline_view::{
    self, JobArtifact, JobDetailsView, JobRow, PipelineHead, PipelineTab, StageColumn,
};
use crate::store::{Store, job_variables};

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

/// The artifacts of successful job `job` (F-20.8, decision 13): name, size and the download URL
/// Download opens in the browser. Read only.
#[tauri::command]
pub async fn job_artifacts(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
    job: u64,
) -> AppResult<Vec<JobArtifact>> {
    let _ = iid;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let result = pipeline_view::artifacts(&client, &project, job).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

/// The details panel's extra facts about failed job `job` (F-20.9, decision 15): whether it
/// failed again on the same tests as its previous attempt. Read only.
#[tauri::command]
pub async fn job_details(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
    job: u64,
) -> AppResult<JobDetailsView> {
    let _ = iid;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let result = pipeline_view::job_details(&client, &project, job).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

/// Plays manual job `job` of the MR's pipeline with `vars` (F-20.6, decision 11), only from the
/// form's Run `<job>`; after GitLab accepted it, `vars` become that job name's last values.
#[tauri::command]
pub async fn job_play(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
    job: u64,
    vars: Vec<JobVariable>,
) -> AppResult<JobRow> {
    let _ = iid;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let result = pipeline_view::play_job(&client, &project, job, &vars).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    let row = result?;
    remember_played_vars(&store, &project, &row.name, &vars);
    Ok(row)
}

/// Keeps `vars` as `job_name`'s last values after GitLab accepted the play. The job already runs,
/// so a failed write is only logged (no names or values) and never turns the play into an error.
fn remember_played_vars(store: &Store, project: &str, job_name: &str, vars: &[JobVariable]) {
    if let Err(err) = store.with_conn(|c| job_variables::save(c, project, job_name, vars)) {
        tracing::warn!(error = %err, "job_play: the job runs, but its variables were not kept");
    }
}

/// The variables job `job_name` of `project` last ran with on this machine (F-20.6); read only.
#[tauri::command]
pub async fn job_variables_get(
    store: State<'_, Store>,
    project: String,
    job_name: String,
) -> AppResult<Vec<JobVariable>> {
    Ok(store.with_conn(|c| job_variables::get(c, &project, &job_name))?)
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

/// Retry failed jobs of pipeline `id` of the MR at once (F-20.4); its head as it now is.
#[tauri::command]
pub async fn pipeline_retry(
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
    let result = pipeline_view::retry_pipeline(&client, &project, iid, id, &user.username).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

/// Cancel pipeline `id` of the MR at once (F-20.4); its head as it now is.
#[tauri::command]
pub async fn pipeline_cancel(
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
    let result = pipeline_view::cancel_pipeline(&client, &project, iid, id, &user.username).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    Ok(result?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f20_6_a_failed_save_after_a_play_is_only_logged() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| Ok(c.execute_batch("DROP TABLE job_variables")?))
            .unwrap();
        let vars = vec![JobVariable {
            key: "DEVICE".into(),
            value: "iPhone 16".into(),
        }];
        let failed = store.with_conn(|c| job_variables::save(c, "p", "j", &vars));
        assert!(
            failed.is_err(),
            "the write must fail for this test to mean anything"
        );
        // Returns `()`: job_play goes on to `Ok(row)` whatever the write did.
        remember_played_vars(&store, "mobile/mobile-app", "ui-tests:ios-device", &vars);
    }
}
