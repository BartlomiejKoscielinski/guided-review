//! Preparation of a teammate's MR (F-05.1, F-05.6), deterministic and without AI: fetch the MR
//! head and the target branch, create, reuse or move the review worktree at
//! `<worktree_root>\<repo>\<iid>`, and list the changed files between the merge base and the
//! head. Progress goes to the caller at each stage; cancelling kills the running git and
//! removes a worktree this run created. The user's checkout is never modified.

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, ErrorCode};
use crate::git::diff::{self, ChangedFile};
use crate::git::{Git, GitError, refs, worktree};
use crate::os::process::Cancel;
use crate::store::repos::RepoRow;
use crate::store::worktrees::{self, KIND_REVIEW, WorktreeRow};
use crate::store::{Store, StoreError};

/// One preparation stage for S-02 Preparing ("Fetching !482", "Creating worktree",
/// "Computing diff · 16 files").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "stage", rename_all = "camelCase")]
#[ts(export)]
pub enum PrepareProgress {
    /// Sent first; carries the MR title for the S-02 heading.
    Fetching {
        #[ts(type = "number")]
        iid: u64,
        title: String,
    },
    CreatingWorktree,
    /// `files` is set once the file list is known.
    ComputingDiff {
        #[ts(optional)]
        #[serde(skip_serializing_if = "Option::is_none")]
        files: Option<u32>,
    },
}

/// The MR to prepare.
pub struct PrepareInput<'a> {
    /// git in the user's repository (the configured path).
    pub git: &'a Git,
    pub repo: &'a RepoRow,
    pub project: &'a str,
    pub iid: u64,
    pub title: &'a str,
    pub target_branch: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prepared {
    pub worktree: PathBuf,
    pub base_sha: String,
    pub head_sha: String,
    pub files: Vec<ChangedFile>,
}

