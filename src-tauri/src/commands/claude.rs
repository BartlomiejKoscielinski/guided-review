//! `claude_*` commands (F-16.4, F-18): status and startup checks, Sign in, the executable,
//! the model table, the commit message task and cancellation.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

use super::repo::active_git;
use super::with_store;
use crate::claude::ClaudeError;
use crate::claude::commit_message::{self, Context};
use crate::claude::discover::{ClaudeExecutable, DiscoveryInput, discover};
use crate::claude::exec;
use crate::claude::models::{self, ModelInfo};
use crate::claude::queue::{ClaudeActivity, Queue};
use crate::claude::runner;
use crate::claude::status::{self, CheckInput, ClaudeStatus, StatusCell};
use crate::claude::task_dir;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::os::process::{Cancel, ProcessSpec, spawn_console};
use crate::store::{self, Store, app_state};

/// Set when a task failed with `CLAUDE_NOT_SIGNED_IN`: the next check probes again.
const REPROBE: &str = "claude.reprobe";

/// Claude state shared by the commands.
pub struct ClaudeApp {
    pub status: StatusCell,
    pub queue: Queue,
    tasks: Mutex<HashMap<String, Cancel>>,
    checking: tokio::sync::Mutex<()>,
    pub(super) tmp_root: PathBuf,
}

impl ClaudeApp {
    pub fn new(app_data: &Path, max_concurrent: u8) -> Self {
        let tmp_root = task_dir::tmp_root(app_data);
        task_dir::sweep(&tmp_root);
        Self {
            status: StatusCell::default(),
            queue: Queue::new(max_concurrent),
            tasks: Mutex::new(HashMap::new()),
            checking: tokio::sync::Mutex::new(()),
            tmp_root,
        }
    }
}

/// Registers the state and starts the startup check in the background.
pub fn manage<R: Runtime>(app: &AppHandle<R>, app_data: &Path, store: &Store) {
    let max = store
        .with_conn(|c| store::settings::load(c))
        .map(|s| s.claude.max_concurrent)
        .unwrap_or(2);
    app.manage(ClaudeApp::new(app_data, max));
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let (Some(claude), Some(store)) =
            (handle.try_state::<ClaudeApp>(), handle.try_state::<Store>())
        else {
            return;
        };
        if let Err(error) = run_check(&claude, &store).await {
            tracing::warn!(%error, "Claude Code startup check failed");
        }
    });
}

async fn run_check(claude: &ClaudeApp, store: &Store) -> AppResult<ClaudeStatus> {
    let _one = claude.checking.lock().await;
    let (settings, probed, reprobe) = with_store(store, |c| {
        Ok((
            store::settings::load(c)?,
            app_state::get(c, app_state::CLAUDE_PROBED_VERSION)?,
            app_state::get(c, REPROBE)?.is_some(),
        ))
    })
    .await?;
    std::fs::create_dir_all(&claude.tmp_root).map_err(|e| {
        AppError::internal("The app's temp folder could not be created.").with_detail(e.to_string())
    })?;
    let input = CheckInput {
        configured: settings.claude.path.map(PathBuf::from),
        probed_version: probed,
        reprobe,
        cwd: claude.tmp_root.clone(),
    };
    let outcome = status::check(&input, &Cancel::new()).await;
    if let Some(version) = outcome.probed.clone() {
        with_store(store, move |c| {
            app_state::set(c, app_state::CLAUDE_PROBED_VERSION, &version)?;
            app_state::remove(c, REPROBE)
        })
        .await?;
    }
    claude.status.set(outcome.status.clone());
    Ok(outcome.status)
}

/// The current status (F-18.1, F-01.6).
#[tauri::command]
pub fn claude_status(claude: State<'_, ClaudeApp>) -> ClaudeStatus {
    claude.status.get()
}

/// Claude tasks running and waiting (F-18.8); reads the queue only, no discovery.
#[tauri::command]
pub fn claude_activity(claude: State<'_, ClaudeApp>) -> ClaudeActivity {
    claude.queue.activity().into()
}

/// Runs the checks again (after Sign in, Change, or on request).
#[tauri::command]
pub async fn claude_refresh(
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
) -> AppResult<ClaudeStatus> {
    run_check(&claude, &store).await
}

pub(super) async fn executable(store: &Store) -> AppResult<ClaudeExecutable> {
    let settings = with_store(store, |c| store::settings::load(c)).await?;
    discover(&DiscoveryInput::from_env(
        settings.claude.path.map(PathBuf::from),
    ))
    .ok_or_else(|| ClaudeError::NotFound.into())
}

