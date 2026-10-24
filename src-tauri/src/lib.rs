//! Guided Review core. All logic lives in the modules below and is testable without Tauri;
//! `commands/` holds the thin `#[tauri::command]` adapters (docs/04-architecture.md).

pub mod claude;
pub mod commands;
pub mod error;
pub mod fix;
pub mod git;
pub mod gitlab;
pub mod logging;
pub mod nav;
pub mod os;
pub mod review;
pub mod reviewers;
pub mod route;
pub mod settings;
pub mod source;
pub mod store;

use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_window_state::{StateFlags, WindowExt};

use os::window::{MonitorArea, Rect, fit_window};

/// Geometry the window-state plugin keeps between runs (F-30.4); its file lives in
/// `%APPDATA%\com.inpost.guidedreview\` (ADR-020).
fn window_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

/// Restores the main window's size and position, fits it onto a monitor, restores the
/// maximized state, then shows it. The window is created hidden, so none of this flickers,
/// and it is shown even when placement fails.
fn show_main_window(window: &WebviewWindow) {
    if let Err(error) = place_main_window(window) {
        tracing::warn!(%error, "window placement failed; showing the window where it is");
    }
    if let Err(error) = window.show().and_then(|()| window.set_focus()) {
        tracing::error!(%error, "the main window could not be shown");
    }
}

fn place_main_window(window: &WebviewWindow) -> tauri::Result<()> {
    // tao sizes an undecorated window by its window-minus-client offset, which on the hidden,
    // never-shown window still includes the 30px caption: every restore grew the window by
    // that much. Toggling decorations makes Windows recompute the frame first (tao 0.37.1).
    window.set_decorations(true)?;
    window.set_decorations(false)?;
    window.restore_state(StateFlags::SIZE | StateFlags::POSITION)?;
    // Place the client area: an undecorated window is all client area, while its outer rect
    // also has invisible resize borders (8px on Windows 11) that may lie off the work area.
    let outer = window.outer_position()?;
    let inner = window.inner_position()?;
    let size = window.inner_size()?;
    let current = Rect::new(inner.x, inner.y, size.width, size.height);
    let monitors = window.available_monitors()?;
    let areas: Vec<MonitorArea> = monitors
        .iter()
        .map(|m| {
            let work = m.work_area();
            MonitorArea {
                work: Rect::new(
                    work.position.x,
                    work.position.y,
                    work.size.width,
                    work.size.height,
                ),
                scale: m.scale_factor(),
            }
        })
        .collect();
    let primary = window
        .primary_monitor()?
        .and_then(|p| {
            monitors
                .iter()
                .position(|m| m.position() == p.position() && m.size() == p.size())
        })
        .unwrap_or(0);
    if let Some(placement) = fit_window(current, &areas, primary) {
        let (min_width, min_height) = placement.min_size_logical();
        // The config already sets 1280×800; only a smaller work area needs a lower minimum.
        if (min_width, min_height) != os::window::MIN_SIZE {
            window.set_min_size(Some(LogicalSize::new(min_width, min_height)))?;
        }
        if placement.rect != current {
            let rect = placement.rect;
            window.set_size(PhysicalSize::new(rect.width, rect.height))?;
            window.set_position(PhysicalPosition::new(
                rect.x - (inner.x - outer.x),
                rect.y - (inner.y - outer.y),
            ))?;
        }
    }
    window.restore_state(StateFlags::MAXIMIZED)?;
    Ok(())
}

/// Installs the local logger (NFR-08) before anything else runs. Without an app data folder or
/// a writable log folder the app still starts; debug builds then log to stderr only.
fn start_logging() {
    match os::paths::app_data_dir() {
        Ok(app_data) => {
            if let Err(error) = logging::init(&app_data) {
                tracing::warn!(%error, "logging to a file is off");
            }
        }
        Err(error) => eprintln!("Guided Review: {error}; logging is off"),
    }
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "Guided Review starting"
    );
}

/// Opens the database. A failure is logged with its path before setup fails and the app exits
/// (error states for this come in M11).
fn open_store() -> Result<store::Store, Box<dyn std::error::Error>> {
    let app_data = os::paths::app_data_dir()?;
    let db = os::paths::db_path(&app_data);
    let store = store::Store::open(&db).map_err(|error| {
        tracing::error!(%error, path = %db.display(), "the database could not be opened");
        Box::new(error) as Box<dyn std::error::Error>
    })?;
    // The app starts with the default repository (F-30.7 switches it for this run only).
    if let Err(error) = store.with_conn(|conn| store::repos::reset_active(conn)) {
        tracing::warn!(%error, "the switched repository could not be reset");
    }
    Ok(store)
}

