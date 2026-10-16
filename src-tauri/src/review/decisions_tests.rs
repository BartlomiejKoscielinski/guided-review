use super::*;
use crate::review::finding_model::{Evidence, Severity, Side};
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
fn f09_2_undo_of_edit_and_add_deletes_only_its_own_draft() {
    with(|c| {
        decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT)?;
        let edit = FindingDecision::EditAndAdd {
            body: "Please await `Enqueue`.".into(),
        };
        let edited = decide(c, "f2", &edit, SUBJECT)?.draft.unwrap();
        assert_eq!(drafts::list(c, "r1")?.len(), 2);

        let out = decide(c, "f2", &FindingDecision::Undo, SUBJECT)?;
        assert_eq!(out.finding.decision, Decision::Open);
        assert!(out.draft.is_none());
        let left = drafts::list(c, "r1")?;
        assert_eq!(left.len(), 1, "the other note keeps its draft");
        assert_eq!(left[0].finding_id.as_deref(), Some("f1"));
        assert_ne!(left[0].id, edited.id);
        assert_eq!(decision_of(c, "f1"), Decision::Draft);
        assert_eq!(decision_of(c, "f2"), Decision::Open);

        // Undone, the note takes Edit and add again, with the new text.
        let again = FindingDecision::EditAndAdd {
            body: "Second try.".into(),
        };
        assert_eq!(
            decide(c, "f2", &again, SUBJECT)?.draft.unwrap().body,
            "Second try."
        );
        Ok(())
    });
}

