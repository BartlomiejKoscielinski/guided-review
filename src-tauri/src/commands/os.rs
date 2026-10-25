//! Rider commands: `rider_open` (F-15.5, F-24.1) opens a file at a line, from the active
//! repository's working copy or, for a session, from the folder `rider.openFrom` picks;
//! `rider_status` and `rider_pick_executable` back Settings › Integrations (F-24.4);
//! `os_open_gitlab_url` (F-20.4, M6 decision 13) opens a page of the configured GitLab in the
//! default browser.

use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;

use super::repo::active_git;
use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::os::browser::{self, BrowserError};
use crate::os::process::spawn_detached;
use crate::os::rider::{self, RiderInput, RiderInstall};
use crate::os::rider_pick::{self, RiderStatus};
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
    let install = detect(settings.rider.path).await?.ok_or_else(|| {
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

/// Opens `url` in the default browser when it is an `https` URL on the configured GitLab host
/// (Open in GitLab, F-20.4); anything else is refused and starts nothing.
#[tauri::command]
pub async fn os_open_gitlab_url(store: State<'_, Store>, url: String) -> AppResult<()> {
    let server = with_store(&store, |conn| {
        Ok(store::settings::load(conn)?.gitlab.server)
    })
    .await?;
    browser::open_gitlab_url(server.as_deref().unwrap_or(""), &url).map_err(|e| match e {
        BrowserError::Refused => AppError::new(ErrorCode::InvalidInput, e.to_string()),
        BrowserError::Launch(source) => {
            AppError::internal("The browser could not be started.").with_detail(source.to_string())
        }
    })
}

/// The install the app uses: the Settings value, else the detected one (docs/05 › Rider).
async fn detect(configured: Option<String>) -> AppResult<Option<RiderInstall>> {
    let configured = configured.map(PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || rider::discover(&RiderInput::from_env(configured)))
        .await
        .map_err(|e| AppError::internal("Rider lookup failed.").with_detail(e.to_string()))
}

/// Settings › Integrations › JetBrains Rider: the path and version the app uses (F-24.4).
#[tauri::command]
pub async fn rider_status(store: State<'_, Store>) -> AppResult<RiderStatus> {
    let settings = with_store(&store, |conn| store::settings::load(conn)).await?;
    let install = detect(settings.rider.path).await?;
    Ok(RiderStatus::from_install(install.as_ref()))
}

/// **Change** (F-24.4): file dialog for `rider64.exe` (or a Toolbox `rider.cmd`, stored as the
/// exe it starts); saved as `rider.path`. `None` when the dialog was closed.
#[tauri::command]
pub async fn rider_pick_executable<R: Runtime>(
    app: AppHandle<R>,
    store: State<'_, Store>,
) -> AppResult<Option<RiderStatus>> {
    let dialog = app
        .dialog()
        .file()
        .set_title("Rider executable")
        .add_filter("Rider", &["exe", "cmd"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| AppError::internal("The file dialog failed.").with_detail(e.to_string()))?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let install = tauri::async_runtime::spawn_blocking(move || rider_pick::pick_install(&path))
        .await
        .map_err(|e| AppError::internal("Rider lookup failed.").with_detail(e.to_string()))?
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::InvalidInput,
                "That file isn't a Rider executable.",
            )
        })?;
    let value = install.exe.to_string_lossy().into_owned();
    with_store(&store, move |c| {
        store::settings::update(c, &serde_json::json!({ "rider": { "path": value } })).map(drop)
    })
    .await?;
    Ok(Some(RiderStatus::from_install(Some(&install))))
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
    // Joined per component so a git path (`a/b.cs`) becomes a native one (`a\b.cs`).
    Ok(relative
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .fold(repo.to_path_buf(), |path, c| path.join(c)))
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

    #[test]
    fn f24_1_git_paths_become_native_paths_for_rider() {
        let repo = Path::new("C:\\Repos\\.review\\gr-sandbox\\2");
        let path = inside(repo, "src/Delivery.App/./Zażółć A.cs").unwrap();
        assert_eq!(
            path,
            repo.join("src").join("Delivery.App").join("Zażółć A.cs")
        );
        assert_eq!(
            path.to_string_lossy(),
            "C:\\Repos\\.review\\gr-sandbox\\2\\src\\Delivery.App\\Zażółć A.cs"
        );
    }
}
