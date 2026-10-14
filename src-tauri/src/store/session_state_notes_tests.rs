//! F-04.3 note decisions and drafts across a restart, and the whole session state together:
//! read back from a database file that was closed and opened again, written through the
//! functions the app writes with.

use std::collections::HashSet;

use serde_json::json;

use super::session_state_tests::{MR, OTHER, restart, started, texts};
use super::sessions;
use super::{plans, settings, start_route, steps_state};
use crate::review::decisions::{self, FindingDecision};
use crate::review::drafts::{self, NewDraft};
use crate::review::finding_model::{Decision, Finding, Severity, Side, StepAnalysis};
use crate::review::model::Layout;
use crate::route::Route;

const SUBJECT: &str = "mr:482";
const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";

fn note(id: &str, fingerprint: &str, suggested: &str) -> Finding {
    Finding {
        id: id.into(),
        step_id: "s4".into(),
        severity: Severity::Q,
        kind: "unawaited-task".into(),
        title: format!("Note {id}"),
        body: "The task is dropped.".into(),
        file: VM.into(),
        side: Side::New,
        line: 2,
        evidence: Vec::new(),
        suggested_comment: suggested.into(),
        fingerprint: fingerprint.into(),
        decision: Decision::Open,
    }
}

/// Step 4's notes as the step task returns them; each test decides on them its own way.
fn step_notes() -> StepAnalysis {
    StepAnalysis {
        step_id: "s4".into(),
        findings: vec![
            note("f1", "aaaa", "Should `Enqueue` be awaited here?"),
            note("f2", "bbbb", "Is the table created on every start?"),
            note("f3", "cccc", "Could the path be kept instead of the bytes?"),
        ],
        checklist: texts(&["Is the retry copy right?"]),
        files_read: Vec::new(),
        folds: Vec::new(),
    }
}

fn general_draft(body: &str) -> NewDraft {
    NewDraft {
        session_id: MR.into(),
        finding_id: None,
        body: body.into(),
        position: None,
        severity: None,
    }
}

#[test]
fn f04_3_note_decisions_and_drafts_survive_a_restart() {
    let (_dir, path, store) = started();
    let notes = step_notes();
    store
        .with_conn(|c| {
            decisions::record(c, MR, &notes).unwrap();
            decisions::decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT).unwrap();
            decisions::decide(c, "f2", &FindingDecision::Dismiss, SUBJECT).unwrap();
            drafts::create(c, &general_draft("Please add a test for the retry path.")).unwrap();
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            // Opening the step again shows its notes with the decisions made before the restart.
            let again = decisions::record(c, MR, &notes).unwrap();
            let seen: Vec<_> = again.iter().map(|f| (f.id.as_str(), f.decision)).collect();
            assert_eq!(
                seen,
                [
                    ("f1", Decision::Draft),
                    ("f2", Decision::Dismissed),
                    ("f3", Decision::Open)
                ]
            );
            // The drafts are still on the list, in the order they were made, still unpublished.
            let list = drafts::list(c, MR).unwrap();
            let bodies: Vec<_> = list.iter().map(|d| d.body.as_str()).collect();
            assert_eq!(
                bodies,
                [
                    "Should `Enqueue` be awaited here?",
                    "Please add a test for the retry path."
                ]
            );
            assert_eq!(list[0].finding_id.as_deref(), Some("f1"));
            assert!(
                list.iter()
                    .all(|d| d.include && d.published_note_id.is_none())
            );
            assert!(drafts::list(c, OTHER).unwrap().is_empty());
            // The dismissed note stays out of the next step run.
            let dismissed = decisions::dismissed(c, SUBJECT).unwrap();
            assert_eq!(
                dismissed
                    .iter()
                    .map(|d| d.fingerprint.as_str())
                    .collect::<Vec<_>>(),
                ["bbbb"]
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn f04_3_a_decision_made_before_a_restart_can_still_be_undone_after_it() {
    let (_dir, path, store) = started();
    let notes = step_notes();
    store
        .with_conn(|c| {
            decisions::record(c, MR, &notes).unwrap();
            decisions::decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT).unwrap();
            decisions::decide(c, "f2", &FindingDecision::Dismiss, SUBJECT).unwrap();
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            decisions::decide(c, "f1", &FindingDecision::Undo, SUBJECT).unwrap();
            decisions::decide(c, "f2", &FindingDecision::Undo, SUBJECT).unwrap();
            assert!(drafts::list(c, MR).unwrap().is_empty());
            assert!(decisions::dismissed(c, SUBJECT).unwrap().is_empty());
            let again = decisions::record(c, MR, &notes).unwrap();
            assert!(again.iter().all(|f| f.decision == Decision::Open));
            Ok(())
        })
        .unwrap();
}

#[test]
fn f04_3_the_whole_session_state_round_trips_through_a_reopened_database() {
    let (_dir, path, store) = started();
    let notes = step_notes();
    let order = texts(&["s2", "s1", "s3", "s4", "s5", "s6", "s7", "s8"]);
    store
        .with_conn(|c| {
            settings::update(
                c,
                &json!({ "ui": { "lastRoute": { "screen": "S-03", "sessionId": MR } } }),
            )?;
            plans::set_custom_order(c, MR, Some(&order))?;
            assert!(sessions::set_current_step(c, MR, "s4")?);
            assert!(sessions::set_layout(c, MR, Layout::B)?);
            steps_state::set_reviewed(c, MR, "s1", true)?;
            steps_state::set_reviewed(c, MR, "s2", true)?;
            steps_state::set_scroll(c, MR, "s4", 245)?;
            steps_state::set_checklist(c, MR, "s4", &texts(&["Is the retry copy right?"]))?;
            decisions::record(c, MR, &notes).unwrap();
            decisions::decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT).unwrap();
            decisions::decide(c, "f3", &FindingDecision::Dismiss, SUBJECT).unwrap();
            Ok(())
        })
        .unwrap();
    // Two starts in a row: what the first start reads is still there for the second.
    let store = restart(store, &path);
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(
                start_route(c)?,
                Route::Step {
                    session_id: MR.into()
                }
            );
            assert_eq!(sessions::current_step(c, MR)?.as_deref(), Some("s4"));
            assert_eq!(sessions::layout(c, MR)?, Some(Layout::B));
            assert_eq!(plans::custom_order(c, MR)?, Some(order.clone()));
            assert_eq!(
                steps_state::reviewed_ids(c, MR)?,
                HashSet::from(["s1".to_owned(), "s2".to_owned()])
            );
            assert_eq!(steps_state::scroll(c, MR, "s4")?, 245);
            assert_eq!(
                steps_state::checklist(c, MR, "s4")?,
                texts(&["Is the retry copy right?"])
            );
            let again = decisions::record(c, MR, &notes).unwrap();
            let seen: Vec<_> = again.iter().map(|f| f.decision).collect();
            assert_eq!(seen, [Decision::Draft, Decision::Open, Decision::Dismissed]);
            assert_eq!(drafts::list(c, MR).unwrap().len(), 1);
            // The other session has none of it.
            assert_eq!(sessions::layout(c, OTHER)?, Some(Layout::A));
            assert_eq!(sessions::current_step(c, OTHER)?, None);
            assert!(steps_state::reviewed_ids(c, OTHER)?.is_empty());
            assert!(drafts::list(c, OTHER).unwrap().is_empty());
            Ok(())
        })
        .unwrap();
}
