//! `git_*` commands for S-06 (F-15, F-16): local changes, commit mode, per-file diffs,
//! staging, commit and push. Index writes are serialized by `RepoState::write_lock`.

use serde::Deserialize;
use tauri::State;
use ts_rs::TS;

use super::repo::{RepoState, active_git};
use crate::error::AppResult;
use crate::git::commit::{self, CommitInfo, CommitResult, PushResult};
use crate::git::diff::ChangedFile;
use crate::git::local::{self, FileRef, LocalChanges};
use crate::git::model::{FileDiff, FileStatus};
use crate::git::staging::{self, Selection};
use crate::os::process::Cancel;
use crate::store::Store;

/// Which diff S-06 shows (F-15.1).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum DiffSource {
    /// HEAD → working tree with the index state of every change.
    Local,
    /// A commit against its first parent.
    Commit { sha: String },
}

/// Local changes of the active repository (S-06 local mode).
#[tauri::command]
pub async fn git_status(store: State<'_, Store>) -> AppResult<LocalChanges> {
    let git = active_git(&store).await?;
    Ok(local::local_changes(&git, &Cancel::new()).await?)
}

/// Details and files of a commit; HEAD when `sha` is missing (F-15.6).
#[tauri::command]
pub async fn git_commit_info(
    store: State<'_, Store>,
    sha: Option<String>,
) -> AppResult<CommitInfo> {
    let git = active_git(&store).await?;
    let rev = sha.unwrap_or_else(|| "HEAD".to_owned());
    Ok(commit::commit_info(&git, &rev, &Cancel::new()).await?)
}

/// The diff of one file (F-15.5).
#[tauri::command]
pub async fn git_file_diff(
    store: State<'_, Store>,
    source: DiffSource,
    file: FileRef,
) -> AppResult<FileDiff> {
    let git = active_git(&store).await?;
    let cancel = Cancel::new();
    Ok(match source {
        DiffSource::Local => local::local_file_diff(&git, &file, &cancel).await?,
        DiffSource::Commit { sha } => {
            let changed = ChangedFile {
                path: file.path,
                old_path: file.old_path,
                status: FileStatus::Modified,
                binary: false,
                additions: 0,
                deletions: 0,
            };
            commit::commit_file_diff(&git, &sha, &changed, &cancel).await?
        }
    })
}

/// Puts files or lines into the index (F-16.1).
#[tauri::command]
pub async fn git_stage(
    store: State<'_, Store>,
    state: State<'_, RepoState>,
    selection: Selection,
) -> AppResult<()> {
    let git = active_git(&store).await?;
    let _write = state.write_lock.lock().await;
    Ok(staging::stage(&git, &selection, &Cancel::new()).await?)
}

/// Takes files or lines out of the index (F-16.1).
#[tauri::command]
pub async fn git_unstage(
    store: State<'_, Store>,
    state: State<'_, RepoState>,
    selection: Selection,
) -> AppResult<()> {
    let git = active_git(&store).await?;
    let _write = state.write_lock.lock().await;
    Ok(staging::unstage(&git, &selection, &Cancel::new()).await?)
}

/// Commits what is staged, or amends HEAD (F-16.4).
#[tauri::command]
pub async fn git_commit(
    store: State<'_, Store>,
    state: State<'_, RepoState>,
    message: String,
    amend: bool,
) -> AppResult<CommitResult> {
    let git = active_git(&store).await?;
    let _write = state.write_lock.lock().await;
    Ok(commit::commit(&git, &message, amend, &Cancel::new()).await?)
}

/// HEAD's message, for Amend previous commit (02 › S-06).
#[tauri::command]
pub async fn git_last_message(store: State<'_, Store>) -> AppResult<Option<String>> {
    let git = active_git(&store).await?;
    Ok(commit::last_message(&git, &Cancel::new()).await?)
}

/// Pushes the current branch to origin (F-16.5).
#[tauri::command]
pub async fn git_push(store: State<'_, Store>) -> AppResult<PushResult> {
    let git = active_git(&store).await?;
    Ok(commit::push(&git, &Cancel::new()).await?)
}
