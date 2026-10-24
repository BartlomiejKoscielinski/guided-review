//! Sessions repository (table `sessions`). Sessions are created from S-01 (F-01.3) and listed
//! for the Review tile (F-30.2) and "Pick up where you left off" (F-04.1); their layout, mode and
//! current step are kept for the next start (F-04.3, F-08.1, `sessions_state.rs`).

#[path = "sessions_state.rs"]
mod state;
#[path = "sessions_summary.rs"]
mod summary;

pub use state::{
    current_step, layout, mark_plan_opened, mode, plan_opened, set_current_step, set_layout,
    set_mode,
};
pub use summary::{
    SummaryField, SummaryState, set_summary, set_summary_draft, set_summary_published, summary,
    summary_draft, summary_note, summary_published, summary_state,
};

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::StoreError;
use super::session_progress;
use crate::review::model::{Layout, Mode, SessionStatus, Strategy};
use crate::review::mr_summary::MrMeta;
use crate::review::sessions::{UnfinishedSession, card_title, resume_route};
use crate::route::Route;
use crate::source::Source;

fn parse<T: DeserializeOwned>(text: &str) -> Option<T> {
    serde_json::from_value(Value::String(text.to_owned())).ok()
}

/// One `sessions` row as the unfinished list reads it.
struct ListedRow {
    id: String,
    status: Option<String>,
    mode: Option<String>,
    updated_at: Option<String>,
    source_json: Option<String>,
    mr_json: Option<String>,
    repo_name: Option<String>,
}

/// Unfinished sessions, most recently updated first, each with the screen to resume at and its
/// card (F-04.1): title and progress. A "drafts only" session is one while it holds an unpublished
/// draft (F-12.7, M5 decision 15). A self-review's title is its repository's name here; the
/// command names it after the branch (`review::sessions::name_self_reviews`).
pub fn list_unfinished(
    conn: &Connection,
    last_route: &Route,
) -> Result<Vec<UnfinishedSession>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.status, s.mode, s.updated_at, s.source_json, s.mr_json, r.name
         FROM sessions s LEFT JOIN repos r ON r.id = s.repo_id
         ORDER BY s.updated_at DESC, s.id",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ListedRow {
                id: row.get(0)?,
                status: row.get(1)?,
                mode: row.get(2)?,
                updated_at: row.get(3)?,
                source_json: row.get(4)?,
                mr_json: row.get(5)?,
                repo_name: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut sessions = Vec::new();
    for row in rows {
        if let Some(session) = unfinished(conn, row, last_route)? {
            sessions.push(session);
        }
    }
    Ok(sessions)
}

/// The card of an unfinished session; `None` for a finished one, a drafts-only one without
/// unpublished drafts or a row that doesn't parse.
fn unfinished(
    conn: &Connection,
    row: ListedRow,
    last_route: &Route,
) -> Result<Option<UnfinishedSession>, StoreError> {
    let id = row.id;
    let Some(status) = row.status.as_deref().and_then(parse::<SessionStatus>) else {
        tracing::warn!(session = id, "session has an unknown status; skipped");
        return Ok(None);
    };
    let drafts_only = status == SessionStatus::DraftsOnly;
    if !status.is_unfinished() && !drafts_only {
        return Ok(None);
    }
    let Some(source) = row
        .source_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<Source>(json).ok())
    else {
        tracing::warn!(session = id, "session has no readable source; skipped");
        return Ok(None);
    };
    let mode = row
        .mode
        .as_deref()
        .and_then(parse::<Mode>)
        .unwrap_or_default();
    let progress = session_progress::of(conn, &id)?;
    // A drafts-only session is listed while it holds an unpublished draft (M5 decision 15).
    if drafts_only && progress.drafts == 0 {
        return Ok(None);
    }
    let mr_title = row
        .mr_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<MrMeta>(json).ok())
        .map(|mr| mr.title);
    Ok(Some(UnfinishedSession {
        title: card_title(&source, mr_title, row.repo_name),
        resume: resume_route(&id, status, mode, last_route),
        id,
        status,
        mode,
        updated_at: row.updated_at.unwrap_or_default(),
        source,
        reviewed_steps: progress.reviewed,
        total_steps: progress.total,
        drafts: progress.drafts,
    }))
}

/// The repository folder of each listed self-review, to name its card after the branch.
pub fn self_review_checkouts(
    conn: &Connection,
    sessions: &[UnfinishedSession],
) -> Result<HashMap<String, PathBuf>, StoreError> {
    let mut checkouts = HashMap::new();
    for session in sessions
        .iter()
        .filter(|s| matches!(s.source, Source::Local { .. }))
    {
        if let Some(found) = folders(conn, &session.id)? {
            checkouts.insert(session.id.clone(), found.checkout);
        }
    }
    Ok(checkouts)
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
    /// The review worktree of a teammate's MR (F-05.1).
    pub worktree: Option<String>,
    /// `MrMeta` of a teammate's MR as JSON (S-02 header, F-06.1).
    pub mr_json: Option<String>,
}

pub(super) fn stored<T: serde::Serialize>(value: T) -> Option<String> {
    match serde_json::to_value(value) {
        Ok(Value::String(text)) => Some(text),
        _ => None,
    }
}

pub fn insert(conn: &Connection, session: &NewSession) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, start_sha, mode, layout,
                               status, worktree, mr_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?10,
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
            session.worktree,
            session.mr_json,
        ],
    )?;
    Ok(())
}

