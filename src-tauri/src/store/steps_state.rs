//! Steps state repository (table `steps_state`): whether the reader marked a step reviewed
//! (F-07.2). Marking arrives with `review_mark_step`.

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
}
