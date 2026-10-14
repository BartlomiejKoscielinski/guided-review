//! `review_*` commands of S-03: a step with its files and threads (F-07.2, F-07.3), its notes
//! (F-09.6) with the prefetch of the next step, questions (F-10.1, F-10.2) and decisions on
//! notes (F-09.2, F-09.4). Claude task events stream on `ch`.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};

use super::claude::{ClaudeApp, after_task, executable};
use super::gitlab::{GitlabApp, connected_client};
use super::with_store;
use crate::claude::queue::Priority;
use crate::claude::tasks::ask::AskAnswer;
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::claude::tasks::plan::Context;
use crate::claude::tasks::step;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::gitlab::discussions::{self, Thread};
use crate::os::process::Cancel;
use crate::review::decisions::{self, DecisionOutcome, FindingDecision};
use crate::review::finding_model::StepAnalysis;
use crate::review::position::LineSelection;
use crate::review::progress;
use crate::review::step_context::{self, MrRef, StepContext};
use crate::review::step_runs::{self, StepRuns};
use crate::review::step_view::{self, StepView};
use crate::store::{self, Store};

/// Step runs in flight and the loaded sessions (files, plan, threads, rules).
#[derive(Default)]
pub struct ReviewApp {
    runs: Arc<StepRuns>,
    contexts: Mutex<HashMap<String, Arc<StepContext>>>,
}

impl ReviewApp {
    /// Keeps the session's context for the step tasks (a new plan replaces the old one).
    pub(super) fn remember(&self, cx: Arc<StepContext>) {
        if let Ok(mut contexts) = self.contexts.lock() {
            contexts.insert(cx.session_id.clone(), cx);
        }
    }

    fn remembered(&self, session: &str) -> Option<Arc<StepContext>> {
        self.contexts
            .lock()
            .ok()
            .and_then(|c| c.get(session).cloned())
    }
}

pub(super) fn plan_context<'a>(
    claude: &'a ClaudeApp,
    store: &'a Store,
    exe: &'a crate::claude::discover::ClaudeExecutable,
    settings: &'a crate::settings::ClaudeSettings,
) -> Context<'a> {
    Context {
        exe,
        settings,
        tmp_root: &claude.tmp_root,
        queue: &claude.queue,
        store,
    }
}

/// The MR's threads for the Claude tasks; none when GitLab can't be reached (they are a hint
/// for Claude, not a requirement).
pub(super) async fn mr_threads(gitlab: &GitlabApp, store: &Store, mr: MrRef) -> Vec<Thread> {
    let client = match connected_client(gitlab, store).await {
        Ok((client, _)) => client,
        Err(error) => {
            tracing::info!(error = %error.message, "no threads for the Claude tasks");
            return Vec::new();
        }
    };
    discussions::list(&client, &mr.project, mr.iid)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "threads not loaded for the Claude tasks");
            Vec::new()
        })
}

/// The session's step context, loaded once per session.
pub(super) async fn step_context(
    review: &ReviewApp,
    ctx: &Context<'_>,
    gitlab: &GitlabApp,
    git_program: Option<&Path>,
    session: &str,
) -> AppResult<Arc<StepContext>> {
    if let Some(cx) = review.remembered(session) {
        return Ok(cx);
    }
    let threads = |mr: MrRef| mr_threads(gitlab, ctx.store, mr);
    let cx =
        Arc::new(step_context::load(ctx, git_program, session, threads, &Cancel::new()).await?);
    review.remember(cx.clone());
    Ok(cx)
}

/// The steps in the session's order: its strategy's, or the dragged one (F-06.4, F-06.5).
async fn order(store: &Store, cx: Arc<StepContext>) -> AppResult<Vec<String>> {
    let order = with_store(store, move |c| Ok(cx.step_order(c))).await??;
    Ok(order.order)
}

