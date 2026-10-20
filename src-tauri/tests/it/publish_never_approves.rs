//! F-12.6 against wiremock: publishing never approves the MR. A Publish (M5 decisions 8 and 9: the
//! draft notes, the one `bulk_publish`, a Retry, a failed batch) writes draft notes to GitLab and
//! nothing else. GitLab here also answers every endpoint that could approve or revoke, with
//! success, so a stray call would not fail by itself; the requests the server got are what is
//! checked: none touches an approval (REST `approve`, `unapprove`, `approvals`, `approval_state`,
//! or a GraphQL mutation), no body carries an approval, and every write is a `draft_notes` create
//! or the one `bulk_publish`, and the deletes of notes an earlier attempt left. The converse
//! (approving publishes nothing, `f12_6_approve_publishes_nothing`) needs `gitlab/approvals.rs` of
//! F-14.2 and is written with it (docs/plans/M5.md, item 9). The GitLab answers follow the
//! documented shapes (synthetic, ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use std::collections::HashSet;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use guided_review_lib::git::model::{FileDiff, FileStatus, Hunk, Line, LineKind};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::draft_notes::DiffRefs;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::drafts::{self, DraftPatch, NewDraft};
use guided_review_lib::review::finding_model::Side;
use guided_review_lib::review::layer::Layer;
use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::review::position::DiffPosition;
use guided_review_lib::review::publish::{self, PublishRequest};
use guided_review_lib::review::step_context::MrRef;
use guided_review_lib::store::sessions::{self, NewSession};
use guided_review_lib::store::{Store, repos};
use serde_json::{Value, json};
use wiremock::matchers::{method, path, path_regex};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const MR: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/6";
const SESSION: &str = "mr-6";
const FILE: &str = "src/Mobile.App/Zażółć gęślą/UploadWorker.cs";

fn client(uri: &str) -> GitlabClient {
    GitlabClient::new(uri, &Token::new(TOKEN).unwrap(), TlsBackend::Platform).unwrap()
}

fn refs() -> DiffRefs {
    DiffRefs {
        base_sha: "b0b0b0".into(),
        start_sha: "5ab5ab".into(),
        head_sha: "4ead4e".into(),
    }
}

fn mr() -> MrRef {
    MrRef {
        project: PROJECT.into(),
        iid: 6,
    }
}

/// The diff of the session: one modified file with an added line (new 13).
fn diff() -> Vec<FileDiff> {
    vec![FileDiff {
        old_path: Some(FILE.into()),
        new_path: Some(FILE.into()),
        status: FileStatus::Modified,
        binary: false,
        mode_change: None,
        additions: 0,
        deletions: 0,
        layer: Layer::App,
        hunks: vec![Hunk {
            id: "h1".into(),
            old_start: 10,
            old_lines: 8,
            new_start: 12,
            new_lines: 8,
            header: String::new(),
            lines: vec![Line {
                kind: LineKind::Add,
                old_no: None,
                new_no: Some(13),
                text: "queue.Kick();".into(),
                emphasis: Vec::new(),
                staged: None,
            }],
            file_level: false,
            staged_differs: false,
            mechanical: None,
        }],
        line_staging: true,
    }]
}

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

/// `n` drafts, "Comment 1" … "Comment n": odd ones on the added line, even ones on the MR.
fn drafts_of_the_session(store: &Store, n: usize) -> Vec<String> {
    (1..=n)
        .map(|i| {
            let position = (i % 2 == 1).then(|| DiffPosition {
                file: FILE.into(),
                side: Side::New,
                line: 13,
            });
            store
                .with_conn(|c| {
                    Ok(drafts::create(
                        c,
                        &NewDraft {
                            session_id: SESSION.into(),
                            finding_id: None,
                            body: format!("Comment {i}"),
                            position,
                            severity: None,
                        },
                    )
                    .unwrap()
                    .id)
                })
                .unwrap()
        })
        .collect()
}

/// GitLab's draft notes endpoint: numbers the notes it creates, refuses the ones named in `refuse`.
#[derive(Clone, Default)]
struct DraftNotes(Arc<Notes>);

#[derive(Default)]
struct Notes {
    next: AtomicU64,
    refuse: Mutex<HashSet<String>>,
    /// What `bulk_publish` answers; a test can change it between two runs.
    bulk: AtomicU16,
}

