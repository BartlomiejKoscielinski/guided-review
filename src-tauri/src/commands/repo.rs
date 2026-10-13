//! `repo_*` commands: the configured repositories (F-19.6), the active one and switching it
//! (F-30.7), and the working-tree watcher that emits `repo_changed` (F-16.2).

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
use crate::source::folder::{self, FolderRepo};
use crate::store::repos::RepoRow;
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

/// A configured repository (S-07 GitLab list, title bar switcher).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Repo {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub path: String,
    /// `group/project` of the `origin` remote on the configured server.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gitlab_project: Option<String>,
    pub is_default: bool,
    pub is_active: bool,
    /// The review worktree folder (default `<repo parent>\.review`).
    pub worktree_root: String,
}

fn to_repo(row: RepoRow, active: Option<i64>) -> Repo {
    Repo {
        worktree_root: row.effective_worktree_root().to_string_lossy().into_owned(),
        is_active: active == Some(row.id),
        id: row.id,
        name: row.name,
        path: row.path,
        gitlab_project: row.gitlab_project,
        is_default: row.is_default,
    }
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

/// Adds the repository of a folder (project from `origin`) and makes it the active one.
pub(crate) async fn add_folder(store: &Store, folder: &Path) -> AppResult<RepoRow> {
    let settings = with_store(store, |conn| store::settings::load(conn)).await?;
    let program = settings.git.path.as_deref().map(Path::new);
    let cancel = Cancel::new();
    Git::new(program, folder).check_version(&cancel).await?;
    let FolderRepo {
        name,
        path,
        gitlab_project,
    } = folder::inspect(program, folder, settings.gitlab.server.as_deref(), &cancel).await?;
    with_store(store, move |conn| {
        let row = store::repos::add(conn, &name, &path, gitlab_project.as_deref())?;
        store::repos::switch(conn, row.id)?;
        Ok(row)
    })
    .await
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

/// Opens the folder dialog and adds the picked folder's repository (S-06 "Pick a repository",
/// S-07 Add repository, the switcher's "Add repository…"); it becomes the active one, and the
/// default when it is the first. `None` when the dialog was closed.
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
    let row = add_folder(&store, &folder).await?;
    let git = active_git(&store).await?;
    watch(&app, &state, &git).await;
    Ok(Some(describe(Path::new(&row.path))))
}

/// The configured repositories. Ones added before a GitLab server was set get their project
/// detected again.
#[tauri::command]
pub async fn repo_list(store: State<'_, Store>) -> AppResult<Vec<Repo>> {
    let (rows, active, settings) = with_store(&store, |conn| {
        Ok((
            store::repos::list(conn)?,
            store::repos::active(conn)?.map(|r| r.id),
            store::settings::load(conn)?,
        ))
    })
    .await?;
    let program = settings.git.path.as_deref().map(Path::new);
    let server = settings.gitlab.server.as_deref();
    let mut repos = Vec::with_capacity(rows.len());
    for mut row in rows {
        if row.gitlab_project.is_none() {
            row.gitlab_project = detect_project(&store, program, server, &row).await?;
        }
        repos.push(to_repo(row, active));
    }
    Ok(repos)
}

/// The project of a repository stored without one, saved when found.
async fn detect_project(
    store: &Store,
    program: Option<&Path>,
    server: Option<&str>,
    row: &RepoRow,
) -> AppResult<Option<String>> {
    let Some(server) = server else {
        return Ok(None);
    };
    let Ok(found) =
        folder::inspect(program, Path::new(&row.path), Some(server), &Cancel::new()).await
    else {
        return Ok(None);
    };
    let Some(project) = found.gitlab_project else {
        return Ok(None);
    };
    let (name, path, stored) = (row.name.clone(), row.path.clone(), project.clone());
    with_store(store, move |conn| {
        store::repos::add(conn, &name, &path, Some(&stored)).map(drop)
    })
    .await?;
    Ok(Some(project))
}

fn not_configured() -> AppError {
    AppError::new(
        ErrorCode::InvalidInput,
        "That repository isn't configured any more.",
    )
}

/// Switches the active repository of S-01 and S-06 (F-30.7).
#[tauri::command]
pub async fn repo_switch<R: Runtime>(
    app: AppHandle<R>,
    store: State<'_, Store>,
    state: State<'_, RepoState>,
    id: i64,
) -> AppResult<ActiveRepo> {
    if !with_store(&store, move |conn| store::repos::switch(conn, id)).await? {
        return Err(not_configured());
    }
    let git = active_git(&store).await?;
    watch(&app, &state, &git).await;
    Ok(describe(git.repo()))
}

/// Settings › GitLab › Set as default (F-19.6).
#[tauri::command]
pub async fn repo_set_default(store: State<'_, Store>, id: i64) -> AppResult<()> {
    if with_store(&store, move |conn| store::repos::set_default(conn, id)).await? {
        Ok(())
    } else {
        Err(not_configured())
    }
}

/// Settings › GitLab › Remove (F-19.6): forgets the repository; nothing on disk changes.
#[tauri::command]
pub async fn repo_remove(store: State<'_, Store>, id: i64) -> AppResult<()> {
    with_store(&store, move |conn| store::repos::remove(conn, id).map(drop)).await
}

fn describe(path: &Path) -> ActiveRepo {
    let path = folder::windows_path(path);
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
