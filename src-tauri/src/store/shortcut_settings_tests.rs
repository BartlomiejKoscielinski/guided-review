//! F-19.7: the shortcuts the user changed are part of the settings (`ui.shortcuts`: action id →
//! keys, only the changed ones), saved at once, read back after the app starts again, replaced
//! whole by a patch (so a Reset drops a key) and never lost to an action id the app doesn't have.
//! The action ids are the UI's (`nextNote`, `openAnything`, …); the core keeps them as names.

use std::collections::BTreeMap;

use rusqlite::Connection;
use serde_json::{Value, json};

use super::Store;
use super::settings::{from_rows, load, update};
use crate::settings::Settings;

/// `ui.shortcuts` as the UI reads it (read through JSON so the tests name no Rust type).
fn changed(settings: &Settings) -> Value {
    serde_json::to_value(settings).unwrap()["ui"]["shortcuts"].clone()
}

fn rows(conn: &Connection) -> BTreeMap<String, String> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings").unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn f19_7_no_shortcut_is_changed_by_default() {
    assert_eq!(changed(&Settings::default()), json!({}));
    let store = Store::open_in_memory().unwrap();
    let s = store.with_conn(|c| load(c)).unwrap();
    assert_eq!(changed(&s), json!({}));
}

#[test]
fn f19_7_changed_shortcuts_are_saved_at_once_and_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir
        .path()
        .join("Zażółć gęślą jaźń")
        .join("GuidedReview")
        .join("guided-review.db");
    let store = Store::open(&path).unwrap();
    let patch = json!({ "ui": { "shortcuts": {
        "nextNote": ["M"],
        "openAnything": ["Ctrl", "J"],
        "markFile": ["Space"]
    } } });
    let next = store.with_conn(|c| update(c, &patch)).unwrap();
    let expected = json!({
        "nextNote": ["M"],
        "openAnything": ["Ctrl", "J"],
        "markFile": ["Space"]
    });
    assert_eq!(changed(&next), expected);
    // One row, `ui.shortcuts`, holds the changed ones; nothing else was written.
    let stored = store.with_conn(|c| Ok(rows(c))).unwrap();
    assert_eq!(stored.keys().collect::<Vec<_>>(), vec!["ui.shortcuts"]);
    let row: Value = serde_json::from_str(&stored["ui.shortcuts"]).unwrap();
    assert_eq!(row, expected);
    drop(store);

    let store = Store::open(&path).unwrap();
    let s = store.with_conn(|c| load(c)).unwrap();
    assert_eq!(changed(&s), expected);
    assert_eq!(s, next);
}

#[test]
fn f19_7_a_patch_replaces_the_changed_shortcuts_whole() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            update(
                c,
                &json!({ "ui": { "shortcuts": { "nextNote": ["M"], "ask": ["Q"] } } }),
            )
        })
        .unwrap();
    // A Reset sends what is still changed: the reset key leaves the map.
    let next = store
        .with_conn(|c| update(c, &json!({ "ui": { "shortcuts": { "ask": ["Q"] } } })))
        .unwrap();
    assert_eq!(changed(&next), json!({ "ask": ["Q"] }));
    assert_eq!(
        changed(&store.with_conn(|c| load(c)).unwrap()),
        json!({ "ask": ["Q"] })
    );

    // Reset all sends an empty map.
    let next = store
        .with_conn(|c| update(c, &json!({ "ui": { "shortcuts": {} } })))
        .unwrap();
    assert_eq!(changed(&next), json!({}));
    assert_eq!(changed(&store.with_conn(|c| load(c)).unwrap()), json!({}));
}

#[test]
fn f19_7_another_setting_patch_keeps_the_changed_shortcuts() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| update(c, &json!({ "ui": { "shortcuts": { "nextNote": ["M"] } } })))
        .unwrap();
    let next = store
        .with_conn(|c| update(c, &json!({ "ui": { "startIn": "detailed" } })))
        .unwrap();
    assert_eq!(changed(&next), json!({ "nextNote": ["M"] }));
    assert_eq!(
        changed(&store.with_conn(|c| load(c)).unwrap()),
        json!({ "nextNote": ["M"] })
    );
}

#[test]
fn f19_7_an_unknown_action_id_does_not_discard_the_other_changed_shortcuts() {
    // A stored row from another version of the app names an action this one doesn't have.
    let s = from_rows([(
        "ui.shortcuts".to_owned(),
        r#"{"nextNote":["M"],"noSuchAction":["Z"]}"#.to_owned(),
    )]);
    assert_eq!(changed(&s)["nextNote"], json!(["M"]));

    // Saving a map that names one is accepted, and the known change is saved.
    let store = Store::open_in_memory().unwrap();
    let next = store
        .with_conn(|c| {
            update(
                c,
                &json!({ "ui": { "shortcuts": { "ask": ["Q"], "noSuchAction": ["Z"] } } }),
            )
        })
        .unwrap();
    assert_eq!(changed(&next)["ask"], json!(["Q"]));
    assert_eq!(
        changed(&store.with_conn(|c| load(c)).unwrap())["ask"],
        json!(["Q"])
    );
}

#[test]
fn f19_7_a_shortcut_without_keys_is_refused_and_changes_nothing() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| update(c, &json!({ "ui": { "shortcuts": { "nextNote": ["M"] } } })))
        .unwrap();
    for bad in [
        json!({ "ui": { "shortcuts": { "ask": [] } } }),
        json!({ "ui": { "shortcuts": { "ask": [""] } } }),
        json!({ "ui": { "shortcuts": { "ask": "Q" } } }),
    ] {
        assert!(
            store.with_conn(|c| update(c, &bad)).is_err(),
            "accepted {bad}"
        );
    }
    assert_eq!(
        changed(&store.with_conn(|c| load(c)).unwrap()),
        json!({ "nextNote": ["M"] })
    );
}
