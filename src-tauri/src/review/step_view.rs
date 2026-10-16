//! What S-03 shows of one step (F-07.2, F-07.3): its place in the reader's order, its files
//! with only the step's hunks, the MR's threads on lines of those hunks and on its file headers
//! (F-06.9, F-11.3) and the reviewed flag. No Claude call; a fallback plan works the same.

use serde::Serialize;
use ts_rs::TS;

use super::coverage;
use super::file_place::{self, PlacedFile};
use super::plan_model::{Plan, Step};
use super::step_context::StepContext;
use super::strategy::gitlab_path_cmp;
use super::thread_place;
use crate::error::{AppError, ErrorCode};
use crate::git::model::{FileDiff, Hunk, LineKind};
use crate::gitlab::discussions::Thread;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StepView {
    pub step: Step,
    /// 1-based position in the reader's order: "STEP 4 OF 8".
    pub number: u32,
    pub total: u32,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prev: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    /// The step's files in GitLab file order with only the step's hunks; `additions` and
    /// `deletions` count those hunks. Mechanical hunks stay, flagged, for the fold rows (F-07.4).
    pub files: Vec<FileDiff>,
    /// Diff threads whose line (the placed line of an outdated one) falls inside one of the
    /// step's hunks.
    pub threads: Vec<Thread>,
    /// Diff threads shown on a file header of this step: no step shows their line, and this is
    /// the first step in the reader's order with their file (F-11.3, M5 decision 4).
    pub file_threads: Vec<Thread>,
    pub reviewed: bool,
    /// The plan is the app's file-order fallback (Claude failed).
    pub fallback: bool,
    /// Every file of the diff with its place for this step in the reader's order (F-08.7
    /// Analysis context, M4 decision 8); a file Claude read that isn't here is outside the change.
    pub places: Vec<PlacedFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StepViewError {
    #[error("the step is not in the plan")]
    NotInPlan,
}

impl From<StepViewError> for AppError {
    fn from(error: StepViewError) -> Self {
        match error {
            StepViewError::NotInPlan => {
                AppError::new(ErrorCode::InvalidInput, "The step is not in the plan.")
            }
        }
    }
}

/// The step `step_id` of the session, numbered in `order` (the reader's order).
pub fn of(
    cx: &StepContext,
    order: &[String],
    step_id: &str,
    reviewed: bool,
) -> Result<StepView, StepViewError> {
    let mut view = build(&cx.plan, &cx.files, &cx.threads, order, step_id, reviewed)?;
    view.fallback = cx.fallback;
    Ok(view)
}

/// See [`of`]; `fallback` is false.
pub fn build(
    plan: &Plan,
    files: &[FileDiff],
    threads: &[Thread],
    order: &[String],
    step_id: &str,
    reviewed: bool,
) -> Result<StepView, StepViewError> {
    let index = order
        .iter()
        .position(|id| id == step_id)
        .ok_or(StepViewError::NotInPlan)?;
    let step = plan
        .steps
        .iter()
        .find(|s| s.id == step_id)
        .ok_or(StepViewError::NotInPlan)?;

    let mut step_files: Vec<FileDiff> = files.iter().filter_map(|f| step_file(f, step)).collect();
    step_files.sort_by(|a, b| gitlab_path_cmp(path(a), path(b)));
    let file_threads = thread_place::on_headers(plan, files, threads, order, step_id);
    let threads = threads
        .iter()
        .filter(|t| step_files.iter().any(|f| thread_place::on_line(f, t)))
        .cloned()
        .collect();

    Ok(StepView {
        step: step.clone(),
        number: u32::try_from(index + 1).unwrap_or(u32::MAX),
        total: u32::try_from(order.len()).unwrap_or(u32::MAX),
        prev: index.checked_sub(1).and_then(|i| order.get(i)).cloned(),
        next: order.get(index + 1).cloned(),
        files: step_files,
        threads,
        file_threads,
        reviewed,
        fallback: false,
        places: file_place::places(plan, &coverage::hunk_refs(files), order, step_id),
    })
}

/// `file` with only the step's hunks; `None` when the step has none of them.
fn step_file(file: &FileDiff, step: &Step) -> Option<FileDiff> {
    let hunks: Vec<Hunk> = file
        .hunks
        .iter()
        .filter(|h| step.hunk_ids.contains(&h.id))
        .cloned()
        .collect();
    if hunks.is_empty() {
        return None;
    }
    if hunks.len() == file.hunks.len() {
        return Some(file.clone());
    }
    let count = |kind: LineKind| {
        let lines = hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| l.kind == kind);
        u32::try_from(lines.count()).unwrap_or(u32::MAX)
    };
    Some(FileDiff {
        additions: count(LineKind::Add),
        deletions: count(LineKind::Del),
        hunks,
        ..file.clone()
    })
}

fn path(file: &FileDiff) -> &str {
    file.new_path
        .as_deref()
        .or(file.old_path.as_deref())
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "step_view_tests.rs"]
mod tests;
