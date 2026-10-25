//! F-12.4 (M5 decision 11): the "Add a summary comment" tick, its text and whether Claude wrote it
//! are kept per session in `sessions.summary_json` (migration 008), so a restart or a second visit
//! to S-05 shows what the reviewer left. Every test writes through the functions the app writes
//! with and "restarts" by opening the same database file again. Synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use std::path::{Path, PathBuf};

use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::store::sessions::{self, NewSession, SummaryField};
use guided_review_lib::store::{Store, repos};

const MR: &str = "mr-482";
const OTHER: &str = "mr-471";

fn db_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path()
        .join("Zażółć gęślą jaźń")
        .join("GuidedReview")
        .join("guided-review.db")
}

fn restart(store: Store, path: &Path) -> Store {
    drop(store);
    Store::open(path).unwrap()
}

fn started() -> (tempfile::TempDir, PathBuf, Store) {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = Store::open(&path).unwrap();
    store
        .with_conn(|c| {
            let repo = repos::add(
                c,
                "mobile ąę",
                r"C:\src\mobile ąę",
                Some("mobile/mobile-app"),
            )
            .unwrap();
            for (id, iid) in [(MR, 482), (OTHER, 471)] {
                sessions::insert(
                    c,
                    &NewSession {
                        id: id.into(),
                        repo_id: repo.id,
                        source_json: format!(
                            r#"{{"kind":"mr","project":"mobile/mobile-app","iid":{iid}}}"#
                        ),
                        base_sha: "a".into(),
                        head_sha: format!("head-{id}"),
                        mode: Mode::Focus,
                        layout: Layout::A,
                        status: SessionStatus::Reviewing,
                        worktree: None,
                        mr_json: None,
                    },
                )
                .unwrap();
            }
            Ok(())
        })
        .unwrap();
    (dir, path, store)
}

#[test]
fn f12_4_the_summary_choice_is_kept_per_session_across_a_restart() {
    let (_dir, path, store) = started();
    let written = SummaryField {
        enabled: true,
        text: "Dzięki, kolejka wygląda dobrze.\nPrzed scaleniem: obsłuż anulowanie aparatu.".into(),
        suggested: true,
    };
    store
        .with_conn(|c| {
            // Nothing ticked yet: off, empty, not Claude's.
            assert_eq!(sessions::summary(c, MR)?, Some(SummaryField::default()));
            assert_eq!(
                SummaryField::default(),
                SummaryField {
                    enabled: false,
                    text: String::new(),
                    suggested: false
                }
            );
            assert!(sessions::set_summary(c, MR, &written)?);
            // There is no session to keep it for.
            assert!(!sessions::set_summary(c, "gone", &written)?);
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(sessions::summary(c, MR)?, Some(written.clone()));
            // Another review of the same repository has its own choice.
            assert_eq!(sessions::summary(c, OTHER)?, Some(SummaryField::default()));
            assert_eq!(sessions::summary(c, "gone")?, None);
            // The reviewer unticks and types over it: the last write wins.
            let own = SummaryField {
                enabled: false,
                text: "My own words.".into(),
                suggested: false,
            };
            assert!(sessions::set_summary(c, MR, &own)?);
            assert_eq!(sessions::summary(c, MR)?, Some(own));
            Ok(())
        })
        .unwrap();
}

#[test]
fn f12_4_migration_008_adds_summary_json_to_sessions() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            let columns = c
                .prepare("SELECT name FROM pragma_table_info('sessions')")?
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            assert!(columns.iter().any(|name| name == "summary_json"));
            // A session that never had a summary ticked reads as the default, not as an error.
            let untouched: Option<String> = c.query_row(
                "SELECT summary_json FROM sessions WHERE id = ?1",
                [MR],
                |row| row.get(0),
            )?;
            assert!(untouched.is_none() || untouched.as_deref() == Some(""));
            assert_eq!(sessions::summary(c, MR)?, Some(SummaryField::default()));
            Ok(())
        })
        .unwrap();
}
