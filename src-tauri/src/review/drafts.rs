//! Draft comments (table `drafts`, F-09.2, F-09.7, F-10.3): kept on this PC only. Nothing here
//! talks to GitLab; drafts reach it only through Publish (`drafts_publish`, F-12), a separate
//! explicit action. Drafts belong to the MR through `session_id` (F-12.7, docs/04) and to a plan
//! step through `step_id` (the S-04 rail's per-step count, F-08.3).

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::finding_model::Severity;
use super::plan_model::Plan;
use super::position::DiffPosition;
use crate::error::{AppError, ErrorCode};
use crate::git::model::FileDiff;
use crate::store::StoreError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Draft {
    pub id: String,
    pub session_id: String,
    /// The note it was made from (Add to drafts, Edit and add).
    pub finding_id: Option<String>,
    pub body: String,
    /// `None`: a comment on the merge request, not on a line.
    pub position: Option<DiffPosition>,
    pub severity: Option<Severity>,
    /// Ticked for the next Publish.
    pub include: bool,
    #[ts(type = "number | null")]
    pub published_note_id: Option<u64>,
    /// Why the last Publish of this draft failed.
    pub error: Option<String>,
    /// The plan step it belongs to (F-08.3): the note's step, else the step holding the hunk of
    /// its line; `None` for a comment on the merge request or a line in no step.
    pub step_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewDraft {
    pub session_id: String,
    pub finding_id: Option<String>,
    pub body: String,
    pub position: Option<DiffPosition>,
    pub severity: Option<Severity>,
}

/// Fields to change; `None` keeps the value.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DraftPatch {
    pub body: Option<String>,
    pub include: Option<bool>,
}

#[derive(Debug, thiserror::Error)]
pub enum DraftError {
    #[error("draft {0} not found")]
    NotFound(String),
    #[error("draft {0} is already published")]
    Published(String),
    #[error("a draft needs text")]
    EmptyBody,
    #[error("the draft's position could not be stored: {0}")]
    Encode(#[from] serde_json::Error),
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<rusqlite::Error> for DraftError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error.into())
    }
}

impl From<DraftError> for AppError {
    fn from(error: DraftError) -> Self {
        match error {
            DraftError::NotFound(_) => {
                AppError::new(ErrorCode::InvalidInput, "This draft no longer exists.")
            }
            DraftError::Published(_) => AppError::new(
                ErrorCode::Conflict,
                "This draft is already on GitLab; change it there.",
            ),
            DraftError::EmptyBody => {
                AppError::new(ErrorCode::InvalidInput, "Write a comment first.")
            }
            DraftError::Encode(e) => {
                AppError::internal("The draft could not be saved.").with_detail(e.to_string())
            }
            DraftError::Store(e) => e.into(),
        }
    }
}

const COLUMNS: &str = "id, session_id, finding_id, body, position_json, severity, include, published_note_id, error, step_id";

fn severity_text(severity: Severity) -> &'static str {
    match severity {
        Severity::Fix => "fix",
        Severity::Q => "q",
        Severity::Nit => "nit",
    }
}

fn severity_from(text: &str) -> Option<Severity> {
    match text {
        "fix" => Some(Severity::Fix),
        "q" => Some(Severity::Q),
        "nit" => Some(Severity::Nit),
        _ => None,
    }
}

fn from_row(row: &Row<'_>) -> rusqlite::Result<Draft> {
    let position: Option<String> = row.get(4)?;
    let severity: Option<String> = row.get(5)?;
    let note: Option<i64> = row.get(7)?;
    Ok(Draft {
        id: row.get(0)?,
        session_id: row.get(1)?,
        finding_id: row.get(2)?,
        body: row.get(3)?,
        position: position.and_then(|p| serde_json::from_str(&p).ok()),
        severity: severity.as_deref().and_then(severity_from),
        include: row.get::<_, Option<bool>>(6)?.unwrap_or(true),
        published_note_id: note.and_then(|n| u64::try_from(n).ok()),
        error: row.get(8)?,
        step_id: row.get(9)?,
    })
}

