//! `gitlab_resolve` and `gitlab_reply` (F-11.2, M5 decisions 1 and 2): actions on an existing MR
//! thread, sent to GitLab at once and independent of drafts and approval. The project and the MR
//! come from the session in the store, never from the UI; the UI names only the discussion.
//! An action GitLab accepted updates the session's remembered threads, so the step shows it.

use tauri::State;

use super::gitlab::{GitlabApp, connected_client};
use super::review::ReviewApp;
use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::gitlab::{discussions, thread_actions};
use crate::review::step_context::MrRef;
use crate::review::thread_place;
use crate::source::model::Source;
use crate::store::{self, Store};

/// The merge request of `session`; a session of commits or local changes has none (F-17.2).
async fn session_mr(store: &Store, session: &str) -> AppResult<MrRef> {
    let id = session.to_owned();
    let row = with_store(store, move |c| store::sessions::source_of(c, &id))
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Unknown session."))?;
    match serde_json::from_str::<Source>(&row.source_json) {
        Ok(Source::Mr { project, iid }) => Ok(MrRef { project, iid }),
        _ => Err(AppError::new(
            ErrorCode::InvalidInput,
            "The session has no merge request.",
        )),
    }
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
