//! Claude sessions of questions (table `claude_sessions`, F-10.2): one per review session and
//! step, continued with `--resume` by follow-up questions.

use rusqlite::{Connection, OptionalExtension, params};

use super::StoreError;

/// The Claude session of a step, if a question was asked there before.
pub fn get(
    conn: &Connection,
    session_id: &str,
    step_id: &str,
) -> Result<Option<String>, StoreError> {
    Ok(conn
        .query_row(
            "SELECT claude_session_id FROM claude_sessions WHERE session_id = ?1 AND step_id = ?2",
            params![session_id, step_id],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn put(
    conn: &Connection,
    session_id: &str,
    step_id: &str,
    claude_session_id: &str,
) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO claude_sessions (session_id, step_id, claude_session_id) VALUES (?1, ?2, ?3)
         ON CONFLICT (session_id, step_id) DO UPDATE SET claude_session_id = excluded.claude_session_id",
        params![session_id, step_id, claude_session_id],
    )?;
    Ok(())
}

/// Forgets the step's Claude session (Claude Code no longer has it).
pub fn delete(conn: &Connection, session_id: &str, step_id: &str) -> Result<(), StoreError> {
    conn.execute(
        "DELETE FROM claude_sessions WHERE session_id = ?1 AND step_id = ?2",
        params![session_id, step_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn f10_2_one_claude_session_per_step_replaced_and_deleted() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                assert_eq!(get(c, "r1", "s1")?, None);
                put(c, "r1", "s1", "c-1")?;
                put(c, "r1", "s2", "c-2")?;
                put(c, "r1", "s1", "c-3")?;
                assert_eq!(get(c, "r1", "s1")?.as_deref(), Some("c-3"));
                delete(c, "r1", "s1")?;
                assert_eq!(get(c, "r1", "s1")?, None);
                assert_eq!(get(c, "r1", "s2")?.as_deref(), Some("c-2"));
                Ok(())
            })
            .unwrap();
    }
}
