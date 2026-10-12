//! `app_state`: small values the app keeps for itself (migration 002), never user settings.

use rusqlite::{Connection, OptionalExtension, params};

use super::StoreError;

/// The Claude Code version of the last successful startup probe (docs/05 › Startup checks).
pub const CLAUDE_PROBED_VERSION: &str = "claude.probedVersion";

pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, StoreError> {
    Ok(conn
        .query_row("SELECT value FROM app_state WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?)
}

pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value],
    )?;
    Ok(())
}

pub fn remove(conn: &Connection, key: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM app_state WHERE key = ?1", [key])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn values_are_set_replaced_and_removed() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                assert_eq!(get(c, CLAUDE_PROBED_VERSION)?, None);
                set(c, CLAUDE_PROBED_VERSION, "2.1.296")?;
                set(c, CLAUDE_PROBED_VERSION, "2.1.300")?;
                assert_eq!(get(c, CLAUDE_PROBED_VERSION)?.as_deref(), Some("2.1.300"));
                remove(c, CLAUDE_PROBED_VERSION)?;
                assert_eq!(get(c, CLAUDE_PROBED_VERSION)?, None);
                Ok(())
            })
            .unwrap();
    }
}
