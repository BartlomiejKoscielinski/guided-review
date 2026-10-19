//! `gitlab_resolve` and `gitlab_reply` (F-11.2, M5 decisions 1 and 2): actions on an existing MR
//! thread, sent to GitLab at once and independent of drafts and approval. The project and the MR
//! come from the session in the store, never from the UI; the UI names only the discussion.
//! An action GitLab accepted updates the session's remembered threads, so the step shows it.
//! `gitlab_discussions` reads the MR's threads for S-05 ("Threads N open", F-12.2) and
//! `gitlab_approval_state` its approval state for the Approval tile (F-14.1).

use tauri::State;

use super::gitlab::{GitlabApp, connected_client};
use super::review::ReviewApp;
use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::gitlab::approvals::{self, ApprovalState};
use crate::gitlab::discussions::{self, Thread};
use crate::gitlab::thread_actions;
use crate::review::step_context::MrRef;
use crate::review::thread_place;
use crate::source::model::Source;
use crate::store::{self, Store};

/// The merge request of `session`; a session of commits or local changes has none (F-17.2).
pub(super) async fn session_mr(store: &Store, session: &str) -> AppResult<MrRef> {
    session_mr_head(store, session).await.map(|(mr, _)| mr)
}

/// The merge request of `session` and the head it reviews (empty for a "drafts only" session).
pub(super) async fn session_mr_head(store: &Store, session: &str) -> AppResult<(MrRef, String)> {
    let id = session.to_owned();
    let row = with_store(store, move |c| store::sessions::source_of(c, &id))
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Unknown session."))?;
    match serde_json::from_str::<Source>(&row.source_json) {
        Ok(Source::Mr { project, iid }) => Ok((MrRef { project, iid }, row.head_sha)),
        _ => Err(AppError::new(
            ErrorCode::InvalidInput,
            "The session has no merge request.",
        )),
    }
}

/// The MR's threads as GitLab has them now, oldest first (S-05: "Threads N open", F-12.2). Read
/// only, `outdated` set against the reviewed head; the remembered threads of the steps are left as
/// they are. Called when the summary opens, never on a restored start (F-30.4).
#[tauri::command]
pub async fn gitlab_discussions(
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
) -> AppResult<Vec<Thread>> {
    let (mr, head) = session_mr_head(&store, &session).await?;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let mut threads = discussions::list(&client, &mr.project, mr.iid).await?;
    // F-13.3: an open thread written on an older version shows **Check with Claude**.
    thread_place::mark_outdated(&mut threads, &head);
    Ok(threads)
}

/// The approval state of the session's MR (S-05 Approval tile, F-14.1): one read, nothing
/// written. Called when the summary opens, never on a restored start (F-30.4).
#[tauri::command]
pub async fn gitlab_approval_state(
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
) -> AppResult<ApprovalState> {
    let mr = session_mr(&store, &session).await?;
    let (client, _) = connected_client(&gitlab, &store).await?;
    Ok(approvals::state(&client, &mr.project, mr.iid).await?)
}

/// Resolve (`resolved = true`) or Reopen (`false`) a thread of the session's MR.
#[tauri::command]
pub async fn gitlab_resolve(
    review: State<'_, ReviewApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    discussion: String,
    resolved: bool,
) -> AppResult<()> {
    let mr = session_mr(&store, &session).await?;
    let (client, _) = connected_client(&gitlab, &store).await?;
    thread_actions::resolve(&client, &mr.project, mr.iid, &discussion, resolved).await?;
    review.update_threads(&session, |threads| {
        thread_actions::mark_resolved(threads, &discussion, resolved);
    });
    Ok(())
}

/// Reply: `body` becomes a note of the thread at once, as written; it is not a draft.
#[tauri::command]
pub async fn gitlab_reply(
    review: State<'_, ReviewApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    discussion: String,
    body: String,
) -> AppResult<()> {
    let mr = session_mr(&store, &session).await?;
    if body.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "The reply is empty.",
        ));
    }
    let (client, _) = connected_client(&gitlab, &store).await?;
    match thread_actions::reply(&client, &mr.project, mr.iid, &discussion, &body).await? {
        Some(note) => review.update_threads(&session, |threads| {
            thread_actions::append_note(threads, &discussion, note);
        }),
        // Sent, but GitLab's answer wasn't a note: the threads as GitLab has them now.
        None => match discussions::list(&client, &mr.project, mr.iid).await {
            Ok(mut fresh) => review.update_threads(&session, |threads| {
                // A reply moves no thread: each keeps the place it had (F-11.3).
                thread_place::carry(threads, &mut fresh);
                *threads = fresh;
            }),
            Err(error) => tracing::warn!(%error, "threads not reloaded after a reply"),
        },
    }
    Ok(())
}
