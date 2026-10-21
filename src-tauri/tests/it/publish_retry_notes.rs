//! Publish after a failed attempt (F-12.5, M5 decision 9) against wiremock: a GitLab draft note the
//! app made is reused only while it still says what goes out. A draft or summary edited since, an
//! unticked draft and an unticked summary have their note deleted (`DELETE …/draft_notes/:id`)
//! before the one `bulk_publish`, because GitLab publishes every pending note of the user; a
//! published summary is never sent again. Synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::draft_notes::DiffRefs;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::drafts::{self, DraftPatch, NewDraft};
use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::review::publish::{self, PublishOutcome, PublishRequest};
use guided_review_lib::review::step_context::MrRef;
use guided_review_lib::store::sessions::{self, NewSession};
use guided_review_lib::store::{Store, repos};
use serde_json::{Value, json};
use wiremock::matchers::{method, path, path_regex};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const PROJECT: &str = "sandbox/gr-sandbox";
const MR: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/6";
const SESSION: &str = "mr-6";

fn store() -> Store {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            let repo = repos::add(c, "mobile ąę", r"C:\src\mobile ąę", Some(PROJECT)).unwrap();
            sessions::insert(
                c,
                &NewSession {
                    id: SESSION.into(),
                    repo_id: repo.id,
                    source_json: format!(r#"{{"kind":"mr","project":"{PROJECT}","iid":6}}"#),
                    base_sha: "b0b0b0".into(),
                    head_sha: "4ead4e".into(),
                    mode: Mode::Focus,
                    layout: Layout::A,
                    status: SessionStatus::Reviewing,
                    worktree: None,
                    mr_json: None,
                },
            )
            .unwrap();
            Ok(())
        })
        .unwrap();
    store
}

/// A comment on the MR (no position, so no diff is needed); returns its id.
fn draft(store: &Store, body: &str) -> String {
    store
        .with_conn(|c| {
            let new = NewDraft {
                session_id: SESSION.into(),
                finding_id: None,
                body: body.into(),
                position: None,
                severity: None,
            };
            Ok(drafts::create(c, &new).unwrap().id)
        })
        .unwrap()
}

fn edit(store: &Store, id: &str, body: &str) {
    let patch = DraftPatch {
        body: Some(body.into()),
        include: None,
    };
    store
        .with_conn(|c| Ok(drafts::update(c, id, &patch).unwrap()))
        .unwrap();
}

fn published_at(store: &Store, id: &str) -> Option<String> {
    store
        .with_conn(|c| {
            Ok(
                c.query_row("SELECT published_at FROM drafts WHERE id = ?1", [id], |r| {
                    r.get(0)
                })?,
            )
        })
        .unwrap()
}

/// GitLab's create: numbers the notes from 500; a note whose text is `refuse` gets a 422.
#[derive(Clone)]
struct Notes(Arc<AtomicU64>, Option<&'static str>);

impl Respond for Notes {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
        let note = body["note"].as_str().unwrap_or_default().to_owned();
        if self.1 == Some(note.as_str()) {
            return ResponseTemplate::new(422)
                .set_body_json(json!({ "message": "Note is too long" }));
        }
        let id = self.0.fetch_add(1, Ordering::SeqCst);
        ResponseTemplate::new(201).set_body_json(json!({ "id": id, "note": note }))
    }
}

/// A server whose first `bulk_publish` fails with 500 and later ones succeed; deletes answer
/// `delete_status`.
async fn server(delete_status: u16, refuse: Option<&'static str>) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes")))
        .respond_with(Notes(Arc::new(AtomicU64::new(500)), refuse))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes/bulk_publish")))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "message": "500" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes/bulk_publish")))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path_regex(format!(r"^{MR}/draft_notes/\d+$")))
        .respond_with(ResponseTemplate::new(delete_status))
        .mount(&server)
        .await;
    server
}

