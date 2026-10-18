//! The sessions of one MR (F-12.7): which one a draft made outside a review joins, which ones a new
//! review takes drafts from, and the drafts-only row. Synthetic data only.

use super::*;
use crate::store::Store;
use crate::store::sessions::{insert_for_test, source_of};

fn seed(conn: &Connection, id: &str, status: &str, source: &Source, updated: &str) {
    insert_for_test(conn, id, status, "focus", updated);
    conn.execute(
        "UPDATE sessions SET source_json = ?2, created_at = ?3 WHERE id = ?1",
        params![id, serde_json::to_string(source).unwrap(), updated],
    )
    .unwrap();
}

fn mr(project: &str, iid: u64) -> Source {
    Source::Mr {
        project: project.into(),
        iid,
    }
}

#[test]
fn f12_7_the_latest_open_session_matches_project_and_iid_ignoring_the_project_case() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            seed(
                c,
                "old",
                "reviewing",
                &mr("mobile/mobile-app", 482),
                "2026-10-10T09:00:00Z",
            );
            seed(
                c,
                "new",
                "draftsOnly",
                &mr("Mobile/Mobile-App", 482),
                "2026-10-11T09:00:00Z",
            );
            seed(
                c,
                "done",
                "done",
                &mr("mobile/mobile-app", 482),
                "2026-10-12T09:00:00Z",
            );
            seed(
                c,
                "odd",
                "paused",
                &mr("mobile/mobile-app", 482),
                "2026-10-13T09:00:00Z",
            );
            seed(
                c,
                "iid",
                "reviewing",
                &mr("mobile/mobile-app", 4820),
                "2026-10-14T09:00:00Z",
            );
            assert_eq!(
                latest_open(c, "mobile/mobile-app", 482)?.as_deref(),
                Some("new")
            );
            assert_eq!(latest_open(c, "mobile/mobile-app", 999)?, None);
            let mut rest = others(c, "mobile/mobile-app", 482, "new")?;
            rest.sort();
            assert_eq!(rest, ["done", "odd", "old"]);
            Ok(())
        })
        .unwrap();
}

#[test]
fn f12_7_two_sessions_saved_in_the_same_instant_pick_the_later_made() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            let same = "2026-10-11T09:00:00.000Z";
            seed(
                c,
                "b-first",
                "planning",
                &mr("mobile/mobile-app", 482),
                same,
            );
            seed(
                c,
                "a-second",
                "planning",
                &mr("mobile/mobile-app", 482),
                same,
            );
            assert_eq!(
                latest_open(c, "mobile/mobile-app", 482)?.as_deref(),
                Some("a-second")
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn f12_7_a_drafts_only_row_has_no_plan_worktree_diff_or_repository_of_another_project() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            let json = serde_json::to_string(&mr("mobile/courier-app", 7)).unwrap();
            let id = insert_drafts_only(c, "mobile/courier-app", &json)?;
            let row = source_of(c, &id)?.unwrap();
            assert_eq!(row.repo_id, None);
            assert_eq!(row.status, Some(SessionStatus::DraftsOnly));
            assert_eq!((row.base_sha.as_str(), row.head_sha.as_str()), ("", ""));
            assert_eq!((row.worktree, row.mr_json), (None, None));
            assert_eq!(row.source_json, json);
            Ok(())
        })
        .unwrap();
}
