//! Publish (F-12.5, M5 decisions 8 and 9) against wiremock: the selected drafts and the summary
//! comment become GitLab draft notes (`POST …/draft_notes`, one per draft, positions from the
//! session's diff) and then go out in exactly ONE `POST …/draft_notes/bulk_publish`, so the author
//! gets a single notification (docs/05 › Draft note positions; `bulk_publish` takes no `note`
//! parameter, S5). A draft whose create fails stays unpublished with its tick and a reason in plain
//! words; a Retry creates only what is missing and reuses the draft notes already made, so nothing
//! is published twice. The GitLab answers follow the documented shapes (synthetic, ADR-019).
//!
//! The tests pin these names (the plan's `gitlab/draft_notes.rs` and `review/publish.rs`):
//! - `draft_notes::DiffRefs { base_sha, start_sha, head_sha }` (the reviewed version's `diff_refs`),
//!   `draft_notes::list(client, project, iid) -> Vec<DraftNote { id, .. }>` and
//!   `draft_notes::bulk_publish(client, project, iid)`.
//! - `publish::run(&PublishRequest { client, store, session, mr, refs, files, ids, summary })`
//!   returning `PublishOutcome { published: Vec<draft id>, summary: bool, failed: Vec<PublishFailure
//!   { id, reason }> }`; a failure of GitLab (refused, unreachable, 5xx) is a `failed` entry per
//!   draft, never an `Err`.
//! - `publish::foreign_drafts(client, store, session, mr) -> u32` (decision 8): the pending draft
//!   notes of the user on the MR that this app did not create.
//! - Columns of migration 008 on `drafts`: `gitlab_draft_id`, `published_at`, `error`, `include`.
//! Not pinned here: the re-map of positions to a newer MR version (decision 10b).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use guided_review_lib::git::model::{FileDiff, FileStatus, Hunk, Line, LineKind};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::draft_notes::{self, DiffRefs};
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::drafts::{self, NewDraft};
use guided_review_lib::review::finding_model::Side;
use guided_review_lib::review::layer::Layer;
use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::review::position::DiffPosition;
use guided_review_lib::review::publish::{self, PublishRequest};
use guided_review_lib::review::step_context::MrRef;
use guided_review_lib::store::sessions::{self, NewSession};
use guided_review_lib::store::{Store, repos};
use rusqlite::params;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const MR: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/6";
const SESSION: &str = "mr-6";
const FILE: &str = "src/Mobile.App/Zażółć gęślą/UploadWorker.cs";
const RENAMED_FROM: &str = "src/Mobile.App/Old Name ąę.cs";
const RENAMED_TO: &str = "src/Mobile.App/New Name ąę.cs";
const UNREACHABLE: &str = "GitLab is unreachable";
const LINE_GONE: &str = "the line is no longer in the MR";
const REFUSED: &str = "GitLab refused the token";

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

fn line(kind: LineKind, old_no: Option<u32>, new_no: Option<u32>, text: &str) -> Line {
    Line {
        kind,
        old_no,
        new_no,
        text: text.into(),
        emphasis: Vec::new(),
        staged: None,
    }
}

fn hunk(id: &str, old_start: u32, new_start: u32, lines: Vec<Line>) -> Hunk {
    Hunk {
        id: id.into(),
        old_start,
        old_lines: 8,
        new_start,
        new_lines: 8,
        header: String::new(),
        lines,
        file_level: false,
        staged_differs: false,
        mechanical: None,
    }
}

fn file(old: &str, new: &str, status: FileStatus, hunks: Vec<Hunk>) -> FileDiff {
    FileDiff {
        old_path: Some(old.into()),
        new_path: Some(new.into()),
        status,
        binary: false,
        mode_change: None,
        additions: 0,
        deletions: 0,
        layer: Layer::App,
        hunks,
        line_staging: true,
    }
}

/// The diff of the session: one modified file holding a context line (old 10, new 12), an added
/// line (new 13) and a deleted line (old 11), and one renamed file with an added line (new 3).
fn diff() -> Vec<FileDiff> {
    vec![
        file(
            FILE,
            FILE,
            FileStatus::Modified,
            vec![hunk(
                "h1",
                10,
                12,
                vec![
                    line(LineKind::Ctx, Some(10), Some(12), "var queue = Queue();"),
                    line(LineKind::Del, Some(11), None, "queue.Flush();"),
                    line(LineKind::Add, None, Some(13), "queue.Kick();"),
                ],
            )],
        ),
        file(
            RENAMED_FROM,
            RENAMED_TO,
            FileStatus::Renamed,
            vec![hunk(
                "h2",
                1,
                1,
                vec![line(LineKind::Add, None, Some(3), "// moved")],
            )],
        ),
    ]
}

