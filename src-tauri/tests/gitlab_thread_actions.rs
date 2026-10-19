//! Thread actions on GitLab (F-11.2, M5 decisions 1 and 2) against wiremock: Resolve and Reopen
//! are a `PUT` of the discussion with `resolved=true|false`, Reply is a `POST` of a note to it
//! (docs/05 › GitLab REST API v4). Each is one request and nothing else: no draft note, no
//! approval (06 › T7). The GitLab answers follow the documented shapes (synthetic, ADR-019).
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::thread_actions;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const MR: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/6";
const DISCUSSION: &str = "6f1c0de9a2b4";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn discussion_route() -> String {
    format!("{MR}/discussions/{DISCUSSION}")
}

fn notes_route() -> String {
    format!("{MR}/discussions/{DISCUSSION}/notes")
}

/// GitLab's answer to a resolve: the discussion as it is now.
fn discussion(resolved: bool) -> Value {
    json!({
        "id": DISCUSSION, "individual_note": false,
        "notes": [
            { "id": 101, "type": "DiffNote", "body": "Does this run on the UI thread?",
              "author": { "id": 3, "username": "alice", "name": "Alice Stand-in" },
              "created_at": "2026-10-12T14:00:00.000Z", "system": false,
              "resolvable": true, "resolved": resolved,
              "position": { "base_sha": "b0", "start_sha": "b0", "head_sha": "h6",
                            "position_type": "text", "old_path": "src/Upload.cs",
                            "new_path": "src/Upload.cs", "old_line": null, "new_line": 17 } }
        ]
    })
}

/// GitLab's answer to a reply: the new note.
fn note(body: &str) -> Value {
    json!({
        "id": 202, "type": "DiscussionNote", "body": body,
        "author": { "id": 2, "username": "dev", "name": "Dev Stand-in" },
        "created_at": "2026-10-16T09:00:00.000Z", "system": false,
        "resolvable": true, "resolved": false, "noteable_iid": 6
    })
}

/// The text a reply request carries: GitLab takes `body` as a JSON field or as a parameter.
fn reply_body(request: &Request) -> Option<String> {
    if let Ok(Value::Object(fields)) = serde_json::from_slice::<Value>(&request.body)
        && let Some(Value::String(body)) = fields.get("body")
    {
        return Some(body.clone());
    }
    request
        .url
        .query_pairs()
        .find(|(name, _)| name == "body")
        .map(|(_, value)| value.into_owned())
}

#[tokio::test]
async fn f11_2_resolve_puts_the_discussion_with_resolved_true() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(discussion_route()))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .and(query_param("resolved", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(discussion(true)))
        .expect(1)
        .mount(&server)
        .await;

    thread_actions::resolve(&client(&server), PROJECT, 6, DISCUSSION, true)
        .await
        .unwrap();

    // Exactly the one request, with the flag as the only parameter.
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    let pairs: Vec<(String, String)> = requests[0]
        .url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    assert_eq!(pairs, [("resolved".to_owned(), "true".to_owned())]);
}

#[tokio::test]
async fn f11_2_reopen_puts_the_discussion_with_resolved_false() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(discussion_route()))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .and(query_param("resolved", "false"))
        .respond_with(ResponseTemplate::new(200).set_body_json(discussion(false)))
        .expect(1)
        .mount(&server)
        .await;

    thread_actions::resolve(&client(&server), PROJECT, 6, DISCUSSION, false)
        .await
        .unwrap();
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn f11_2_reply_posts_the_text_to_the_discussion_as_written() {
    let server = MockServer::start().await;
    let text = "Zażółć gęślą jaźń:\n- `Kick()` zwalnia semafor\n- <b>nie</b> blokuje & ma 100%";
    Mock::given(method("POST"))
        .and(path(notes_route()))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(201).set_body_json(note(text)))
        .expect(1)
        .mount(&server)
        .await;

    thread_actions::reply(&client(&server), PROJECT, 6, DISCUSSION, text)
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(reply_body(&requests[0]).as_deref(), Some(text));
}

