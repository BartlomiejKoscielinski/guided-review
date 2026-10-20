//! F-25.4 At app start the proposals are gone (they live in core memory only), so every scratch
//! worktree left from the last run is removed: git first, then the folder, then its
//! registration. Only paths registered with kind `scratch` are touched (T8).

use std::path::{Path, PathBuf};

use crate::git::Git;
use crate::git::scratch::{self, KIND_SCRATCH, Scratch};
use crate::store::{Store, repos, worktrees};

/// Removes the registered scratch worktrees. Never fails: what can't be removed is logged and
/// stays registered for the next start.
pub async fn sweep(store: &Store, git_program: Option<&Path>) {
    let rows = match store.with_conn(|c| worktrees::of_kind(c, KIND_SCRATCH)) {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(%error, "the leftover scratch worktrees could not be listed");
            return;
        }
    };
    for row in rows {
        let repo = store
            .with_conn(|c| repos::get(c, row.repo_id))
            .ok()
            .flatten();
        let path = PathBuf::from(&row.path);
        match repo {
            Some(repo) => {
                let git = Git::new(git_program, Path::new(&repo.path));
                let leftover = Scratch {
                    path,
                    base_sha: row.head_sha.clone().unwrap_or_default(),
                    file: PathBuf::new(),
                    start_hash: String::new(),
                };
                scratch::remove(&git, store, &leftover).await;
            }
            None => remove_orphan(store, &path, &row.path),
        }
    }
}

/// A scratch whose repository was removed from the app: no git to ask, only the folder.
fn remove_orphan(store: &Store, path: &Path, key: &str) {
    if path.exists()
        && let Err(error) = std::fs::remove_dir_all(path)
    {
        tracing::warn!(%error, "a leftover scratch folder could not be removed");
        return;
    }
    if let Err(error) = store.with_conn(|c| worktrees::unregister(c, key)) {
        tracing::warn!(%error, "a leftover scratch worktree could not be unregistered");
    }
}
