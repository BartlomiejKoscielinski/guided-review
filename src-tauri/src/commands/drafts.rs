//! `drafts_*` commands (F-09.2, F-10.3): draft comments kept on this PC. Nothing here talks to
//! GitLab; `drafts_publish` (F-12) is a separate explicit action.

use tauri::State;

use super::with_store;
use crate::error::AppResult;
use crate::review::drafts::{self, Draft, DraftPatch, NewDraft};
use crate::store::Store;

/// The drafts of a session in the order they were made.
#[tauri::command]
pub async fn drafts_list(store: State<'_, Store>, session_id: String) -> AppResult<Vec<Draft>> {
    with_store(&store, move |c| Ok(drafts::list(c, &session_id)))
        .await?
        .map_err(Into::into)
}

#[tauri::command]
pub async fn drafts_create(store: State<'_, Store>, draft: NewDraft) -> AppResult<Draft> {
    with_store(&store, move |c| Ok(drafts::create(c, &draft)))
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
