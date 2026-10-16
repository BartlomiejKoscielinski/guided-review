//! The S-04 footer's Claude status (F-08.8, M4 decisions 9 and 10): the session's steps whose
//! analysis is ready (in Claude's cache under the current settings), running now or failed, in
//! the reader's order, and which code Claude reads. Reads caches only: it never starts `claude`.

use serde::Serialize;
use ts_rs::TS;

use super::step_context::StepContext;
use super::step_runs::StepRuns;
use crate::claude::tasks::plan::Context;
use crate::claude::tasks::plan_inputs::PlanSource;
use crate::claude::tasks::step;
use crate::claude::tasks::step_inputs::Dismissal;
use crate::error::AppError;

/// The code Claude reads in a session (M4 decision 10).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum CodeAt {
    /// An MR's review worktree at its head ("worktree @ a3f9c12").
    Worktree { sha: String },
    /// A self-review of commits: the user's repository at the session's head, no worktree.
    Repository { sha: String },
    /// Local changes: whatever is in the working tree, at no commit.
    WorkingTree,
}

/// The steps by the state of their analysis, each in the reader's order, and the code Claude
/// reads. A step is in at most one list: running wins over ready, ready over failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalysisStatus {
    /// Analyzed under the current settings: opening the step shows its notes at once.
    pub ready: Vec<String>,
    /// `claude` is analyzing the step now (the opened step or its prefetch).
    pub running: Vec<String>,
    /// The step's last run failed and no run of it succeeded since.
    pub failed: Vec<String>,
    pub code_at: CodeAt,
}

/// Which code Claude reads for a session of `source` whose head is `head_sha`.
pub fn code_at(source: &PlanSource, head_sha: &str) -> CodeAt {
    match source {
        PlanSource::Mr { .. } => CodeAt::Worktree {
            sha: head_sha.to_owned(),
        },
        PlanSource::Commits { .. } => CodeAt::Repository {
            sha: head_sha.to_owned(),
        },
        PlanSource::Local { .. } => CodeAt::WorkingTree,
    }
}

/// The status of the steps of `order` in the session of `cx` (its runs in `runs`, its notes
/// dismissed as `dismissed`, which the cached analysis is checked against).
pub fn status(
    ctx: &Context<'_>,
    runs: &StepRuns,
    cx: &StepContext,
    order: &[String],
    dismissed: &[Dismissal],
) -> Result<AnalysisStatus, AppError> {
    let mut status = AnalysisStatus {
        ready: Vec::new(),
        running: Vec::new(),
        failed: Vec::new(),
        code_at: code_at(&cx.source, &cx.head_sha),
    };
    for step_id in order {
        if runs.is_running(&cx.session_id, step_id) {
            status.running.push(step_id.clone());
        } else if step::cached_analysis(ctx, &cx.step_request(step_id, order, dismissed))?.is_some()
        {
            status.ready.push(step_id.clone());
        } else if runs.has_failed(&cx.session_id, step_id) {
            status.failed.push(step_id.clone());
        }
    }
    Ok(status)
}
