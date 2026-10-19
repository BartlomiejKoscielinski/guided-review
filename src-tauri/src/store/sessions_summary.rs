//! What S-05 keeps of the "Add a summary comment" field per session (F-12.4, M5 decision 11): the
//! tick, the text and whether Claude suggested it, as JSON in `sessions.summary_json` (migration
//! 008). Nothing stored, or a value that doesn't parse, reads as unticked and empty.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
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

/// The summary field as S-05 reads it, with whether the comment went out (F-12.5): a published
/// summary is never sent again, also after the app restarts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SummaryState {
    #[serde(flatten)]
    #[ts(flatten)]
    pub field: SummaryField,
    /// `true` once a Publish sent the comment; absent before.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub published: Option<bool>,
}

/// Keys of `summary_json` only the core writes: the GitLab draft note of a failed Publish attempt,
/// the text it carries, and whether the comment went out. The UI's field never replaces them.
const DRAFT_ID: &str = "gitlabDraftId";
const DRAFT_TEXT: &str = "gitlabDraftText";
const PUBLISHED: &str = "published";

/// The stored JSON object; `None` when there is no such session, empty when nothing parses.
fn stored(conn: &Connection, id: &str) -> Result<Option<Map<String, Value>>, StoreError> {
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT summary_json FROM sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(row.map(
        |json| match json.as_deref().map(serde_json::from_str::<Value>) {
            Some(Ok(Value::Object(map))) => map,
            _ => Map::new(),
        },
    ))
}

fn write(conn: &Connection, id: &str, json: &Map<String, Value>) -> Result<(), StoreError> {
    let text = serde_json::to_string(json).unwrap_or_default();
    conn.execute(
        "UPDATE sessions SET summary_json = ?2 WHERE id = ?1",
        params![id, text],
    )?;
    Ok(())
}

/// Keeps the session's summary field; `false` when there is no such session. What only the core
/// writes (the draft note of an earlier Publish attempt, whether it was published) stays.
pub fn set_summary(conn: &Connection, id: &str, field: &SummaryField) -> Result<bool, StoreError> {
    let Some(old) = stored(conn, id)? else {
        return Ok(false);
    };
    let mut json = match serde_json::to_value(field) {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    };
    for key in [DRAFT_ID, DRAFT_TEXT, PUBLISHED] {
        match old.get(key) {
            Some(value) => json.insert(key.to_owned(), value.clone()),
            None => json.remove(key),
        };
    }
    write(conn, id, &json)?;
    conn.execute(
        "UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        params![id],
    )?;
    Ok(true)
}

/// The summary field with whether it was published; `None` when there is no such session.
pub fn summary_state(conn: &Connection, id: &str) -> Result<Option<SummaryState>, StoreError> {
    let Some(field) = summary(conn, id)? else {
        return Ok(None);
    };
    let published = summary_published(conn, id)?.then_some(true);
    Ok(Some(SummaryState { field, published }))
}

/// The GitLab draft note made for the session's summary comment by a Publish whose batch did not
/// go out (F-12.5), so a Retry reuses it instead of making a second one.
pub fn summary_draft(conn: &Connection, id: &str) -> Result<Option<i64>, StoreError> {
    Ok(summary_note(conn, id)?.map(|(note, _)| note))
}

/// The summary's GitLab draft note with the text it carries (`None` for a note kept without its
/// text, which a Publish then makes again).
pub fn summary_note(
    conn: &Connection,
    id: &str,
) -> Result<Option<(i64, Option<String>)>, StoreError> {
    let json = stored(conn, id)?.unwrap_or_default();
    Ok(json.get(DRAFT_ID).and_then(Value::as_i64).map(|note| {
        let text = json
            .get(DRAFT_TEXT)
            .and_then(Value::as_str)
            .map(str::to_owned);
        (note, text)
    }))
}

/// Remembers (`Some`: the note and its text) or forgets (`None`) the summary's GitLab draft note.
pub fn set_summary_draft(
    conn: &Connection,
    id: &str,
    note: Option<(i64, &str)>,
) -> Result<(), StoreError> {
    let Some(mut json) = stored(conn, id)? else {
        return Ok(());
    };
    match note {
        Some((note, text)) => {
            json.insert(DRAFT_ID.to_owned(), Value::from(note));
            json.insert(DRAFT_TEXT.to_owned(), Value::from(text));
        }
        None => {
            json.remove(DRAFT_ID);
            json.remove(DRAFT_TEXT);
        }
    }
    write(conn, id, &json)
}

/// The summary comment went out with a Publish.
pub fn summary_published(conn: &Connection, id: &str) -> Result<bool, StoreError> {
    let json = stored(conn, id)?.unwrap_or_default();
    Ok(json.get(PUBLISHED).and_then(Value::as_bool) == Some(true))
}

/// Keeps that the summary comment went out and forgets its draft note: no Publish sends it again.
pub fn set_summary_published(conn: &Connection, id: &str) -> Result<(), StoreError> {
    let Some(mut json) = stored(conn, id)? else {
        return Ok(());
    };
    json.remove(DRAFT_ID);
    json.remove(DRAFT_TEXT);
    json.insert(PUBLISHED.to_owned(), Value::Bool(true));
    write(conn, id, &json)
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

    #[test]
    fn f12_5_the_summary_draft_note_survives_an_edit_and_is_forgotten_once_published() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                insert_for_test(c, "s1", "reviewing", "focus", "2026-10-17T08:00:00Z");
                assert_eq!(summary_draft(c, "s1")?, None);
                set_summary_draft(c, "s1", Some((512, "Looks good.")))?;
                assert_eq!(summary_draft(c, "s1")?, Some(512));
                let field = SummaryField {
                    enabled: true,
                    text: "Looks good.".into(),
                    suggested: false,
                };
                set_summary(c, "s1", &field)?;
                assert_eq!(summary(c, "s1")?, Some(field.clone()));
                assert_eq!(summary_draft(c, "s1")?, Some(512));
                assert_eq!(
                    summary_note(c, "s1")?,
                    Some((512, Some("Looks good.".to_owned())))
                );
                set_summary_draft(c, "s1", None)?;
                assert_eq!(summary_draft(c, "s1")?, None);
                assert_eq!(summary(c, "s1")?, Some(field));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn f12_5_a_published_summary_stays_published_across_an_edit() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                insert_for_test(c, "s1", "reviewing", "focus", "2026-10-17T08:00:00Z");
                let field = SummaryField {
                    enabled: true,
                    text: "Looks good.".into(),
                    suggested: false,
                };
                set_summary(c, "s1", &field)?;
                assert!(!summary_published(c, "s1")?);
                assert_eq!(summary_state(c, "s1")?.unwrap().published, None);
                set_summary_draft(c, "s1", Some((9, "Looks good.")))?;
                set_summary_published(c, "s1")?;
                assert_eq!(summary_note(c, "s1")?, None);
                // The UI writes its field again (an edit): the core's flag stays.
                let edited = SummaryField {
                    text: "Edited.".into(),
                    ..field
                };
                set_summary(c, "s1", &edited)?;
                assert!(summary_published(c, "s1")?);
                let state = summary_state(c, "s1")?.unwrap();
                assert_eq!((state.field, state.published), (edited, Some(true)));
                assert_eq!(summary_state(c, "nope")?, None);
                Ok(())
            })
            .unwrap();
    }
}
