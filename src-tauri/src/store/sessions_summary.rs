//! What S-05 keeps of the "Add a summary comment" field per session (F-12.4, M5 decision 11): the
//! tick, the text and whether Claude suggested it, as JSON in `sessions.summary_json` (migration
//! 008). Nothing stored, or a value that doesn't parse, reads as unticked and empty.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::store::StoreError;

/// The summary comment of a session's Publish.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SummaryField {
    /// "Add a summary comment" is ticked.
    pub enabled: bool,
    /// The text of the area; an empty one isn't published.
    pub text: String,
    /// The text began as Claude's suggestion: it stays set while the reviewer edits it and is
    /// cleared with the text (M5 decision 11).
    pub suggested: bool,
}

/// The session's summary field; `None` when there is no such session.
pub fn summary(conn: &Connection, id: &str) -> Result<Option<SummaryField>, StoreError> {
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT summary_json FROM sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(row.map(|json| {
        json.as_deref()
            .and_then(|text| serde_json::from_str(text).ok())
            .unwrap_or_default()
    }))
}

/// Keeps the session's summary field; `false` when there is no such session.
pub fn set_summary(conn: &Connection, id: &str, field: &SummaryField) -> Result<bool, StoreError> {
    let json = serde_json::to_string(field).unwrap_or_default();
    let changed = conn.execute(
        "UPDATE sessions SET summary_json = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, json],
    )?;
    Ok(changed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use crate::store::sessions::insert_for_test;

    #[test]
    fn f12_4_a_summary_json_that_does_not_parse_reads_as_unticked() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                insert_for_test(c, "s1", "reviewing", "focus", "2026-10-17T08:00:00Z");
                c.execute(
                    "UPDATE sessions SET summary_json = '{not json' WHERE id = 's1'",
                    [],
                )?;
                assert_eq!(summary(c, "s1")?, Some(SummaryField::default()));
                Ok(())
            })
            .unwrap();
    }
}