async fn publish(
    server: &MockServer,
    store: &Store,
    ids: &[String],
    summary: Option<&str>,
) -> PublishOutcome {
    let client = GitlabClient::new(
        &server.uri(),
        &Token::new("glpat-wiremock0000000").unwrap(),
        TlsBackend::Platform,
    )
    .unwrap();
    let refs = DiffRefs {
        base_sha: "b0b0b0".into(),
        start_sha: "5ab5ab".into(),
        head_sha: "4ead4e".into(),
    };
    let mr = MrRef {
        project: PROJECT.into(),
        iid: 6,
    };
    let request = PublishRequest {
        client: &client,
        store,
        session: SESSION,
        mr: &mr,
        refs: &refs,
        files: &[],
        ids,
        summary,
    };
    publish::run(&request).await.unwrap()
}

/// `(method, path below the MR)` of every request, and the texts created, in order.
async fn requests(server: &MockServer) -> (Vec<(String, String)>, Vec<String>) {
    let all = server.received_requests().await.unwrap();
    let seen = all
        .iter()
        .map(|r| (r.method.to_string(), r.url.path().replacen(MR, "", 1)))
        .collect();
    let created = all
        .iter()
        .filter(|r| r.method.as_str() == "POST" && r.url.path() == format!("{MR}/draft_notes"))
        .map(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["note"].as_str().unwrap().to_owned()
        })
        .collect();
    (seen, created)
}

fn deletes(seen: &[(String, String)]) -> Vec<&str> {
    seen.iter()
        .filter(|(m, _)| m == "DELETE")
        .map(|(_, p)| p.as_str())
        .collect()
}

#[tokio::test]
async fn f12_5_a_draft_edited_after_a_failed_batch_goes_out_with_its_new_text() {
    let server = server(204, None).await;
    let store = store();
    let id = draft(&store, "Old text");
    let ids = [id.clone()];
    let first = publish(&server, &store, &ids, None).await;
    assert_eq!(first.failed.len(), 1);

    edit(&store, &id, "New text");
    let retry = publish(&server, &store, &ids, None).await;

    assert_eq!(retry.published, ids);
    let (seen, created) = requests(&server).await;
    assert_eq!(created, ["Old text", "New text"]);
    assert_eq!(
        deletes(&seen),
        ["/draft_notes/500"],
        "the old note is deleted"
    );
    let delete_at = seen.iter().position(|(m, _)| m == "DELETE").unwrap();
    let last_batch = seen.iter().rposition(|(_, p)| p.ends_with("bulk_publish"));
    assert!(last_batch.unwrap() > delete_at, "deleted before the batch");
}

#[tokio::test]
async fn f12_5_a_draft_unticked_after_a_failed_batch_is_not_published() {
    let server = server(204, None).await;
    let store = store();
    let (kept, unticked) = (draft(&store, "Kept"), draft(&store, "Unticked"));
    publish(&server, &store, &[kept.clone(), unticked.clone()], None).await;

    let retry = publish(&server, &store, std::slice::from_ref(&kept), None).await;

    assert_eq!(retry.published, std::slice::from_ref(&kept));
    assert_eq!(published_at(&store, &unticked), None);
    let (seen, created) = requests(&server).await;
    assert_eq!(created, ["Kept", "Unticked"], "nothing made twice");
    assert_eq!(deletes(&seen), ["/draft_notes/501"]);
    // Ticked again later, it gets a new note.
    let later = publish(&server, &store, std::slice::from_ref(&unticked), None).await;
    assert_eq!(later.published, [unticked]);
    assert_eq!(requests(&server).await.1.last().unwrap(), "Unticked");
}

#[tokio::test]
async fn f12_5_a_summary_edited_or_unticked_after_a_failed_batch_is_not_sent_as_it_was() {
    let server = server(204, None).await;
    let store = store();
    let id = draft(&store, "Comment");
    let ids = [id.clone()];
    publish(&server, &store, &ids, Some("Old summary")).await;

    // Edited: the old note goes, the new text is made.
    let retry = publish(&server, &store, &ids, Some("New summary")).await;
    assert!(retry.summary);
    let (seen, created) = requests(&server).await;
    assert_eq!(created, ["Comment", "Old summary", "New summary"]);
    assert_eq!(deletes(&seen), ["/draft_notes/501"]);
}

