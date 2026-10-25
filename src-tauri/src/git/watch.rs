//! Working-tree watcher (F-16.2; docs/04 › Background work): changes in the working tree, the
//! index, HEAD, refs or an unfinished merge/rebase call `on_change` once per burst (debounce
//! 300 ms), so S-06 shows what Rider or a terminal did. Independent of Tauri; the command layer
//! turns the callback into the `repo_changed` event.
//!
//! `FileWatcher` (F-26.3, M7 decision 7): after **Fix in Rider** S-10 waits for a content change
//! of the thread's one file, on the same debouncer; the command layer turns it into `fix_watch`.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::error::{AppError, ErrorCode};

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};

pub const DEBOUNCE: Duration = Duration::from_millis(300);

/// Watches until dropped.
pub struct RepoWatcher {
    _debouncer: Debouncer<RecommendedWatcher>,
}

#[derive(Debug, thiserror::Error)]
pub enum WatchError {
    #[error("the working tree can't be watched: {0}")]
    Notify(String),
    /// A file path that is empty, absolute or leaves the working tree (`..`).
    #[error("the file is not inside the working tree")]
    Outside,
}

impl From<WatchError> for AppError {
    fn from(error: WatchError) -> Self {
        match error {
            WatchError::Outside => AppError::new(ErrorCode::InvalidInput, "Invalid file path."),
            WatchError::Notify(detail) => {
                AppError::internal("The working tree can’t be watched.").with_detail(detail)
            }
        }
    }
}

fn notify_error(error: impl std::fmt::Display) -> WatchError {
    WatchError::Notify(error.to_string())
}

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
            .map_err(notify_error)?;
        debouncer
            .watcher()
            .watch(repo, RecursiveMode::Recursive)
            .map_err(notify_error)?;
        if !git_dir.starts_with(repo) {
            debouncer
                .watcher()
                .watch(git_dir, RecursiveMode::Recursive)
                .map_err(notify_error)?;
        }
        Ok(Self {
            _debouncer: debouncer,
        })
    }
}

/// Waits for a content change of one working-tree file (F-26.3); watches until the first change
/// or until dropped (Stop waiting, thread switch, leaving S-10).
pub struct FileWatcher {
    _debouncer: Debouncer<RecommendedWatcher>,
}

impl FileWatcher {
    /// `file` is relative to the working tree `repo`, `/` or `\` separated. The file's content
    /// hash is taken now (the click); `on_change` runs once, when a write leaves a different
    /// content (a deleted file counts). Writes of other files or of the same content are ignored.
    pub fn start(
        repo: &Path,
        file: &str,
        on_change: impl Fn() + Send + 'static,
    ) -> Result<Self, WatchError> {
        let target = inside(repo, file)?;
        let baseline = content_hash(&target)
            .ok_or_else(|| WatchError::Notify(format!("{} can't be read", target.display())))?;
        let done = Arc::new(AtomicBool::new(false));
        let watched = target.clone();
        let mut debouncer =
            new_debouncer(DEBOUNCE, move |result: DebounceEventResult| match result {
                Ok(events) => {
                    if done.load(Ordering::SeqCst)
                        || !events.iter().any(|e| same_path(&e.path, &watched))
                    {
                        return;
                    }
                    let Some(now) = content_hash(&watched) else {
                        return;
                    };
                    if now != baseline && !done.swap(true, Ordering::SeqCst) {
                        on_change();
                    }
                }
                Err(error) => tracing::warn!(%error, "file watcher error"),
            })
            .map_err(notify_error)?;
        // The parent folder catches a save through a temporary file and a rename too.
        let (folder, mode) = match target.parent().filter(|p| p.is_dir()) {
            Some(parent) => (parent.to_path_buf(), RecursiveMode::NonRecursive),
            None => (repo.to_path_buf(), RecursiveMode::Recursive),
        };
        debouncer
            .watcher()
            .watch(&folder, mode)
            .map_err(notify_error)?;
        Ok(Self {
            _debouncer: debouncer,
        })
    }
}

/// `file` (git or Windows separators) as a path under `repo`; `..`, a root or a drive is refused.
fn inside(repo: &Path, file: &str) -> Result<PathBuf, WatchError> {
    let mut path = repo.to_path_buf();
    let mut parts = 0;
    for part in file.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        let mut components = Path::new(part).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) => path.push(name),
            _ => return Err(WatchError::Outside),
        }
        parts += 1;
    }
    if parts == 0 {
        return Err(WatchError::Outside);
    }
    Ok(path)
}

/// The SHA-256 of the file's bytes; `Some(None)` when it doesn't exist, `None` when it can't be
/// read now (a writer holds it: the next event reads it again).
fn content_hash(path: &Path) -> Option<Option<[u8; 32]>> {
    match std::fs::read(path) {
        Ok(bytes) => Some(Some(Sha256::digest(&bytes).into())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(None),
        Err(error) => {
            tracing::debug!(%error, "watched file not readable");
            None
        }
    }
}

/// Windows paths compare without case.
fn same_path(a: &Path, b: &Path) -> bool {
    a == b
        || (cfg!(windows)
            && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase())
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

    #[test]
    fn f26_3_the_watched_file_is_inside_the_working_tree() {
        let repo = Path::new("C:\\src\\mobile app");
        let expected = repo.join("src").join("Zażółć").join("A b.cs");
        assert_eq!(inside(repo, "src/Zażółć/A b.cs").unwrap(), expected);
        assert_eq!(inside(repo, "src\\Zażółć\\A b.cs").unwrap(), expected);
        assert_eq!(inside(repo, "./src/Zażółć/A b.cs").unwrap(), expected);
        for bad in ["", "/", "..", "../x.cs", "src/../../x.cs", "C:\\x.cs"] {
            assert!(inside(repo, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn f26_3_a_watch_error_reaches_the_ui_without_paths() {
        let outside = AppError::from(WatchError::Outside);
        assert_eq!(outside.code, ErrorCode::InvalidInput);
        let failed = AppError::from(WatchError::Notify("C:\\src\\x".into()));
        assert_eq!(failed.message, "The working tree can’t be watched.");
    }
}
