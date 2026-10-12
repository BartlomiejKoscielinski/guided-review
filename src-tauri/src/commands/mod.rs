//! `#[tauri::command]` adapters, one file per area (`app`, `source`, `sessions`, `review`, …).
//! They only translate between IPC and the core modules; command names are `area_action`.

pub mod app;
pub mod claude;
pub mod git;
pub mod os;
pub mod repo;
pub mod sessions;

use crate::error::{AppError, AppResult};
use crate::store::{Store, StoreError};

/// Runs a store call on the blocking thread pool, so the async runtime never waits on SQLite.
pub(crate) async fn with_store<T, F>(store: &Store, f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&mut rusqlite::Connection) -> Result<T, StoreError> + Send + 'static,
{
    let store = store.clone();
    tauri::async_runtime::spawn_blocking(move || store.with_conn(f))
        .await
        .map_err(|e| {
            AppError::internal("The app's database could not be used.").with_detail(e.to_string())
        })?
        .map_err(AppError::from)
}
