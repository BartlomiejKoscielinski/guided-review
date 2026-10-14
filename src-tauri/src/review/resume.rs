//! S-03 restored on start (F-04.3): the step the session was on, read from what is stored - the
//! database, the files of the change through git and Claude's cache. Restoring starts no Claude
//! task and calls no GitLab (F-30.4): the step comes without the MR's threads, which are live
//! GitLab data, and with its notes only when Claude's analysis of it is cached.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::decisions;
use super::finding_model::StepAnalysis;
use super::plan_runs::{self, PlanView};
use super::progress;
use super::step_context::{self, MrRef, StepContext};
use super::step_runs;
use super::step_view::{self, StepView};
use crate::claude::tasks::plan::Context;
use crate::error::AppError;
use crate::gitlab::discussions::Thread;
use crate::os::process::Cancel;
use crate::store::sessions;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ResumedSession {
    /// The cached plan with the session's step order and reviewed steps (S-02's data).
    pub plan: PlanView,
    /// The step S-03 was on, else the first of the order; without the MR's threads.
    pub step: StepView,
    /// The step's notes with their decisions; `None` when Claude's analysis isn't cached.
    pub findings: Option<StepAnalysis>,
}

/// The session as S-03 shows it after a restart; `None` when its plan isn't cached (a fallback
/// plan never is), so there is nothing to show without running Claude.
pub async fn resume(
    ctx: &Context<'_>,
    git_program: Option<&Path>,
    session_id: &str,
    cancel: &Cancel,
) -> Result<Option<ResumedSession>, AppError> {
    let no_threads = |_: MrRef| std::future::ready(Vec::<Thread>::new());
    let inputs =
        step_context::load_inputs(ctx.store, git_program, session_id, no_threads, cancel).await?;
    let Some(mut plan) = plan_runs::cached_view(ctx, &inputs)? else {
        return Ok(None);
    };
    let cx = StepContext::new(inputs, plan.plan.clone());
    let store = ctx.store;
    plan.reviewed = store.with_conn(|c| progress::reviewed_steps(c, session_id, &cx.plan))?;
    let order = plan.order.order.clone();
    let stored = store.with_conn(|c| sessions::current_step(c, session_id))?;
    let Some(step_id) = stored
        .filter(|s| order.contains(s))
        .or_else(|| order.first().cloned())
    else {
        return Ok(None);
    };
    let reviewed = plan.reviewed.contains(&step_id);
    let step = step_view::of(&cx, &order, &step_id, reviewed)?;
    let subject = cx.subject();
    let dismissed = store.with_conn(|c| Ok(decisions::dismissed(c, &subject)))??;
    let req = cx.step_request(&step_id, &order, &dismissed);
    let findings = step_runs::cached_findings(ctx, &req, session_id).unwrap_or_else(|error| {
        tracing::warn!(error = %AppError::from(error).message, "cached notes not read on resume");
        None
    });
    Ok(Some(ResumedSession {
        plan,
        step,
        findings,
    }))
}
