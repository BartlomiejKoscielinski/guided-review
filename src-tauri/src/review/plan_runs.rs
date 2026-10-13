//! The plan of a session with its channel events (`review_plan`, docs/04 › IPC contract):
//! `queued`, `started` unless cached, then `done` with the plan and the session's step order,
//! or `failed` (F-06.2, F-06.12). A cached plan starts no `claude` process.

use serde::Serialize;
use ts_rs::TS;

use super::coverage;
use super::plan_model::Plan;
use super::step_context::SessionInputs;
use super::step_order::{self, StepOrder};
use super::step_runs::RunError;
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::claude::tasks::plan::{self, Context};
use crate::error::AppError;
use crate::os::process::Cancel;

/// S-02's data: the plan, where it came from and the reader's order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlanView {
    pub plan: Plan,
    /// When the cached plan was stored (ISO 8601 UTC): "Plan from cache · <age>"; `None` when
    /// Claude planned just now.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cached_at: Option<String>,
    pub order: StepOrder,
}

/// Plans the session (or reads the cached plan) and emits the task events.
pub async fn plan(
    ctx: &Context<'_>,
    inputs: &SessionInputs,
    cancel: &Cancel,
    emit: &(dyn Fn(ClaudeTaskEvent<PlanView>) + Sync),
) -> Result<PlanView, RunError> {
    emit(ClaudeTaskEvent::Queued);
    let started = || emit(ClaudeTaskEvent::Started);
    let result = match plan::run(ctx, &inputs.plan_request(), &started, cancel).await {
        Ok(outcome) => view(ctx, inputs, outcome.plan, outcome.cached_at).map_err(RunError::App),
        Err(error) => Err(RunError::Claude(error)),
    };
    emit(match &result {
        Ok(view) => ClaudeTaskEvent::Done {
            result: view.clone(),
        },
        Err(error) => ClaudeTaskEvent::Failed {
            error: error.clone().into(),
        },
    });
    result
}

fn view(
    ctx: &Context<'_>,
    inputs: &SessionInputs,
    plan: Plan,
    cached_at: Option<String>,
) -> Result<PlanView, AppError> {
    let hunks = coverage::hunk_refs(&inputs.files);
    let order = ctx
        .store
        .with_conn(|conn| Ok(step_order::load(conn, &inputs.session_id, &plan, &hunks)))??;
    Ok(PlanView {
        plan,
        cached_at,
        order,
    })
}