impl DraftNotes {
    fn refuse(&self, note: &str) {
        self.0.refuse.lock().unwrap().insert(note.to_owned());
    }

    fn accept(&self, note: &str) {
        self.0.refuse.lock().unwrap().remove(note);
    }

    fn bulk_answers(&self, status: u16) {
        self.0.bulk.store(status, Ordering::SeqCst);
    }
}

/// `bulk_publish`: 204 when it works, anything else is GitLab failing the batch.
struct Bulk(DraftNotes);

impl Respond for Bulk {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        let status = self.0.0.bulk.load(Ordering::SeqCst);
        ResponseTemplate::new(status)
            .set_body_json(json!({ "message": "500 Internal Server Error" }))
    }
}

impl Respond for DraftNotes {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
        let note = body["note"].as_str().unwrap_or_default().to_owned();
        if self.0.refuse.lock().unwrap().contains(&note) {
            return ResponseTemplate::new(400).set_body_json(json!({
                "message": "400 Bad request - Note {:line_code=>[\"can't be blank\", \"must be a valid line code\"]}"
            }));
        }
        let id = 500 + self.0.next.fetch_add(1, Ordering::SeqCst);
        ResponseTemplate::new(201).set_body_json(json!({
            "id": id, "author_id": 2, "merge_request_id": 60, "note": note,
            "commit_id": null, "line_code": null, "resolve_discussion": false,
            "discussion_id": null, "position": body.get("position").cloned().unwrap_or(Value::Null)
        }))
    }
}

/// A GitLab that takes draft notes and the batch (`bulk_publish` answers `bulk_status`) and also
/// says yes to approving, revoking and reading the approval, over REST and GraphQL.
async fn gitlab(bulk_status: u16) -> (MockServer, DraftNotes) {
    let server = MockServer::start().await;
    let notes = DraftNotes::default();
    notes.bulk_answers(bulk_status);
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes")))
        .respond_with(notes.clone())
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes/bulk_publish")))
        .respond_with(Bulk(notes.clone()))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path_regex(r"/draft_notes/\d+$"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    for approval in ["approve", "unapprove"] {
        Mock::given(method("POST"))
            .and(path(format!("{MR}/{approval}")))
            .respond_with(ResponseTemplate::new(201).set_body_json(json!({
                "id": 60, "iid": 6, "approved_by": [{ "user": { "id": 2, "username": "dev" } }]
            })))
            .mount(&server)
            .await;
    }
    for approval in ["approvals", "approval_state"] {
        Mock::given(method("GET"))
            .and(path(format!("{MR}/{approval}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "approvals_required": 0, "approved_by": [], "user_has_approved": false,
                "user_can_approve": true, "require_password_to_approve": false
            })))
            .mount(&server)
            .await;
    }
    Mock::given(method("POST"))
        .and(path("/api/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": {} })))
        .mount(&server)
        .await;
    (server, notes)
}

async fn received(server: &MockServer) -> Vec<Request> {
    server.received_requests().await.unwrap()
}

fn bulk_publishes(requests: &[Request]) -> usize {
    requests
        .iter()
        .filter(|r| {
            r.method.as_str() == "POST" && r.url.path() == format!("{MR}/draft_notes/bulk_publish")
        })
        .count()
}

/// Nothing the server got approves, revokes or reads an approval, and the only writes are the draft
/// notes and their one batch.
fn assert_never_approved(requests: &[Request]) {
    assert!(!requests.is_empty(), "the publish sent nothing at all");
    for r in requests {
        let target = format!("{} {}", r.method, r.url.path());
        let body = String::from_utf8_lossy(&r.body).to_lowercase();
        assert!(
            !r.url.path().to_lowercase().contains("approv"),
            "{target}: a publish touched the approval"
        );
        assert!(
            !r.url
                .query()
                .unwrap_or_default()
                .to_lowercase()
                .contains("approv"),
            "{target}: the query names an approval"
        );
        assert!(
            !body.contains("approv"),
            "{target}: the body carries an approval: {body}"
        );
        if r.method.as_str() != "GET" {
            let draft_notes = format!("{MR}/draft_notes");
            let bulk = format!("{MR}/draft_notes/bulk_publish");
            let one = r.url.path().strip_prefix(&format!("{draft_notes}/"));
            let create = r.method.as_str() == "POST"
                && (r.url.path() == draft_notes || r.url.path() == bulk);
            let delete =
                r.method.as_str() == "DELETE" && one.is_some_and(|id| id.parse::<u64>().is_ok());
            assert!(
                create || delete,
                "{target}: a publish writes draft notes and nothing else"
            );
        }
    }
}

