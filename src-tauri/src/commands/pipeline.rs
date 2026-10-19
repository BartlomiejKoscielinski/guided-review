//! `pipeline_list` and `pipeline_get` (F-20.1): S-08's pipeline tabs and the head of the selected
//! pipeline of an MR, read only. The screen calls them when it opens by navigation, never on a
//! restored start (F-30.4).

use tauri::State;

use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error, not_connected};
use crate::error::AppResult;
use crate::review::pipeline_view::{self, PipelineHead, PipelineTab};
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
