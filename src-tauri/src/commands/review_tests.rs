use super::*;
use crate::review::drafts::{self, DraftPatch, NewDraft};
use crate::review::finding_model::{Decision, Finding, Severity, Side};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";

fn finding(id: &str, fingerprint: &str) -> Finding {
    Finding {
        id: id.into(),
        step_id: "s1".into(),
        severity: Severity::Fix,
        kind: "swallowed-cancel".into(),
        title: "Cancelling the camera shows an error".into(),
        body: "catch (Exception) also catches OperationCanceledException.".into(),
        file: VM.into(),
        side: Side::New,
        line: 54,
        evidence: Vec::new(),
        suggested_comment: "Consider a separate catch (OperationCanceledException).".into(),
        fingerprint: fingerprint.into(),
        decision: Decision::Open,
    }
}

/// An MR session `r1` (!482) with two notes, and a commits session `c1` with one.
fn with<T>(f: impl FnOnce(&mut Connection) -> T) -> T {
    let store = Store::open_in_memory().unwrap();
    let mut out = None;
    store
        .with_conn(|c| {
            c.execute(
                "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha) VALUES
                 ('r1', 1, '{\"kind\":\"mr\",\"project\":\"team/app\",\"iid\":482}', 'b', 'h'),
                 ('c1', 1, '{\"kind\":\"commits\",\"to\":\"abc1234\"}', 'b', 'h')",
                [],
            )?;
            let analysis = |ids: &[(&str, &str)]| StepAnalysis {
                step_id: "s1".into(),
                findings: ids.iter().map(|(id, fp)| finding(id, fp)).collect(),
                checklist: Vec::new(),
                files_read: Vec::new(),
                folds: Vec::new(),
            };
            decisions::record(c, "r1", &analysis(&[("f1", "aaaa"), ("f2", "bbbb")])).unwrap();
            decisions::record(c, "c1", &analysis(&[("f9", "cccc")])).unwrap();
            out = Some(f(c));
            Ok(())
        })
        .unwrap();
    out.unwrap()
}

#[test]
fn f09_2_review_decide_dismisses_per_mr_and_undoes() {
    with(|c| {
        let out = decide(c, "f1", &FindingDecision::Dismiss).unwrap();
        assert_eq!(out.finding.decision, Decision::Dismissed);
        let dismissed = decisions::dismissed(c, "mr:482").unwrap();
        assert_eq!(dismissed.len(), 1);
        assert_eq!(dismissed[0].fingerprint, "aaaa");

        let out = decide(c, "f1", &FindingDecision::Undo).unwrap();
        assert_eq!(out.finding.decision, Decision::Open);
        assert!(decisions::dismissed(c, "mr:482").unwrap().is_empty());
    });
}

#[test]
fn f09_2_review_decide_add_to_drafts_and_errors() {
    with(|c| {
        let out = decide(c, "f2", &FindingDecision::AddToDrafts).unwrap();
        let draft = out.draft.unwrap();
        assert_eq!(draft.session_id, "r1");
        assert_eq!(draft.position.unwrap().line, 54);

        let again = decide(c, "f2", &FindingDecision::Dismiss).unwrap_err();
        assert_eq!(again.code, ErrorCode::Conflict);
        let missing = decide(c, "nope", &FindingDecision::Dismiss).unwrap_err();
        assert_eq!(missing.code, ErrorCode::InvalidInput);
    });
}

#[test]
fn f17_1_review_decide_on_commits_dismisses_under_their_own_subject() {
    with(|c| {
        let out = decide(c, "f9", &FindingDecision::Dismiss).unwrap();
        assert_eq!(out.finding.decision, Decision::Dismissed);
        let dismissed = decisions::dismissed(c, "commit:abc1234").unwrap();
        assert_eq!(dismissed.len(), 1);
        assert_eq!(dismissed[0].fingerprint, "cccc");
        assert!(decisions::dismissed(c, "mr:482").unwrap().is_empty());
    });
}

#[test]
fn f09_2_draft_errors_map_to_app_errors() {
    with(|c| {
        let empty = drafts::create(
            c,
            &NewDraft {
                session_id: "r1".into(),
                finding_id: None,
                body: "  ".into(),
                position: None,
                severity: None,
            },
        )
        .map_err(AppError::from)
        .unwrap_err();
        assert_eq!(empty.code, ErrorCode::InvalidInput);
        assert_eq!(empty.message, "Write a comment first.");

        let missing = drafts::update(c, "nope", &DraftPatch::default())
            .map_err(AppError::from)
            .unwrap_err();
        assert_eq!(missing.code, ErrorCode::InvalidInput);
    });
}
