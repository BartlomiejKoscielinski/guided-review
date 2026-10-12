//! Sessions repository (table `sessions`). Sessions are created from M3 on; in M0 the table
//! is empty and the Review tile stays dimmed.

use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::StoreError;
use crate::review::model::{Layout, Mode, SessionStatus};
use crate::review::sessions::{UnfinishedSession, resume_route};
use crate::route::Route;

fn parse<T: DeserializeOwned>(text: &str) -> Option<T> {
    serde_json::from_value(Value::String(text.to_owned())).ok()
}

/// Unfinished sessions, most recently updated first, each with the screen to resume at.
pub fn list_unfinished(
    conn: &Connection,
    last_route: &Route,
) -> Result<Vec<UnfinishedSession>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, status, mode, updated_at FROM sessions
         ORDER BY updated_at DESC, id",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut sessions = Vec::new();
    for (id, status, mode, updated_at) in rows {
        let Some(status) = status.as_deref().and_then(parse::<SessionStatus>) else {
            tracing::warn!(session = id, "session has an unknown status; skipped");
            continue;
        };
        if !status.is_unfinished() {
            continue;
        }
        let mode = mode.as_deref().and_then(parse::<Mode>).unwrap_or_default();
        let resume = resume_route(&id, status, mode, last_route);
        sessions.push(UnfinishedSession {
            id,
            status,
            mode,
            updated_at: updated_at.unwrap_or_default(),
            resume,
        });
    }
    Ok(sessions)
}

/// A session to create (F-01.3); `source_json` is the serialized `Source`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSession {
    pub id: String,
    pub repo_id: i64,
    pub source_json: String,
    pub base_sha: String,
    pub head_sha: String,
    pub mode: Mode,
    pub layout: Layout,
    pub status: SessionStatus,
}

fn stored<T: serde::Serialize>(value: T) -> Option<String> {
    match serde_json::to_value(value) {
        Ok(Value::String(text)) => Some(text),
        _ => None,
    }
}

pub fn insert(conn: &Connection, session: &NewSession) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, start_sha, mode, layout,
                               status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8,
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params![
            session.id,
            session.repo_id,
            session.source_json,
            session.base_sha,
            session.head_sha,
            stored(session.mode),
            stored(session.layout),
            stored(session.status),
        ],
    )?;
    Ok(())
}

/// The stored source of a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSource {
    pub repo_id: i64,
    pub source_json: String,
    pub base_sha: String,
    pub head_sha: String,
    pub status: Option<SessionStatus>,
}

pub fn source_of(conn: &Connection, id: &str) -> Result<Option<SessionSource>, StoreError> {
    Ok(conn
        .query_row(
            "SELECT repo_id, source_json, base_sha, head_sha, status FROM sessions WHERE id = ?1",
            params![id],
            |row| {
                Ok(SessionSource {
                    repo_id: row.get(0)?,
                    source_json: row.get(1)?,
                    base_sha: row.get(2)?,
                    head_sha: row.get(3)?,
                    status: row
                        .get::<_, Option<String>>(4)?
                        .as_deref()
                        .and_then(parse::<SessionStatus>),
                })
            },
        )
        .optional()?)
}

pub fn exists(conn: &Connection, id: &str) -> Result<bool, StoreError> {
    Ok(conn
        .query_row("SELECT 1 FROM sessions WHERE id = ?1", params![id], |_| {
            Ok(())
        })
        .optional()?
        .is_some())
}

#[cfg(test)]
pub(crate) fn insert_for_test(
    conn: &Connection,
    id: &str,
    status: &str,
    mode: &str,
    updated: &str,
) {
    conn.execute(
        "INSERT INTO sessions (id, status, mode, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, status, mode, updated],
    )
    .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn empty_table_has_no_unfinished_sessions() {
        let store = Store::open_in_memory().unwrap();
        let list = store
            .with_conn(|c| list_unfinished(c, &Route::Start))
            .unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn f30_2_unfinished_sessions_exclude_done_and_drafts_only() {
        let store = Store::open_in_memory().unwrap();
        let list = store
            .with_conn(|c| {
                insert_for_test(c, "done", "done", "focus", "2026-10-11T10:00:00Z");
                insert_for_test(c, "drafts", "draftsOnly", "focus", "2026-10-11T11:00:00Z");
                insert_for_test(c, "odd", "paused", "focus", "2026-10-11T12:00:00Z");
                insert_for_test(c, "plan", "planning", "focus", "2026-10-11T08:00:00Z");
                insert_for_test(c, "rev", "reviewing", "detailed", "2026-10-11T09:00:00Z");
                list_unfinished(c, &Route::Start)
            })
            .unwrap();
        let ids: Vec<&str> = list.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["rev", "plan"]);
    }

    #[test]
    fn f30_2_review_resumes_most_recent_session_at_last_screen() {
        let store = Store::open_in_memory().unwrap();
        let last = Route::Summary {
            session_id: "new".into(),
        };
        let list = store
            .with_conn(|c| {
                insert_for_test(c, "old", "reviewing", "focus", "2026-10-10T09:00:00Z");
                insert_for_test(c, "new", "reviewing", "focus", "2026-10-11T09:00:00Z");
                list_unfinished(c, &last)
            })
            .unwrap();
        assert_eq!(list[0].resume, last);
        assert_eq!(
            list[1].resume,
            Route::Step {
                session_id: "old".into()
            }
        );
    }

    #[test]
    fn exists_finds_sessions_by_id() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                insert_for_test(c, "s1", "done", "focus", "2026-10-11T09:00:00Z");
                assert!(exists(c, "s1")?);
                assert!(!exists(c, "s2")?);
                Ok(())
            })
            .unwrap();
    }
}
