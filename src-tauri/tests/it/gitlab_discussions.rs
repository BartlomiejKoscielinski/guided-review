//! MR discussions, read only (F-06.9, M3 decision 5) against wiremock. `mr_discussions_6` is
//! recorded from the stand-in (`seed.rb`: !6 has two open threads, one resolved, and system
//! notes). The seed has no diff thread, so the DiffNote below follows GitLab's documented
//! `position` shape (synthetic, ADR-019).
#![allow(clippy::unwrap_used, reason = "tests")]

use crate::cassette;

use cassette::cassette;
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::discussions;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const ROUTE: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/6/discussions";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

async fn page(server: &MockServer, page: &str, next: &str, body: Value) {
    Mock::given(method("GET"))
        .and(path(ROUTE))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .and(query_param("page", page))
        .and(query_param("per_page", "100"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", next)
                .set_body_json(body),
        )
        .expect(1)
        .mount(server)
        .await;
}

fn diff_thread() -> Value {
    json!({
        "id": "6f1c0de", "individual_note": false,
        "notes": [
            { "id": 101, "type": "DiffNote", "body": "Does this run on the UI thread?",
              "author": { "id": 3, "username": "alice", "name": "Alice Stand-in" },
              "created_at": "2026-10-12T14:00:00.000Z", "system": false,
              "resolvable": true, "resolved": false,
              "position": { "base_sha": "b0", "start_sha": "b0", "head_sha": "h6",
                            "position_type": "text", "old_path": "src/Upload.cs",
                            "new_path": "src/Upload.cs", "old_line": null, "new_line": 17 } },
            { "id": 102, "type": "DiffNote", "body": "Yes, moving it.",
              "author": { "id": 2, "username": "dev", "name": "Dev Stand-in" },
              "created_at": "2026-10-12T14:05:00.000Z", "system": false,
              "resolvable": true, "resolved": false }
        ]
    })
}

#[tokio::test]
async fn f06_9_reads_every_page_of_discussions() {
    let server = MockServer::start().await;
    page(&server, "1", "2", cassette("mr_discussions_6")).await;
    page(&server, "2", "", json!([diff_thread()])).await;
    let threads = discussions::list(&client(&server), "sandbox/gr-sandbox", 6)
        .await
        .unwrap();

    // Two system notes dropped; three threads from the stand-in, one diff thread.
    let firsts: Vec<&str> = threads.iter().map(|t| t.notes[0].body.as_str()).collect();
    assert_eq!(
        firsts,
        [
            "Should the retry back off?",
            "What happens when the token expires mid-upload?",
            "Typo in the log message.",
            "Does this run on the UI thread?",
        ]
    );
    assert_eq!(discussions::open_count(&threads), 3);
    assert!(threads[2].resolved);
    assert_eq!(threads[0].notes[0].author.name, "Alice Stand-in");
    let diff = &threads[3];
    assert_eq!(diff.notes.len(), 2);
    let position = diff.position.as_ref().unwrap();
    assert_eq!(
        (position.new_path.as_str(), position.new_line),
        ("src/Upload.cs", Some(17))
    );

    let file = discussions::render(&threads);
    assert!(file.contains("Thread 1 · open · on the merge request\n"));
    assert!(file.contains("Thread 3 · resolved · on the merge request\n"));
    assert!(file.contains("Thread 4 · open · src/Upload.cs:17 (new)\n"));
    assert!(file.contains("  - dev (2026-10-12T14:05:00.000Z): Yes, moving it.\n"));
    assert_eq!(
        discussions::open_summary(&threads).as_deref(),
        Some("3 open threads.")
    );
}

#[tokio::test]
async fn f06_9_no_discussions_render_none() {
    let server = MockServer::start().await;
    page(&server, "1", "", json!([])).await;
    let threads = discussions::list(&client(&server), "sandbox/gr-sandbox", 6)
        .await
        .unwrap();
    assert!(threads.is_empty());
    assert_eq!(discussions::render(&threads), "none\n");
    assert_eq!(discussions::open_summary(&threads), None);
}

#[tokio::test]
async fn f06_9_only_reads() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(ROUTE))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({"message": "404 Not found"})))
        .expect(1)
        .mount(&server)
        .await;
    // Anything but GET would hit no mock and fail the expectation count below.
    let result = discussions::list(&client(&server), "sandbox/gr-sandbox", 6).await;
    assert!(matches!(result, Err(GitlabError::NotFound)));
    let requests = server.received_requests().await.unwrap();
    assert!(
        requests
            .iter()
            .all(|r| r.method == wiremock::http::Method::GET)
    );
}
