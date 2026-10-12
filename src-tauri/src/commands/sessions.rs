//! `sessions_*` and `session_open_*` commands. Commit and local sessions open stub screens until
//! M3 (M2 decision 3); MR sessions come with preparation (`session_open_mr`, F-05) and open S-02.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::State;
use tauri::ipc::Channel;

use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error};
use super::repo::{active_git, add_folder};
use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::Git;
use crate::os::process::Cancel;
use crate::review::mr_summary::{self, MrMeta, SessionMr};
use crate::review::open_mr::{self, OpenMr, OpenMrError, SessionDefaults};
use crate::review::prepare::PrepareProgress;
use crate::review::sessions::{self, OpenedSession, UnfinishedSession};
use crate::source::open::{self, Resolved};
use crate::source::{CommitRange, LocalScope};
use crate::store::{self, Store};

/// Unfinished sessions, most recent first; the Review tile resumes the first one (F-30.2).
#[tauri::command]
pub async fn sessions_list_unfinished(
    store: State<'_, Store>,
) -> AppResult<Vec<UnfinishedSession>> {
    with_store(&store, |conn| store::unfinished_sessions(conn)).await
}

/// Stores a resolved source as a new session of the active repository.
async fn create(store: &Store, resolved: Resolved) -> AppResult<OpenedSession> {
    let (repo, settings) = with_store(store, |conn| {
        Ok((store::repos::active(conn)?, store::settings::load(conn)?))
    })
    .await?;
    let repo =
        repo.ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Pick a repository first."))?;
    let (row, opened) = sessions::new_session(
        repo.id,
        resolved,
        settings.ui.start_in,
        settings.ui.focus_layout,
    )
    .map_err(|e| {
        AppError::internal("The session could not be saved.").with_detail(e.to_string())
    })?;
    with_store(store, move |conn| store::sessions::insert(conn, &row)).await?;
    Ok(opened)
}

/// Step review of one commit or a range `from..to` (F-01.3, F-03.2).
#[tauri::command]
pub async fn session_open_commit(
    store: State<'_, Store>,
    range: CommitRange,
) -> AppResult<OpenedSession> {
    let git = active_git(&store).await?;
    let resolved = open::commits(&git, &range, &Cancel::new()).await?;
    create(&store, resolved).await
}

/// Self-review of local changes in one scope (F-03.4, F-17).
#[tauri::command]
pub async fn session_open_local(
    store: State<'_, Store>,
    scope: LocalScope,
) -> AppResult<OpenedSession> {
    let git = active_git(&store).await?;
    let resolved = open::local(&git, &scope, &Cancel::new()).await?;
    create(&store, resolved).await
}

/// A branch typed in S-01: the current one as local changes, another one as its commits.
#[tauri::command]
pub async fn session_open_branch(
    store: State<'_, Store>,
    branch: String,
) -> AppResult<OpenedSession> {
    let git = active_git(&store).await?;
    let resolved = open::branch(&git, &branch, &Cancel::new()).await?;
    create(&store, resolved).await
}

/// A repository path typed in S-01: added when it isn't configured, made active, then
/// self-review of its branch.
#[tauri::command]
pub async fn session_open_repo(store: State<'_, Store>, path: String) -> AppResult<OpenedSession> {
    let folder = PathBuf::from(path.trim().trim_matches('"'));
    if !folder.is_absolute() || !Path::new(&folder).is_dir() {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            format!("No commit, branch or repository matches “{}”.", path.trim()),
        ));
    }
    add_folder(&store, &folder).await?;
    let git = active_git(&store).await?;
    let cancel = Cancel::new();
    let scope = open::default_scope(&git, &cancel).await?;
    let resolved = open::local(&git, &scope, &cancel).await?;
    create(&store, resolved).await
}

/// Running MR preparations by the UI's task ID, for `session_prepare_cancel` (F-05.6).
#[derive(Default)]
pub struct PrepareTasks(Mutex<HashMap<String, Cancel>>);

impl PrepareTasks {
    fn insert(&self, task: &str, cancel: &Cancel) {
        if let Ok(mut tasks) = self.0.lock() {
            tasks.insert(task.to_owned(), cancel.clone());
        }
    }

