use super::*;
use crate::review::finding_model::{Severity, Side};
use crate::store::Store;

const SUBJECT: &str = "mr:482";
const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";

fn finding(id: &str, fingerprint: &str) -> Finding {
    Finding {
        id: id.into(),
        step_id: "s1".into(),
        severity: Severity::Q,
        kind: "unawaited-task".into(),
        title: "Enqueue is not awaited".into(),
        body: "The task is dropped.".into(),
        file: VM.into(),
        side: Side::New,
        line: 2,
        evidence: Vec::new(),
        suggested_comment: "Should `Enqueue` be awaited here?".into(),
        fingerprint: fingerprint.into(),
        decision: Decision::Open,
    }
}

fn analysis(findings: Vec<Finding>) -> StepAnalysis {
    StepAnalysis {
        step_id: "s1".into(),
        findings,
        checklist: Vec::new(),
        files_read: Vec::new(),
        folds: Vec::new(),
    }
}

/// A store with two notes of session r1 recorded.
fn with<T>(f: impl FnOnce(&mut Connection) -> Result<T, DecisionError>) -> T {
    let store = Store::open_in_memory().unwrap();
    let mut out = None;
    store
        .with_conn(|c| {
            record(
                c,
                "r1",
                &analysis(vec![finding("f1", "aaaa"), finding("f2", "bbbb")]),
            )
            .unwrap();
            out = Some(f(c));
            Ok(())
        })
        .unwrap();
    out.unwrap().unwrap()
}

fn decision_of(c: &Connection, id: &str) -> Decision {
    load(c, id).unwrap().0.decision
}

#[test]
fn f09_2_add_to_drafts_creates_a_draft_from_the_suggested_comment() {
    with(|c| {
        let out = decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT)?;
        assert_eq!(out.finding.decision, Decision::Draft);
        let draft = out.draft.unwrap();
        assert_eq!(draft.body, "Should `Enqueue` be awaited here?");
        assert_eq!(draft.finding_id.as_deref(), Some("f1"));
        assert_eq!(draft.session_id, "r1");
        assert_eq!(draft.severity, Some(Severity::Q));
        assert_eq!(
            draft.position,
            Some(DiffPosition {
                file: VM.into(),
                side: Side::New,
                line: 2
            })
        );
        assert!(draft.include && draft.published_note_id.is_none());
        assert_eq!(drafts::list(c, "r1")?, [draft]);
        assert_eq!(decision_of(c, "f1"), Decision::Draft);
        assert_eq!(decision_of(c, "f2"), Decision::Open);
        Ok(())
    });
}

#[test]
fn f09_2_edit_and_add_uses_the_edited_text() {
    with(|c| {
        let edit = FindingDecision::EditAndAdd {
            body: "Please await `Enqueue`.".into(),
        };
        let out = decide(c, "f2", &edit, SUBJECT)?;
        assert_eq!(out.draft.unwrap().body, "Please await `Enqueue`.");
        // A decided note takes no second decision until it is undone.
        assert!(matches!(
            decide(c, "f2", &FindingDecision::Dismiss, SUBJECT),
            Err(DecisionError::AlreadyDecided(_))
        ));
        Ok(())
    });
}

#[test]
fn f09_2_undo_add_to_drafts_deletes_the_draft() {
    with(|c| {
        decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT)?;
        let out = decide(c, "f1", &FindingDecision::Undo, SUBJECT)?;
        assert_eq!(out.finding.decision, Decision::Open);
        assert!(out.draft.is_none());
        assert!(drafts::list(c, "r1")?.is_empty());
        assert_eq!(decision_of(c, "f1"), Decision::Open);
        // Undone, it can be decided again; with nothing decided there is nothing to undo.
        decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT)?;
        assert!(matches!(
            decide(c, "f2", &FindingDecision::Undo, SUBJECT),
            Err(DecisionError::NothingToUndo(_))
        ));
        Ok(())
    });
}

#[test]
fn f09_2_undo_of_a_published_draft_is_refused() {
    with(|c| {
        let draft = decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT)?
            .draft
            .unwrap();
        c.execute(
            "UPDATE drafts SET published_note_id = 9 WHERE id = ?1",
            [&draft.id],
        )?;
        assert!(matches!(
            decide(c, "f1", &FindingDecision::Undo, SUBJECT),
            Err(DecisionError::Draft(DraftError::Published(_)))
        ));
        // The transaction rolled back: the note keeps its decision.
        assert_eq!(decision_of(c, "f1"), Decision::Draft);
        Ok(())
    });
}

#[test]
fn f09_4_dismiss_stores_the_fingerprint_and_kind_and_undo_removes_it() {
    with(|c| {
        let out = decide(c, "f1", &FindingDecision::Dismiss, SUBJECT)?;
        assert_eq!(out.finding.decision, Decision::Dismissed);
        assert!(drafts::list(c, "r1")?.is_empty());
        let row: (String, String, String, String) = c.query_row(
            "SELECT fingerprint, kind, mr, file FROM dismissals",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        assert_eq!(
            row,
            (
                "aaaa".into(),
                "unawaited-task".into(),
                SUBJECT.into(),
                VM.into()
            )
        );
        assert_eq!(
            dismissed(c, SUBJECT)?,
            [Dismissal {
                fingerprint: "aaaa".into(),
                kind: "unawaited-task".into()
            }]
        );
        assert!(dismissed(c, "mr:7")?.is_empty(), "per merge request");

        decide(c, "f1", &FindingDecision::Undo, SUBJECT)?;
        assert!(dismissed(c, SUBJECT)?.is_empty());
        assert_eq!(decision_of(c, "f1"), Decision::Open);
        Ok(())
    });
}

#[test]
fn f09_2_decisions_survive_a_new_run_of_the_step() {
    with(|c| {
        decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT)?;
        // The same note again (cache hit or a new run) plus a new one.
        let again = record(
            c,
            "r1",
            &analysis(vec![finding("f1", "aaaa"), finding("f3", "cccc")]),
        )?;
        let decisions: Vec<_> = again.iter().map(|f| (f.id.as_str(), f.decision)).collect();
        assert_eq!(decisions, [("f1", Decision::Draft), ("f3", Decision::Open)]);
        assert!(matches!(
            decide(c, "nope", &FindingDecision::Dismiss, SUBJECT),
            Err(DecisionError::NotFound(_))
        ));
        Ok(())
    });
}

#[test]
fn f04_3_dismissed_notes_of_a_step_are_kept_for_the_session() {
    with(|c| {
        decide(c, "f2", &FindingDecision::Dismiss, SUBJECT)?;
        decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT)?;
        let notes = dismissed_notes(c, "r1", "s1")?;
        assert_eq!(
            notes
                .iter()
                .map(|f| (f.id.as_str(), f.decision))
                .collect::<Vec<_>>(),
            [("f2", Decision::Dismissed)]
        );
        assert_eq!(notes[0].fingerprint, "bbbb");
        // Another session or step has none; an undone dismissal is gone.
        assert!(dismissed_notes(c, "r2", "s1")?.is_empty());
        assert!(dismissed_notes(c, "r1", "s2")?.is_empty());
        decide(c, "f2", &FindingDecision::Undo, SUBJECT)?;
        assert!(dismissed_notes(c, "r1", "s1")?.is_empty());
        Ok(())
    });
}
