//! Working-tree watcher (F-16.2; docs/04 › Background work): changes in the working tree, the
//! index, HEAD, refs or an unfinished merge/rebase call `on_change` once per burst (debounce
//! 300 ms), so S-06 shows what Rider or a terminal did. Independent of Tauri; the command layer
//! turns the callback into the `repo_changed` event.

use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};

pub const DEBOUNCE: Duration = Duration::from_millis(300);

/// Watches until dropped.
pub struct RepoWatcher {
    _debouncer: Debouncer<RecommendedWatcher>,
}

#[derive(Debug, thiserror::Error)]
#[error("the working tree can't be watched: {0}")]
pub struct WatchError(String);

impl RepoWatcher {
    /// `repo` is the working tree, `git_dir` its git directory (inside or outside the tree).
    pub fn start(
        repo: &Path,
        git_dir: &Path,
        on_change: impl Fn() + Send + 'static,
    ) -> Result<Self, WatchError> {
        let repo_root = repo.to_path_buf();
        let git_root = git_dir.to_path_buf();
        let mut debouncer =
            new_debouncer(DEBOUNCE, move |result: DebounceEventResult| match result {
                Ok(events) => {
                    if events
                        .iter()
                        .any(|e| is_relevant(&e.path, &repo_root, &git_root))
                    {
                        on_change();
                    }
                }
                Err(error) => tracing::warn!(%error, "working-tree watcher error"),
            })
            .map_err(|e| WatchError(e.to_string()))?;
        debouncer
            .watcher()
            .watch(repo, RecursiveMode::Recursive)
            .map_err(|e| WatchError(e.to_string()))?;
        if !git_dir.starts_with(repo) {
            debouncer
                .watcher()
                .watch(git_dir, RecursiveMode::Recursive)
                .map_err(|e| WatchError(e.to_string()))?;
        }
        Ok(Self {
            _debouncer: debouncer,
        })
    }
}

/// Inside the git directory only the index, HEAD, refs and merge/rebase markers matter;
/// objects, logs and lock files change all the time.
pub fn is_relevant(path: &Path, repo: &Path, git_dir: &Path) -> bool {
    let Ok(inside) = path.strip_prefix(git_dir) else {
        return path.starts_with(repo);
    };
    let first: Option<PathBuf> = inside.components().next().and_then(|c| match c {
        Component::Normal(name) => Some(PathBuf::from(name)),
        _ => None,
    });
    let Some(first) = first else {
        return false;
    };
    let name = first.to_string_lossy();
    if name.ends_with(".lock") {
        return false;
    }
    matches!(
        name.as_ref(),
        "index"
            | "HEAD"
            | "refs"
            | "packed-refs"
            | "MERGE_HEAD"
            | "CHERRY_PICK_HEAD"
            | "REVERT_HEAD"
            | "rebase-merge"
            | "rebase-apply"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f16_2_only_relevant_git_files_trigger_a_refresh() {
        let repo = Path::new("C:\\src\\mobile app");
        let git = repo.join(".git");
        assert!(is_relevant(&repo.join("src\\A ż.cs"), repo, &git));
        assert!(is_relevant(&git.join("index"), repo, &git));
        assert!(is_relevant(&git.join("refs\\heads\\main"), repo, &git));
        assert!(is_relevant(&git.join("MERGE_HEAD"), repo, &git));
        assert!(!is_relevant(&git.join("index.lock"), repo, &git));
        assert!(!is_relevant(&git.join("objects\\ab\\cdef"), repo, &git));
        assert!(!is_relevant(&git.join("logs\\HEAD"), repo, &git));
        assert!(!is_relevant(Path::new("C:\\elsewhere\\x"), repo, &git));
    }
}
