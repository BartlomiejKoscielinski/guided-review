//! F-04.3 Session state survives app restarts: reviewed steps, note decisions, drafts, layout,
//! scroll position per step and "For you to judge" ticks are read back from a database file that
//! was closed and opened again. Every test writes through the functions the app writes with and
//! "restarts" by dropping the store and opening the same file.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::json;

use super::sessions::{self, NewSession};
use super::{Store, repos, settings, start_route, steps_state};
use crate::review::model::{Layout, Mode, SessionStatus};
use crate::route::Route;

pub(super) const MR: &str = "mr-482";
pub(super) const OTHER: &str = "mr-471";

/// The database file of a fresh app data folder with spaces and Polish characters.
fn db_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path()
        .join("Zażółć gęślą jaźń")
        .join("GuidedReview")
        .join("guided-review.db")
}

/// Closes the database and opens the file again, as the next start of the app does.
pub(super) fn restart(store: Store, path: &Path) -> Store {
    drop(store);
    Store::open(path).unwrap()
}

/// A teammate's MR session as S-01 writes it (F-01.3), opened in layout A.
fn open_session(c: &mut Connection, id: &str, iid: u64) {
    let repo = repos::add(
        c,
        "mobile ąę",
        r"C:\src\mobile ąę",
        Some("mobile/mobile-app"),
    )
    .unwrap();
    sessions::insert(
        c,
        &NewSession {
            id: id.into(),
            repo_id: repo.id,
            source_json: format!(r#"{{"kind":"mr","project":"mobile/mobile-app","iid":{iid}}}"#),
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

/// A store in a new data folder with the sessions `MR` and `OTHER` opened.
pub(super) fn started() -> (tempfile::TempDir, PathBuf, Store) {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = Store::open(&path).unwrap();
    store
        .with_conn(|c| {
            open_session(c, MR, 482);
            open_session(c, OTHER, 471);
            Ok(())
        })
        .unwrap();
    (dir, path, store)
}

pub(super) fn texts(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn f04_3_scroll_position_is_kept_per_step_across_a_restart() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            steps_state::set_scroll(c, MR, "s2", 1310)?;
            steps_state::set_scroll(c, MR, "s4", 120)?;
            // Scrolling on replaces the earlier position of the step.
            steps_state::set_scroll(c, MR, "s4", 245)?;
            steps_state::set_scroll(c, OTHER, "s4", 7)?;
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(steps_state::scroll(c, MR, "s2")?, 1310);
            assert_eq!(steps_state::scroll(c, MR, "s4")?, 245);
            assert_eq!(steps_state::scroll(c, OTHER, "s4")?, 7);
            // A step that was never scrolled opens at the top.
            assert_eq!(steps_state::scroll(c, MR, "s3")?, 0);
            assert_eq!(steps_state::scroll(c, OTHER, "s2")?, 0);
            // Scrolling alone does not mark the step reviewed.
            assert!(steps_state::reviewed_ids(c, MR)?.is_empty());
            Ok(())
        })
        .unwrap();
}

#[test]
fn f04_3_reviewed_steps_survive_a_restart() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            for step in ["s1", "s2", "s3"] {
                steps_state::set_reviewed(c, MR, step, true)?;
            }
            steps_state::set_reviewed(c, MR, "s2", false)?;
            steps_state::set_reviewed(c, OTHER, "s5", true)?;
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(
                steps_state::reviewed_ids(c, MR)?,
                HashSet::from(["s1".to_owned(), "s3".to_owned()])
            );
            assert!(steps_state::reviewed(c, MR, "s1")?);
            assert!(!steps_state::reviewed(c, MR, "s2")?);
            assert_eq!(
                steps_state::reviewed_ids(c, OTHER)?,
                HashSet::from(["s5".to_owned()])
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn f04_3_checklist_ticks_survive_a_restart() {
    let (_dir, path, store) = started();
    let judged = texts(&[
        "Does the queue survive a restart?",
        "Czy tekst „Spróbuj ponownie” jest poprawny?",
    ]);
    store
        .with_conn(|c| {
            steps_state::set_checklist(c, MR, "s4", &judged)?;
            steps_state::set_checklist(c, MR, "s2", &texts(&["Is the table created once?"]))?;
            steps_state::set_checklist(c, OTHER, "s4", &texts(&["Another review's tick"]))?;
            // Unticking everything is a state too.
            steps_state::set_checklist(c, MR, "s6", &texts(&["Is the worker started once?"]))?;
            steps_state::set_checklist(c, MR, "s6", &[])?;
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(steps_state::checklist(c, MR, "s4")?, judged);
            assert_eq!(
                steps_state::checklist(c, MR, "s2")?,
                texts(&["Is the table created once?"])
            );
            assert_eq!(
                steps_state::checklist(c, OTHER, "s4")?,
                texts(&["Another review's tick"])
            );
            assert!(steps_state::checklist(c, MR, "s6")?.is_empty());
            // A step nobody ticked anything on.
            assert!(steps_state::checklist(c, MR, "s1")?.is_empty());
            Ok(())
        })
        .unwrap();
}

#[test]
fn f04_3_one_step_keeps_its_reviewed_mark_scroll_and_ticks_together() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            steps_state::set_scroll(c, MR, "s4", 245)?;
            steps_state::set_checklist(c, MR, "s4", &texts(&["Is the retry copy right?"]))?;
            steps_state::set_reviewed(c, MR, "s4", true)?;
            // Each write changes only its own part of the step's state, in any order.
            steps_state::set_scroll(c, MR, "s4", 300)?;
            steps_state::set_checklist(c, MR, "s5", &texts(&["Is the banner shown offline?"]))?;
            steps_state::set_reviewed(c, MR, "s5", true)?;
            steps_state::set_scroll(c, MR, "s5", 12)?;
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert!(steps_state::reviewed(c, MR, "s4")?);
            assert_eq!(steps_state::scroll(c, MR, "s4")?, 300);
            assert_eq!(
                steps_state::checklist(c, MR, "s4")?,
                texts(&["Is the retry copy right?"])
            );
            assert!(steps_state::reviewed(c, MR, "s5")?);
            assert_eq!(steps_state::scroll(c, MR, "s5")?, 12);
            assert_eq!(
                steps_state::checklist(c, MR, "s5")?,
                texts(&["Is the banner shown offline?"])
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn f04_3_layout_is_kept_per_session_across_a_restart() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            open_session(c, "mr-455", 455);
            assert!(sessions::set_layout(c, MR, Layout::B)?);
            assert!(sessions::set_layout(c, OTHER, Layout::C)?);
            // The last choice wins.
            assert!(sessions::set_layout(c, OTHER, Layout::A)?);
            assert!(sessions::set_layout(c, OTHER, Layout::C)?);
            // There is no session to keep a layout for.
            assert!(!sessions::set_layout(c, "gone", Layout::B)?);
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(sessions::layout(c, MR)?, Some(Layout::B));
            assert_eq!(sessions::layout(c, OTHER)?, Some(Layout::C));
            // A session whose layout was never changed keeps the one it was opened in.
            assert_eq!(sessions::layout(c, "mr-455")?, Some(Layout::A));
            assert_eq!(sessions::layout(c, "gone")?, None);
            Ok(())
        })
        .unwrap();
}

#[test]
fn f04_3_current_step_is_kept_per_session_across_a_restart() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            assert_eq!(sessions::current_step(c, MR)?, None);
            assert!(sessions::set_current_step(c, MR, "s2")?);
            assert!(sessions::set_current_step(c, MR, "s4")?);
            assert!(sessions::set_current_step(c, OTHER, "s1")?);
            assert!(!sessions::set_current_step(c, "gone", "s1")?);
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(sessions::current_step(c, MR)?.as_deref(), Some("s4"));
            assert_eq!(sessions::current_step(c, OTHER)?.as_deref(), Some("s1"));
            assert_eq!(sessions::current_step(c, "gone")?, None);
            Ok(())
        })
        .unwrap();
}

#[test]
fn f04_3_the_step_screen_is_restored_for_a_session_that_survived_the_restart() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            settings::update(
                c,
                &json!({ "ui": { "lastRoute": { "screen": "S-03", "sessionId": MR } } }),
            )?;
            assert!(sessions::set_current_step(c, MR, "s4")?);
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(
                start_route(c)?,
                Route::Step {
                    session_id: MR.into()
                }
            );
            // The step the screen opens on is stored with the session.
            assert_eq!(sessions::current_step(c, MR)?.as_deref(), Some("s4"));
            Ok(())
        })
        .unwrap();
}
