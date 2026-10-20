//! Scratch worktrees for Fix with Claude (F-25.2, ADR-018; docs/05 › Fix scratch worktree).
//! `git stash create` turns the tracked uncommitted changes into a commit object without
//! touching the checkout (empty output = a clean tree, use `HEAD`); `git worktree add --detach`
//! checks it out under `<app tmp>/scratch/<id>`; an untracked target file is copied in. The
//! path is registered in `worktrees` (kind `scratch`) before git creates it, so the janitor can
//! remove a leftover one (T8). The user's checkout is only read.

use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use super::error::GitError;
use super::runner::Git;
use super::worktree;
use crate::error::AppError;
use crate::os::process::Cancel;
use crate::store::{Store, StoreError, worktrees};

/// `worktrees.kind` of a fix scratch worktree.
pub const KIND_SCRATCH: &str = "scratch";

/// An app-managed copy of the user's working tree for one fix run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scratch {
    /// `<root>/<id>`; Claude's working directory.
    pub path: PathBuf,
    /// The commit the scratch is checked out at (`git stash create`, or `HEAD`).
    pub base_sha: String,
    /// The one file Claude may edit, relative to the repository (as given).
    pub file: PathBuf,
    /// SHA-256 of the user's copy of `file` when the run started (Accept compares it, F-25.4).
    pub start_hash: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ScratchError {
    #[error("the file to fix must be a relative path inside the repository: {0}")]
    InvalidFile(String),
    #[error("the file to fix could not be read: {0}")]
    Read(std::io::Error),
    #[error("the scratch copy could not be prepared: {0}")]
    Io(std::io::Error),
    #[error(transparent)]
    Git(#[from] GitError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<ScratchError> for AppError {
    fn from(error: ScratchError) -> Self {
        match error {
            ScratchError::Git(e) => e.into(),
            ScratchError::Store(e) => e.into(),
            ScratchError::InvalidFile(_) => AppError::new(
                crate::error::ErrorCode::InvalidInput,
                "This file can't be fixed.",
            )
            .with_detail(error.to_string()),
            other => AppError::internal("The copy for Claude could not be prepared.")
                .with_detail(other.to_string()),
        }
    }
}

/// The file as git prints it: forward slashes, relative to the repository root.
pub fn git_path(file: &Path) -> Result<String, ScratchError> {
    let invalid = || ScratchError::InvalidFile(file.to_string_lossy().into_owned());
    let text = file.to_string_lossy().replace('\\', "/");
    if text.starts_with('/') {
        return Err(invalid());
    }
    let mut parts = Vec::new();
    for component in Path::new(&text).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(invalid());
            }
        }
    }
    if parts.is_empty() {
        return Err(invalid());
    }
    Ok(parts.join("/"))
}

/// SHA-256 (hex) of the bytes of a file.
pub fn file_hash(path: &Path) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    Ok(Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// Creates the scratch worktree `root/id` for fixing `file` in the repository of `git`.
pub async fn create(
    git: &Git,
    store: &Store,
    repo_id: i64,
    root: &Path,
    id: &str,
    file: &Path,
    cancel: &Cancel,
) -> Result<Scratch, ScratchError> {
    let rel = git_path(file)?;
    let user_copy = git.repo().join(&rel);
    let start_hash = file_hash(&user_copy).map_err(ScratchError::Read)?;
    let stash = git.run(["stash", "create"], cancel).await?;
    let base_sha = match stash.stdout.trim() {
        "" => worktree::head(git, cancel).await?,
        sha => sha.to_owned(),
    };
    let scratch = Scratch {
        path: root.join(id),
        base_sha,
        file: file.to_path_buf(),
        start_hash,
    };
    let key = scratch.path.to_string_lossy().into_owned();
    store.with_conn(|conn| {
        worktrees::register(
            conn,
            &worktrees::WorktreeRow {
                path: key.clone(),
                repo_id,
                kind: KIND_SCRATCH.to_owned(),
                project: None,
                iid: None,
                head_sha: Some(scratch.base_sha.clone()),
            },
        )
    })?;
    if let Err(error) = populate(git, &scratch, &rel, &user_copy, cancel).await {
        remove(git, store, &scratch).await;
        return Err(error);
    }
    Ok(scratch)
}

async fn populate(
    git: &Git,
    scratch: &Scratch,
    rel: &str,
    user_copy: &Path,
    cancel: &Cancel,
) -> Result<(), ScratchError> {
    if let Some(parent) = scratch.path.parent() {
        std::fs::create_dir_all(parent).map_err(ScratchError::Io)?;
    }
    worktree::add(git, &scratch.path, &scratch.base_sha, cancel).await?;
    let target = scratch.path.join(rel);
    if !target.exists() {
        // An untracked target: `git stash create` leaves untracked files out.
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(ScratchError::Io)?;
        }
        std::fs::copy(user_copy, &target).map_err(ScratchError::Io)?;
    }
    Ok(())
}

/// Removes the scratch worktree (git first, then whatever is left of the folder) and its
/// registration. Never fails: what can't be removed is logged and left to the janitor.
pub async fn remove(git: &Git, store: &Store, scratch: &Scratch) {
    let cancel = Cancel::new();
    if let Err(error) = worktree::remove(git, &scratch.path, &cancel).await {
        tracing::warn!(%error, "git could not remove the scratch worktree");
    }
    if scratch.path.exists()
        && let Err(error) = std::fs::remove_dir_all(&scratch.path)
    {
        tracing::warn!(%error, "the scratch folder could not be removed");
    }
    if let Err(error) = worktree::prune(git, &cancel).await {
        tracing::warn!(%error, "git worktree prune failed");
    }
    if scratch.path.exists() {
        // Keep the registration so the janitor retries.
        return;
    }
    let key = scratch.path.to_string_lossy().into_owned();
    if let Err(error) = store.with_conn(|conn| worktrees::unregister(conn, &key)) {
        tracing::warn!(%error, "the scratch worktree could not be unregistered");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f25_2_git_path_is_relative_with_forward_slashes() {
        assert_eq!(
            git_path(Path::new(r"src\Zażółć gęślą\Upload Queue.cs")).unwrap(),
            "src/Zażółć gęślą/Upload Queue.cs"
        );
        assert_eq!(git_path(Path::new("./a/b.cs")).unwrap(), "a/b.cs");
        for bad in ["", "/a.cs", "../a.cs", "a/../../b.cs", r"C:\a.cs"] {
            assert!(git_path(Path::new(bad)).is_err(), "{bad}");
        }
    }
}