/// The drafts of a session in the order they were made.
pub fn list(conn: &Connection, session_id: &str) -> Result<Vec<Draft>, DraftError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM drafts WHERE session_id = ?1 ORDER BY created_at, rowid"
    ))?;
    let drafts = stmt
        .query_map([session_id], from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(drafts)
}

pub fn get(conn: &Connection, id: &str) -> Result<Draft, DraftError> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM drafts WHERE id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| DraftError::NotFound(id.to_owned()))
}

/// The plan step holding the hunk of a diff line (F-08.3): a draft on that line belongs to it.
/// `None` for a line in a skim group, between hunks or in a file outside the change.
pub fn step_at(plan: &Plan, files: &[FileDiff], position: &DiffPosition) -> Option<String> {
    let hunk = files
        .iter()
        .filter(|f| {
            [&f.new_path, &f.old_path]
                .into_iter()
                .flatten()
                .any(|p| *p == position.file)
        })
        .flat_map(|f| f.hunks.iter())
        .find(|h| h.lines.iter().any(|l| position.is_on(l)))?;
    plan.steps
        .iter()
        .find(|s| s.hunk_ids.contains(&hunk.id))
        .map(|s| s.id.clone())
}

/// The step of a session's note; `None` when the note isn't there.
fn note_step(
    conn: &Connection,
    session: &str,
    finding: &str,
) -> Result<Option<String>, DraftError> {
    let step: Option<Option<String>> = conn
        .query_row(
            "SELECT step_id FROM findings WHERE session_id = ?1 AND id = ?2",
            params![session, finding],
            |row| row.get(0),
        )
        .optional()?;
    Ok(step.flatten())
}

/// A new draft, included in the next Publish; one made from a note belongs to the note's step.
pub fn create(conn: &Connection, new: &NewDraft) -> Result<Draft, DraftError> {
    create_at(conn, new, None)
}

/// [`create`] with `line_step`, the step holding the hunk of the draft's line ([`step_at`]),
/// for a draft that isn't from a note (the line comment composer, a draft from an answer).
pub fn create_at(
    conn: &Connection,
    new: &NewDraft,
    line_step: Option<String>,
) -> Result<Draft, DraftError> {
    if new.body.trim().is_empty() {
        return Err(DraftError::EmptyBody);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let position = new
        .position
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    let note = match &new.finding_id {
        Some(finding) => note_step(conn, &new.session_id, finding)?,
        None => None,
    };
    let step_id = note.or(line_step.filter(|_| new.position.is_some()));
    conn.execute(
        "INSERT INTO drafts (id, session_id, finding_id, body, position_json, severity, include,
                             step_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7,
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params![
            id,
            new.session_id,
            new.finding_id,
            new.body,
            position,
            new.severity.map(severity_text),
            step_id,
        ],
    )?;
    get(conn, &id)
}

/// Changes an unpublished draft.
pub fn update(conn: &Connection, id: &str, patch: &DraftPatch) -> Result<Draft, DraftError> {
    let draft = get(conn, id)?;
    if draft.published_note_id.is_some() {
        return Err(DraftError::Published(id.to_owned()));
    }
    if patch.body.as_deref().is_some_and(|b| b.trim().is_empty()) {
        return Err(DraftError::EmptyBody);
    }
    conn.execute(
        "UPDATE drafts SET body = COALESCE(?2, body), include = COALESCE(?3, include),
                           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, patch.body, patch.include],
    )?;
    get(conn, id)
}

/// Deletes an unpublished draft.
pub fn delete(conn: &Connection, id: &str) -> Result<(), DraftError> {
    let draft = get(conn, id)?;
    if draft.published_note_id.is_some() {
        return Err(DraftError::Published(id.to_owned()));
    }
    conn.execute("DELETE FROM drafts WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
#[path = "drafts_tests.rs"]
mod tests;
