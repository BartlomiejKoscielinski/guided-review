//! `sessions_*` and `session_open_*` commands. Commit and local sessions open stub screens until
//! M3 (M2 decision 3); MR sessions come with preparation (`session_open_mr`, F-05).

use std::path::{Path, PathBuf};

use tauri::State;

use super::repo::{active_git, add_folder};
use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::os::process::Cancel;
use crate::review::sessions::{self, OpenedSession, UnfinishedSession};
use crate::source::open::{self, Resolved};
use crate::source::{CommitRange, LocalScope};
use crate::store::{self, Store};

/// Unfinished sessions, most recent first; the Review tile resumes the first one (F-30.2).
#[tauri::command]
pub async fn sessions_list_unfinished(
    store: State<'_, Store>,
) -> AppResult<Vec<UnfinishedSession>> {
    with_store(&store, |conn| store::unfinished_sessions(conn)).await
}

/// Stores a resolved source as a new session of the active repository.
async fn create(store: &Store, resolved: Resolved) -> AppResult<OpenedSession> {
    let (repo, settings) = with_store(store, |conn| {
        Ok((store::repos::active(conn)?, store::settings::load(conn)?))
    })
    .await?;
    let repo =
        repo.ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Pick a repository first."))?;
    let (row, opened) = sessions::new_session(
        repo.id,
        resolved,
        settings.ui.start_in,
        settings.ui.focus_layout,
    )
    .map_err(|e| {
        AppError::internal("The session could not be saved.").with_detail(e.to_string())
    })?;
    with_store(store, move |conn| store::sessions::insert(conn, &row)).await?;
    Ok(opened)
}

/// Step review of one commit or a range `from..to` (F-01.3, F-03.2).
#[tauri::command]
pub async fn session_open_commit(
    store: State<'_, Store>,
    range: CommitRange,
) -> AppResult<OpenedSession> {
    let git = active_git(&store).await?;
    let resolved = open::commits(&git, &range, &Cancel::new()).await?;
    create(&store, resolved).await
}

/// Self-review of local changes in one scope (F-03.4, F-17).
#[tauri::command]
pub async fn session_open_local(
    store: State<'_, Store>,
    scope: LocalScope,
) -> AppResult<OpenedSession> {
    let git = active_git(&store).await?;
    let resolved = open::local(&git, &scope, &Cancel::new()).await?;
    create(&store, resolved).await
}

/// A branch typed in S-01: the current one as local changes, another one as its commits.
#[tauri::command]
pub async fn session_open_branch(
    store: State<'_, Store>,
    branch: String,
) -> AppResult<OpenedSession> {
    let git = active_git(&store).await?;
    let resolved = open::branch(&git, &branch, &Cancel::new()).await?;
    create(&store, resolved).await
}

/// A repository path typed in S-01: added when it isn't configured, made active, then
/// self-review of its branch.
#[tauri::command]
pub async fn session_open_repo(store: State<'_, Store>, path: String) -> AppResult<OpenedSession> {
    let folder = PathBuf::from(path.trim().trim_matches('"'));
    if !folder.is_absolute() || !Path::new(&folder).is_dir() {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            format!("No commit, branch or repository matches “{}”.", path.trim()),
        ));
    }
    add_folder(&store, &folder).await?;
    let git = active_git(&store).await?;
    let cancel = Cancel::new();
    let scope = open::default_scope(&git, &cancel).await?;
    let resolved = open::local(&git, &scope, &cancel).await?;
    create(&store, resolved).await
}
