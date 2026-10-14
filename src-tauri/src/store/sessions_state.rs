//! What S-03 keeps of a session between app starts (F-04.3): the layout it was read in (F-07.1)
//! and the step it was on. Both are columns of `sessions`; a session that doesn't exist has
//! neither.

use rusqlite::{Connection, OptionalExtension, params};

use super::{parse, stored};
use crate::review::model::Layout;
use crate::store::StoreError;

/// The session's layout: the last one chosen, else the one it was opened in; `None` when there
/// is no such session.
pub fn layout(conn: &Connection, id: &str) -> Result<Option<Layout>, StoreError> {
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT layout FROM sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(row.map(|text| {
        text.as_deref()
            .and_then(parse::<Layout>)
            .unwrap_or_default()
    }))
}

/// Keeps the layout the reader chose for the session; `false` when there is no such session.
pub fn set_layout(conn: &Connection, id: &str, layout: Layout) -> Result<bool, StoreError> {
    let changed = conn.execute(
        "UPDATE sessions SET layout = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, stored(layout)],
    )?;
    Ok(changed > 0)
}

/// The step S-03 was on; `None` before a step was opened or when there is no such session.
pub fn current_step(conn: &Connection, id: &str) -> Result<Option<String>, StoreError> {
    let step: Option<Option<String>> = conn
        .query_row(
            "SELECT current_step FROM sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(step.flatten().filter(|s| !s.is_empty()))
}

/// Keeps the step S-03 is on; `false` when there is no such session.
pub fn set_current_step(conn: &Connection, id: &str, step: &str) -> Result<bool, StoreError> {
    let changed = conn.execute(
        "UPDATE sessions SET current_step = ?2,
                             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, step],
    )?;
    Ok(changed > 0)
}
