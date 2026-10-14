//! Steps state repository (table `steps_state`): whether the reader marked a step reviewed
//! (F-07.2), written by `review_mark_step`; where S-03 was scrolled in the step and its ticked
//! "For you to judge" items (F-04.3). Each write changes only its own column of the step's row.

use std::collections::{BTreeMap, HashSet};

use rusqlite::{Connection, OptionalExtension, params};

use super::StoreError;

/// The step's reviewed flag; `false` when the step has no row.
pub fn reviewed(conn: &Connection, session: &str, step: &str) -> Result<bool, StoreError> {
    let flag: Option<Option<i64>> = conn
        .query_row(
            "SELECT reviewed FROM steps_state WHERE session_id = ?1 AND step_id = ?2",
            params![session, step],
            |row| row.get(0),
        )
        .optional()?;
    Ok(flag.flatten().is_some_and(|f| f != 0))
}

/// The session's steps marked reviewed (any plan the session had).
pub fn reviewed_ids(conn: &Connection, session: &str) -> Result<HashSet<String>, StoreError> {
    let mut stmt =
        conn.prepare("SELECT step_id FROM steps_state WHERE session_id = ?1 AND reviewed != 0")?;
    let ids = stmt
        .query_map(params![session], |row| row.get(0))?
        .collect::<Result<HashSet<String>, _>>()?;
    Ok(ids)
}

/// Sets the step's reviewed flag; the step's other state (scroll, checklist) stays.
pub fn set_reviewed(
    conn: &Connection,
    session: &str,
    step: &str,
    reviewed: bool,
) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO steps_state (session_id, step_id, reviewed) VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id, step_id) DO UPDATE SET reviewed = excluded.reviewed",
        params![session, step, i64::from(reviewed)],
    )?;
    Ok(())
}

/// The step's scroll offset in pixels (F-04.3); `0` for a step that was never scrolled.
pub fn scroll(conn: &Connection, session: &str, step: &str) -> Result<u32, StoreError> {
    let top: Option<Option<i64>> = conn
        .query_row(
            "SELECT scroll FROM steps_state WHERE session_id = ?1 AND step_id = ?2",
            params![session, step],
            |row| row.get(0),
        )
        .optional()?;
    Ok(top.flatten().map_or(0, offset))
}

/// The scroll offset of every scrolled step of the session.
pub fn scrolls(conn: &Connection, session: &str) -> Result<BTreeMap<String, u32>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT step_id, scroll FROM steps_state WHERE session_id = ?1 AND scroll IS NOT NULL",
    )?;
    let rows = stmt
        .query_map(params![session], |row| {
            Ok((row.get::<_, String>(0)?, offset(row.get(1)?)))
        })?
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    Ok(rows)
}

fn offset(stored: i64) -> u32 {
    u32::try_from(stored.max(0)).unwrap_or(u32::MAX)
}

/// Keeps where the step was scrolled; its reviewed flag and ticks stay.
pub fn set_scroll(
    conn: &Connection,
    session: &str,
    step: &str,
    scroll: u32,
) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO steps_state (session_id, step_id, scroll) VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id, step_id) DO UPDATE SET scroll = excluded.scroll",
        params![session, step, i64::from(scroll)],
    )?;
    Ok(())
}

/// The step's ticked "For you to judge" items (F-08.7); none when nothing was ticked.
pub fn checklist(conn: &Connection, session: &str, step: &str) -> Result<Vec<String>, StoreError> {
    let json: Option<Option<String>> = conn
        .query_row(
            "SELECT checklist_json FROM steps_state WHERE session_id = ?1 AND step_id = ?2",
            params![session, step],
            |row| row.get(0),
        )
        .optional()?;
    Ok(json.flatten().map(|j| ticks(&j)).unwrap_or_default())
}

/// The ticked items of every step of the session that has any.
pub fn checklists(
    conn: &Connection,
    session: &str,
) -> Result<BTreeMap<String, Vec<String>>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT step_id, checklist_json FROM steps_state
         WHERE session_id = ?1 AND checklist_json IS NOT NULL",
    )?;
    let rows = stmt
        .query_map(params![session], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(step, json)| (step, ticks(&json)))
        .filter(|(_, ticked)| !ticked.is_empty())
        .collect())
}

/// A row that doesn't parse counts as nothing ticked.
fn ticks(json: &str) -> Vec<String> {
    serde_json::from_str(json).unwrap_or_else(|error| {
        tracing::warn!(%error, "unreadable checklist ticks; treated as none");
        Vec::new()
    })
}

/// Replaces the step's ticked items (none unticks all); its reviewed flag and scroll stay.
pub fn set_checklist(
    conn: &Connection,
    session: &str,
    step: &str,
    ticked: &[String],
) -> Result<(), StoreError> {
    let json = serde_json::Value::from(ticked.to_vec()).to_string();
    conn.execute(
        "INSERT INTO steps_state (session_id, step_id, checklist_json) VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id, step_id) DO UPDATE SET checklist_json = excluded.checklist_json",
        params![session, step, json],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::store::Store;

    #[test]
    fn f07_2_reviewed_from_steps_state() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                assert!(!reviewed(c, "r1", "s1")?);
                c.execute(
                    "INSERT INTO steps_state (session_id, step_id, reviewed) VALUES
                     ('r1', 's1', 1), ('r1', 's2', 0)",
                    [],
                )?;
                assert!(reviewed(c, "r1", "s1")?);
                assert!(!reviewed(c, "r1", "s2")?);
                assert!(!reviewed(c, "r2", "s1")?);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn f07_2_set_reviewed_toggles_and_keeps_scroll() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                c.execute(
                    "INSERT INTO steps_state (session_id, step_id, reviewed, scroll)
                     VALUES ('r1', 's1', 0, 240)",
                    [],
                )?;
                set_reviewed(c, "r1", "s1", true)?;
                set_reviewed(c, "r1", "s2", true)?;
                set_reviewed(c, "r2", "s1", true)?;
                assert_eq!(
                    reviewed_ids(c, "r1")?,
                    HashSet::from(["s1".to_owned(), "s2".to_owned()])
                );
                set_reviewed(c, "r1", "s2", false)?;
                assert_eq!(reviewed_ids(c, "r1")?, HashSet::from(["s1".to_owned()]));
                let scroll: i64 = c.query_row(
                    "SELECT scroll FROM steps_state WHERE session_id = 'r1' AND step_id = 's1'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(scroll, 240);
                Ok(())
            })
            .unwrap();
    }
}
