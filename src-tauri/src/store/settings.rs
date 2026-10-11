//! Settings repository: one row per key in `settings(key, value)` with a JSON value
//! (`ui.startIn` → `"focus"`). Reading is forgiving: unknown keys are ignored and invalid values
//! fall back to the default with a log line (docs/04 › Settings). Writing stores changed keys.

use std::collections::BTreeMap;

use rusqlite::{Connection, params};
use serde_json::{Map, Value};

use super::StoreError;
use crate::settings::{REPLACED_WHOLE, Settings};

/// Object-valued keys that are stored whole in one row (`claude.tasks.<group>`, `ui.lastRoute`).
fn is_object_key(key: &str) -> bool {
    REPLACED_WHOLE.contains(&key) || key.starts_with("claude.tasks.")
}

/// The settings as `key → JSON value` rows.
pub fn flatten(settings: &Settings) -> BTreeMap<String, Value> {
    let mut out = BTreeMap::new();
    if let Ok(tree) = serde_json::to_value(settings) {
        flatten_into("", &tree, &mut out);
    }
    out
}

fn flatten_into(prefix: &str, value: &Value, out: &mut BTreeMap<String, Value>) {
    match value {
        Value::Object(map) if prefix.is_empty() || !is_object_key(prefix) => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_into(&path, child, out);
            }
        }
        _ => {
            out.insert(prefix.to_owned(), value.clone());
        }
    }
}

fn set_path(tree: &mut Value, key: &str, value: Value) {
    let mut node = tree;
    let mut parts = key.split('.').peekable();
    while let Some(part) = parts.next() {
        let Value::Object(map) = node else { return };
        if parts.peek().is_none() {
            map.insert(part.to_owned(), value);
            return;
        }
        node = map
            .entry(part.to_owned())
            .or_insert_with(|| Value::Object(Map::new()));
    }
}

/// Builds settings from stored rows, starting from the defaults.
pub fn from_rows(rows: impl IntoIterator<Item = (String, String)>) -> Settings {
    let defaults = Settings::default();
    let known = flatten(&defaults);
    let Ok(mut tree) = serde_json::to_value(&defaults) else {
        return defaults;
    };
    for (key, raw) in rows {
        if !known.contains_key(&key) {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&raw) else {
            tracing::warn!(key, "stored setting is not JSON; using the default");
            continue;
        };
        let mut candidate = tree.clone();
        set_path(&mut candidate, &key, value);
        let valid = serde_json::from_value::<Settings>(candidate.clone())
            .is_ok_and(|s| s.validate().is_ok());
        if valid {
            tree = candidate;
        } else {
            tracing::warn!(key, "stored setting is invalid; using the default");
        }
    }
    serde_json::from_value(tree).unwrap_or(defaults)
}

pub fn load(conn: &Connection) -> Result<Settings, StoreError> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<(String, String)>, _>>()?;
    Ok(from_rows(rows))
}