fn at(file: &str, side: Side, line: u32) -> DiffPosition {
    DiffPosition {
        file: file.into(),
        side,
        line,
    }
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

/// A draft of the session on `position` (None: a comment on the MR); returns its id.
fn draft(store: &Store, body: &str, position: Option<DiffPosition>) -> String {
    store
        .with_conn(|c| {
            Ok(drafts::create(
                c,
                &NewDraft {
                    session_id: SESSION.into(),
                    finding_id: None,
                    body: body.into(),
                    position,
                    severity: None,
                },
            )
            .unwrap()
            .id)
        })
        .unwrap()
}

/// `n` drafts on the modified file's added line, "Comment 1" … "Comment n".
fn drafts_on_added_line(store: &Store, n: usize) -> Vec<String> {
    (1..=n)
        .map(|i| {
            draft(
                store,
                &format!("Comment {i}"),
                Some(at(FILE, Side::New, 13)),
            )
        })
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
struct Row {
    include: bool,
    published_at: Option<String>,
    gitlab_draft_id: Option<i64>,
    error: Option<String>,
}

fn row(store: &Store, id: &str) -> Row {
    store
        .with_conn(|c| {
            Ok(c.query_row(
                "SELECT include, published_at, gitlab_draft_id, error FROM drafts WHERE id = ?1",
                params![id],
                |r| {
                    Ok(Row {
                        include: r.get::<_, Option<bool>>(0)?.unwrap_or(true),
                        published_at: r.get(1)?,
                        gitlab_draft_id: r.get(2)?,
                        error: r.get(3)?,
                    })
                },
            )?)
        })
        .unwrap()
}

fn set_gitlab_draft_id(store: &Store, id: &str, gitlab_id: i64) {
    store
        .with_conn(|c| {
            c.execute(
                "UPDATE drafts SET gitlab_draft_id = ?2 WHERE id = ?1",
                params![id, gitlab_id],
            )?;
            Ok(())
        })
        .unwrap();
}

/// GitLab's draft notes endpoint: numbers the notes it creates and refuses the ones named in
/// `refuse` with the 400 GitLab sends for a position on a line that isn't in the diff.
struct DraftNotes {
    next: AtomicU64,
    refuse: Mutex<HashSet<String>>,
}

#[derive(Clone)]
struct Shared(Arc<DraftNotes>);

impl Shared {
    fn new() -> Self {
        Self(Arc::new(DraftNotes {
            next: AtomicU64::new(500),
            refuse: Mutex::new(HashSet::new()),
        }))
    }

    fn refuse(&self, note: &str) {
        self.0.refuse.lock().unwrap().insert(note.to_owned());
    }

    fn accept(&self, note: &str) {
        self.0.refuse.lock().unwrap().remove(note);
    }
}

impl Respond for Shared {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
        let note = body["note"].as_str().unwrap_or_default().to_owned();
        if self.0.refuse.lock().unwrap().contains(&note) {
            return ResponseTemplate::new(400).set_body_json(json!({
                "message": "400 Bad request - Note {:line_code=>[\"can't be blank\", \"must be a valid line code\"]}"
            }));
        }
        let id = self.0.next.fetch_add(1, Ordering::SeqCst);
        ResponseTemplate::new(201).set_body_json(json!({
            "id": id, "author_id": 2, "merge_request_id": 60, "note": note,
            "commit_id": null, "line_code": null, "resolve_discussion": false,
            "discussion_id": null, "position": body.get("position").cloned().unwrap_or(Value::Null)
        }))
    }
}

async fn serve_draft_notes(server: &MockServer) -> Shared {
    let notes = Shared::new();
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes")))
        .respond_with(notes.clone())
        .mount(server)
        .await;
    notes
}

async fn serve_bulk_publish(server: &MockServer, status: u16) {
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes/bulk_publish")))
        .respond_with(
            ResponseTemplate::new(status)
                .set_body_json(json!({ "message": "500 Internal Server Error" })),
        )
        .mount(server)
        .await;
}

/// `(method, path)` of every request the server got, in order.
async fn seen(server: &MockServer) -> Vec<(String, String)> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| (r.method.to_string(), r.url.path().to_owned()))
        .collect()
}