#[tokio::test]
async fn f11_2_each_action_is_one_request_and_never_a_draft_note_or_an_approval() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(discussion_route()))
        .respond_with(ResponseTemplate::new(200).set_body_json(discussion(true)))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(notes_route()))
        .respond_with(ResponseTemplate::new(201).set_body_json(note("Thanks.")))
        .mount(&server)
        .await;

    let gitlab = client(&server);
    thread_actions::resolve(&gitlab, PROJECT, 6, DISCUSSION, true)
        .await
        .unwrap();
    thread_actions::reply(&gitlab, PROJECT, 6, DISCUSSION, "Thanks.")
        .await
        .unwrap();
    thread_actions::resolve(&gitlab, PROJECT, 6, DISCUSSION, false)
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    let seen: Vec<(String, String)> = requests
        .iter()
        .map(|r| (r.method.to_string(), r.url.path().to_owned()))
        .collect();
    assert_eq!(
        seen,
        [
            ("PUT".to_owned(), discussion_route()),
            ("POST".to_owned(), notes_route()),
            ("PUT".to_owned(), discussion_route()),
        ]
    );
    for (_, requested) in &seen {
        assert!(!requested.contains("draft_notes"), "{requested}");
        assert!(!requested.contains("approve"), "{requested}");
        assert!(!requested.contains("bulk_publish"), "{requested}");
    }
}

#[tokio::test]
async fn f11_2_403_is_gitlab_forbidden_with_gitlabs_message_in_the_detail() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(discussion_route()))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(json!({ "message": "403 Forbidden" })),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(notes_route()))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(json!({ "message": "403 Forbidden" })),
        )
        .mount(&server)
        .await;

    let gitlab = client(&server);
    let resolve = thread_actions::resolve(&gitlab, PROJECT, 6, DISCUSSION, true).await;
    let reply = thread_actions::reply(&gitlab, PROJECT, 6, DISCUSSION, "Hello").await;
    for result in [resolve.err(), reply.err()] {
        let Some(GitlabError::Forbidden { message }) = result else {
            panic!("expected GitlabError::Forbidden, got {result:?}");
        };
        assert_eq!(message.as_deref(), Some("403 Forbidden"));
        let app: AppError = GitlabError::Forbidden { message }.into();
        assert_eq!(app.code, ErrorCode::GitlabForbidden);
    }
}

#[tokio::test]
async fn f11_2_a_missing_discussion_is_not_found_and_a_bad_token_is_unauthorized() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(discussion_route()))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "message": "404 Not found" })),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(notes_route()))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(json!({ "message": "401 Unauthorized" })),
        )
        .mount(&server)
        .await;

    let gitlab = client(&server);
    let resolve = thread_actions::resolve(&gitlab, PROJECT, 6, DISCUSSION, true)
        .await
        .err();
    assert!(
        matches!(resolve, Some(GitlabError::NotFound)),
        "{resolve:?}"
    );
    let reply = thread_actions::reply(&gitlab, PROJECT, 6, DISCUSSION, "Hello")
        .await
        .err();
    assert!(
        matches!(reply, Some(GitlabError::Unauthorized)),
        "{reply:?}"
    );
}

/// The discussion ID comes from the UI. Whatever it holds, the request stays a call on the
/// discussions of this merge request: it cannot walk up to `/approve` or add parameters.
#[tokio::test]
async fn f11_2_a_discussion_id_cannot_redirect_the_call() {
    let hostile = [
        "../approve",
        "%2e%2e/approve",
        "abc/notes/../../approve",
        "abc?resolved=false",
        "abc#fragment",
        "abc/../../../../merge_requests/7/approve",
    ];
    for id in hostile {
        let server = MockServer::start().await;
        Mock::given(wiremock::matchers::any())
            .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "message": "404" })))
            .mount(&server)
            .await;
        let gitlab = client(&server);
        let _ = thread_actions::resolve(&gitlab, PROJECT, 6, id, true).await;
        let _ = thread_actions::reply(&gitlab, PROJECT, 6, id, "Hello").await;

        for request in server.received_requests().await.unwrap() {
            let requested = request.url.path();
            assert!(
                requested.starts_with(&format!("{MR}/discussions/")),
                "{id:?} reached {requested}"
            );
            assert!(!requested.contains("approve"), "{id:?} reached {requested}");
            assert!(
                request.url.query_pairs().all(|(name, value)| {
                    (name == "resolved" && value == "true") || name == "body"
                }),
                "{id:?} added parameters: {:?}",
                request.url.query()
            );
        }
    }
}
