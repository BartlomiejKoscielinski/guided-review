//! Publish after a failed attempt when the MR moved on (F-12.5, M5 decisions 9 and 10b) against
//! wiremock: a line comment's GitLab draft note sits at a position on the version it was made on,
//! so a Publish placing it on another version deletes that note and makes it again at the
//! re-mapped position; on the same version the note is reused. Synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use guided_review_lib::git::model::{FileDiff, FileStatus, Hunk, Line, LineKind};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::draft_notes::{DiffRefs, NotePosition};
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::drafts::{self, NewDraft};
use guided_review_lib::review::finding_model::Side;
use guided_review_lib::review::layer::Layer;
use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::review::position::DiffPosition;
use guided_review_lib::review::publish::{self, PublishOutcome, PublishRequest};
use guided_review_lib::review::publish_remap::Moved;
use guided_review_lib::review::step_context::MrRef;
use guided_review_lib::store::sessions::{self, NewSession};
use guided_review_lib::store::{Store, repos};
use serde_json::{Value, json};
use wiremock::matchers::{method, path, path_regex};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const PROJECT: &str = "sandbox/gr-sandbox";
const MR: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/6";
const SESSION: &str = "mr-6";
const FILE: &str = "src/App/Zażółć/Upload ViewModel.cs";

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

/// A comment on the added line 13 of [`FILE`]; returns its id.
fn draft(store: &Store) -> String {
    store
        .with_conn(|c| {
            let new = NewDraft {
                session_id: SESSION.into(),
                finding_id: None,
                body: "Kick the queue once".into(),
                position: Some(DiffPosition {
                    file: FILE.into(),
                    side: Side::New,
                    line: 13,
                }),
                severity: None,
            };
            Ok(drafts::create(c, &new).unwrap().id)
        })
        .unwrap()
}

/// The reviewed version's diff: [`FILE`] with an added line 13.
fn files() -> Vec<FileDiff> {
    let line = Line {
        kind: LineKind::Add,
        old_no: None,
        new_no: Some(13),
        text: "queue.Kick();".into(),
        emphasis: Vec::new(),
        staged: None,
    };
    vec![FileDiff {
        old_path: Some(FILE.into()),
        new_path: Some(FILE.into()),
        status: FileStatus::Modified,
        binary: false,
        mode_change: None,
        additions: 1,
        deletions: 0,
        layer: Layer::App,
        hunks: vec![Hunk {
            id: "h1".into(),
            old_start: 12,
            old_lines: 0,
            new_start: 13,
            new_lines: 1,
            header: String::new(),
            lines: vec![line],
            file_level: false,
            staged_differs: false,
            mechanical: None,
        }],
        line_staging: true,
    }]
}

fn reviewed() -> DiffRefs {
    DiffRefs {
        base_sha: "b0b0b0".into(),
        start_sha: "5ab5ab".into(),
        head_sha: "4ead4e".into(),
    }
}

fn newer() -> DiffRefs {
    DiffRefs {
        base_sha: "b0b0b0".into(),
        start_sha: "5ab5ab".into(),
        head_sha: "9e9e9e".into(),
    }
}

/// GitLab's create numbers the notes from 500.
#[derive(Clone)]
struct Notes(Arc<AtomicU64>);

impl Respond for Notes {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        let id = self.0.fetch_add(1, Ordering::SeqCst);
        ResponseTemplate::new(201).set_body_json(json!({ "id": id, "note": "" }))
    }
}

/// The first `bulk_publish` fails with 500, later ones succeed; deletes answer 204.
async fn server() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes")))
        .respond_with(Notes(Arc::new(AtomicU64::new(500))))
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
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    server
}

async fn publish(
    server: &MockServer,
    store: &Store,
    ids: &[String],
    refs: &DiffRefs,
    moved: Option<&Moved>,
) -> PublishOutcome {
    let client = GitlabClient::new(
        &server.uri(),
        &Token::new(&format!("glpat-{}", "w".repeat(20))).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap();
    let mr = MrRef {
        project: PROJECT.into(),
        iid: 6,
    };
    let files = files();
    let request = PublishRequest {
        client: &client,
        store,
        session: SESSION,
        mr: &mr,
        refs,
        files: &files,
        ids,
        summary: None,
    };
    publish::run_on(&request, moved).await.unwrap()
}

/// `(method, path below the MR)` of every request, and the bodies of the creates, in order.
async fn requests(server: &MockServer) -> (Vec<(String, String)>, Vec<Value>) {
    let all = server.received_requests().await.unwrap();
    let seen = all
        .iter()
        .map(|r| (r.method.to_string(), r.url.path().replacen(MR, "", 1)))
        .collect();
    let created = all
        .iter()
        .filter(|r| r.method.as_str() == "POST" && r.url.path() == format!("{MR}/draft_notes"))
        .map(|r| serde_json::from_slice(&r.body).unwrap())
        .collect();
    (seen, created)
}

#[tokio::test]
async fn f12_5_a_note_made_on_the_reviewed_version_is_made_again_at_the_moved_position() {
    let server = server().await;
    let store = store();
    let id = draft(&store);
    let ids = vec![id.clone()];

    // The batch fails: note 500 stays in GitLab, on the reviewed version.
    let first = publish(&server, &store, &ids, &reviewed(), None).await;
    assert_eq!(first.failed.len(), 1);

    // The MR moved on; the comment's line is now line 15 of the newer version.
    let moved = Moved {
        positions: HashMap::from([(
            id.clone(),
            NotePosition {
                old_path: FILE.into(),
                new_path: FILE.into(),
                old_line: None,
                new_line: Some(15),
            },
        )]),
    };
    let second = publish(&server, &store, &ids, &newer(), Some(&moved)).await;
    assert_eq!(second.published, ids);

    let (seen, created) = requests(&server).await;
    let deleted: Vec<&str> = seen
        .iter()
        .filter(|(m, _)| m == "DELETE")
        .map(|(_, p)| p.as_str())
        .collect();
    assert_eq!(
        deleted,
        ["/draft_notes/500"],
        "the note on the old version is deleted"
    );
    assert_eq!(created.len(), 2, "made again on the newer version");
    let position = &created[1]["position"];
    assert_eq!(position["head_sha"], "9e9e9e");
    assert_eq!(position["new_line"], 15);
}

#[tokio::test]
async fn f12_5_a_note_on_the_same_version_is_reused_by_the_retry() {
    let server = server().await;
    let store = store();
    let ids = vec![draft(&store)];

    publish(&server, &store, &ids, &reviewed(), None).await;
    let retry = publish(&server, &store, &ids, &reviewed(), None).await;
    assert_eq!(retry.published, ids);

    let (seen, created) = requests(&server).await;
    assert!(seen.iter().all(|(m, _)| m != "DELETE"));
    assert_eq!(created.len(), 1, "the note is reused, not made twice");
}
