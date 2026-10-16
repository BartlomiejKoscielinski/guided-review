//! F-07.10 Each file of a step can be marked reviewed on its own: `review_mark_file` marks or
//! unmarks one file of one step, a step counts as reviewed when all its files are, `review_mark_step`
//! (Mark reviewed) marks all its files at once and on a reviewed step unmarks them, steps marked
//! reviewed before file marks existed count as all files reviewed, and the marks are kept per step
//! and file across a restart (F-04.3), read back with the rest of the session state.
//!
//! The step flag in `steps_state` stays what the steps list, the S-02 card and `review_step` read
//! ("steps keep being counted"), so the tests read it through `progress::reviewed_steps` and
//! `steps_state::reviewed_ids`. Every test writes through the functions the app writes with.

use rusqlite::Connection;

use super::session_state_tests::{MR, OTHER, restart, started};
use super::steps_state;
use crate::error::{AppError, ErrorCode};
use crate::git::model::{FileDiff, FileStatus, Hunk};
use crate::review::layer::{Layer, layer_of};
use crate::review::plan_model::{Coverage, Orders, Plan, Step};
use crate::review::progress::{self, ProgressError};
use crate::review::session_state;

const VM: &str = "src/App/ViewModels/Upload ViewModel.cs";
const QUEUE: &str = "src/Core/Upload/Zażółć Queue.cs";
const IFACE: &str = "src/Core/IUploadQueue.cs";
const BANNER: &str = "src/App/Views/Offline banner.xaml";

fn hunk(id: &str, start: u32) -> Hunk {
    Hunk {
        id: id.into(),
        old_start: start,
        old_lines: 3,
        new_start: start,
        new_lines: 3,
        header: String::new(),
        lines: Vec::new(),
        file_level: false,
        staged_differs: false,
        mechanical: None,
    }
}

fn file(path: &str, hunks: Vec<Hunk>) -> FileDiff {
    FileDiff {
        old_path: Some(path.into()),
        new_path: Some(path.into()),
        status: FileStatus::Modified,
        binary: false,
        mode_change: None,
        additions: 4,
        deletions: 1,
        layer: layer_of(path),
        hunks,
        line_staging: true,
    }
}

/// VM has two hunks split across s1 (a1) and s2 (a2).
fn files() -> Vec<FileDiff> {
    vec![
        file(VM, vec![hunk("a1", 10), hunk("a2", 100)]),
        file(QUEUE, vec![hunk("q1", 1)]),
        file(IFACE, vec![hunk("i1", 1)]),
        file(BANNER, vec![hunk("b1", 1)]),
    ]
}

fn step(id: &str, hunks: &[&str]) -> Step {
    Step {
        id: id.into(),
        title: format!("Title {id}"),
        short_title: id.into(),
        reason: String::new(),
        description: String::new(),
        layer: Layer::Core,
        hunk_ids: hunks.iter().map(|&h| h.into()).collect(),
        builds_on: Vec::new(),
    }
}

/// s1: VM (first hunk) and IFACE; s2: VM (second hunk) and QUEUE; s3: BANNER alone.
fn plan() -> Plan {
    Plan {
        intent: String::new(),
        steps: vec![
            step("s1", &["a1", "i1"]),
            step("s2", &["a2", "q1"]),
            step("s3", &["b1"]),
        ],
        orders: Orders {
            contract_to_ui: Vec::new(),
            tests_first: Vec::new(),
        },
        skim: Vec::new(),
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: String::new(),
        coverage: Coverage::default(),
    }
}

fn sorted(mut items: Vec<String>) -> Vec<String> {
    items.sort();
    items
}

fn paths(items: &[&str]) -> Vec<String> {
    sorted(items.iter().map(|&p| p.to_owned()).collect())
}

/// Marks or unmarks one file of a step of `session`; returns the plan's reviewed steps.
fn mark_file(c: &Connection, session: &str, step: &str, file: &str, reviewed: bool) -> Vec<String> {
    progress::mark_file(c, session, &plan(), &files(), step, file, reviewed).unwrap()
}

/// The files of the step marked reviewed (a step marked as a whole has all its files).
fn marked(c: &Connection, session: &str, step: &str) -> Vec<String> {
    sorted(progress::reviewed_files(c, session, &plan(), &files(), step).unwrap())
}

/// What `session_state` reads back for the step: the files marked on their own.
fn kept(c: &Connection, session: &str, step: &str) -> Vec<String> {
    let state = session_state::load(c, session).unwrap().unwrap();
    sorted(state.reviewed_files.get(step).cloned().unwrap_or_default())
}

