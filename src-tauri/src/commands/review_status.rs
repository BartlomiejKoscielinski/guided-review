//! `review_analysis_status` of S-04's footer (F-08.8): which steps Claude has ready, is
//! analyzing or failed on, and which code it reads.

use std::path::{Path, PathBuf};

use tauri::State;

use super::claude::ClaudeApp;
use super::gitlab::GitlabApp;
use super::review::{ReviewApp, order, plan_context, step_context};
use super::with_store;
use crate::claude::discover::ClaudeExecutable;
use crate::error::AppResult;
use crate::review::analysis_status::{self, AnalysisStatus};
use crate::review::decisions;
use crate::store::{self, Store};

/// The session's steps whose analysis is ready, running now or failed, in the reader's order,
/// and the code Claude reads (M4 decisions 9 and 10). It reads Claude's cache and the runs in
/// flight only: no `claude` run and no Claude Code lookup, so it answers when Claude Code is
/// missing or signed out too (the footer keeps "worktree @ …" then).
#[tauri::command]
pub async fn review_analysis_status(
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
) -> AppResult<AnalysisStatus> {
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    // Never started: the status reads caches only (the cache key holds no executable).
    let exe = ClaudeExecutable::Native(PathBuf::new());
    let ctx = plan_context(&claude, &store, &exe, &settings.claude);
    let git_program = settings.git.path.as_deref().map(Path::new);
    let cx = step_context(&review, &ctx, &gitlab, git_program, &session).await?;
    let order = order(&store, cx.clone()).await?;
    let subject = cx.subject();
    let dismissed = with_store(&store, move |c| Ok(decisions::dismissed(c, &subject))).await??;
    analysis_status::status(&ctx, review.runs(), &cx, &order, &dismissed)
}
