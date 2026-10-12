//! `rider_open` (F-15.5): opens a file of the active repository's working copy in Rider at a
//! line. Files of a teammate's MR (worktree) follow with F-24.1 in M2.

use std::path::{Component, Path, PathBuf};

use tauri::State;

use super::repo::active_git;
use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::os::process::spawn_detached;
use crate::os::rider::{self, RiderInput};
use crate::store::{self, Store};

/// `file` is repository-relative with `/`; `line` is 1-based.
#[tauri::command]
pub async fn rider_open(store: State<'_, Store>, file: String, line: u32) -> AppResult<()> {
    let git = active_git(&store).await?;
    let path = inside(git.repo(), &file)?;
    let settings = with_store(&store, |conn| store::settings::load(conn)).await?;
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
    spawn_detached(
        &install.exe,
        &rider::open_args(&path, line.max(1), None),
        None,
    )
    .map_err(|e| AppError::internal("Rider could not be started.").with_detail(e.to_string()))?;
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
