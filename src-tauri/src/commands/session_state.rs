//! `session_state` and `session_set_*`: what S-03 keeps of a session between app starts (F-04.3),
//! written on change; `session_resume`: S-03 restored on start from stored data only. None of
//! them runs Claude or calls GitLab (F-30.4).

use std::path::Path;

use tauri::State;

use super::claude::{ClaudeApp, executable};
use super::review::plan_context;
use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::os::process::Cancel;
use crate::review::model::{Layout, Mode};
use crate::review::resume::{self, ResumedSession};
use crate::review::session_state::{self, SessionState};
use crate::store::{self, Store, sessions, steps_state};

fn unknown() -> AppError {
    AppError::new(ErrorCode::InvalidInput, "Unknown session.")
}

fn found(found: bool) -> AppResult<()> {
    if found { Ok(()) } else { Err(unknown()) }
}

/// The session's current step, layout, scroll positions and checklist ticks (database only).
#[tauri::command]
pub async fn session_state(store: State<'_, Store>, session: String) -> AppResult<SessionState> {
    with_store(&store, move |c| session_state::load(c, &session))
        .await?
        .ok_or_else(unknown)
}

/// The step S-03 is on.
#[tauri::command]
pub async fn session_set_step(
    store: State<'_, Store>,
    session: String,
    step: String,
) -> AppResult<()> {
    found(
        with_store(&store, move |c| {
            sessions::set_current_step(c, &session, &step)
        })
        .await?,
    )
}

/// The layout chosen for the session (F-07.1).
#[tauri::command]
pub async fn session_set_layout(
    store: State<'_, Store>,
    session: String,
    layout: Layout,
) -> AppResult<()> {
    found(with_store(&store, move |c| sessions::set_layout(c, &session, layout)).await?)
}

/// The session's mode from the Focus | Detailed toggle or `Ctrl+D` (F-08.1). Settings › General ›
/// Start in stays the mode of new sessions (M4 decision 4).
#[tauri::command]
pub async fn session_set_mode(
    store: State<'_, Store>,
    session: String,
    mode: Mode,
) -> AppResult<()> {
    found(with_store(&store, move |c| sessions::set_mode(c, &session, mode)).await?)
}

/// S-02 showed the session's plan: the S-04 rail's "Change overview" is done (F-08.3).
#[tauri::command]
pub async fn session_mark_plan_opened(store: State<'_, Store>, session: String) -> AppResult<()> {
    found(with_store(&store, move |c| sessions::mark_plan_opened(c, &session)).await?)
}

/// Where the step was scrolled, in pixels (debounced by the UI).
#[tauri::command]
pub async fn session_set_scroll(
    store: State<'_, Store>,
    session: String,
    step: String,
    top: u32,
) -> AppResult<()> {
    found(
        with_store(&store, move |c| {
            let exists = sessions::exists(c, &session)?;
            if exists {
                steps_state::set_scroll(c, &session, &step, top)?;
            }
            Ok(exists)
        })
        .await?,
    )
}

/// The step's ticked "For you to judge" items (F-08.7); an empty list unticks all.
#[tauri::command]
pub async fn session_set_checklist(
    store: State<'_, Store>,
    session: String,
    step: String,
    ticked: Vec<String>,
) -> AppResult<()> {
    found(
        with_store(&store, move |c| {
            let exists = sessions::exists(c, &session)?;
            if exists {
                steps_state::set_checklist(c, &session, &step, &ticked)?;
            }
            Ok(exists)
        })
        .await?,
    )
}

/// S-03 restored on start (F-04.3, F-30.4): the cached plan, the step the session was on without
/// the MR's threads, and its notes when they are cached; `None` when the plan isn't cached.
#[tauri::command]
pub async fn session_resume(
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    session: String,
) -> AppResult<Option<ResumedSession>> {
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let exe = executable(&store).await?;
    let ctx = plan_context(&claude, &store, &exe, &settings.claude);
    let git_program = settings.git.path.as_deref().map(Path::new);
    resume::resume(&ctx, git_program, &session, &Cancel::new()).await
}