fn reviewed_steps(c: &Connection, session: &str) -> Vec<String> {
    progress::reviewed_steps(c, session, &plan()).unwrap()
}

fn invalid_input(error: ProgressError) {
    let error: AppError = error.into();
    assert_eq!(error.code, ErrorCode::InvalidInput);
}

#[test]
fn f07_10_a_file_is_marked_per_step_and_file() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            assert_eq!(mark_file(c, MR, "s1", VM, true), Vec::<String>::new());
            assert_eq!(marked(c, MR, "s1"), paths(&[VM]));
            // The same file in the other step is its own mark (a file split across steps).
            assert_eq!(marked(c, MR, "s2"), Vec::<String>::new());
            assert_eq!(marked(c, MR, "s3"), Vec::<String>::new());
            // Another session's marks are its own.
            assert_eq!(marked(c, OTHER, "s1"), Vec::<String>::new());

            mark_file(c, MR, "s2", VM, true);
            assert_eq!(marked(c, MR, "s2"), paths(&[VM]));
            mark_file(c, MR, "s1", VM, false);
            assert_eq!(marked(c, MR, "s1"), Vec::<String>::new());
            assert_eq!(marked(c, MR, "s2"), paths(&[VM]));
            assert_eq!(reviewed_steps(c, MR), Vec::<String>::new());
            Ok(())
        })
        .unwrap();
}

#[test]
fn f07_10_marking_twice_or_unmarking_an_unmarked_file_changes_nothing() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            mark_file(c, MR, "s1", VM, false);
            assert_eq!(marked(c, MR, "s1"), Vec::<String>::new());
            mark_file(c, MR, "s1", IFACE, true);
            mark_file(c, MR, "s1", IFACE, true);
            assert_eq!(marked(c, MR, "s1"), paths(&[IFACE]));
            mark_file(c, MR, "s1", VM, false);
            assert_eq!(marked(c, MR, "s1"), paths(&[IFACE]));
            Ok(())
        })
        .unwrap();
}

#[test]
fn f07_10_a_step_is_reviewed_when_all_its_files_are() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            assert_eq!(mark_file(c, MR, "s1", IFACE, true), Vec::<String>::new());
            assert!(steps_state::reviewed_ids(c, MR)?.is_empty());
            // The last file of the step makes the step reviewed.
            assert_eq!(mark_file(c, MR, "s1", VM, true), ["s1"]);
            assert_eq!(reviewed_steps(c, MR), ["s1"]);
            assert!(steps_state::reviewed(c, MR, "s1")?);
            // A step of one file is reviewed with that file; the answer lists steps in plan order.
            assert_eq!(mark_file(c, MR, "s3", BANNER, true), ["s1", "s3"]);
            // One file taken back and the step is no longer reviewed; the other files stay marked.
            assert_eq!(mark_file(c, MR, "s1", VM, false), ["s3"]);
            assert_eq!(marked(c, MR, "s1"), paths(&[IFACE]));
            assert!(!steps_state::reviewed(c, MR, "s1")?);
            assert_eq!(reviewed_steps(c, MR), ["s3"]);
            // s2 shares VM with s1 but is not reviewed by s1's marks.
            assert_eq!(marked(c, MR, "s2"), Vec::<String>::new());
            Ok(())
        })
        .unwrap();
}

#[test]
fn f07_10_mark_reviewed_marks_all_files_and_on_a_reviewed_step_unmarks_them() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            mark_file(c, MR, "s2", VM, true);
            mark_file(c, MR, "s1", VM, true);
            assert_eq!(progress::mark(c, MR, &plan(), "s1", true).unwrap(), ["s1"]);
            assert_eq!(marked(c, MR, "s1"), paths(&[VM, IFACE]));
            assert_eq!(reviewed_steps(c, MR), ["s1"]);
            // The other step's marks are not touched.
            assert_eq!(marked(c, MR, "s2"), paths(&[VM]));

            // Mark reviewed on a reviewed step takes all its marks back.
            assert_eq!(
                progress::mark(c, MR, &plan(), "s1", false).unwrap(),
                Vec::<String>::new()
            );
            assert_eq!(marked(c, MR, "s1"), Vec::<String>::new());
            assert_eq!(kept(c, MR, "s1"), Vec::<String>::new());
            assert!(steps_state::reviewed_ids(c, MR)?.is_empty());
            assert_eq!(marked(c, MR, "s2"), paths(&[VM]));
            Ok(())
        })
        .unwrap();
}

