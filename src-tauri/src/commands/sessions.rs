//! `sessions_*` commands.

use tauri::State;

use super::with_store;
use crate::error::AppResult;
use crate::review::sessions::UnfinishedSession;
use crate::store::{self, Store};

/// Unfinished sessions, most recent first; the Review tile resumes the first one (F-30.2).
#[tauri::command]
pub async fn sessions_list_unfinished(
    store: State<'_, Store>,
) -> AppResult<Vec<UnfinishedSession>> {
    with_store(&store, |conn| store::unfinished_sessions(conn)).await
}
