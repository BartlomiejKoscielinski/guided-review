//! "Self-review done" of S-11's "Before you create" (F-27.5, M7 decision 19): the numbers of the
//! newest self-review of the repository, "6 of 6 steps · 0 open notes". A self-review is a
//! local-changes session (the same lookup as the kept notes of F-27.2); an MR or commits session
//! never counts, and neither does another repository's. Sessions keep no branch, so the lookup is
//! per repository, and a self-review made on uncommitted changes counts after they are committed
//! (its head differs from HEAD by then).
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::review::plan_model::Plan;
use guided_review_lib::store::session_progress::{Progress, latest_self_review};
use guided_review_lib::store::{Store, plans, steps_state};
use rusqlite::{Connection, params};
use serde_json::json;

const LOCAL: &str = r#"{"kind":"local","scope":{"kind":"uncommitted"}}"#;
const MR: &str = r#"{"kind":"mr","project":"g/p","iid":7}"#;
const COMMITS: &str = r#"{"kind":"commits","to":"abc"}"#;

fn plan(ids: &[&str]) -> Plan {
    let steps: Vec<_> = ids
        .iter()
        .map(|id| {
            json!({ "id": id, "title": id, "shortTitle": id, "reason": "", "description": "",
                    "layer": "core", "hunkIds": ["h1"], "buildsOn": [] })
        })
        .collect();
    serde_json::from_value(json!({
        "intent": "", "steps": steps,
        "orders": { "contractToUi": [], "testsFirst": [] },
        "skim": [], "risks": [], "descriptionCheck": [], "alreadyDiscussed": "",
        "coverage": { "files": 1, "filesTotal": 1, "hunks": 1, "hunksTotal": 1 }
    }))
    .unwrap()
}

fn session(c: &Connection, id: &str, repo: i64, source: &str, head: &str, updated: &str) {
    c.execute(
        "INSERT INTO sessions (id, repo_id, source_json, head_sha, status, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'done', ?5)",
        params![id, repo, source, head, updated],
    )
    .unwrap();
}

fn reviewed(c: &Connection, id: &str, steps: &[&str], reviewed: &[&str]) {
    plans::set_plan(c, id, &plan(steps)).unwrap();
    for step in reviewed {
        steps_state::set_reviewed(c, id, step, true).unwrap();
    }
}

fn note(c: &Connection, id: &str, session: &str, published: Option<i64>) {
    c.execute(
        "INSERT INTO drafts (id, session_id, published_note_id) VALUES (?1, ?2, ?3)",
        params![id, session, published],
    )
    .unwrap();
}

fn latest(store: &Store, repo: i64) -> Option<Progress> {
    store.with_conn(|c| latest_self_review(c, repo)).unwrap()
}

#[test]
fn f27_5_a_repository_without_a_self_review_has_none() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            session(c, "mr", 1, MR, "h1", "2026-10-11T10:00:00Z");
            session(c, "commits", 1, COMMITS, "h1", "2026-10-11T11:00:00Z");
            session(c, "other", 2, LOCAL, "h1", "2026-10-11T12:00:00Z");
            Ok(())
        })
        .unwrap();
    assert_eq!(latest(&store, 1), None);
    assert_eq!(latest(&store, 3), None);
}

#[test]
fn f27_5_the_newest_local_session_gives_steps_reviewed_total_and_open_notes() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            session(c, "old", 1, LOCAL, "h0", "2026-10-11T08:00:00Z");
            reviewed(c, "old", &["a", "b"], &["a", "b"]);
            session(c, "new", 1, LOCAL, "h1", "2026-10-11T09:00:00Z");
            reviewed(
                c,
                "new",
                &["a", "b", "c", "d", "e", "f"],
                &["a", "b", "c", "d"],
            );
            note(c, "n1", "new", None);
            note(c, "n2", "new", None);
            note(c, "n3", "new", Some(77));
            note(c, "n4", "old", None);
            // Newer sessions of other kinds and repositories do not take its place.
            session(c, "mr", 1, MR, "h1", "2026-10-11T10:00:00Z");
            reviewed(c, "mr", &["a"], &["a"]);
            session(c, "other", 2, LOCAL, "h1", "2026-10-11T11:00:00Z");
            reviewed(c, "other", &["a"], &["a"]);
            Ok(())
        })
        .unwrap();
    assert_eq!(
        latest(&store, 1),
        Some(Progress {
            reviewed: 4,
            total: 6,
            drafts: 2
        })
    );
}

#[test]
fn f27_5_a_finished_self_review_counts_whatever_head_it_was_made_at() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            session(
                c,
                "self",
                1,
                LOCAL,
                "sha-before-the-commit",
                "2026-10-11T09:00:00Z",
            );
            reviewed(c, "self", &["a", "b"], &["a", "b"]);
            Ok(())
        })
        .unwrap();
    assert_eq!(
        latest(&store, 1),
        Some(Progress {
            reviewed: 2,
            total: 2,
            drafts: 0
        })
    );
}

#[test]
fn f27_5_a_self_review_without_a_plan_yet_has_no_steps() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            session(c, "self", 1, LOCAL, "h1", "2026-10-11T09:00:00Z");
            Ok(())
        })
        .unwrap();
    assert_eq!(
        latest(&store, 1).map(|p| (p.reviewed, p.total)),
        Some((0, 0))
    );
}
