//! `author_mr` (F-26.1): S-10 Your MR reads my merge request (title, branches, head pipeline and
//! the thread list), read only. Called when the screen opens by navigation, never on a restored
//! start (F-30.4); it runs no Claude, so it needs no Claude Code lookup. `author_file_diff`
//! (F-26.2) reads the selected thread's file from the user's own checkout, read only.

use tauri::State;

use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error, not_connected};
use super::repo::active_git;
use crate::error::AppResult;
use crate::git::diff;
use crate::git::model::FileDiff;
use crate::os::process::Cancel;
use crate::review::author_mr::{self, AuthorMr, AuthorMrError};
use crate::store::Store;

/// My MR `iid` of `project` as S-10 shows it; someone else's MR is `INVALID_INPUT`.
#[tauri::command]
pub async fn author_mr(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
) -> AppResult<AuthorMr> {
    let (client, status) = connected_client(&gitlab, &store).await?;
    let Some(user) = status.user.as_ref() else {
        return Err(not_connected(&status));
    };
    let result = author_mr::load(&client, &project, iid, &user.username).await;
    if let Err(AuthorMrError::Gitlab(e)) = &result {
        forget_status_on_auth_error(&gitlab, Some(e)).await;
    }
    Ok(result?)
}

/// The unified diff of `path` in the active repository from merge-base(`origin/<target>`, HEAD)
/// to the working tree (F-26.2, M7 decision 6); `target` is the MR's target branch.
#[tauri::command]
pub async fn author_file_diff(
    store: State<'_, Store>,
    target: String,
    path: String,
) -> AppResult<FileDiff> {
    let git = active_git(&store).await?;
    Ok(diff::author_file_diff(&git, &target, &path, &Cancel::new()).await?)
}