/// The stored source of a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSource {
    /// `None`: a "drafts only" session of a project no repository here has (F-12.7).
    pub repo_id: Option<i64>,
    pub source_json: String,
    pub base_sha: String,
    pub head_sha: String,
    pub status: Option<SessionStatus>,
    pub worktree: Option<String>,
    pub mr_json: Option<String>,
}

pub fn source_of(conn: &Connection, id: &str) -> Result<Option<SessionSource>, StoreError> {
    Ok(conn
        .query_row(
            "SELECT repo_id, source_json, base_sha, head_sha, status, worktree, mr_json FROM sessions
             WHERE id = ?1",
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
                    worktree: row.get(5)?,
                    mr_json: row.get(6)?,
                })
            },
        )
        .optional()?)
}

/// Where a session's files live: its repository's checkout and, for a teammate's MR, the
/// review worktree (F-24.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFolders {
    pub checkout: PathBuf,
    pub worktree: Option<PathBuf>,
}

pub fn folders(conn: &Connection, id: &str) -> Result<Option<SessionFolders>, StoreError> {
    Ok(conn
        .query_row(
            "SELECT r.path, s.worktree FROM sessions s JOIN repos r ON r.id = s.repo_id
             WHERE s.id = ?1",
            params![id],
            |row| {
                Ok(SessionFolders {
                    checkout: PathBuf::from(row.get::<_, String>(0)?),
                    worktree: row.get::<_, Option<String>>(1)?.map(PathBuf::from),
                })
            },
        )
        .optional()?)
}

/// The session's step order strategy (F-06.4); the default when none is stored.
pub fn strategy(conn: &Connection, id: &str) -> Result<Strategy, StoreError> {
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT strategy FROM sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored
        .flatten()
        .as_deref()
        .and_then(parse::<Strategy>)
        .unwrap_or_default())
}

/// Stores the session's strategy; `false` when there is no such session.
pub fn set_strategy(conn: &Connection, id: &str, strategy: Strategy) -> Result<bool, StoreError> {
    let changed = conn.execute(
        "UPDATE sessions SET strategy = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, stored(strategy)],
    )?;
    Ok(changed > 0)
}

/// The session was used now: `updated_at` orders "Pick up where you left off" (F-04.1).
pub fn touch(conn: &Connection, id: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// The latest self-review (a local-changes session) of a repository, by its last use: whose kept
/// notes the MR description reads (F-27.2).
pub fn latest_self_review(conn: &Connection, repo_id: i64) -> Result<Option<String>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, source_json FROM sessions WHERE repo_id = ?1
         ORDER BY updated_at DESC, created_at DESC, rowid DESC",
    )?;
    let rows = stmt.query_map(params![repo_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    })?;
    for row in rows {
        let (id, json) = row?;
        let local = json
            .as_deref()
            .and_then(|j| serde_json::from_str::<Source>(j).ok())
            .is_some_and(|source| matches!(source, Source::Local { .. }));
        if local {
            return Ok(Some(id));
        }
    }
    Ok(None)
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
        "INSERT INTO sessions (id, status, mode, updated_at, source_json)
         VALUES (?1, ?2, ?3, ?4, '{\"kind\":\"local\",\"scope\":{\"kind\":\"uncommitted\"}}')",
        params![id, status, mode, updated],
    )
    .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn f27_2_the_latest_self_review_is_the_last_used_local_session_of_the_repository() {
        let store = Store::open_in_memory().unwrap();
        let found = store
            .with_conn(|c| {
                let local = r#"{"kind":"local","scope":{"kind":"staged"}}"#;
                let mr = r#"{"kind":"mr","project":"g/p","iid":7}"#;
                for (id, repo, json, updated) in [
                    ("old", 1, local, "2026-10-11T08:00:00Z"),
                    ("new", 1, local, "2026-10-11T09:00:00Z"),
                    ("mr", 1, mr, "2026-10-11T10:00:00Z"),
                    ("other", 2, local, "2026-10-11T11:00:00Z"),
                ] {
                    c.execute(
                        "INSERT INTO sessions (id, repo_id, source_json, status, updated_at)
                         VALUES (?1, ?2, ?3, 'done', ?4)",
                        params![id, repo, json, updated],
                    )?;
                }
                Ok((latest_self_review(c, 1)?, latest_self_review(c, 3)?))
            })
            .unwrap();
        assert_eq!(found, (Some("new".to_owned()), None));
    }

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

    #[test]
    fn f24_1_session_folders_hold_the_checkout_and_the_mr_worktree() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                let repo = crate::store::repos::add(
                    c,
                    "mobile ąę",
                    r"C:\src\mobile ąę",
                    Some("mobile/mobile-app"),
                )?;
                insert(
                    c,
                    &NewSession {
                        id: "mr".into(),
                        repo_id: repo.id,
                        source_json: r#"{"kind":"mr","project":"mobile/mobile-app","iid":482}"#
                            .into(),
                        base_sha: "a".into(),
                        head_sha: "b".into(),
                        mode: Mode::Focus,
                        layout: Layout::A,
                        status: SessionStatus::Planning,
                        worktree: Some(r"C:\src\.review\mobile ąę\482".into()),
                        mr_json: None,
                    },
                )?;
                assert_eq!(
                    folders(c, "mr")?,
                    Some(SessionFolders {
                        checkout: PathBuf::from(r"C:\src\mobile ąę"),
                        worktree: Some(PathBuf::from(r"C:\src\.review\mobile ąę\482")),
                    })
                );
                assert_eq!(folders(c, "missing")?, None);
                Ok(())
            })
            .unwrap();
    }
}

#[cfg(test)]
#[path = "sessions_progress_tests.rs"]
mod progress_tests;
