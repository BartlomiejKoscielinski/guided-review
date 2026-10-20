//! Unit tests of the summary comment's inputs and result (F-12.4); the run against the fake
//! `claude` is in `tests/it/summary_task.rs`. Synthetic data only (ADR-019).

use serde_json::json;

use super::*;
use crate::review::finding_model::Side;
use crate::review::position::DiffPosition;

fn draft(id: &str, body: &str, line: Option<u32>) -> Draft {
    Draft {
        id: id.into(),
        session_id: "mr-482".into(),
        finding_id: None,
        body: body.into(),
        position: line.map(|line| DiffPosition {
            file: "src/Zażółć/Upload Queue.cs".into(),
            side: Side::New,
            line,
        }),
        severity: None,
        include: true,
        published_note_id: None,
        error: None,
        step_id: None,
        outdated: false,
    }
}

#[test]
fn f12_4_drafts_file_numbers_the_drafts_going_out_with_their_place() {
    let mut unticked = draft("d3", "Not this one.", None);
    unticked.include = false;
    let mut published = draft("d4", "Nor this one.", None);
    published.published_note_id = Some(9);
    let drafts = [
        draft("d1", "Await it.\nIt drops errors.", Some(12)),
        unticked,
        published,
        draft("d2", "Add a test.", None),
    ];
    assert_eq!(
        drafts_file(&drafts),
        "Draft 1 · src/Zażółć/Upload Queue.cs:12\n    Await it.\n    It drops errors.\n\
         Draft 2 · on the merge request\n    Add a test.\n"
    );
    // Nothing goes out with the summary: "none", like the other task inputs.
    assert_eq!(drafts_file(&drafts[1..3]), "none\n");
    assert_eq!(drafts_file(&[]), "none\n");
}

#[test]
fn f12_4_summary_of_trims_clamps_and_rejects_what_is_not_a_summary() {
    assert_eq!(
        summary_of(&json!({ "summary": "  Thanks.  \n" })).unwrap(),
        "Thanks."
    );
    let long = format!("{} tail", "a".repeat(SUMMARY_MAX));
    let clamped = summary_of(&json!({ "summary": long })).unwrap();
    assert_eq!(clamped.chars().count(), SUMMARY_MAX);
    assert!(clamped.ends_with('…'));
    for wrong in [
        json!({ "summary": 5 }),
        json!({ "summary": "   " }),
        json!({ "text": "x" }),
        json!("x"),
    ] {
        assert!(
            matches!(summary_of(&wrong), Err(ClaudeError::Schema(_))),
            "{wrong}"
        );
    }
}