#[test]
fn f09_2_edit_and_add_with_blank_text_is_refused_and_the_note_stays_open() {
    with(|c| {
        for body in ["", "  \n\t "] {
            let edit = FindingDecision::EditAndAdd { body: body.into() };
            assert!(matches!(
                decide(c, "f1", &edit, SUBJECT),
                Err(DecisionError::Draft(DraftError::EmptyBody))
            ));
        }
        assert_eq!(decision_of(c, "f1"), Decision::Open);
        assert!(drafts::list(c, "r1")?.is_empty());
        // Nothing was half done: the note still takes any decision.
        decide(c, "f1", &FindingDecision::Dismiss, SUBJECT)?;
        assert_eq!(decision_of(c, "f1"), Decision::Dismissed);
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

#[test]
fn f09_1_a_stored_note_keeps_every_field_through_a_decision() {
    // Every field set, including the old side and the evidence list the other fixtures leave empty.
    let full = Finding {
        severity: Severity::Fix,
        side: Side::Old,
        line: 7,
        evidence: vec![
            Evidence {
                file: "src/Core/IClient.cs".into(),
                line: 12,
                note: "the overload".into(),
            },
            Evidence {
                file: VM.into(),
                line: 7,
                note: "the removed call".into(),
            },
        ],
        ..finding("f9", "9999")
    };
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            record(c, "r1", &analysis(vec![full.clone()])).unwrap();
            let out = decide(c, "f9", &FindingDecision::Dismiss, SUBJECT).unwrap();
            assert_eq!(
                out.finding,
                Finding {
                    decision: Decision::Dismissed,
                    ..full.clone()
                }
            );
            let kept = dismissed_notes(c, "r1", "s1").unwrap();
            assert_eq!(kept.len(), 1);
            assert_eq!(kept[0].evidence, full.evidence);
            assert_eq!(kept[0].suggested_comment, full.suggested_comment);
            // Add to drafts on the old side keeps the side and the line in the draft's position.
            decide(c, "f9", &FindingDecision::Undo, SUBJECT).unwrap();
            let added = decide(c, "f9", &FindingDecision::AddToDrafts, SUBJECT).unwrap();
            assert_eq!(
                added.draft.unwrap().position,
                Some(DiffPosition {
                    file: VM.into(),
                    side: Side::Old,
                    line: 7
                })
            );
            Ok(())
        })
        .unwrap();
}

const COMMIT: &str = "commit:abc1234";

#[test]
fn f09_4_a_dismissal_stays_in_its_own_review_and_its_undo_cannot_reach_another() {
    with(|c| {
        // The MR review (session r1) dismisses its note.
        let here = record(c, "r1", &analysis(vec![finding("f1", "aaaa")]))?;
        decide(c, &here[0].id, &FindingDecision::Dismiss, SUBJECT)?;
        // A commit review (session c1) raises the same note: same step, position and code, so
        // the same id and fingerprint.
        let there = record(c, "c1", &analysis(vec![finding("f1", "aaaa")]))?;
        assert_eq!(
            there[0].decision,
            Decision::Open,
            "a dismissal elsewhere is not a decision on this review's note"
        );
        // Dismissing it there records a dismissal for the commit and leaves the MR's alone.
        decide(c, &there[0].id, &FindingDecision::Dismiss, COMMIT)?;
        assert_eq!(dismissed(c, COMMIT)?.len(), 1);
        assert_eq!(dismissed(c, SUBJECT)?.len(), 1);
        // Undoing it there takes back only the commit's dismissal.
        decide(c, &there[0].id, &FindingDecision::Undo, COMMIT)?;
        assert!(dismissed(c, COMMIT)?.is_empty());
        assert_eq!(
            dismissed(c, SUBJECT)?,
            [Dismissal {
                fingerprint: "aaaa".into(),
                kind: "unawaited-task".into()
            }],
            "the MR still does not see the note again"
        );
        Ok(())
    });
}

#[test]
fn f09_4_undoing_one_note_keeps_the_dismissal_of_another_note_with_the_same_fingerprint() {
    with(|c| {
        // The same kind on the same code twice in one file (identical line and neighbours).
        record(
            c,
            "r1",
            &analysis(vec![finding("f1", "aaaa"), finding("f3", "aaaa")]),
        )?;
        decide(c, "f1", &FindingDecision::Dismiss, SUBJECT)?;
        decide(c, "f3", &FindingDecision::Dismiss, SUBJECT)?;
        decide(c, "f1", &FindingDecision::Undo, SUBJECT)?;
        // f3 still shows as dismissed, so its fingerprint must still be kept out of the next run.
        assert_eq!(decision_of(c, "f3"), Decision::Dismissed);
        assert_eq!(
            dismissed(c, SUBJECT)?,
            [Dismissal {
                fingerprint: "aaaa".into(),
                kind: "unawaited-task".into()
            }]
        );
        decide(c, "f3", &FindingDecision::Undo, SUBJECT)?;
        assert!(dismissed(c, SUBJECT)?.is_empty());
        Ok(())
    });
}

#[test]
fn f09_4_dismissals_keep_kind_review_file_and_time_for_the_rule_suggestions() {
    with(|c| {
        // F-29.2 counts dismissals of one kind across reviews: two in the MR, one in a commit.
        record(c, "c1", &analysis(vec![finding("f9", "cccc")]))?;
        decide(c, "f1", &FindingDecision::Dismiss, SUBJECT)?;
        decide(c, "f2", &FindingDecision::Dismiss, SUBJECT)?;
        decide(c, "f9", &FindingDecision::Dismiss, COMMIT)?;
        let count = |c: &Connection| -> rusqlite::Result<(i64, i64)> {
            c.query_row(
                "SELECT COUNT(*), COUNT(DISTINCT mr) FROM dismissals WHERE kind = 'unawaited-task'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
        };
        assert_eq!(count(c)?, (3, 2));
        let rows: Vec<(String, String, String)> = c
            .prepare("SELECT mr, file, created_at FROM dismissals ORDER BY rowid")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?;
        let reviews: Vec<&str> = rows.iter().map(|(mr, _, _)| mr.as_str()).collect();
        assert_eq!(reviews, [SUBJECT, SUBJECT, COMMIT]);
        for (_, file, at) in &rows {
            assert_eq!(file, VM);
            // "2026-10-15T06:23:45.123Z": a UTC time, so "N times in 3 weeks" can be told.
            let b = at.as_bytes();
            assert!(
                at.len() == 24 && b[10] == b'T' && at.ends_with('Z') && at.starts_with("20"),
                "{at}"
            );
        }
        // An undone dismissal no longer counts.
        decide(c, "f9", &FindingDecision::Undo, COMMIT)?;
        assert_eq!(count(c)?, (2, 1));
        Ok(())
    });
}

// F-08.3: the rail counts drafts per step (`Draft.stepId`); a draft made from a note belongs to
// the note's step, through every path that makes one and through the read path.
#[test]
fn f08_3_a_draft_from_a_note_belongs_to_the_notes_step() {
    with(|c| {
        record(
            c,
            "r1",
            &StepAnalysis {
                step_id: "s2".into(),
                ..analysis(vec![Finding {
                    step_id: "s2".into(),
                    line: 9,
                    ..finding("f3", "cccc")
                }])
            },
        )?;
        let added = decide(c, "f1", &FindingDecision::AddToDrafts, SUBJECT)?
            .draft
            .unwrap();
        assert_eq!(added.step_id.as_deref(), Some("s1"));
        // Edit and add, or a draft the UI makes with the note's ID.
        let edited = drafts::create(
            c,
            &NewDraft {
                session_id: "r1".into(),
                finding_id: Some("f3".into()),
                body: "Is the queue flushed here?".into(),
                position: None,
                severity: Some(Severity::Q),
            },
        )?;
        assert_eq!(edited.step_id.as_deref(), Some("s2"));
        // A comment on the merge request belongs to no step.
        let general = drafts::create(
            c,
            &NewDraft {
                session_id: "r1".into(),
                finding_id: None,
                body: "Looks good overall.".into(),
                position: None,
                severity: None,
            },
        )?;
        assert_eq!(general.step_id, None);
        let steps: Vec<Option<String>> = drafts::list(c, "r1")?
            .into_iter()
            .map(|d| d.step_id)
            .collect();
        assert_eq!(steps, [Some("s1".to_owned()), Some("s2".to_owned()), None]);
        Ok(())
    });
}
