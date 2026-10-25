//! A "drafts only" session is listed under "Pick up where you left off" while it holds an
//! unpublished draft (F-12.7, M5 decision 15): the card shows the draft count only and Continue
//! opens S-05. Synthetic data only.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::mr_drafts;

use guided_review_lib::review::drafts;
use guided_review_lib::review::model::SessionStatus;
use guided_review_lib::route::Route;
use guided_review_lib::source::Source;
use guided_review_lib::store::{self, Store};
use mr_drafts::*;

#[test]
fn f12_7_a_drafts_only_session_is_listed_for_pick_up_while_it_holds_unpublished_drafts() {
    let (store, repo) = store_with_repo();
    let at = (&store, repo);
    // A done session of the same MR and a drafts-only session without drafts stay out.
    seed(
        at,
        "done",
        mr_json(PROJECT, 482),
        SessionStatus::Done,
        ("2026-10-01T08:00:00Z", "2026-10-01T09:00:00Z"),
    );
    seed(
        at,
        "empty",
        mr_json(PROJECT, 484),
        SessionStatus::DraftsOnly,
        ("2026-10-02T08:00:00Z", "2026-10-02T09:00:00Z"),
    );
    // The drafts-only session of !483: made from a draft, then a second one.
    let one = attach(&store, PROJECT, 483, "Is this flaky?");
    attach(&store, PROJECT, 483, "Was it green before?");

    let listed = store.with_conn(|c| store::unfinished_sessions(c)).unwrap();

    assert_eq!(listed.len(), 1, "{listed:?}");
    let card = &listed[0];
    assert_eq!(card.id, one.session_id);
    assert_eq!(card.status, SessionStatus::DraftsOnly);
    assert_eq!(
        card.source,
        Source::Mr {
            project: PROJECT.into(),
            iid: 483
        }
    );
    assert_eq!(card.title, PROJECT, "no MR title is known, so the project");
    assert_eq!(card.drafts, 2, "the card shows the draft count");
    assert_eq!(
        (card.reviewed_steps, card.total_steps),
        (0, 0),
        "there are no steps"
    );
    assert_eq!(
        card.resume,
        Route::Summary {
            session_id: one.session_id.clone()
        },
        "Continue opens S-05, whatever screen was open last"
    );
}

#[test]
fn f12_7_a_drafts_only_session_leaves_pick_up_once_its_drafts_are_published_or_deleted() {
    let (store, _) = store_with_repo();
    let published = attach(&store, PROJECT, 482, "Will be published.");
    let deleted = attach(&store, PROJECT, 483, "Will be deleted.");
    let kept = attach(&store, PROJECT, 484, "Stays.");
    let ids = |store: &Store| -> Vec<String> {
        store
            .with_conn(|c| store::unfinished_sessions(c))
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect()
    };
    assert_eq!(ids(&store).len(), 3);

    store
        .with_conn(|c| {
            // What Publish records on a draft (`published_note_id`); the GitLab call is not needed.
            c.execute(
                "UPDATE drafts SET published_note_id = 9001 WHERE id = ?1",
                [&published.id],
            )?;
            Ok(())
        })
        .unwrap();
    store
        .with_conn(|c| Ok(drafts::delete(c, &deleted.id)))
        .unwrap()
        .unwrap();

    assert_eq!(ids(&store), [kept.session_id]);
}