#[test]
fn f07_10_taking_one_file_back_from_a_reviewed_step_keeps_the_others_marked() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            progress::mark(c, MR, &plan(), "s1", true).unwrap();
            assert_eq!(mark_file(c, MR, "s1", VM, false), Vec::<String>::new());
            assert_eq!(marked(c, MR, "s1"), paths(&[IFACE]));
            assert_eq!(kept(c, MR, "s1"), paths(&[IFACE]));
            assert!(!steps_state::reviewed(c, MR, "s1")?);
            // Marking it again completes the step again.
            assert_eq!(mark_file(c, MR, "s1", VM, true), ["s1"]);
            assert_eq!(marked(c, MR, "s1"), paths(&[VM, IFACE]));
            Ok(())
        })
        .unwrap();
}

#[test]
fn f07_10_steps_reviewed_before_file_marks_count_as_all_files_reviewed() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            // What the app wrote before: the step's flag, no file marks.
            steps_state::set_reviewed(c, MR, "s1", true)?;
            steps_state::set_reviewed(c, MR, "s3", true)?;
            assert_eq!(marked(c, MR, "s1"), paths(&[VM, IFACE]));
            assert_eq!(marked(c, MR, "s3"), paths(&[BANNER]));
            assert_eq!(marked(c, MR, "s2"), Vec::<String>::new());
            assert_eq!(reviewed_steps(c, MR), ["s1", "s3"]);

            // Taking one file back leaves the other files of that step marked, and the other step.
            assert_eq!(mark_file(c, MR, "s1", IFACE, false), ["s3"]);
            assert_eq!(marked(c, MR, "s1"), paths(&[VM]));
            assert_eq!(marked(c, MR, "s3"), paths(&[BANNER]));
            // Mark reviewed on such a step unmarks all its files.
            progress::mark(c, MR, &plan(), "s3", false).unwrap();
            assert_eq!(marked(c, MR, "s3"), Vec::<String>::new());
            Ok(())
        })
        .unwrap();
}

#[test]
fn f07_10_marks_survive_a_restart_per_session_step_and_file() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            mark_file(c, MR, "s1", VM, true);
            mark_file(c, MR, "s3", BANNER, true);
            progress::mark(c, MR, &plan(), "s2", true).unwrap();
            progress::mark(c, MR, &plan(), "s2", false).unwrap();
            mark_file(c, MR, "s2", QUEUE, true);
            mark_file(c, OTHER, "s1", IFACE, true);
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(marked(c, MR, "s1"), paths(&[VM]));
            assert_eq!(kept(c, MR, "s1"), paths(&[VM]));
            assert_eq!(marked(c, MR, "s2"), paths(&[QUEUE]));
            assert_eq!(kept(c, MR, "s2"), paths(&[QUEUE]));
            assert_eq!(marked(c, MR, "s3"), paths(&[BANNER]));
            assert_eq!(reviewed_steps(c, MR), ["s3"]);
            assert_eq!(marked(c, OTHER, "s1"), paths(&[IFACE]));
            assert_eq!(kept(c, OTHER, "s1"), paths(&[IFACE]));
            assert_eq!(kept(c, OTHER, "s2"), Vec::<String>::new());
            // Marks made after the restart are kept on top.
            mark_file(c, MR, "s1", IFACE, true);
            assert_eq!(reviewed_steps(c, MR), ["s1", "s3"]);
            Ok(())
        })
        .unwrap();
}

#[test]
fn f07_10_a_file_outside_the_step_or_a_step_outside_the_plan_is_refused() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            let plan = plan();
            let files = files();
            // QUEUE belongs to s2, not to s1; an unknown path is in no step.
            for file in [QUEUE, "src/App/not there.cs"] {
                let error =
                    progress::mark_file(c, MR, &plan, &files, "s1", file, true).unwrap_err();
                invalid_input(error);
            }
            let error = progress::mark_file(c, MR, &plan, &files, "s9", VM, true).unwrap_err();
            invalid_input(error);
            let error = progress::reviewed_files(c, MR, &plan, &files, "s9").unwrap_err();
            invalid_input(error);
            // Nothing was written.
            assert_eq!(marked(c, MR, "s1"), Vec::<String>::new());
            assert_eq!(marked(c, MR, "s2"), Vec::<String>::new());
            assert_eq!(kept(c, MR, "s1"), Vec::<String>::new());
            assert!(steps_state::reviewed_ids(c, MR)?.is_empty());
            Ok(())
        })
        .unwrap();
}
