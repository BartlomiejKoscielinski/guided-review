//! Claude runs of a review step with their channel events (docs/04 › IPC contract). Notes
//! (F-09.6): one run per session and step at a time, so the prefetch of step N+1 and opening
//! N+1 share a `claude` process; the result is recorded with its decisions (F-09.2). Questions
//! (F-10.1, F-10.2): the answer streams as `partialText` and ends with `done`.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::watch;

use super::decisions;
use super::finding_model::{Finding, StepAnalysis};
use crate::claude::ClaudeError;
use crate::claude::queue::Priority;
use crate::claude::tasks::ask::{self, AskAnswer, AskRequest};
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::claude::tasks::plan::Context;
use crate::claude::tasks::step::{self, StepOutcome, StepRequest};
use crate::error::{AppError, ErrorCode};
use crate::git::model::FileDiff;
use crate::os::process::Cancel;

#[derive(Debug, Clone)]
enum RunState {
    Waiting,
    Running,
    Finished(Result<StepOutcome, ClaudeError>),
}

enum Role {
    Owner(watch::Sender<RunState>),
    Joiner(watch::Receiver<RunState>),
}

/// Step runs in flight, by session and step.
#[derive(Debug, Default)]
pub struct StepRuns {
    inflight: Mutex<HashMap<String, watch::Receiver<RunState>>>,
}

/// Removes the owner's entry however its run ends (result, error or a dropped future).
struct Entry<'a> {
    runs: &'a StepRuns,
    key: &'a str,
}

impl Drop for Entry<'_> {
    fn drop(&mut self) {
        if let Ok(mut inflight) = self.runs.inflight.lock() {
            inflight.remove(self.key);
        }
    }
}

impl StepRuns {
    fn claim(&self, key: &str) -> Result<Role, ClaudeError> {
        let mut inflight = self
            .inflight
            .lock()
            .map_err(|_| ClaudeError::failed("step runs poisoned"))?;
        if let Some(rx) = inflight.get(key) {
            return Ok(Role::Joiner(rx.clone()));
        }
        let (tx, rx) = watch::channel(RunState::Waiting);
        inflight.insert(key.to_owned(), rx);
        Ok(Role::Owner(tx))
    }

