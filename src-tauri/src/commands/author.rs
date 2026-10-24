//! `author_mr` (F-26.1): S-10 Your MR reads my merge request (title, branches, head pipeline and
//! the thread list), read only. Called when the screen opens by navigation, never on a restored
//! start (F-30.4); it runs no Claude, so it needs no Claude Code lookup. `author_file_diff`
//! (F-26.2) reads the selected thread's file from the user's own checkout, read only;
//! `author_fixup_target` (F-26.4) names the commit a fix of a thread is a fixup of, read only.
//! `author_queue_reply` (F-26.5) stores the reply **Commit** queues, sending nothing;
//! `author_push_and_reply` runs only on the click on **Push and reply** or **Retry**.

use tauri::State;

use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error, not_connected};
use super::repo::active_git;
use crate::error::AppResult;
use crate::error::{AppError, ErrorCode};
use crate::git::diff;
use crate::git::fixup_target::{self, FixupTarget};
use crate::git::model::FileDiff;
use crate::os::process::Cancel;
use crate::review::author_mr::{self, AuthorMr, AuthorMrError};
use crate::review::author_push::{self, PushOutcome, PushReply};
use crate::store::Store;
use crate::store::queued_replies::{self, NewQueuedReply, QueuedReply};

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
    let queued = store
        .with_conn(|conn| queued_replies::pending_discussions(conn, &project, iid))
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "queued replies unreadable; S-10 shows no Fixed locally tag");
            Default::default()
        });
    let result = author_mr::load(&client, &project, iid, &user.username, &queued).await;
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

/// The commit a fix of the thread on `line` of `path` is a fixup of (F-26.4, M7 decision 8):
/// the blame of the line in my MR's range, else the newest range commit touching the file, else
/// HEAD. Reads git only; no Claude, no GitLab.
#[tauri::command]
pub async fn author_fixup_target(
    store: State<'_, Store>,
    target: String,
    path: String,
    line: Option<u32>,
) -> AppResult<FixupTarget> {
    let git = active_git(&store).await?;
    Ok(fixup_target::find(&git, &target, &path, line, &Cancel::new()).await?)
}

/// Queues the reply **Commit** made for `discussion` of my MR (F-26.5): "Fixed in <sha>. <one
/// sentence>." sent after the push of `after_sha`; queueing the thread again replaces it. Sends
/// nothing (M7 decision 12).
#[tauri::command]
pub async fn author_queue_reply(
    store: State<'_, Store>,
    project: String,
    iid: u64,
    discussion: String,
    body: String,
    resolve: bool,
    after_sha: String,
) -> AppResult<QueuedReply> {
    if body.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "Write the reply to send.",
        ));
    }
    let reply = NewQueuedReply {
        project,
        iid,
        discussion,
        body,
        resolve,
        after_sha,
    };
    Ok(store.with_conn(|conn| queued_replies::queue(conn, &reply))?)
}

/// **Push and reply** (F-26.5, M7 decisions 11 and 12): pushes the active checkout's branch and
/// then sends the queued reply `reply_id` (and Resolve when it is on); "Pull first" pushes
/// nothing. A failure keeps the reply queued for **Retry**.
#[tauri::command]
pub async fn author_push_and_reply(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
    reply_id: String,
) -> AppResult<PushOutcome> {
    let (client, _) = connected_client(&gitlab, &store).await?;
    let git = active_git(&store).await?;
    let job = PushReply {
        client: &client,
        store: &store,
        git: &git,
        project: &project,
        iid,
        reply_id: &reply_id,
    };
    author_push::push_and_reply(&job, &Cancel::new()).await
}