/// Sign in to Claude Code: `claude auth login` in its own console window (docs/05 › Startup
/// checks); the UI runs `claude_refresh` when the app window gets focus again.
#[tauri::command]
pub async fn claude_sign_in(
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
) -> AppResult<()> {
    let exe = executable(&store).await?;
    let spec = runner::process_spec(
        &exe,
        runner::auth_login_args(),
        &claude.tmp_root,
        None,
        std::time::Duration::ZERO,
    );
    let spec = ProcessSpec {
        timeout: None,
        stdin: None,
        ..spec
    };
    std::fs::create_dir_all(&claude.tmp_root).ok();
    spawn_console(&spec).map_err(|e| {
        AppError::new(ErrorCode::ClaudeFailed, "Claude Code could not be started.")
            .with_detail(e.to_string())
    })?;
    Ok(())
}

/// Change (F-18.6): picks `claude.exe` (or an npm `cli.js`), checks its version, saves it as
/// `claude.path` and runs the checks. `None` when the dialog was closed.
#[tauri::command]
pub async fn claude_pick_executable<R: Runtime>(
    app: AppHandle<R>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
) -> AppResult<Option<ClaudeStatus>> {
    let dialog = app
        .dialog()
        .file()
        .set_title("Claude Code executable")
        .add_filter("Claude Code", &["exe", "js", "cmd"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| AppError::internal("The file dialog failed.").with_detail(e.to_string()))?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let exe = discover(&DiscoveryInput::from_env(Some(path.clone())))
        .filter(|e| e.display_path() == path || path.extension().is_some_and(|x| x == "cmd"))
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::InvalidInput,
                "That file isn't a Claude Code executable.",
            )
        })?;
    std::fs::create_dir_all(&claude.tmp_root).ok();
    exec::version(&exe, &claude.tmp_root, &Cancel::new())
        .await
        .map_err(AppError::from)?;
    let value = path.to_string_lossy().into_owned();
    with_store(&store, move |c| {
        store::settings::update(c, &serde_json::json!({ "claude": { "path": value } })).map(drop)
    })
    .await?;
    run_check(&claude, &store).await.map(Some)
}

/// Models and their effort levels (F-18.2, F-18.4).
#[tauri::command]
pub fn claude_models() -> Vec<ModelInfo> {
    models::models()
}

/// Suggest (F-16.4): a commit message for the staged changes of the active repository.
/// `task` is the UI's ID for `claude_cancel`.
#[tauri::command]
pub async fn claude_commit_message(
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    task: String,
) -> AppResult<String> {
    let git = active_git(&store).await?;
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let exe = executable(&store).await?;
    let cancel = Cancel::new();
    if let Ok(mut tasks) = claude.tasks.lock() {
        tasks.insert(task.clone(), cancel.clone());
    }
    let ctx = Context {
        exe: &exe,
        settings: &settings.claude,
        git: &git,
        tmp_root: &claude.tmp_root,
        queue: &claude.queue,
    };
    let result = commit_message::run(&ctx, &cancel).await;
    if let Ok(mut tasks) = claude.tasks.lock() {
        tasks.remove(&task);
    }
    after_task(&claude, &store, result.as_ref().map(drop)).await;
    result.map_err(AppError::from)
}

/// Updates the status and the queue after a task (F-18.1, F-18.7).
pub(super) async fn after_task(
    claude: &ClaudeApp,
    store: &Store,
    result: Result<(), &ClaudeError>,
) {
    claude.status.task_result(result);
    match result {
        Ok(()) => claude.queue.resume(),
        Err(ClaudeError::Limited { .. }) => claude.queue.pause(),
        Err(ClaudeError::NotSignedIn { .. }) => {
            let flagged = with_store(store, |c| app_state::set(c, REPROBE, "1")).await;
            if let Err(error) = flagged {
                tracing::warn!(error = %error.message, "re-probe flag not stored");
            }
        }
        Err(_) => {}
    }
}

/// Cancels a running or waiting task (NFR-02).
#[tauri::command]
pub fn claude_cancel(claude: State<'_, ClaudeApp>, task: String) {
    if let Some(cancel) = claude.tasks.lock().ok().and_then(|t| t.get(&task).cloned()) {
        cancel.cancel();
    }
}

/// Applies "Run at most N Claude tasks at once" after a settings change (F-18.6).
pub fn apply_settings(claude: &ClaudeApp, max_concurrent: u8) {
    claude.queue.set_max(max_concurrent);
}