/// The JSON bodies of the creates, in order.
async fn created(server: &MockServer) -> Vec<Value> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.method.as_str() == "POST" && r.url.path() == format!("{MR}/draft_notes"))
        .map(|r| serde_json::from_slice(&r.body).unwrap())
        .collect()
}

fn count(requests: &[(String, String)], suffix: &str) -> usize {
    requests
        .iter()
        .filter(|(m, p)| m == "POST" && *p == format!("{MR}/{suffix}"))
        .count()
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
async fn f12_5_five_drafts_and_a_summary_make_six_draft_notes_and_exactly_one_bulk_publish() {
    let server = MockServer::start().await;
    serve_draft_notes(&server).await;
    serve_bulk_publish(&server, 204).await;
    let store = store();
    let files = diff();
    let ids = drafts_on_added_line(&store, 5);
    let not_selected = draft(&store, "Left unticked", Some(at(FILE, Side::New, 13)));

    let outcome = publish::run(&request!(
        &server.uri(),
        &store,
        &files,
        &ids,
        Some("Thanks, the queue looks good.")
    ))
    .await
    .unwrap();

    assert_eq!(outcome.published, ids);
    assert!(outcome.summary);
    assert!(outcome.failed.is_empty());

    let requests = seen(&server).await;
    assert_eq!(
        count(&requests, "draft_notes"),
        6,
        "five drafts and the summary"
    );
    assert_eq!(
        count(&requests, "draft_notes/bulk_publish"),
        1,
        "one batch, one notification"
    );
    assert_eq!(
        requests.last().unwrap().1,
        format!("{MR}/draft_notes/bulk_publish"),
        "the batch goes out after every note is made"
    );
    // Nothing else: no approval, no discussion note, no single publish.
    for (_, requested) in &requests {
        assert!(!requested.contains("approve"), "{requested}");
        assert!(!requested.contains("/discussions"), "{requested}");
        assert!(!requested.contains("/notes"), "{requested}");
    }

    // The drafts in the selected order, then the summary as a note with no position.
    let bodies = created(&server).await;
    let notes: Vec<&str> = bodies.iter().map(|b| b["note"].as_str().unwrap()).collect();
    assert_eq!(
        notes,
        [
            "Comment 1",
            "Comment 2",
            "Comment 3",
            "Comment 4",
            "Comment 5",
            "Thanks, the queue looks good."
        ]
    );
    let summary = bodies.last().unwrap();
    assert!(
        summary.get("position").is_none_or(Value::is_null),
        "{summary}"
    );

    // `bulk_publish` has no `note` of its own (05, S5).
    let batch = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.url.path().ends_with("/bulk_publish"))
        .unwrap();
    let fields: Value = serde_json::from_slice(&batch.body).unwrap_or(Value::Null);
    assert!(fields.get("note").is_none(), "{fields}");
    assert!(batch.url.query_pairs().all(|(name, _)| name != "note"));

    // Every published draft remembers it; the unselected one was never sent.
    for id in &ids {
        let stored = row(&store, id);
        assert!(stored.published_at.is_some(), "{id}");
        assert!(stored.gitlab_draft_id.is_some(), "{id}");
        assert_eq!(stored.error, None);
        assert!(stored.include, "a published draft keeps its tick");
    }
    let left = row(&store, &not_selected);
    assert_eq!((left.published_at, left.gitlab_draft_id), (None, None));
    let listed = store
        .with_conn(|c| Ok(drafts::list(c, SESSION).unwrap()))
        .unwrap();
    for draft in listed.iter().filter(|d| ids.contains(&d.id)) {
        assert!(draft.published_note_id.is_some(), "{}", draft.id);
    }
    assert!(
        listed
            .iter()
            .find(|d| d.id == not_selected)
            .unwrap()
            .published_note_id
            .is_none()
    );
}

