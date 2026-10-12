//! `rider_open` (F-15.5, F-24.1): opens a file in Rider at a line, from the active
//! repository's working copy or, for a session, from the folder `rider.openFrom` picks.

use std::path::{Component, Path, PathBuf};

use tauri::State;

use super::repo::active_git;
use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::os::process::spawn_detached;
use crate::os::rider::{self, RiderInput};
use crate::store::{self, Store};

/// `file` is repository-relative with `/`; `line` is 1-based. An empty `file` opens the
/// repository folder ("Pull with rebase in Rider" after a rejected push). With `session`, a
/// teammate's MR opens from its review worktree or the checkout (`rider.openFrom`, F-24.1).
#[tauri::command]
pub async fn rider_open(
    store: State<'_, Store>,
    file: String,
    line: u32,
    session: Option<String>,
) -> AppResult<()> {
    let settings = with_store(&store, |conn| store::settings::load(conn)).await?;
    let root = match session {
        Some(id) => {
            let folders = with_store(&store, move |conn| store::sessions::folders(conn, &id))
                .await?
                .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Unknown session."))?;
            let root = rider::open_root(
                settings.rider.open_from,
                folders.worktree.as_deref(),
                &folders.checkout,
            );
            if !root.is_dir() {
                return Err(AppError::new(
                    ErrorCode::WorktreeFailed,
                    "The review worktree is gone. Open the merge request again.",
                ));
            }
            root.to_path_buf()
        }
        None => active_git(&store).await?.repo().to_path_buf(),
    };
    let path = if file.is_empty() {
        None
    } else {
        Some(inside(&root, &file)?)
    };
    let configured = settings.rider.path.map(PathBuf::from);
    let install = tauri::async_runtime::spawn_blocking(move || {
        rider::discover(&RiderInput::from_env(configured))
    })
    .await
    .map_err(|e| AppError::internal("Rider lookup failed.").with_detail(e.to_string()))?
    .ok_or_else(|| {
        AppError::new(
            ErrorCode::InvalidInput,
            "Rider wasn't found. Set its path in Settings › Integrations.",
        )
    })?;
    let args = match &path {
        Some(path) => rider::open_args(path, line.max(1), None),
        None => vec![root.as_os_str().to_owned()],
    };
    spawn_detached(&install.exe, &args, None).map_err(|e| {
        AppError::internal("Rider could not be started.").with_detail(e.to_string())
    })?;
    Ok(())
}

/// A repository-relative path joined to the repository; no absolute paths or `..`.
fn inside(repo: &Path, file: &str) -> AppResult<PathBuf> {
    let relative = Path::new(file);
    let safe = !file.is_empty()
        && relative
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    if !safe {
        return Err(AppError::new(ErrorCode::InvalidInput, "Invalid file path."));
    }
    Ok(repo.join(relative))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_paths_inside_the_repository_are_opened() {
        let repo = Path::new("C:\\src\\mobile app");
        assert_eq!(
            inside(repo, "src/Zażółć/A b.cs").unwrap(),
            repo.join("src/Zażółć/A b.cs")
        );
        assert!(inside(repo, "../secret.txt").is_err());
        assert!(inside(repo, "C:\\Windows\\win.ini").is_err());
        assert!(inside(repo, "/etc/passwd").is_err());
        assert!(inside(repo, "").is_err());
    }
}
