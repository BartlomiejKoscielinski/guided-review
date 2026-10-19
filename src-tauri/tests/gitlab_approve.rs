//! Approve and Revoke against wiremock (F-14.2, M5 decision 10a and 14): `POST
//! /projects/:id/merge_requests/:iid/approve` with the reviewed head as `sha`, and `POST
//! .../unapprove`. GitLab answers a stale `sha` with an error that reads as the MR having changed
//! (the plan: 409 -> `CONFLICT`). Synthetic answers (ADR-019).
//!
//! The tests pin these names (the plan's `gitlab/approvals.rs`):
//! - `approvals::approve(client, project, iid, sha) -> Result<_, GitlabError>`: one POST to
//!   `/approve` whose JSON body is `{ "sha": <sha> }`, nothing else.
//! - `approvals::unapprove(client, project, iid) -> Result<_, GitlabError>`: one POST to
//!   `/unapprove`.
//! - `approvals::check_reviewed_head(sha, reviewed_head) -> Result<(), AppError>`: what the
//!   command `gitlab_approve(session, sha)` runs before it calls GitLab; a SHA other than the
//!   session's reviewed head is refused with `ErrorCode::Conflict` (no request is made).
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::approvals;
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const MR: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/6";
const HEAD: &str = "4ead4e4ead4e4ead4e4ead4e4ead4e4ead4e4ead";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn approved_answer() -> Value {
    json!({ "iid": 6, "approvals_required": 1, "approved_by": [], "user_has_approved": true,
            "user_can_approve": false, "require_password_to_approve": false })
}

async fn serve(server: &MockServer, route: &str, response: ResponseTemplate) {
    Mock::given(method("POST"))
        .and(path(format!("{MR}/{route}")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(response)
        .mount(server)
        .await;
}

async fn bodies(server: &MockServer) -> Vec<Value> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| serde_json::from_slice(&r.body).unwrap_or(Value::Null))
        .collect()
}

#[tokio::test]
async fn f14_2_approve_posts_the_reviewed_head_as_sha() {
    let server = MockServer::start().await;
    serve(
        &server,
        "approve",
        ResponseTemplate::new(201).set_body_json(approved_answer()),
    )
    .await;

    approvals::approve(&client(&server), PROJECT, 6, HEAD)
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1, "approving is one request");
    assert_eq!(bodies(&server).await[0], json!({ "sha": HEAD }));
}

#[tokio::test]
async fn f14_2_a_stale_sha_answered_409_is_a_conflict() {
    let server = MockServer::start().await;
    serve(
        &server,
        "approve",
        ResponseTemplate::new(409)
            .set_body_json(json!({ "message": "SHA does not match HEAD of source branch" })),
    )
    .await;

    let error = approvals::approve(&client(&server), PROJECT, 6, HEAD)
        .await
        .unwrap_err();

    assert!(
        matches!(error, GitlabError::Status { status: 409, .. }),
        "{error:?}"
    );
    assert_eq!(AppError::from(error).code, ErrorCode::Conflict);
}

#[tokio::test]
async fn f14_2_unapprove_posts_to_unapprove_and_nothing_else() {
    let server = MockServer::start().await;
    serve(
        &server,
        "unapprove",
        ResponseTemplate::new(201).set_body_json(approved_answer()),
    )
    .await;

    approvals::unapprove(&client(&server), PROJECT, 6)
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].url.path().ends_with("/unapprove"));
}

#[tokio::test]
async fn f14_2_unapprove_failure_is_an_error_not_a_made_up_success() {
    let server = MockServer::start().await;
    serve(&server, "unapprove", ResponseTemplate::new(404)).await;

    let error = approvals::unapprove(&client(&server), PROJECT, 6)
        .await
        .unwrap_err();

    assert_eq!(error, GitlabError::NotFound);
}

#[test]
fn f14_2_command_refuses_other_sha() {
    approvals::check_reviewed_head(HEAD, HEAD).unwrap();
    let other = "0000000000000000000000000000000000000000";
    let error = approvals::check_reviewed_head(other, HEAD).unwrap_err();
    assert_eq!(error.code, ErrorCode::Conflict);
}

#[test]
fn f14_2_command_refuses_an_empty_reviewed_head() {
    // A "drafts only" session has no reviewed head; nothing was reviewed, so nothing is approved.
    let error = approvals::check_reviewed_head(HEAD, "").unwrap_err();
    assert_eq!(error.code, ErrorCode::Conflict);
}
