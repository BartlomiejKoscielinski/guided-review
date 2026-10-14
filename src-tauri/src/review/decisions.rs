//! Decisions on Claude's notes (F-09.2, F-09.4; table `findings`): **Add to drafts** and **Edit
//! and add** create a local draft (`drafts.rs`), **Dismiss** records the note's fingerprint in
//! `dismissals` so the step task leaves it out from then on; each can be undone. Nothing here
//! talks to GitLab.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::drafts::{self, Draft, DraftError, NewDraft};
use super::finding_model::{Decision, Finding, StepAnalysis};
use super::position::DiffPosition;
use crate::claude::tasks::step_inputs::Dismissal;
use crate::error::{AppError, ErrorCode};
use crate::store::StoreError;

/// What the reviewer did with a note.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum FindingDecision {
    /// A draft from the suggested comment.
    AddToDrafts,
    /// A draft with the text the reviewer edited.
    EditAndAdd {
        body: String,
    },
    Dismiss,
    /// Takes the last decision back: deletes its draft or its dismissal.
    Undo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DecisionOutcome {
    pub finding: Finding,
    /// The draft Add to drafts or Edit and add created.
    pub draft: Option<Draft>,
}

#[derive(Debug, thiserror::Error)]
pub enum DecisionError {
    #[error("note {0} not found")]
    NotFound(String),
    #[error("note {0} already has a decision")]
    AlreadyDecided(String),
    #[error("note {0} has no decision to undo")]
    NothingToUndo(String),
    #[error(transparent)]
    Draft(#[from] DraftError),
    #[error("a stored note could not be read: {0}")]
    Decode(#[from] serde_json::Error),
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<rusqlite::Error> for DecisionError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error.into())
    }
}

impl From<DecisionError> for AppError {
    fn from(error: DecisionError) -> Self {
        match error {
            DecisionError::NotFound(_) => {
                AppError::new(ErrorCode::InvalidInput, "This note no longer exists.")
            }
            DecisionError::AlreadyDecided(_) | DecisionError::NothingToUndo(_) => {
                AppError::new(ErrorCode::Conflict, "This note changed in the meantime.")
            }
            DecisionError::Draft(e) => e.into(),
            DecisionError::Decode(e) => {
                AppError::internal("A note could not be read.").with_detail(e.to_string())
            }
            DecisionError::Store(e) => e.into(),
        }
    }
}

fn decision_text(decision: Decision) -> &'static str {
    match decision {
        Decision::Open => "open",
        Decision::Draft => "draft",
        Decision::Dismissed => "dismissed",
    }
}

fn decision_from(text: &str) -> Decision {
    match text {
        "draft" => Decision::Draft,
        "dismissed" => Decision::Dismissed,
        _ => Decision::Open,
    }
}

/// Stores a step's validated notes for the session and returns them with the decisions made
/// earlier (a note keeps its ID across runs and cache hits, so its decision survives).
pub fn record(
    conn: &mut Connection,
    session_id: &str,
    analysis: &StepAnalysis,
) -> Result<Vec<Finding>, DecisionError> {
    let tx = conn.transaction()?;
    let mut findings = Vec::with_capacity(analysis.findings.len());
    for finding in &analysis.findings {
        let stored = Finding {
            decision: Decision::Open,
            ..finding.clone()
        };
        tx.execute(
            "INSERT INTO findings (id, session_id, step_id, json, kind, decision, fingerprint)
             VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6)
             ON CONFLICT (id) DO UPDATE SET json = excluded.json, kind = excluded.kind,
                 fingerprint = excluded.fingerprint, step_id = excluded.step_id",
            params![
                stored.id,
                session_id,
                stored.step_id,
                serde_json::to_string(&stored)?,
                stored.kind,
                stored.fingerprint,
            ],
        )?;
        let decision: String = tx.query_row(
            "SELECT decision FROM findings WHERE id = ?1",
            [&stored.id],
            |row| row.get(0),
        )?;
        findings.push(Finding {
            decision: decision_from(&decision),
            ..stored
        });
    }
    tx.commit()?;
    Ok(findings)
}

/// A stored note with its decision, and its session.
fn load(conn: &Connection, id: &str) -> Result<(Finding, String), DecisionError> {
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT json, decision, session_id FROM findings WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let (json, decision, session) = row.ok_or_else(|| DecisionError::NotFound(id.to_owned()))?;
    let finding: Finding = serde_json::from_str(&json)?;
    Ok((
        Finding {
            decision: decision_from(&decision),
            ..finding
        },
        session,
    ))
}