#[tokio::test]
async fn f12_5_a_summary_unticked_after_a_failed_batch_has_its_note_deleted() {
    let server = server(204, None).await;
    let store = store();
    let id = draft(&store, "Comment");
    let ids = [id.clone()];
    publish(&server, &store, &ids, Some("Summary")).await;

    let retry = publish(&server, &store, &ids, None).await;
    assert!(!retry.summary);
    assert_eq!(retry.published, ids);
    assert_eq!(deletes(&requests(&server).await.0), ["/draft_notes/501"]);
}

#[tokio::test]
async fn f12_5_a_note_that_can_not_be_deleted_stops_the_batch() {
    let server = server(500, None).await;
    let store = store();
    let id = draft(&store, "Old text");
    let ids = [id.clone()];
    publish(&server, &store, &ids, None).await;
    edit(&store, &id, "New text");

    let retry = publish(&server, &store, &ids, None).await;

    assert!(retry.published.is_empty());
    assert_eq!(retry.failed.len(), 1);
    let (seen, created) = requests(&server).await;
    let batches = seen.iter().filter(|(_, p)| p.ends_with("bulk_publish"));
    assert_eq!(batches.count(), 1, "only the first, failed batch");
    assert_eq!(created, ["Old text"]);
    assert_eq!(published_at(&store, &id), None);
}

#[tokio::test]
async fn f12_5_a_published_summary_is_not_sent_again_by_a_later_publish() {
    let server = server(204, None).await;
    let store = store();
    let first = draft(&store, "First");
    // The first batch fails, the retry sends the draft and the summary.
    publish(
        &server,
        &store,
        std::slice::from_ref(&first),
        Some("Summary"),
    )
    .await;
    let sent = publish(
        &server,
        &store,
        std::slice::from_ref(&first),
        Some("Summary"),
    )
    .await;
    assert!(sent.summary);

    // Later (also after a restart) a new draft goes out; the summary text is still in the field.
    let second = draft(&store, "Second");
    let later = publish(
        &server,
        &store,
        std::slice::from_ref(&second),
        Some("Summary"),
    )
    .await;

    assert_eq!(later.published, [second]);
    assert!(!later.summary);
    let (_, created) = requests(&server).await;
    assert_eq!(created, ["First", "Summary", "Second"]);
}

#[tokio::test]
async fn f12_5_a_summary_gitlab_refuses_is_reported_with_its_reason_and_the_drafts_still_go_out() {
    let server = server(204, Some("Summary")).await;
    let store = store();
    let id = draft(&store, "Comment");
    let ids = [id.clone()];
    // The first batch fails (500): the draft and the summary both carry that failure.
    let first = publish(&server, &store, &ids, Some("Summary")).await;
    assert_eq!(first.summary_failed.as_deref(), Some("Note is too long"));

    let retry = publish(&server, &store, &ids, Some("Summary")).await;
    assert_eq!(retry.published, ids);
    assert!(!retry.summary);
    assert_eq!(retry.summary_failed.as_deref(), Some("Note is too long"));
    assert!(retry.failed.is_empty());
    let json = serde_json::to_value(&retry).unwrap();
    assert_eq!(json["summaryFailed"], "Note is too long");
    // Nothing failed: the outcome carries no summaryFailed key at all.
    let empty = serde_json::to_value(publish(&server, &store, &[], None).await).unwrap();
    assert!(empty.get("summaryFailed").is_none(), "{empty}");
}

#[tokio::test]
async fn f12_5_a_failed_batch_fails_the_summary_too_and_a_summary_alone_can_be_published() {
    let server = server(204, None).await;
    let store = store();
    let failed = publish(&server, &store, &[], Some("Summary only")).await;
    assert!(!failed.summary);
    assert_eq!(failed.summary_failed.as_deref(), Some("500"));

    let retry = publish(&server, &store, &[], Some("Summary only")).await;
    assert!(retry.summary && retry.summary_failed.is_none());
    assert_eq!(
        requests(&server).await.1,
        ["Summary only"],
        "the note is reused"
    );
}