#[tokio::test]
async fn f12_5_without_a_summary_only_the_drafts_are_created() {
    let server = MockServer::start().await;
    serve_draft_notes(&server).await;
    serve_bulk_publish(&server, 204).await;
    let store = store();
    let files = diff();
    let ids = drafts_on_added_line(&store, 2);

    let outcome = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();

    assert!(!outcome.summary);
    assert_eq!(outcome.published.len(), 2);
    let requests = seen(&server).await;
    assert_eq!(count(&requests, "draft_notes"), 2);
    assert_eq!(count(&requests, "draft_notes/bulk_publish"), 1);
}

#[tokio::test]
async fn f12_5_positions_follow_the_line_kind_and_the_file_paths_of_the_diff() {
    let server = MockServer::start().await;
    serve_draft_notes(&server).await;
    serve_bulk_publish(&server, 204).await;
    let store = store();
    let files = diff();
    let ids = [
        draft(&store, "added", Some(at(FILE, Side::New, 13))),
        draft(&store, "deleted", Some(at(FILE, Side::Old, 11))),
        draft(&store, "context", Some(at(FILE, Side::New, 12))),
        draft(&store, "renamed", Some(at(RENAMED_TO, Side::New, 3))),
    ];

    publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();

    let bodies = created(&server).await;
    let position = |note: &str| -> Value {
        bodies
            .iter()
            .find(|b| b["note"] == note)
            .unwrap_or_else(|| panic!("no draft note {note}"))["position"]
            .clone()
    };
    for note in ["added", "deleted", "context", "renamed"] {
        let p = position(note);
        assert_eq!(p["position_type"], "text", "{note}");
        assert_eq!(p["base_sha"], "b0b0b0", "{note}");
        assert_eq!(p["start_sha"], "5ab5ab", "{note}");
        assert_eq!(p["head_sha"], "4ead4e", "{note}");
    }
    // Added: the new line only.
    let added = position("added");
    assert_eq!(
        (added["new_line"].as_u64(), added.get("old_line")),
        (Some(13), None)
    );
    assert_eq!(
        (added["old_path"].as_str(), added["new_path"].as_str()),
        (Some(FILE), Some(FILE))
    );
    // Deleted: the old line only.
    let deleted = position("deleted");
    assert_eq!(
        (deleted["old_line"].as_u64(), deleted.get("new_line")),
        (Some(11), None)
    );
    // Context: both numbers, whichever side the draft was written on.
    let context = position("context");
    assert_eq!(
        (context["old_line"].as_u64(), context["new_line"].as_u64()),
        (Some(10), Some(12))
    );
    // A renamed file keeps both of its paths.
    let renamed = position("renamed");
    assert_eq!(
        (
            renamed["old_path"].as_str(),
            renamed["new_path"].as_str(),
            renamed["new_line"].as_u64()
        ),
        (Some(RENAMED_FROM), Some(RENAMED_TO), Some(3))
    );
}

#[tokio::test]
async fn f12_5_a_comment_on_the_mr_is_created_without_a_position() {
    let server = MockServer::start().await;
    serve_draft_notes(&server).await;
    serve_bulk_publish(&server, 204).await;
    let store = store();
    let files = diff();
    let ids = [draft(&store, "General remark", None)];

    let outcome = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();

    assert_eq!(outcome.published, ids);
    let bodies = created(&server).await;
    assert_eq!(bodies.len(), 1);
    assert!(
        bodies[0].get("position").is_none_or(Value::is_null),
        "{}",
        bodies[0]
    );
}

#[tokio::test]
async fn f12_5_one_failed_create_leaves_four_published_and_the_failed_draft_ticked_with_its_reason()
{
    let server = MockServer::start().await;
    let notes = serve_draft_notes(&server).await;
    serve_bulk_publish(&server, 204).await;
    let store = store();
    let files = diff();
    let ids = drafts_on_added_line(&store, 5);
    notes.refuse("Comment 3");

    let outcome = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();

    let expected: Vec<String> = [0, 1, 3, 4].iter().map(|&i| ids[i].clone()).collect();
    assert_eq!(outcome.published, expected);
    assert_eq!(outcome.failed.len(), 1);
    assert_eq!(outcome.failed[0].id, ids[2]);
    assert_eq!(outcome.failed[0].reason, LINE_GONE);
    // The four that were made still go out in one batch.
    assert_eq!(count(&seen(&server).await, "draft_notes/bulk_publish"), 1);

    let failed = row(&store, &ids[2]);
    assert!(failed.include, "a failed draft keeps its tick");
    assert_eq!(failed.error.as_deref(), Some(LINE_GONE));
    assert_eq!(failed.published_at, None);
    for i in [0, 1, 3, 4] {
        let stored = row(&store, &ids[i]);
        assert!(
            stored.published_at.is_some() && stored.error.is_none(),
            "{i}"
        );
    }
}

