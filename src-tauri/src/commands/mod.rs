//! `#[tauri::command]` adapters, one file per area (`app`, `source`, `sessions`, `review`, …).
//! They only translate between IPC and the core modules; command names are `area_action`.

pub mod app;
pub mod approval;
pub mod author;
pub mod claude;
pub mod drafts;
pub mod fix;
pub mod git;
pub mod gitlab;
pub mod gitlab_threads;
pub mod job_explain;
pub mod job_trace;
pub mod os;
pub mod pipeline;
pub mod publish;
pub mod repo;
pub mod review;
pub mod review_plan;
pub mod review_status;
pub mod session_state;
pub mod sessions;
pub mod source;
pub mod summary;
pub mod thread_check;

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
