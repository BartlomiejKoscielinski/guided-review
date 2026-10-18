//! `drafts_*` commands (F-09.2, F-10.3): draft comments kept on this PC. Nothing here talks to
//! GitLab; `drafts_publish` (F-12) is a separate explicit action.

use tauri::State;

use super::review::ReviewApp;
use super::with_store;
use crate::error::AppResult;
use crate::review::drafts::{self, Draft, DraftPatch, NewDraft, NewMrDraft};
use crate::store::Store;

/// The drafts of a session in the order they were made.
#[tauri::command]
pub async fn drafts_list(store: State<'_, Store>, session_id: String) -> AppResult<Vec<Draft>> {
    with_store(&store, move |c| Ok(drafts::list(c, &session_id)))
        .await?
        .map_err(Into::into)
}

/// A new draft. One on a line that isn't from a note belongs to the step holding that line's hunk
/// (F-08.3), found in the session's loaded plan and diff: a line is commented on an open step, so
/// both are loaded; no Claude Code lookup here.
#[tauri::command]
pub async fn drafts_create(
    review: State<'_, ReviewApp>,
    store: State<'_, Store>,
    draft: NewDraft,
) -> AppResult<Draft> {
    let line_step = match (&draft.finding_id, &draft.position) {
        (None, Some(position)) => review
            .remembered(&draft.session_id)
            .and_then(|cx| drafts::step_at(&cx.plan, &cx.files, position)),
        _ => None,
    };
    with_store(&store, move |c| Ok(drafts::create_at(c, &draft, line_step)))
        .await?
        .map_err(Into::into)
}

/// A draft made outside a review (Explain failure on S-08, Add as a question on S-12) of the MR
/// `project` !`iid`: it joins the MR's latest session, else a new "drafts only" one that S-05 opens
/// (F-12.7). Database only: no GitLab or Claude Code.
#[tauri::command]
pub async fn drafts_create_for_mr(
    store: State<'_, Store>,
    project: String,
    iid: u64,
    draft: NewMrDraft,
) -> AppResult<Draft> {
    with_store(&store, move |c| {
        Ok(drafts::attach_to_mr(c, &project, iid, &draft))
    })
    .await?
    .map_err(Into::into)
}

/// Edits the text or the Publish tick; a published draft is refused.
#[tauri::command]
pub async fn drafts_update(
    store: State<'_, Store>,
    id: String,
    patch: DraftPatch,
) -> AppResult<Draft> {
    with_store(&store, move |c| Ok(drafts::update(c, &id, &patch)))
        .await?
        .map_err(Into::into)
}

#[tauri::command]
pub async fn drafts_delete(store: State<'_, Store>, id: String) -> AppResult<()> {
    with_store(&store, move |c| Ok(drafts::delete(c, &id)))
        .await?
        .map_err(Into::into)
}