pub(super) fn sender<T: serde::Serialize + Clone + Send + Sync>(
    ch: Channel<ClaudeTaskEvent<T>>,
) -> impl Fn(ClaudeTaskEvent<T>) + Sync
where
    ClaudeTaskEvent<T>: tauri::ipc::IpcResponse,
{
    move |event| {
        if let Err(error) = ch.send(event) {
            tracing::debug!(%error, "Claude task event not delivered");
        }
    }
}

/// The session's remembered context, else loaded from its cached plan (no Claude run).
async fn loaded(
    review: &ReviewApp,
    claude: &ClaudeApp,
    store: &Store,
    gitlab: &GitlabApp,
    session: &str,
) -> AppResult<Arc<StepContext>> {
    if let Some(cx) = review.remembered(session) {
        return Ok(cx);
    }
    let settings = with_store(store, |c| store::settings::load(c)).await?;
    let exe = executable(store).await?;
    let ctx = plan_context(claude, store, &exe, &settings.claude);
    let git_program = settings.git.path.as_deref().map(Path::new);
    step_context(review, &ctx, gitlab, git_program, session).await
}

fn not_in_plan() -> AppError {
    AppError::new(ErrorCode::InvalidInput, "The step is not in the plan.")
}

/// A step of S-03 (F-07.2, F-07.3): "STEP n OF m" in the reader's order, its files with only its
/// hunks, the threads inside them and the reviewed flag. No Claude call: a session planned in
/// this run (a fallback plan too) needs no Claude Code.
#[tauri::command]
pub async fn review_step(
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    step: String,
) -> AppResult<StepView> {
    let cx = loaded(&review, &claude, &store, &gitlab, &session).await?;
    let order = order(&store, cx.clone()).await?;
    let (session_id, step_id) = (session.clone(), step.clone());
    let reviewed = with_store(&store, move |c| {
        store::steps_state::reviewed(c, &session_id, &step_id)
    })
    .await?;
    Ok(step_view::of(&cx, &order, &step, reviewed)?)
}

/// Opening a step (F-09.6): its notes as `CurrentStep` with events on `ch`, and the next step
/// prefetched in the background. A step already running (its prefetch) is joined, not run twice.
#[tauri::command]
#[allow(clippy::too_many_arguments, reason = "Tauri states and IPC arguments")]
pub async fn review_findings<R: Runtime>(
    app: AppHandle<R>,
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    step: String,
    ch: Channel<ClaudeTaskEvent<StepAnalysis>>,
) -> AppResult<StepAnalysis> {
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let exe = executable(&store).await?;
    let ctx = plan_context(&claude, &store, &exe, &settings.claude);
    let git_program = settings.git.path.as_deref().map(Path::new);
    let cx = step_context(&review, &ctx, &gitlab, git_program, &session).await?;
    let order = order(&store, cx.clone()).await?;
    let schedule = step::schedule(&order, &step);
    if schedule.is_empty() {
        return Err(not_in_plan());
    }
    let subject = cx.subject();
    let dismissed = with_store(&store, move |c| Ok(decisions::dismissed(c, &subject))).await??;

    for (next, _) in schedule.iter().filter(|(_, p)| *p == Priority::Prefetch) {
        prefetch(
            app.clone(),
            review.runs.clone(),
            cx.clone(),
            order.clone(),
            next.clone(),
            dismissed.clone(),
        );
    }

    let req = cx.step_request(&step, &order, &dismissed);
    let emit = sender(ch);
    let result = step_runs::findings(
        &review.runs,
        &ctx,
        &req,
        &session,
        Priority::CurrentStep,
        &Cancel::new(),
        &emit,
    )
    .await;
    if let Err(error) = &result
        && let Some(claude_error) = error.claude()
    {
        after_task(&claude, &store, Err(claude_error)).await;
    } else if result.is_ok() {
        after_task(&claude, &store, Ok(())).await;
    }
    result.map_err(AppError::from)
}