#[derive(Debug, thiserror::Error)]
pub enum PrepareError {
    #[error("Preparation was cancelled.")]
    Cancelled,
    /// The review worktree can't be made; the payload is the copy.
    #[error("{0}")]
    Worktree(String),
    #[error(transparent)]
    Git(GitError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<GitError> for PrepareError {
    fn from(error: GitError) -> Self {
        match error {
            GitError::Cancelled => Self::Cancelled,
            other => Self::Git(other),
        }
    }
}

impl From<PrepareError> for AppError {
    fn from(error: PrepareError) -> Self {
        match error {
            PrepareError::Cancelled => AppError::new(ErrorCode::Cancelled, "Cancelled."),
            PrepareError::Worktree(message) => AppError::new(ErrorCode::WorktreeFailed, message),
            PrepareError::Git(e) => e.into(),
            PrepareError::Store(e) => e.into(),
        }
    }
}

/// `<worktree_root>\<repo>\<iid>`.
pub fn worktree_path(repo: &RepoRow, iid: u64) -> PathBuf {
    repo.effective_worktree_root()
        .join(&repo.name)
        .join(iid.to_string())
}

pub async fn prepare(
    input: &PrepareInput<'_>,
    store: &Store,
    progress: &(dyn Fn(PrepareProgress) + Send + Sync),
    cancel: &Cancel,
) -> Result<Prepared, PrepareError> {
    progress(PrepareProgress::Fetching {
        iid: input.iid,
        title: input.title.to_owned(),
    });
    if !refs::is_branch_name(input.target_branch) {
        return Err(PrepareError::Worktree(format!(
            "The target branch “{}” isn't a valid branch name.",
            input.target_branch
        )));
    }
    let fetched = worktree::fetch_mr(input.git, input.iid, input.target_branch, cancel).await?;
    checkpoint(cancel)?;

    progress(PrepareProgress::CreatingWorktree);
    let path = worktree_path(input.repo, input.iid);
    let created = ensure_worktree(input, store, &path, &fetched.head_sha, cancel).await?;

    let result = async {
        checkpoint(cancel)?;
        progress(PrepareProgress::ComputingDiff { files: None });
        let base =
            diff::merge_base(input.git, &fetched.target_sha, &fetched.head_sha, cancel).await?;
        let files = diff::range_files(input.git, &base, &fetched.head_sha, cancel).await?;
        progress(PrepareProgress::ComputingDiff {
            files: Some(u32::try_from(files.len()).unwrap_or(u32::MAX)),
        });
        checkpoint(cancel)?;
        Ok(Prepared {
            worktree: path.clone(),
            base_sha: base,
            head_sha: fetched.head_sha.clone(),
            files,
        })
    }
    .await;
    if result.is_err() && created {
        remove_registered(input.git, store, &path).await;
    }
    result
}

fn checkpoint(cancel: &Cancel) -> Result<(), PrepareError> {
    if cancel.is_cancelled() {
        Err(PrepareError::Cancelled)
    } else {
        Ok(())
    }
}

async fn registered(store: &Store, path: &Path) -> Result<Option<WorktreeRow>, PrepareError> {
    let key = path.to_string_lossy().into_owned();
    Ok(blocking(store, move |c| worktrees::get(c, &key)).await?)
}

/// Reuses the registered worktree (moving it to `head` for a new MR version) or creates it.
/// Returns whether this run created it. A folder at `path` that isn't registered is never
/// touched.
async fn ensure_worktree(
    input: &PrepareInput<'_>,
    store: &Store,
    path: &Path,
    head: &str,
    cancel: &Cancel,
) -> Result<bool, PrepareError> {
    let row = registered(store, path).await?;
    let listed = worktree::list(input.git, cancel).await?;
    let in_git = worktree::contains(&listed, path);
    if row.is_none() && (path.exists() || in_git) {
        return Err(PrepareError::Worktree(format!(
            "{} already exists and isn't one of the app's worktrees.",
            path.display()
        )));
    }
    if row.is_some() && in_git && path.is_dir() {
        let at = input.git.at(path);
        if worktree::head(&at, cancel).await? != head
            && let Err(error) = worktree::move_to(&at, head, cancel).await
        {
            if matches!(error, GitError::Cancelled) {
                return Err(PrepareError::Cancelled);
            }
            tracing::warn!(%error, "review worktree could not be moved; recreating it");
            remove_registered(input.git, store, path).await;
            return create(input, store, path, head, cancel)
                .await
                .map(|()| true);
        }
        let key = path.to_string_lossy().into_owned();
        let sha = head.to_owned();
        blocking(store, move |c| worktrees::touch(c, &key, &sha)).await?;
        return Ok(false);
    }
    if row.is_some() {
        // Registered but gone from git or from disk: clear what is left, then create again.
        remove_registered(input.git, store, path).await;
    }
    create(input, store, path, head, cancel)
        .await
        .map(|()| true)
}

/// Registers the path first so that a half-made worktree can be removed, then adds it.
async fn create(
    input: &PrepareInput<'_>,
    store: &Store,
    path: &Path,
    head: &str,
    cancel: &Cancel,
) -> Result<(), PrepareError> {
    let row = WorktreeRow {
        path: path.to_string_lossy().into_owned(),
        repo_id: input.repo.id,
        kind: KIND_REVIEW.to_owned(),
        project: Some(input.project.to_owned()),
        iid: Some(input.iid),
        head_sha: Some(head.to_owned()),
    };
    blocking(store, move |c| worktrees::register(c, &row)).await?;
    let made = async {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                PrepareError::Worktree(format!("{} could not be created: {e}", parent.display()))
            })?;
        }
        worktree::add(input.git, path, head, cancel).await?;
        Ok(())
    }
    .await;
    if made.is_err() {
        remove_registered(input.git, store, path).await;
    }
    made
}

/// Removes a registered worktree with git, then whatever folder is left, and forgets it.
/// Cleanup runs after a cancel, so it uses its own cancel token; failures are logged.
pub async fn remove_registered(git: &Git, store: &Store, path: &Path) {
    match registered(store, path).await {
        Ok(Some(_)) => {}
        Ok(None) => return,
        Err(error) => {
            tracing::warn!(%error, "worktree registry unavailable; nothing removed");
            return;
        }
    }
    let cancel = Cancel::new();
    if let Err(error) = worktree::remove(git, path, &cancel).await {
        tracing::debug!(%error, "git worktree remove failed; removing the folder");
    }
    if path.exists()
        && let Err(error) = std::fs::remove_dir_all(path)
    {
        tracing::warn!(%error, "review worktree folder could not be removed");
    }
    if let Err(error) = worktree::prune(git, &cancel).await {
        tracing::warn!(%error, "git worktree prune failed");
    }
    let key = path.to_string_lossy().into_owned();
    if let Err(error) = blocking(store, move |c| worktrees::unregister(c, &key)).await {
        tracing::warn!(%error, "worktree row could not be removed");
    }
}

async fn blocking<T, F>(store: &Store, f: F) -> Result<T, StoreError>
where
    T: Send + 'static,
    F: FnOnce(&mut rusqlite::Connection) -> Result<T, StoreError> + Send + 'static,
{
    let store = store.clone();
    tokio::task::spawn_blocking(move || store.with_conn(f))
        .await
        .map_err(|_| StoreError::Poisoned)?
}