    /// `step::run`, or joining the run of the same `key` already in flight. `on_started` runs
    /// when `claude` starts, for a joiner too.
    pub async fn run(
        &self,
        key: &str,
        ctx: &Context<'_>,
        req: &StepRequest<'_>,
        priority: Priority,
        on_started: &(dyn Fn() + Sync),
        cancel: &Cancel,
    ) -> Result<StepOutcome, ClaudeError> {
        loop {
            match self.claim(key)? {
                Role::Owner(tx) => {
                    let _entry = Entry { runs: self, key };
                    let started = || {
                        tx.send_replace(RunState::Running);
                        on_started();
                    };
                    let result = step::run(ctx, req, priority, &started, cancel).await;
                    tx.send_replace(RunState::Finished(result.clone()));
                    return result;
                }
                Role::Joiner(mut rx) => {
                    let mut told = false;
                    loop {
                        let state = rx.borrow_and_update().clone();
                        match state {
                            RunState::Finished(result) => {
                                // `Running` may have been skipped between two polls.
                                if !told && result.as_ref().is_ok_and(|o| !o.cached) {
                                    on_started();
                                }
                                return result;
                            }
                            RunState::Running if !told => {
                                told = true;
                                on_started();
                            }
                            RunState::Running | RunState::Waiting => {}
                        }
                        // The owner went away without a result: run it here instead.
                        if rx.changed().await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    }
}

/// A run's failure: Claude's own (the status and queue follow it, F-18.1, F-18.7) or the app's.
#[derive(Debug, Clone)]
pub enum RunError {
    Claude(ClaudeError),
    App(AppError),
}

impl RunError {
    pub fn claude(&self) -> Option<&ClaudeError> {
        match self {
            Self::Claude(e) => Some(e),
            Self::App(_) => None,
        }
    }
}

impl From<RunError> for AppError {
    fn from(error: RunError) -> Self {
        match error {
            RunError::Claude(e) => e.into(),
            RunError::App(e) => e,
        }
    }
}

/// The notes of one step (`review_findings`): `queued`, `started` unless cached, then `done`
/// with the notes and their decisions, or `failed`.
pub async fn findings(
    runs: &StepRuns,
    ctx: &Context<'_>,
    req: &StepRequest<'_>,
    session_id: &str,
    priority: Priority,
    cancel: &Cancel,
    emit: &(dyn Fn(ClaudeTaskEvent<StepAnalysis>) + Sync),
) -> Result<StepAnalysis, RunError> {
    emit(ClaudeTaskEvent::Queued);
    let key = format!("{session_id}\u{0}{}", req.step_id);
    let started = || emit(ClaudeTaskEvent::Started);
    let result = match runs.run(&key, ctx, req, priority, &started, cancel).await {
        Ok(outcome) => record(ctx, session_id, req, outcome.analysis).map_err(RunError::App),
        Err(error) => Err(RunError::Claude(error)),
    };
    emit(match &result {
        Ok(analysis) => ClaudeTaskEvent::Done {
            result: analysis.clone(),
        },
        Err(error) => {
            let error: AppError = error.clone().into();
            log_failure(req.step_id, priority, &error);
            ClaudeTaskEvent::Failed { error }
        }
    });
    result
}

/// The longest error detail a failed step logs.
const LOGGED_DETAIL_MAX: usize = 200;

/// Whether an error's detail is the app's own text. Claude Code's own failures carry its stderr
/// or the `result` text of the error (claude/error.rs `map_output`), which stays out of the log
/// (NFR-08); `ClaudeSchema` details are the app's validation messages and never quote Claude.
const fn detail_is_app_text(code: ErrorCode) -> bool {
    !matches!(
        code,
        ErrorCode::ClaudeNotFound
            | ErrorCode::ClaudeNotSignedIn
            | ErrorCode::ClaudeFailed
            | ErrorCode::ClaudeGuardViolation
            | ErrorCode::ClaudeLimited
    )
}

/// A failed step analysis in the log (S-03 "Couldn't analyze this step."): the error code and
/// message, and the detail (cut short) only when it is the app's own text.
fn log_failure(step_id: &str, priority: Priority, error: &AppError) {
    if error.code == ErrorCode::Cancelled {
        return;
    }
    if !detail_is_app_text(error.code) {
        tracing::warn!(
            step = %step_id,
            ?priority,
            code = ?error.code,
            error = %error.message,
            "step analysis failed"
        );
        return;
    }
    let detail: String = error
        .detail
        .as_deref()
        .unwrap_or_default()
        .chars()
        .take(LOGGED_DETAIL_MAX)
        .collect();
    tracing::warn!(
        step = %step_id,
        ?priority,
        code = ?error.code,
        error = %error.message,
        %detail,
        "step analysis failed"
    );
}

/// The notes of one step from Claude's cache with their decisions; `None` when the step was
/// never analyzed under the current settings. Starts no `claude` run and no step task (S-03
/// restored on start, F-04.3, F-30.4).
pub fn cached_findings(
    ctx: &Context<'_>,
    req: &StepRequest<'_>,
    session_id: &str,
) -> Result<Option<StepAnalysis>, RunError> {
    match step::cached_analysis(ctx, req) {
        Ok(Some(analysis)) => record(ctx, session_id, req, analysis)
            .map(Some)
            .map_err(RunError::App),
        Ok(None) => Ok(None),
        Err(error) => Err(RunError::Claude(error)),
    }
}

/// The analysis with each note's stored decision, and the step's notes this session recorded
/// that the task left out back in their place: the task leaves out every note with a dismissed
/// fingerprint (F-09.4), including a note that shares it with a dismissed one but is itself open
/// or a draft, so those come back with their own decisions.
fn record(
    ctx: &Context<'_>,
    session_id: &str,
    req: &StepRequest<'_>,
    analysis: StepAnalysis,
) -> Result<StepAnalysis, AppError> {
    let (findings, left_out) = ctx.store.with_conn(|conn| {
        Ok(
            decisions::record(conn, session_id, &analysis).and_then(|findings| {
                let left_out =
                    decisions::left_out_notes(conn, session_id, &analysis.step_id, req.dismissed)?;
                Ok((findings, left_out))
            }),
        )
    })??;
    Ok(StepAnalysis {
        findings: with_left_out(findings, left_out, req.files),
        ..analysis
    })
}

/// `findings` with the left-out notes they lack, in diff order: the change's file order, then
/// the line (the order the step task's notes come in).
fn with_left_out(
    mut findings: Vec<Finding>,
    left_out: Vec<Finding>,
    files: &[FileDiff],
) -> Vec<Finding> {
    let missing: Vec<Finding> = left_out
        .into_iter()
        .filter(|d| findings.iter().all(|f| f.id != d.id))
        .collect();
    if missing.is_empty() {
        return findings;
    }
    findings.extend(missing);
    let position = |file: &str| {
        files
            .iter()
            .position(|f| {
                [&f.new_path, &f.old_path]
                    .iter()
                    .any(|p| p.as_deref() == Some(file))
            })
            .unwrap_or(usize::MAX)
    };
    findings.sort_by_key(|f| (position(&f.file), f.line));
    findings
}

/// A question (`review_ask`): `queued`, `started`, `partialText` deltas in order, then `done`
/// with the whole answer, or `failed`.
pub async fn ask(
    ctx: &Context<'_>,
    req: &AskRequest<'_>,
    cancel: &Cancel,
    emit: &(dyn Fn(ClaudeTaskEvent<AskAnswer>) + Sync),
) -> Result<AskAnswer, ClaudeError> {
    emit(ClaudeTaskEvent::Queued);
    let started = || emit(ClaudeTaskEvent::Started);
    let mut on_text = |text: &str| {
        emit(ClaudeTaskEvent::PartialText {
            text: text.to_owned(),
        });
    };
    let result = ask::run(ctx, req, &started, &mut on_text, cancel).await;
    emit(match &result {
        Ok(answer) => ClaudeTaskEvent::Done {
            result: answer.clone(),
        },
        Err(error) => ClaudeTaskEvent::Failed {
            error: error.clone().into(),
        },
    });
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::model::FileStatus;
    use crate::review::finding_model::{Decision, Severity, Side};
    use crate::review::layer::layer_of;

    const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
    const QUEUE: &str = "src/Mobile.Core/Upload Queue.cs";

    fn file(path: &str) -> FileDiff {
        FileDiff {
            old_path: Some(path.into()),
            new_path: Some(path.into()),
            status: FileStatus::Modified,
            binary: false,
            mode_change: None,
            additions: 1,
            deletions: 0,
            layer: layer_of(path),
            hunks: Vec::new(),
            line_staging: true,
        }
    }

    fn note(id: &str, file: &str, line: u32, decision: Decision) -> Finding {
        Finding {
            id: id.into(),
            step_id: "s4".into(),
            severity: Severity::Q,
            kind: "unawaited-task".into(),
            title: format!("Note {id}"),
            body: String::new(),
            file: file.into(),
            side: Side::New,
            line,
            evidence: Vec::new(),
            suggested_comment: String::new(),
            fingerprint: id.into(),
            decision,
        }
    }

    fn ids(findings: &[Finding]) -> Vec<&str> {
        findings.iter().map(|f| f.id.as_str()).collect()
    }

    #[test]
    fn f04_3_dismissed_notes_go_back_in_diff_order() {
        let files = [file(QUEUE), file(VM)];
        let shown = vec![
            note("q1", QUEUE, 12, Decision::Open),
            note("v2", VM, 48, Decision::Draft),
        ];
        let dismissed = vec![
            note("v1", VM, 20, Decision::Dismissed),
            note("q2", QUEUE, 30, Decision::Dismissed),
        ];
        let merged = with_left_out(shown, dismissed, &files);
        assert_eq!(ids(&merged), ["q1", "q2", "v1", "v2"]);
        assert_eq!(merged[2].decision, Decision::Dismissed);
    }

    #[test]
    fn f04_3_a_note_already_shown_is_not_added_twice_and_the_order_stays() {
        let files = [file(VM)];
        // Claude's order stays as it is when nothing is missing.
        let shown = vec![
            note("v2", VM, 48, Decision::Open),
            note("v1", VM, 20, Decision::Dismissed),
        ];
        let dismissed = vec![note("v1", VM, 20, Decision::Dismissed)];
        assert_eq!(ids(&with_left_out(shown, dismissed, &files)), ["v2", "v1"]);
    }
}