    fn remove(&self, task: &str) {
        if let Ok(mut tasks) = self.0.lock() {
            tasks.remove(task);
        }
    }
}

/// A teammate's MR (F-01.3, F-02.3): the repository of `project` (switched to, decision 7; the
/// active one without `project`), the MR from GitLab (404 → F-01.5 copy), preparation with
/// progress on `ch` (F-05), then a Planning session on S-02. `task` is the UI's ID for
/// `session_prepare_cancel`.
#[tauri::command]
pub async fn session_open_mr(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    tasks: State<'_, PrepareTasks>,
    iid: u64,
    project: Option<String>,
    task: String,
    ch: Channel<PrepareProgress>,
) -> AppResult<OpenedSession> {
    let (resolved, settings) = with_store(&store, move |conn| {
        Ok((
            open_mr::resolve_repo(conn, project.as_deref()),
            store::settings::load(conn)?,
        ))
    })
    .await?;
    let (repo, project) = resolved?;
    if !Path::new(&repo.path).is_dir() {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "Pick a repository first.",
        ));
    }
    let (client, _) = connected_client(&gitlab, &store).await?;
    let ctx = OpenMr {
        client: &client,
        store: &store,
        git_program: settings.git.path.as_deref().map(Path::new),
        repo: &repo,
        project: &project,
        iid,
        defaults: SessionDefaults {
            mode: settings.ui.start_in,
            layout: settings.ui.focus_layout,
        },
    };
    let progress = move |p: PrepareProgress| {
        if let Err(error) = ch.send(p) {
            tracing::debug!(%error, "preparation progress not delivered");
        }
    };
    let cancel = Cancel::new();
    tasks.insert(&task, &cancel);
    let result = open_mr::open_mr(&ctx, &progress, &cancel).await;
    tasks.remove(&task);
    if let Err(OpenMrError::Gitlab(error)) = &result {
        forget_status_on_auth_error(&gitlab, Some(error)).await;
    }
    Ok(result?)
}

/// Cancel on S-02 Preparing (F-05.6): kills the running git and removes a worktree the
/// preparation created.
#[tauri::command]
pub fn session_prepare_cancel(tasks: State<'_, PrepareTasks>, task: String) {
    if let Some(cancel) = tasks.0.lock().ok().and_then(|t| t.get(&task).cloned()) {
        cancel.cancel();
    }
}

/// A teammate's MR session: git in its repository, the stored range and MR fields.
pub(super) struct MrSession {
    pub git: Git,
    pub base: String,
    pub head: String,
    pub mr: MrMeta,
}

/// The MR session `id`; `None` for a session of commits or local changes.
pub(super) async fn mr_session(store: &Store, id: String) -> AppResult<Option<MrSession>> {
    let (source, folders, settings) = with_store(store, move |conn| {
        Ok((
            store::sessions::source_of(conn, &id)?,
            store::sessions::folders(conn, &id)?,
            store::settings::load(conn)?,
        ))
    })
    .await?;
    let (Some(source), Some(folders)) = (source, folders) else {
        return Err(AppError::new(ErrorCode::InvalidInput, "Unknown session."));
    };
    let Some(json) = source.mr_json else {
        return Ok(None);
    };
    let mr = serde_json::from_str::<MrMeta>(&json).map_err(|e| {
        AppError::internal("The session could not be read.").with_detail(e.to_string())
    })?;
    let git = Git::new(
        settings.git.path.as_deref().map(Path::new),
        &folders.checkout,
    );
    Ok(Some(MrSession {
        git,
        base: source.base_sha,
        head: source.head_sha,
        mr,
    }))
}

/// S-02's header and S-06's read-only MR browse (F-06.1, F-24.1): the MR as prepared and the
/// files of `merge-base..head`; `None` when the session isn't a teammate's MR. Starts no
/// GitLab work, so a restored screen can call it.
#[tauri::command]
pub async fn session_mr(
    store: State<'_, Store>,
    session_id: String,
) -> AppResult<Option<SessionMr>> {
    let Some(session) = mr_session(&store, session_id).await? else {
        return Ok(None);
    };
    let summary = mr_summary::session_mr(
        &session.git,
        session.mr,
        &session.base,
        &session.head,
        &Cancel::new(),
    )
    .await?;
    Ok(Some(summary))
}