#[tokio::test]
async fn f12_5_retry_creates_only_the_failed_draft_and_publishes_it_in_one_more_batch() {
    let server = MockServer::start().await;
    let notes = serve_draft_notes(&server).await;
    serve_bulk_publish(&server, 204).await;
    let store = store();
    let files = diff();
    let ids = drafts_on_added_line(&store, 5);
    notes.refuse("Comment 3");
    publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();

    // GitLab takes the line this time; the Retry sends only the failed row.
    notes.accept("Comment 3");
    let retry = [ids[2].clone()];
    let outcome = publish::run(&request!(&server.uri(), &store, &files, &retry, None))
        .await
        .unwrap();

    assert_eq!(outcome.published, retry);
    assert!(outcome.failed.is_empty());
    let requests = seen(&server).await;
    // 5 creates in the first run (one refused) plus 1 in the retry: nothing was created twice.
    assert_eq!(count(&requests, "draft_notes"), 6);
    assert_eq!(count(&requests, "draft_notes/bulk_publish"), 2);
    let again: Vec<Value> = created(&server).await;
    let comment_3 = again.iter().filter(|b| b["note"] == "Comment 3").count();
    assert_eq!(comment_3, 2, "refused once, made once");
    let stored = row(&store, &ids[2]);
    assert!(stored.published_at.is_some() && stored.error.is_none());
}

#[tokio::test]
async fn f12_5_a_failed_bulk_publish_fails_every_draft_and_the_retry_publishes_without_duplicates()
{
    let server = MockServer::start().await;
    serve_draft_notes(&server).await;
    let store = store();
    let files = diff();
    let ids = drafts_on_added_line(&store, 3);

    // The first batch fails (500), the next one is accepted.
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes/bulk_publish")))
        .respond_with(
            ResponseTemplate::new(500)
                .set_body_json(json!({ "message": "500 Internal Server Error" })),
        )
        .up_to_n_times(1)
        .mount(&server)
        .await;
    serve_bulk_publish(&server, 204).await;
    let outcome = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();
    assert!(outcome.published.is_empty());
    assert_eq!(outcome.failed.len(), 3);
    for failure in &outcome.failed {
        assert!(!failure.reason.is_empty());
        assert_ne!(failure.reason, LINE_GONE);
    }
    for id in &ids {
        let stored = row(&store, id);
        assert!(stored.include && stored.published_at.is_none(), "{id}");
        assert!(
            stored.gitlab_draft_id.is_some(),
            "the made note is remembered: {id}"
        );
        assert!(stored.error.is_some(), "{id}");
    }

    // The retry: the notes exist already, so only the batch is sent again.
    let outcome = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();
    assert_eq!(outcome.published, ids);
    assert!(outcome.failed.is_empty());
    let requests = seen(&server).await;
    assert_eq!(
        count(&requests, "draft_notes"),
        3,
        "no second create for any draft"
    );
    assert_eq!(count(&requests, "draft_notes/bulk_publish"), 2);
    for id in &ids {
        let stored = row(&store, id);
        assert!(
            stored.published_at.is_some() && stored.error.is_none(),
            "{id}"
        );
    }
}

#[tokio::test]
async fn f12_5_a_refused_token_and_an_unreachable_server_fail_the_drafts_in_plain_words() {
    // 401 on every call: nothing is made, so there is nothing to publish.
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::any())
        .respond_with(
            ResponseTemplate::new(401).set_body_json(json!({ "message": "401 Unauthorized" })),
        )
        .mount(&server)
        .await;
    let store = store();
    let files = diff();
    let ids = drafts_on_added_line(&store, 2);

    let outcome = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();
    assert!(outcome.published.is_empty());
    assert_eq!(
        outcome
            .failed
            .iter()
            .map(|f| f.reason.as_str())
            .collect::<Vec<_>>(),
        [REFUSED, REFUSED]
    );
    assert_eq!(count(&seen(&server).await, "draft_notes/bulk_publish"), 0);
    assert_eq!(row(&store, &ids[0]).error.as_deref(), Some(REFUSED));

    // Nothing listens on the port: GitLab is unreachable.
    let closed = MockServer::start().await;
    let uri = closed.uri();
    drop(closed);
    let outcome = publish::run(&request!(&uri, &store, &files, &ids, None))
        .await
        .unwrap();
    assert!(outcome.published.is_empty());
    assert_eq!(
        outcome
            .failed
            .iter()
            .map(|f| f.reason.as_str())
            .collect::<Vec<_>>(),
        [UNREACHABLE, UNREACHABLE]
    );
    assert_eq!(row(&store, &ids[1]).error.as_deref(), Some(UNREACHABLE));
}