macro_rules! request {
    ($uri:expr, $store:expr, $files:expr, $ids:expr, $summary:expr) => {
        PublishRequest {
            client: &client($uri),
            store: $store,
            session: SESSION,
            mr: &mr(),
            refs: &refs(),
            files: $files,
            ids: $ids,
            summary: $summary,
        }
    };
}

#[tokio::test]
async fn f12_6_publish_never_approves() {
    let (server, _) = gitlab(204).await;
    let store = store();
    let files = diff();
    let ids = drafts_of_the_session(&store, 5);

    let outcome = publish::run(&request!(
        &server.uri(),
        &store,
        &files,
        &ids,
        Some("Thanks, the queue looks good.")
    ))
    .await
    .unwrap();

    assert_eq!(outcome.published, ids, "the publish itself went through");
    assert!(outcome.summary);
    let requests = received(&server).await;
    assert_eq!(bulk_publishes(&requests), 1);
    assert_never_approved(&requests);
}

#[tokio::test]
async fn f12_6_a_partial_failure_and_its_retry_never_approve() {
    let (server, notes) = gitlab(204).await;
    let store = store();
    let files = diff();
    let ids = drafts_of_the_session(&store, 5);
    notes.refuse("Comment 3");

    let first = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();
    assert_eq!(first.failed.len(), 1, "the first run fails one draft");
    assert_never_approved(&received(&server).await);

    notes.accept("Comment 3");
    let retry = [ids[2].clone()];
    let second = publish::run(&request!(&server.uri(), &store, &files, &retry, None))
        .await
        .unwrap();

    assert_eq!(second.published, retry);
    let requests = received(&server).await;
    assert_eq!(bulk_publishes(&requests), 2, "one batch per run");
    assert_never_approved(&requests);
}

#[tokio::test]
async fn f12_6_a_failed_batch_never_approves_either() {
    let (server, _) = gitlab(500).await;
    let store = store();
    let files = diff();
    let ids = drafts_of_the_session(&store, 3);

    let outcome = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();

    assert!(outcome.published.is_empty(), "GitLab refused the batch");
    assert_eq!(outcome.failed.len(), 3);
    let requests = received(&server).await;
    assert_eq!(bulk_publishes(&requests), 1);
    assert_never_approved(&requests);
}

#[tokio::test]
async fn f12_6_a_retry_that_replaces_the_notes_of_a_failed_batch_never_approves() {
    let (server, notes) = gitlab(500).await;
    let store = store();
    let files = diff();
    let ids = drafts_of_the_session(&store, 2);
    let first = publish::run(&request!(
        &server.uri(),
        &store,
        &files,
        &ids,
        Some("Summary.")
    ))
    .await
    .unwrap();
    assert!(first.published.is_empty(), "GitLab failed the first batch");

    // The notes of the failed batch are still pending in GitLab: after an edit and a new summary
    // the second run deletes them, makes the new ones and sends the batch.
    store
        .with_conn(|c| {
            let patch = DraftPatch {
                body: Some("Comment 1, edited".into()),
                include: None,
            };
            Ok(drafts::update(c, &ids[0], &patch).unwrap())
        })
        .unwrap();
    notes.bulk_answers(204);
    let second = publish::run(&request!(
        &server.uri(),
        &store,
        &files,
        &ids,
        Some("Summary 2.")
    ))
    .await
    .unwrap();

    assert_eq!(second.published, ids);
    let requests = received(&server).await;
    assert!(
        requests.iter().any(|r| r.method.as_str() == "DELETE"),
        "the stale notes were deleted, so this run covers the delete path"
    );
    assert_eq!(bulk_publishes(&requests), 2);
    assert_never_approved(&requests);
}
