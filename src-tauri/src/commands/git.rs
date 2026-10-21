//! `git_*` commands for S-01 (F-03.1, F-03.3) and S-06 (F-15, F-16): commits, scope counts,
//! local changes, commit mode, per-file diffs, staging, commit and push. Index writes are serialized by `RepoState::write_lock`.

use serde::Deserialize;
use tauri::State;
use ts_rs::TS;

use super::repo::{RepoState, active_git};
use super::sessions::mr_session;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::commit::{self, CommitInfo, CommitResult, PushResult};
use crate::git::diff::{self, ChangedFile};
use crate::git::local::{self, FileRef, LocalChanges};
use crate::git::log::{self, CommitList};
use crate::git::model::{FileDiff, FileStatus};
use crate::git::staging::{self, Selection};
use crate::git::summary::{self, StatusSummary};
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
    /// A teammate's MR session: merge base → head (S-06 MR browse, F-24.1).
    #[serde(rename_all = "camelCase")]
    Session { session_id: String },
}

/// Local changes of the active repository (S-06 local mode).
#[tauri::command]
pub async fn git_status(store: State<'_, Store>) -> AppResult<LocalChanges> {
    let git = active_git(&store).await?;
    Ok(local::local_changes(&git, &Cancel::new()).await?)
}

/// The Commits column of S-01 (F-03.1): the current branch when `branch` is missing; `query`
/// filters by message, author or SHA prefix.
#[tauri::command]
pub async fn git_log(
    store: State<'_, Store>,
    branch: Option<String>,
    query: Option<String>,
) -> AppResult<CommitList> {
    let git = active_git(&store).await?;
    Ok(log::log(&git, branch.as_deref(), query.as_deref(), &Cancel::new()).await?)
}

/// Counts of the three My changes scopes (F-03.3).
#[tauri::command]
pub async fn git_status_summary(store: State<'_, Store>) -> AppResult<StatusSummary> {
    let git = active_git(&store).await?;
    Ok(summary::status_summary(&git, &Cancel::new()).await?)
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
    let cancel = Cancel::new();
    Ok(match source {
        DiffSource::Local => {
            let git = active_git(&store).await?;
            local::local_file_diff(&git, &file, &cancel).await?
        }
        DiffSource::Commit { sha } => {
            let git = active_git(&store).await?;
            commit::commit_file_diff(&git, &sha, &changed_file(file), &cancel).await?
        }
        DiffSource::Session { session_id } => {
            let s = mr_session(&store, session_id).await?.ok_or_else(|| {
                AppError::new(
                    ErrorCode::InvalidInput,
                    "This session isn't a merge request.",
                )
            })?;
            diff::range_file_diff(&s.git, &s.base, &s.head, &changed_file(file), &cancel).await?
        }
    })
}

/// The file to diff between two commits; git finds its status and counts again.
fn changed_file(file: FileRef) -> ChangedFile {
    ChangedFile {
        path: file.path,
        old_path: file.old_path,
        status: FileStatus::Modified,
        binary: false,
        additions: 0,
        deletions: 0,
    }
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

/// Commits what is staged, or amends HEAD (F-16.4); with `only`, S-10's commit of the fixed
/// file alone, as a fixup of the commit `fixup` when given (F-26.4).
#[tauri::command]
pub async fn git_commit(
    store: State<'_, Store>,
    state: State<'_, RepoState>,
    message: String,
    amend: bool,
    fixup: Option<String>,
    only: Option<Vec<String>>,
) -> AppResult<CommitResult> {
    let git = active_git(&store).await?;
    let cancel = Cancel::new();
    let Some(only) = only else {
        if fixup.is_some() {
            return Err(AppError::new(
                ErrorCode::InvalidInput,
                "A fixup commit needs the fixed file.",
            ));
        }
        let _write = state.write_lock.lock().await;
        return Ok(commit::commit(&git, &message, amend, &cancel).await?);
    };
    if amend {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "A fix is a new commit, never an amend.",
        ));
    }
    let _write = state.write_lock.lock().await;
    Ok(commit::commit_only(&git, &message, fixup.as_deref(), &only, &cancel).await?)
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
