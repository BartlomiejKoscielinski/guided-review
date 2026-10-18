//! The sessions of one merge request, project + iid (F-12.7, M5 decision 15): drafts belong to the
//! MR, so a draft made outside a review joins the latest of them, and a review just opened takes
//! the unpublished drafts of the others.

use rusqlite::{Connection, params};
use serde_json::Value;

use super::StoreError;
use super::repos;
use super::sessions::stored;
use crate::review::model::SessionStatus;
use crate::source::Source;

/// A session stores the MR it reviews as `Source::Mr`; GitLab project paths ignore case.
fn reviews(source_json: Option<&str>, project: &str, iid: u64) -> bool {
    match source_json.map(serde_json::from_str::<Source>) {
        Some(Ok(Source::Mr {
            project: theirs,
            iid: their_iid,
        })) => their_iid == iid && theirs.eq_ignore_ascii_case(project),
        _ => false,
    }
}

fn status_of(text: Option<String>) -> Option<SessionStatus> {
    serde_json::from_value(Value::String(text?)).ok()
}

/// The MR's sessions and their statuses, the one used last first: the order of "Pick up where you
/// left off" (`updated_at`), the later made of two saved in the same instant.
fn of_mr(
    conn: &Connection,
    project: &str,
    iid: u64,
) -> Result<Vec<(String, Option<SessionStatus>)>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, source_json, status FROM sessions
         ORDER BY updated_at DESC, created_at DESC, rowid DESC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter(|(_, source, _)| reviews(source.as_deref(), project, iid))
        .map(|(id, _, status)| (id, status_of(status)))
        .collect())
}

/// The session a draft made outside a review joins: the MR's session used last that isn't done.
/// A done session is listed nowhere, so a draft put there would be stranded.
pub fn latest_open(
    conn: &Connection,
    project: &str,
    iid: u64,
) -> Result<Option<String>, StoreError> {
    Ok(of_mr(conn, project, iid)?
        .into_iter()
        .find(|(_, status)| status.is_some_and(|s| s != SessionStatus::Done))
        .map(|(id, _)| id))
}

/// The MR's sessions other than `except`, whatever their status.
pub fn others(
    conn: &Connection,
    project: &str,
    iid: u64,
    except: &str,
) -> Result<Vec<String>, StoreError> {
    Ok(of_mr(conn, project, iid)?
        .into_iter()
        .map(|(id, _)| id)
        .filter(|id| id != except)
        .collect())
}

/// A new "drafts only" session of the MR (`source_json`, a `Source::Mr`) and its ID: no plan, no
/// worktree and no diff (empty SHAs, no mode or layout). It belongs to the repository of the
/// project when this PC has one.
pub fn insert_drafts_only(
    conn: &Connection,
    project: &str,
    source_json: &str,
) -> Result<String, StoreError> {
    let id = uuid::Uuid::new_v4().to_string();
    let repo = repos::by_project(conn, project)?.map(|repo| repo.id);
    conn.execute(
        "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, start_sha, status,
                               created_at, updated_at)
         VALUES (?1, ?2, ?3, '', '', '', ?4,
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params![id, repo, source_json, stored(SessionStatus::DraftsOnly)],
    )?;
    Ok(id)
}

#[cfg(test)]
#[path = "mr_sessions_tests.rs"]
mod tests;
