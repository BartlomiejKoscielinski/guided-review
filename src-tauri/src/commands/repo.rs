//! `repo_*` commands: the active repository (M1: the default one, picked in S-06) and the
//! working-tree watcher that emits `repo_changed` (F-16.2).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::Git;
use crate::git::watch::RepoWatcher;
use crate::os::process::Cancel;
use crate::store::{self, Store};

/// Event emitted when the active repository's working tree, index or HEAD changed.
pub const REPO_CHANGED: &str = "repo_changed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ActiveRepo {
    /// Folder name, shown in the title bar.
    pub name: String,
    /// Absolute path of the working tree.
    pub path: String,
}

/// The watcher of the active repository and a lock that serializes index writes (two quick
/// clicks must not race for `index.lock`).
#[derive(Default)]
pub struct RepoState {
    watcher: Mutex<Option<(PathBuf, RepoWatcher)>>,
    pub write_lock: tokio::sync::Mutex<()>,
}

/// git for the active repository, or `INVALID_INPUT` "Pick a repository first."
pub(crate) async fn active_git(store: &Store) -> AppResult<Git> {
    let (repo, settings) = with_store(store, |conn| {
        Ok((store::repos::active(conn)?, store::settings::load(conn)?))
    })
    .await?;
    let repo = repo
        .filter(|r| Path::new(&r.path).is_dir())
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Pick a repository first."))?;
    Ok(Git::new(
        settings.git.path.as_deref().map(Path::new),
        repo.path,
    ))
}

/// The active repository, if one was picked and still exists. Starts watching it.
#[tauri::command]
pub async fn repo_active<R: Runtime>(
    app: AppHandle<R>,
    store: State<'_, Store>,
    state: State<'_, RepoState>,
) -> AppResult<Option<ActiveRepo>> {
    let git = match active_git(&store).await {
        Ok(git) => git,
        Err(error) if error.code == ErrorCode::InvalidInput => return Ok(None),
        Err(error) => return Err(error),
    };
    git.check_version(&Cancel::new()).await?;
    watch(&app, &state, &git).await;
    Ok(Some(describe(git.repo())))
}

/// Opens the folder dialog; the picked folder's working tree becomes the default repository.
/// `None` when the dialog was closed.
#[tauri::command]
pub async fn repo_pick<R: Runtime>(
    app: AppHandle<R>,
    store: State<'_, Store>,
    state: State<'_, RepoState>,
) -> AppResult<Option<ActiveRepo>> {
    let dialog = app.dialog().file().set_title("Pick a repository");
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| AppError::internal("The folder dialog failed.").with_detail(e.to_string()))?;
    let Some(folder) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let settings = with_store(&store, |conn| store::settings::load(conn)).await?;
    let git = Git::new(settings.git.path.as_deref().map(Path::new), &folder);
    let cancel = Cancel::new();
    git.check_version(&cancel).await?;
    let top = git.toplevel(&cancel).await?;
    let repo = describe(&top);
    let (name, path) = (repo.name.clone(), repo.path.clone());
    with_store(&store, move |conn| {
        store::repos::set_default(conn, &name, &path).map(drop)
    })
    .await?;
    let git = Git::new(settings.git.path.as_deref().map(Path::new), &top);
    watch(&app, &state, &git).await;
    Ok(Some(repo))
}

fn describe(path: &Path) -> ActiveRepo {
    // git prints forward slashes; show the Windows form.
    let path = PathBuf::from(
        path.to_string_lossy()
            .replace('/', std::path::MAIN_SEPARATOR_STR),
    );
    ActiveRepo {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
    }
}

/// (Re)starts the watcher when the active repository changed.
async fn watch<R: Runtime>(app: &AppHandle<R>, state: &RepoState, git: &Git) {
    let repo = git.repo().to_path_buf();
    let watching = state
        .watcher
        .lock()
        .is_ok_and(|guard| guard.as_ref().is_some_and(|(path, _)| *path == repo));
    if watching {
        return;
    }
    let git_dir = match git.git_dir(&Cancel::new()).await {
        Ok(dir) => dir,
        Err(error) => {
            tracing::warn!(%error, "no git directory to watch");
            return;
        }
    };
    let handle = app.clone();
    let started = RepoWatcher::start(&repo, &git_dir, move || {
        if let Err(error) = handle.emit(REPO_CHANGED, ()) {
            tracing::warn!(%error, "repo_changed could not be emitted");
        }
    });
    match started {
        Ok(watcher) => {
            if let Ok(mut guard) = state.watcher.lock() {
                *guard = Some((repo, watcher));
            }
        }
        Err(error) => tracing::warn!(%error, "working tree not watched"),
    }
}

/// Registers the state used by these commands.
pub fn manage<R: Runtime>(app: &AppHandle<R>) {
    app.manage(RepoState::default());
}