/// Builds and runs the Tauri app.
#[allow(
    clippy::expect_used,
    reason = "app startup: without its Tauri context the app cannot run"
)]
pub fn run() {
    start_logging();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .skip_initial_state("main")
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                show_main_window(&window);
            }
            let store = open_store()?;
            let app_data = os::paths::app_data_dir()?;
            // Before the tmp folder sweep, so git removes its own worktrees (F-25.4).
            commands::fix::sweep_scratches(&store);
            commands::claude::manage(app.handle(), &app_data, &store);
            app.manage(store);
            commands::repo::manage(app.handle());
            app.manage(commands::gitlab::GitlabApp::default());
            app.manage(commands::sessions::PrepareTasks::default());
            app.manage(commands::review::ReviewApp::default());
            app.manage(fix::proposals::Proposals::default());
            app.manage(commands::job_trace::JobTraces::default());
            app.manage(commands::fix_watch::FixWatches::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_health,
            commands::app::app_settings_get,
            commands::app::app_settings_set,
            commands::app::app_start_route,
            commands::sessions::sessions_list_unfinished,
            commands::repo::repo_active,
            commands::repo::repo_pick,
            commands::repo::repo_list,
            commands::repo::repo_switch,
            commands::repo::repo_set_default,
            commands::repo::repo_remove,
            commands::source::source_detect,
            commands::sessions::session_open_commit,
            commands::sessions::session_open_local,
            commands::sessions::session_open_branch,
            commands::sessions::session_open_repo,
            commands::sessions::session_open_mr,
            commands::sessions::session_prepare_cancel,
            commands::sessions::session_mr,
            commands::sessions::session_source,
            commands::sessions::session_status,
            commands::session_state::session_state,
            commands::session_state::session_set_step,
            commands::session_state::session_set_layout,
            commands::session_state::session_set_mode,
            commands::session_state::session_mark_plan_opened,
            commands::session_state::session_set_scroll,
            commands::session_state::session_set_checklist,
            commands::session_state::session_resume,
            commands::git::git_status,
            commands::git::git_log,
            commands::git::git_status_summary,
            commands::git::git_branch_info,
            commands::git::git_commit_info,
            commands::git::git_file_diff,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_last_message,
            commands::git::git_push,
            commands::os::rider_open,
            commands::os::os_open_gitlab_url,
            commands::os::rider_status,
            commands::os::rider_pick_executable,
            commands::claude::claude_status,
            commands::claude::claude_activity,
            commands::claude::claude_refresh,
            commands::claude::claude_sign_in,
            commands::claude::claude_pick_executable,
            commands::claude::claude_models,
            commands::claude::claude_commit_message,
            commands::claude::claude_cancel,
            commands::fix::fix_propose,
            commands::fix::fix_accept,
            commands::fix_watch::fix_watch,
            commands::fix_watch::fix_watch_stop,
            commands::fix::fix_discard,
            commands::summary::claude_summary_comment,
            commands::summary::session_summary,
            commands::summary::session_set_summary,
            commands::thread_check::claude_thread_check,
            commands::job_explain::job_explain,
            commands::gitlab::gitlab_status,
            commands::gitlab::gitlab_account_save,
            commands::gitlab::gitlab_account_remove,
            commands::gitlab::gitlab_list_mrs,
            commands::gitlab_threads::gitlab_discussions,
            commands::author::author_mr,
            commands::author::author_file_diff,
            commands::author::author_fixup_target,
            commands::author::author_uncommitted_files,
            commands::author::author_queue_reply,
            commands::author::author_push_and_reply,
            commands::author::author_push_pipeline,
            commands::author_reply::author_reply,
            commands::author_reply::claude_reply_draft,
            commands::create_mr::git_mr_title,
            commands::create_mr::claude_mr_description,
            commands::reviewers::reviewers_suggest,
            commands::reviewers::gitlab_users_search,
            commands::gitlab_threads::gitlab_approval_state,
            commands::approval::summary_status,
            commands::approval::gitlab_approve,
            commands::approval::gitlab_unapprove,
            commands::gitlab_threads::gitlab_resolve,
            commands::gitlab_threads::gitlab_reply,
            commands::pipeline::pipeline_list,
            commands::pipeline::pipeline_get,
            commands::pipeline::pipeline_jobs,
            commands::pipeline::job_retry,
            commands::pipeline::job_cancel,
            commands::pipeline::job_artifacts,
            commands::pipeline::job_details,
            commands::pipeline::job_play,
            commands::pipeline::job_variables_get,
            commands::pipeline::pipeline_mr_head,
            commands::pipeline::pipeline_run_mr,
            commands::pipeline::pipeline_retry,
            commands::pipeline::pipeline_cancel,
            commands::job_trace::job_trace,
            commands::job_trace::job_trace_stop,
            commands::review_plan::review_plan,
            commands::review_plan::review_set_strategy,
            commands::review_plan::review_reorder_steps,
            commands::review::review_step,
            commands::review::review_findings,
            commands::review::review_ask,
            commands::review::review_decide,
            commands::review::review_mark_step,
            commands::review::review_mark_file,
            commands::review_status::review_analysis_status,
            commands::drafts::drafts_list,
            commands::drafts::drafts_create,
            commands::drafts::drafts_create_for_mr,
            commands::drafts::drafts_update,
            commands::drafts::drafts_delete,
            commands::publish::drafts_publish,
            commands::publish::gitlab_foreign_drafts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Guided Review");
}
