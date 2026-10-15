//! Draft comments (table `drafts`, F-09.2, F-09.7, F-10.3): kept on this PC only. Nothing here
//! talks to GitLab; drafts reach it only through Publish (`drafts_publish`, F-12), a separate
//! explicit action. Drafts belong to the MR through `session_id` (F-12.7, docs/04).

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::finding_model::Severity;
use super::position::DiffPosition;
use crate::error::{AppError, ErrorCode};
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

const COLUMNS: &str =
    "id, session_id, finding_id, body, position_json, severity, include, published_note_id, error";

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

/// A new draft, included in the next Publish.
pub fn create(conn: &Connection, new: &NewDraft) -> Result<Draft, DraftError> {
    if new.body.trim().is_empty() {
        return Err(DraftError::EmptyBody);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let position = new
        .position
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    conn.execute(
        "INSERT INTO drafts (id, session_id, finding_id, body, position_json, severity, include,
                             created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1,
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params![
            id,
            new.session_id,
            new.finding_id,
            new.body,
            position,
            new.severity.map(severity_text),
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
