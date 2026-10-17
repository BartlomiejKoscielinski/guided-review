//! The summary comment of S-05 (F-12.4, M5 decision 11): `claude_summary_comment` runs the
//! summary task once when "Add a summary comment" is ticked (task events on `ch`);
//! `session_summary` and `session_set_summary` keep the tick, the text and whether Claude wrote it
//! per session. Those two read and write the database only: no Claude, no GitLab (P-008).

use std::path::Path;

use tauri::State;
use tauri::ipc::Channel;

use super::claude::{ClaudeApp, after_task, executable};
use super::gitlab::GitlabApp;
use super::review::{ReviewApp, plan_context, sender, step_context};
use super::with_store;
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::claude::tasks::summary_comment::{self, SummaryComment, SummaryRequest};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::os::process::Cancel;
use crate::review::drafts;
use crate::store::sessions::{self, SummaryField, SummaryState};
use crate::store::{self, Store};

fn unknown() -> AppError {
    AppError::new(ErrorCode::InvalidInput, "Unknown session.")
}

/// Claude's short overall summary of the MR session's review, from its plan, the drafts that go
/// out with it and the MR's open threads: `queued`, `started` (not on a cache hit), then `done`
/// or `failed` on `ch`.
#[tauri::command]
pub async fn claude_summary_comment(
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    ch: Channel<ClaudeTaskEvent<SummaryComment>>,
) -> AppResult<SummaryComment> {
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let exe = executable(&store).await?;
    let ctx = plan_context(&claude, &store, &exe, &settings.claude);
    let git_program = settings.git.path.as_deref().map(Path::new);
    let cx = step_context(&review, &ctx, &gitlab, git_program, &session).await?;
    let id = session.clone();
    let drafts = with_store(&store, move |c| Ok(drafts::list(c, &id))).await??;
    let req = SummaryRequest {
        repo_id: cx.repo_id,
        source: &cx.source,
        base_sha: &cx.base_sha,
        head_sha: &cx.head_sha,
        cwd: &cx.cwd,
        plan: &cx.plan,
        drafts: &drafts,
        threads: &cx.threads,
    };
    let emit = sender(ch);
    emit(ClaudeTaskEvent::Queued);
    let started = || emit(ClaudeTaskEvent::Started);
    let result = summary_comment::run(&ctx, &req, &started, &Cancel::new())
        .await
        .map(|outcome| SummaryComment {
            summary: outcome.summary,
        });
    emit(match &result {
        Ok(comment) => ClaudeTaskEvent::Done {
            result: comment.clone(),
        },
        Err(error) => ClaudeTaskEvent::Failed {
            error: error.clone().into(),
        },
    });
    after_task(&claude, &store, result.as_ref().map(drop)).await;
    result.map_err(AppError::from)
}

/// The session's "Add a summary comment" tick, text and suggested flag, and whether a Publish
/// sent it (database only).
#[tauri::command]
pub async fn session_summary(store: State<'_, Store>, session: String) -> AppResult<SummaryState> {
    with_store(&store, move |c| sessions::summary_state(c, &session))
        .await?
        .ok_or_else(unknown)
}

/// Keeps the session's summary field as the reviewer left it (database only).
#[tauri::command]
pub async fn session_set_summary(
    store: State<'_, Store>,
    session: String,
    summary: SummaryField,
) -> AppResult<()> {
    let found = with_store(&store, move |c| {
        sessions::set_summary(c, &session, &summary)
    })
    .await?;
    if found { Ok(()) } else { Err(unknown()) }
}