/// Applies a partial patch, stores the keys whose value changed, and returns the new settings.
pub fn update(conn: &mut Connection, patch: &Value) -> Result<Settings, StoreError> {
    let current = load(conn)?;
    let next = current.patched(patch)?;
    let before = flatten(&current);
    let tx = conn.transaction()?;
    for (key, value) in flatten(&next) {
        if before.get(&key) != Some(&value) {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value.to_string()],
            )?;
        }
    }
    tx.commit()?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::model::Mode;
    use crate::route::Route;
    use crate::store::Store;
    use serde_json::json;

    fn rows(conn: &Connection) -> BTreeMap<String, String> {
        let mut stmt = conn.prepare("SELECT key, value FROM settings").unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn keys_are_the_ones_in_the_settings_table() {
        let keys: Vec<String> = flatten(&Settings::default()).into_keys().collect();
        let mut expected = vec![
            "ui.startIn",
            "ui.focusLayout",
            "ui.diffColors",
            "ui.lastRoute",
            "os.startWithWindows",
            "os.closeToTray",
            "claude.path",
            "claude.maxConcurrent",
            "claude.model",
            "claude.effort",
            "claude.lang",
            "claude.tasks.plan",
            "claude.tasks.step",
            "claude.tasks.ask",
            "claude.tasks.fix",
            "claude.tasks.mr",
            "claude.tasks.commit",
            "git.path",
            "gitlab.server",
            "rider.path",
            "rider.openFrom",
            "nav.engine",
            "notify.reviewRequests",
            "notify.newCommits",
            "notify.comments",
            "notify.pipelines",
            "notify.approvals",
            "poll.minutes",
            "quiet.enabled",
            "quiet.from",
            "quiet.to",
            "quiet.weekends",
        ];
        expected.sort_unstable();
        assert_eq!(keys, expected);
    }

    #[test]
    fn empty_table_gives_the_defaults() {
        let store = Store::open_in_memory().unwrap();
        let s = store.with_conn(|c| load(c)).unwrap();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn stored_values_are_read_back() {
        let s = from_rows([
            ("ui.startIn".to_owned(), "\"detailed\"".to_owned()),
            (
                "claude.tasks.commit".to_owned(),
                r#"{"model":"default","effort":"max"}"#.to_owned(),
            ),
        ]);
        assert_eq!(s.ui.start_in, Mode::Detailed);
        assert_eq!(s.claude.tasks.commit.model, "default");
    }

    #[test]
    fn unknown_keys_are_ignored_and_invalid_values_fall_back_to_the_default() {
        let s = from_rows([
            ("ui.theme".to_owned(), "\"light\"".to_owned()),
            ("ui".to_owned(), "{}".to_owned()),
            ("claude.maxConcurrent".to_owned(), "9".to_owned()),
            ("poll.minutes".to_owned(), "not json".to_owned()),
            ("ui.lastRoute".to_owned(), r#"{"screen":"S-99"}"#.to_owned()),
            ("os.closeToTray".to_owned(), "false".to_owned()),
        ]);
        let mut expected = Settings::default();
        expected.os.close_to_tray = false;
        assert_eq!(s, expected);
    }

    #[test]
    fn update_stores_only_changed_keys_and_round_trips() {
        let store = Store::open_in_memory().unwrap();
        let next = store
            .with_conn(|c| {
                update(
                    c,
                    &json!({ "ui": { "focusLayout": "C" }, "poll": { "minutes": 3 } }),
                )
            })
            .unwrap();
        let stored = store.with_conn(|c| Ok(rows(c))).unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(
            stored.get("ui.focusLayout").map(String::as_str),
            Some("\"C\"")
        );
        assert_eq!(store.with_conn(|c| load(c)).unwrap(), next);
    }

    #[test]
    fn invalid_update_changes_nothing() {
        let store = Store::open_in_memory().unwrap();
        let err = store
            .with_conn(|c| {
                update(
                    c,
                    &json!({ "ui": { "startIn": "detailed" }, "poll": { "minutes": 7 } }),
                )
            })
            .unwrap_err();
        assert!(matches!(err, StoreError::Settings(_)));
        assert!(store.with_conn(|c| Ok(rows(c))).unwrap().is_empty());
    }

    #[test]
    fn f30_4_last_route_round_trips_through_settings() {
        let store = Store::open_in_memory().unwrap();
        let route = json!({ "screen": "S-07", "section": "claude" });
        store
            .with_conn(|c| update(c, &json!({ "ui": { "lastRoute": route } })))
            .unwrap();
        let s = store.with_conn(|c| load(c)).unwrap();
        assert_eq!(
            s.ui.last_route,
            Route::Settings {
                section: crate::route::SettingsSection::Claude
            }
        );
        let stored = store.with_conn(|c| Ok(rows(c))).unwrap();
        assert_eq!(
            stored.get("ui.lastRoute").map(String::as_str),
            Some(r#"{"screen":"S-07","section":"claude"}"#)
        );
    }
}
