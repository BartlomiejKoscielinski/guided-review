//! Drafts belong to the MR, project + iid (F-12.7, M5 decision 15). A draft added outside a review
//! (Explain failure on S-08, Add as a question on S-12) joins the latest session of its MR or
//! creates a "drafts only" session that S-05 opens and "Pick up where you left off" lists. The
//! list under "Pick up" is in `drafts_of_the_mr_pick_up.rs`, the move of drafts into a newly opened
//! review in `drafts_of_the_mr_review.rs`. Synthetic data.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/mr_drafts.rs"]
mod mr_drafts;

use guided_review_lib::review::drafts::{DraftError, NewMrDraft};
use guided_review_lib::review::finding_model::{Severity, Side};
use guided_review_lib::review::model::SessionStatus;
use guided_review_lib::review::position::DiffPosition;
use guided_review_lib::source::Source;
use guided_review_lib::store::sessions;
use mr_drafts::*;

#[test]
fn f12_7_a_draft_outside_a_review_joins_the_latest_session_of_its_mr() {
    let (store, repo) = store_with_repo();
    let at = (&store, repo);
    seed(
        at,
        "a-old",
        mr_json(PROJECT, 482),
        SessionStatus::Reviewing,
        ("2026-10-10T08:00:00Z", "2026-10-10T09:00:00Z"),
    );
    seed(
        at,
        "b-latest",
        mr_json(PROJECT, 482),
        SessionStatus::Planning,
        ("2026-10-12T08:00:00Z", "2026-10-12T09:00:00Z"),
    );
    // Newer than both, but another MR: another iid, another project with the same iid, no MR.
    seed(
        at,
        "c-other-iid",
        mr_json(PROJECT, 483),
        SessionStatus::Reviewing,
        ("2026-10-14T08:00:00Z", "2026-10-14T09:00:00Z"),
    );
    seed(
        at,
        "d-other-project",
        mr_json(OTHER_PROJECT, 482),
        SessionStatus::Reviewing,
        ("2026-10-15T08:00:00Z", "2026-10-15T09:00:00Z"),
    );
    seed(
        at,
        "e-self-review",
        local_json(),
        SessionStatus::Reviewing,
        ("2026-10-16T08:00:00Z", "2026-10-16T09:00:00Z"),
    );
    let before = session_ids(&store);

    let draft = attach(
        &store,
        PROJECT,
        482,
        "Does anything outside this MR still call `Enqueue`?",
    );

    assert_eq!(draft.session_id, "b-latest");
    assert_eq!(drafts_of(&store, "b-latest"), [draft]);
    for other in ["a-old", "c-other-iid", "d-other-project", "e-self-review"] {
        assert!(drafts_of(&store, other).is_empty(), "{other} got the draft");
    }
    assert_eq!(session_ids(&store), before, "no session is created");
}

#[test]
fn f12_7_the_latest_session_is_the_one_used_last_not_the_one_made_last() {
    // Decision: "latest" follows `updated_at`, the order of "Pick up where you left off" and the
    // Review tile, so a draft lands in the session the user would open next.
    let (store, repo) = store_with_repo();
    let at = (&store, repo);
    seed(
        at,
        "first-made-used-last",
        mr_json(PROJECT, 482),
        SessionStatus::Reviewing,
        ("2026-10-01T08:00:00Z", "2026-10-12T09:00:00Z"),
    );
    seed(
        at,
        "made-last",
        mr_json(PROJECT, 482),
        SessionStatus::Reviewing,
        ("2026-10-10T08:00:00Z", "2026-10-11T09:00:00Z"),
    );

    let draft = attach(&store, PROJECT, 482, "Is the retry limit tested?");

    assert_eq!(draft.session_id, "first-made-used-last");
}

#[test]
fn f12_7_a_done_session_is_not_joined_so_the_draft_is_not_stranded() {
    // Decision: a done session is not listed by "Pick up where you left off" or the Review tile,
    // so a draft put there would never be seen (decision 15: drafts must never be stranded).
    let (store, repo) = store_with_repo();
    let at = (&store, repo);
    seed(
        at,
        "done-newest",
        mr_json(PROJECT, 482),
        SessionStatus::Done,
        ("2026-10-12T08:00:00Z", "2026-10-13T09:00:00Z"),
    );
    seed(
        at,
        "reviewing-older",
        mr_json(PROJECT, 482),
        SessionStatus::Reviewing,
        ("2026-10-10T08:00:00Z", "2026-10-11T09:00:00Z"),
    );
    seed(
        at,
        "done-only",
        mr_json(PROJECT, 490),
        SessionStatus::Done,
        ("2026-10-12T08:00:00Z", "2026-10-13T09:00:00Z"),
    );

    let joined = attach(&store, PROJECT, 482, "Why was this renamed?");
    assert_eq!(joined.session_id, "reviewing-older");

    let alone = attach(&store, PROJECT, 490, "Why was this removed?");
    assert_ne!(alone.session_id, "done-only");
    assert!(drafts_of(&store, "done-only").is_empty());
    assert!(drafts_of(&store, "done-newest").is_empty());
    let source = store
        .with_conn(|c| sessions::source_of(c, &alone.session_id))
        .unwrap()
        .unwrap();
    assert_eq!(source.status, Some(SessionStatus::DraftsOnly));
}

