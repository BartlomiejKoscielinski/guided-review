//! Claude runs of a review step with their channel events (docs/04 › IPC contract). Notes
//! (F-09.6): one run per session and step at a time, so the prefetch of step N+1 and opening
//! N+1 share a `claude` process; the result is recorded with its decisions (F-09.2). Questions
//! (F-10.1, F-10.2): the answer streams as `partialText` and ends with `done`.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::watch;

use super::decisions;
use super::finding_model::StepAnalysis;
use crate::claude::ClaudeError;
use crate::claude::queue::Priority;
use crate::claude::tasks::ask::{self, AskAnswer, AskRequest};
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::claude::tasks::plan::Context;
use crate::claude::tasks::step::{self, StepOutcome, StepRequest};
use crate::error::AppError;
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
        Ok(outcome) => record(ctx, session_id, outcome.analysis).map_err(RunError::App),
        Err(error) => Err(RunError::Claude(error)),
    };
    emit(match &result {
        Ok(analysis) => ClaudeTaskEvent::Done {
            result: analysis.clone(),
        },
        Err(error) => ClaudeTaskEvent::Failed {
            error: error.clone().into(),
        },
    });
    result
}

/// The analysis with each note's stored decision.
fn record(
    ctx: &Context<'_>,
    session_id: &str,
    analysis: StepAnalysis,
) -> Result<StepAnalysis, AppError> {
    let findings = ctx
        .store
        .with_conn(|conn| Ok(decisions::record(conn, session_id, &analysis)))??;
    Ok(StepAnalysis {
        findings,
        ..analysis
    })
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
