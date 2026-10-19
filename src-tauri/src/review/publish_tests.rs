#![allow(clippy::unwrap_used, reason = "tests")]
use super::*;
use crate::gitlab::error::NetworkProblem;
use crate::review::drafts;

#[test]
fn f12_5_reasons_are_in_plain_words() {
    let status = |status: u16, message: Option<&str>| GitlabError::Status {
        status,
        message: message.map(str::to_owned),
    };
    assert_eq!(
        reason(&status(
            400,
            Some("400 Bad request - Note {:line_code=>[\"can't be blank\"]}")
        )),
        LINE_GONE
    );
    assert_eq!(
        reason(&status(400, Some("Position is incomplete"))),
        LINE_GONE
    );
    assert_eq!(
        reason(&status(400, Some("note is too long"))),
        "note is too long"
    );
    assert_eq!(
        reason(&status(422, Some("Merge request is locked"))),
        "Merge request is locked"
    );
    assert_eq!(reason(&status(502, None)), "GitLab answered 502");
    for refused in [
        GitlabError::Unauthorized,
        GitlabError::TokenExpired,
        GitlabError::TokenRevoked,
    ] {
        assert_eq!(reason(&refused), REFUSED);
        assert!(stops_the_run(&refused));
    }
    let unreachable = GitlabError::Unreachable(NetworkProblem::Refused);
    assert_eq!(reason(&unreachable), UNREACHABLE);
    assert!(stops_the_run(&unreachable));
    assert!(!stops_the_run(&status(400, None)));
    assert_eq!(
        reason(&GitlabError::Forbidden {
            message: Some("403 Forbidden".into())
        }),
        "403 Forbidden"
    );
}

#[test]
fn f12_5_mark_published_takes_only_drafts_with_a_note_not_yet_published() {
    use crate::review::drafts::NewDraft;
    use crate::store::sessions::insert_for_test;
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            insert_for_test(c, "s1", "reviewing", "focus", "2026-10-17T08:00:00Z");
            let new = |body: &str| NewDraft {
                session_id: "s1".into(),
                finding_id: None,
                body: body.into(),
                position: None,
                severity: None,
            };
            let made = drafts::create(c, &new("made")).unwrap().id;
            let local = drafts::create(c, &new("local")).unwrap().id;
            remember_note(c, &made, 77, "made", None)?;
            remember_failure(c, &local, LINE_GONE)?;
            assert_eq!(mark_published(c, "s1")?, std::slice::from_ref(&made));
            assert_eq!(mark_published(c, "s1")?, Vec::<String>::new());
            let listed = drafts::list(c, "s1").unwrap();
            let by = |id: &str| listed.iter().find(|d| d.id == id).unwrap();
            assert_eq!(by(&made).published_note_id, Some(77));
            assert_eq!(by(&local).published_note_id, None);
            assert_eq!(by(&local).error.as_deref(), Some(LINE_GONE));
            Ok(())
        })
        .unwrap();
}