fn set_decision(conn: &Connection, id: &str, decision: Decision) -> Result<(), DecisionError> {
    conn.execute(
        "UPDATE findings SET decision = ?2 WHERE id = ?1",
        params![id, decision_text(decision)],
    )?;
    Ok(())
}

/// Applies a decision to a note. `subject` is the review's subject (`PlanSource::subject`):
/// dismissals are kept per merge request (or commit) and fingerprint.
pub fn decide(
    conn: &mut Connection,
    finding_id: &str,
    decision: &FindingDecision,
    subject: &str,
) -> Result<DecisionOutcome, DecisionError> {
    let tx = conn.transaction()?;
    let (finding, session) = load(&tx, finding_id)?;
    let (next, draft) = match decision {
        FindingDecision::AddToDrafts | FindingDecision::EditAndAdd { .. } => {
            if finding.decision != Decision::Open {
                return Err(DecisionError::AlreadyDecided(finding_id.to_owned()));
            }
            let body = match decision {
                FindingDecision::EditAndAdd { body } => body.clone(),
                _ => finding.suggested_comment.clone(),
            };
            let draft = drafts::create(
                &tx,
                &NewDraft {
                    session_id: session,
                    finding_id: Some(finding.id.clone()),
                    body,
                    position: Some(DiffPosition {
                        file: finding.file.clone(),
                        side: finding.side,
                        line: finding.line,
                    }),
                    severity: Some(finding.severity),
                },
            )?;
            (Decision::Draft, Some(draft))
        }
        FindingDecision::Dismiss => {
            if finding.decision != Decision::Open {
                return Err(DecisionError::AlreadyDecided(finding_id.to_owned()));
            }
            tx.execute(
                "INSERT INTO dismissals (fingerprint, kind, mr, file, created_at)
                 VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                params![finding.fingerprint, finding.kind, subject, finding.file],
            )?;
            (Decision::Dismissed, None)
        }
        FindingDecision::Undo => {
            match finding.decision {
                Decision::Open => return Err(DecisionError::NothingToUndo(finding_id.to_owned())),
                Decision::Draft => {
                    let ids: Vec<String> = tx
                        .prepare("SELECT id FROM drafts WHERE finding_id = ?1 AND session_id = ?2")?
                        .query_map(params![finding.id, session], |row| row.get(0))?
                        .collect::<Result<_, _>>()?;
                    // A draft already deleted from the drafts list leaves nothing to delete.
                    for id in ids {
                        drafts::delete(&tx, &id)?;
                    }
                }
                Decision::Dismissed => {
                    tx.execute(
                        "DELETE FROM dismissals WHERE fingerprint = ?1 AND mr = ?2",
                        params![finding.fingerprint, subject],
                    )?;
                }
            }
            (Decision::Open, None)
        }
    };
    set_decision(&tx, finding_id, next)?;
    tx.commit()?;
    Ok(DecisionOutcome {
        finding: Finding {
            decision: next,
            ..finding
        },
        draft,
    })
}

/// The session a stored note belongs to.
pub fn session_of(conn: &Connection, finding_id: &str) -> Result<String, DecisionError> {
    conn.query_row(
        "SELECT session_id FROM findings WHERE id = ?1",
        [finding_id],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| DecisionError::NotFound(finding_id.to_owned()))
}

/// The step's notes this session dismissed, in the order they were first recorded. The step
/// task leaves dismissed fingerprints out (F-09.4), so a step shown again - from the cache after
/// a restart (F-04.3) - gets them back from here: the reviewer still sees the decision and can
/// undo it.
pub fn dismissed_notes(
    conn: &Connection,
    session_id: &str,
    step_id: &str,
) -> Result<Vec<Finding>, DecisionError> {
    let mut stmt = conn.prepare(
        "SELECT json FROM findings
         WHERE session_id = ?1 AND step_id = ?2 AND decision = 'dismissed' ORDER BY rowid",
    )?;
    let rows = stmt
        .query_map(params![session_id, step_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    rows.iter()
        .map(|json| {
            Ok(Finding {
                decision: Decision::Dismissed,
                ..serde_json::from_str(json)?
            })
        })
        .collect()
}

/// The notes dismissed for `subject` (inputs of the step task, F-09.4), oldest first.
pub fn dismissed(conn: &Connection, subject: &str) -> Result<Vec<Dismissal>, DecisionError> {
    let mut stmt = conn.prepare(
        "SELECT fingerprint, kind FROM dismissals WHERE mr = ?1
         GROUP BY fingerprint, kind ORDER BY MIN(rowid)",
    )?;
    let rows = stmt
        .query_map([subject], |row| {
            Ok(Dismissal {
                fingerprint: row.get(0)?,
                kind: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
#[path = "decisions_tests.rs"]
mod tests;
