//! `review_*` commands of S-02: the plan (F-06.2, F-06.12) with its task events on `ch`, the
//! strategy toggle (F-06.4, no Claude call) and the dragged order (F-06.5).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::State;
use tauri::ipc::Channel;

use super::claude::{ClaudeApp, after_task, executable};
use super::gitlab::GitlabApp;
use super::review::{ReviewApp, mr_threads, plan_context, sender, step_context};
use super::with_store;
use crate::claude::ClaudeError;
use crate::claude::discover::{DiscoveryInput, discover};
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::error::AppResult;
use crate::os::process::Cancel;
use crate::review::model::Strategy;
use crate::review::plan_runs::{self, PlanView};
use crate::review::progress;
use crate::review::step_context::{self as context, MrRef, StepContext};
use crate::review::step_order::StepOrder;
use crate::store::{self, Store};

/// Opening S-02: the cached plan (`queued` → `done`, no `claude`) or a new plan (`queued`,
/// `started`, `done` | `failed`). The plan is kept for the S-03 step tasks.
#[tauri::command]
pub async fn review_plan(
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    ch: Channel<ClaudeTaskEvent<PlanView>>,
) -> AppResult<PlanView> {
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let git_program = settings.git.path.as_deref().map(Path::new);
    let threads = |mr: MrRef| mr_threads(&gitlab, &store, mr);
    let cancel = Cancel::new();
    let inputs = context::load_inputs(&store, git_program, &session, threads, &cancel).await?;
    let emit = sender(ch);
    let configured = settings.claude.path.clone().map(PathBuf::from);
    let planned = match discover(&DiscoveryInput::from_env(configured)) {
        None => plan_runs::unavailable(&inputs, ClaudeError::NotFound, &emit),
        Some(exe) => {
            let ctx = plan_context(&claude, &store, &exe, &settings.claude);
            match plan_runs::plan(&ctx, &inputs, &cancel, &emit).await {
                Ok(planned) => planned,
                Err(error) => {
                    if let Some(claude_error) = error.claude() {
                        after_task(&claude, &store, Err(claude_error)).await;
                    }
                    return Err(error.into());
                }
            }
        }
    };
    let plan = planned.view.plan.clone();
    let mut view = planned.view;
    view.reviewed = {
        let (session, plan) = (session.clone(), plan.clone());
        with_store(&store, move |c| {
            progress::reviewed_steps(c, &session, &plan)
        })
        .await?
    };
    let cx = match &planned.claude_error {
        None => StepContext::new(inputs, plan),
        Some(_) => StepContext::fallback(inputs, plan),
    };
    review.remember(Arc::new(cx));
    after_task(
        &claude,
        &store,
        planned.claude_error.as_ref().map_or(Ok(()), Err),
    )
    .await;
    Ok(view)
}

/// Contract to UI, Tests first or File order (F-06.4): stored, the dragged order cleared.
/// Refused on the fallback plan (File order only).
#[tauri::command]
pub async fn review_set_strategy(
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    strategy: Strategy,
) -> AppResult<StepOrder> {
    let cx = planned(&review, &claude, &store, &gitlab, &session).await?;
    with_store(&store, move |c| Ok(cx.set_strategy(c, strategy)))
        .await?
        .map_err(Into::into)
}

/// A dragged order (F-06.5): every step of the plan exactly once; saved in the session.
/// Refused on the fallback plan.
#[tauri::command]
pub async fn review_reorder_steps(
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    order: Vec<String>,
) -> AppResult<StepOrder> {
    let cx = planned(&review, &claude, &store, &gitlab, &session).await?;
    with_store(&store, move |c| Ok(cx.reorder(c, &order)))
        .await?
        .map_err(Into::into)
}

/// The session with its plan; "The plan isn't ready yet." before `review_plan` succeeded.
async fn planned(
    review: &ReviewApp,
    claude: &ClaudeApp,
    store: &Store,
    gitlab: &GitlabApp,
    session: &str,
) -> AppResult<Arc<StepContext>> {
    let settings = with_store(store, |c| store::settings::load(c)).await?;
    let exe = executable(store).await?;
    let ctx = plan_context(claude, store, &exe, &settings.claude);
    let git_program = settings.git.path.as_deref().map(Path::new);
    step_context(review, &ctx, gitlab, git_program, session).await
}