/// The next step's notes in the background (docs/04 › Prefetch), recorded like an opened step.
fn prefetch<R: Runtime>(
    app: AppHandle<R>,
    runs: Arc<StepRuns>,
    cx: Arc<StepContext>,
    order: Vec<String>,
    step: String,
    dismissed: Vec<crate::claude::tasks::step_inputs::Dismissal>,
) {
    tauri::async_runtime::spawn(async move {
        let (Some(claude), Some(store)) = (app.try_state::<ClaudeApp>(), app.try_state::<Store>())
        else {
            return;
        };
        let Ok(settings) = with_store(&store, |c| store::settings::load(c)).await else {
            return;
        };
        let Ok(exe) = executable(&store).await else {
            return;
        };
        let ctx = plan_context(&claude, &store, &exe, &settings.claude);
        let req = cx.step_request(&step, &order, &dismissed);
        let result = step_runs::findings(
            &runs,
            &ctx,
            &req,
            &cx.session_id,
            Priority::Prefetch,
            &Cancel::new(),
            &|_| {},
        )
        .await;
        match &result {
            Ok(_) => after_task(&claude, &store, Ok(())).await,
            Err(error) => {
                tracing::info!(error = %AppError::from(error.clone()).message, "prefetch failed");
                if let Some(claude_error) = error.claude() {
                    after_task(&claude, &store, Err(claude_error)).await;
                }
            }
        }
    });
}

/// A question on a step and, if any, the selected lines (F-10.1): `partialText` deltas on `ch`,
/// then `done` with the whole answer; follow-ups on the same step continue its Claude session
/// (F-10.2).
#[tauri::command]
#[allow(clippy::too_many_arguments, reason = "Tauri states and IPC arguments")]
pub async fn review_ask(
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    step: String,
    question: String,
    selection: Option<LineSelection>,
    ch: Channel<ClaudeTaskEvent<AskAnswer>>,
) -> AppResult<AskAnswer> {
    if question.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "Type a question first.",
        ));
    }
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let exe = executable(&store).await?;
    let ctx = plan_context(&claude, &store, &exe, &settings.claude);
    let git_program = settings.git.path.as_deref().map(Path::new);
    let cx = step_context(&review, &ctx, &gitlab, git_program, &session).await?;
    let order = order(&store, cx.clone()).await?;
    if !order.contains(&step) {
        return Err(not_in_plan());
    }
    let req = cx.ask_request(&step, &order, question.trim(), selection.as_ref());
    let emit = sender(ch);
    let result = step_runs::ask(&ctx, &req, &Cancel::new(), &emit).await;
    after_task(&claude, &store, result.as_ref().map(drop)).await;
    result.map_err(AppError::from)
}

/// A decision on a note (F-09.2, F-09.4); dismissals are kept per MR.
pub(crate) fn decide(
    conn: &mut Connection,
    finding: &str,
    decision: &FindingDecision,
) -> AppResult<DecisionOutcome> {
    let session = decisions::session_of(conn, finding)?;
    let source = store::sessions::source_of(conn, &session)?
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Unknown session."))?;
    let subject = step_context::subject(&source.source_json)?;
    Ok(decisions::decide(conn, finding, decision, &subject)?)
}

/// Add to drafts, Edit and add, Dismiss and Undo on a note card (F-09.2). Local only.
#[tauri::command]
pub async fn review_decide(
    store: State<'_, Store>,
    finding: String,
    decision: FindingDecision,
) -> AppResult<DecisionOutcome> {
    with_store(&store, move |c| Ok(decide(c, &finding, &decision))).await?
}

/// Mark reviewed (Space) and its undo (F-07.2): the step's flag in the session. Returns the plan's
/// reviewed steps for the steps list checks and the progress segments (F-07.1). No Claude call.
#[tauri::command]
pub async fn review_mark_step(
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    step: String,
    reviewed: bool,
) -> AppResult<Vec<String>> {
    let cx = loaded(&review, &claude, &store, &gitlab, &session).await?;
    with_store(&store, move |c| {
        Ok(progress::mark(c, &cx.session_id, &cx.plan, &step, reviewed))
    })
    .await?
    .map_err(Into::into)
}

#[cfg(test)]
#[path = "review_tests.rs"]
mod tests;
