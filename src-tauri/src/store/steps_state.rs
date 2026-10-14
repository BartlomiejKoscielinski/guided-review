//! Steps state repository (table `steps_state`): whether the reader marked a step reviewed
//! (F-07.2), written by `review_mark_step`.

use std::collections::HashSet;

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