#[test]
fn f12_7_without_a_session_of_the_mr_a_drafts_only_session_is_created() {
    let (store, repo) = store_with_repo();
    let other = ("2026-10-12T08:00:00Z", "2026-10-12T09:00:00Z");
    seed(
        (&store, repo),
        "other-mr",
        mr_json(PROJECT, 483),
        SessionStatus::Reviewing,
        other,
    );
    let position = DiffPosition {
        file: "src/App/Zażółć/Upload ViewModel.cs".into(),
        side: Side::New,
        line: 41,
    };

    let draft = try_attach(
        &store,
        PROJECT,
        482,
        &NewMrDraft {
            body: "Dlaczego zadanie zakończyło się błędem?".into(),
            position: Some(position.clone()),
            severity: Some(Severity::Q),
        },
    )
    .unwrap();

    assert_ne!(draft.session_id, "other-mr");
    assert_eq!(draft.body, "Dlaczego zadanie zakończyło się błędem?");
    assert_eq!(draft.position, Some(position));
    assert_eq!(draft.severity, Some(Severity::Q));
    assert!(draft.include, "ticked for the next Publish");
    assert_eq!(
        (draft.published_note_id, draft.finding_id.clone()),
        (None, None)
    );
    assert_eq!(draft.step_id, None, "no plan, so no step");
    let created = store
        .with_conn(|c| sessions::source_of(c, &draft.session_id))
        .unwrap()
        .expect("the session is stored");
    assert_eq!(created.status, Some(SessionStatus::DraftsOnly));
    assert_eq!(
        serde_json::from_str::<Source>(&created.source_json).unwrap(),
        Source::Mr {
            project: PROJECT.into(),
            iid: 482
        }
    );
    assert_eq!(created.worktree, None, "no worktree");
    assert_eq!(
        count(
            &store,
            "SELECT COUNT(*) FROM plans WHERE session_id = ?1",
            &draft.session_id
        ),
        0,
        "no plan"
    );
    assert_eq!(drafts_of(&store, &draft.session_id), [draft]);
    assert_eq!(session_ids(&store).len(), 2, "one session was added");
}

#[test]
fn f12_7_later_drafts_of_the_mr_join_the_drafts_only_session_and_another_mr_gets_its_own() {
    let (store, _) = store_with_repo();

    let first = attach(
        &store,
        PROJECT,
        482,
        "Why did the build fail on the signing step?",
    );
    let second = attach(
        &store,
        PROJECT,
        482,
        "Is the keystore secret set for this branch?",
    );
    let other_iid = attach(&store, PROJECT, 483, "Is this flaky?");
    let other_project = attach(&store, OTHER_PROJECT, 482, "Same iid, another project.");

    assert_eq!(second.session_id, first.session_id);
    assert_eq!(
        drafts_of(&store, &first.session_id)
            .iter()
            .map(|d| d.body.as_str())
            .collect::<Vec<_>>(),
        [
            "Why did the build fail on the signing step?",
            "Is the keystore secret set for this branch?"
        ],
        "in the order they were made"
    );
    let mut sessions = vec![
        first.session_id.clone(),
        other_iid.session_id.clone(),
        other_project.session_id.clone(),
    ];
    sessions.sort();
    sessions.dedup();
    assert_eq!(sessions.len(), 3, "each MR has its own drafts-only session");
    assert_eq!(session_ids(&store).len(), 3);
}

#[test]
fn f12_7_a_blank_draft_creates_no_session_and_no_draft() {
    let (store, _) = store_with_repo();

    let error = try_attach(&store, PROJECT, 482, &question("  \n ")).unwrap_err();

    assert!(matches!(error, DraftError::EmptyBody), "{error:?}");
    assert!(
        session_ids(&store).is_empty(),
        "no drafts-only session without a draft"
    );
    let remaining: i64 = store
        .with_conn(|c| Ok(c.query_row("SELECT COUNT(*) FROM drafts", [], |row| row.get(0))?))
        .unwrap();
    assert_eq!(remaining, 0);
}