#[tokio::test]
async fn f12_5_another_gitlab_message_is_the_reason_as_gitlab_wrote_it() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes")))
        .respond_with(
            ResponseTemplate::new(422)
                .set_body_json(json!({ "message": "Merge request is locked" })),
        )
        .mount(&server)
        .await;
    let store = store();
    let files = diff();
    let ids = drafts_on_added_line(&store, 1);

    let outcome = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();
    assert_eq!(outcome.failed.len(), 1);
    assert!(
        outcome.failed[0].reason.contains("Merge request is locked"),
        "{}",
        outcome.failed[0].reason
    );
}

#[tokio::test]
async fn f12_5_draft_notes_from_gitlabs_own_review_are_counted_and_ours_are_not() {
    let server = MockServer::start().await;
    // Two notes written in GitLab's web UI (801, 802) and one this app made earlier (701).
    Mock::given(method("GET"))
        .and(path(format!("{MR}/draft_notes")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            { "id": 701, "author_id": 2, "merge_request_id": 60, "note": "Comment 1", "position": null },
            { "id": 801, "author_id": 2, "merge_request_id": 60, "note": "Written on the web", "position": null },
            { "id": 802, "author_id": 2, "merge_request_id": 60, "note": "Me too", "position": null }
        ])))
        .mount(&server)
        .await;
    let store = store();
    let ids = drafts_on_added_line(&store, 2);
    set_gitlab_draft_id(&store, &ids[0], 701);

    let listed = draft_notes::list(&client(&server.uri()), PROJECT, 6)
        .await
        .unwrap();
    assert_eq!(
        listed.iter().map(|n| n.id).collect::<Vec<_>>(),
        [701, 801, 802]
    );

    let foreign = publish::foreign_drafts(&client(&server.uri()), &store, SESSION, &mr())
        .await
        .unwrap();
    assert_eq!(foreign, 2);
    // Counting writes nothing to GitLab.
    assert!(seen(&server).await.iter().all(|(m, _)| m == "GET"));
}

#[tokio::test]
async fn f12_5_publishing_goes_on_when_gitlab_holds_foreign_drafts() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{MR}/draft_notes")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            { "id": 801, "author_id": 2, "merge_request_id": 60, "note": "Written on the web", "position": null }
        ])))
        .mount(&server)
        .await;
    serve_draft_notes(&server).await;
    serve_bulk_publish(&server, 204).await;
    let store = store();
    let files = diff();
    let ids = drafts_on_added_line(&store, 1);

    let outcome = publish::run(&request!(&server.uri(), &store, &files, &ids, None))
        .await
        .unwrap();
    assert_eq!(
        outcome.published, ids,
        "decision 8: Publish stays available"
    );
    assert_eq!(count(&seen(&server).await, "draft_notes/bulk_publish"), 1);
}

#[tokio::test]
async fn f12_5_bulk_publish_is_one_post_with_no_note_and_a_failure_is_an_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes/bulk_publish")))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    draft_notes::bulk_publish(&client(&server.uri()), PROJECT, 6)
        .await
        .unwrap();
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    let fields: Value = serde_json::from_slice(&requests[0].body).unwrap_or(Value::Null);
    assert!(fields.get("note").is_none(), "{fields}");
    assert!(
        requests[0]
            .url
            .query_pairs()
            .all(|(name, _)| name != "note")
    );

    let failing = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes/bulk_publish")))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "message": "500" })))
        .mount(&failing)
        .await;
    let failed = draft_notes::bulk_publish(&client(&failing.uri()), PROJECT, 6).await;
    assert!(failed.is_err(), "{failed:?}");
}
