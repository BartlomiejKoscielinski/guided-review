//! The approval state of an MR (F-14.1, M5 decision 14) against wiremock: one `GET
//! /projects/:id/merge_requests/:iid/approvals` read, and nothing else, becomes what the Approval
//! tile of S-05 shows ("Not approved yet" / "Approved by you", "Approvals: X of Y"). The answers
//! carry the fields of the S5 cassette (unlicensed EE 17.11.7, `field/baseline/standin-keysets.md`
//! › `mr_approvals.keys`; synthetic values, ADR-019), including the `approvals_required: 0` of an
//! MR that asks for no approval.
//!
//! The tests pin these names (the plan's `gitlab/approvals.rs`):
//! - `approvals::state(client, project, iid) -> Result<ApprovalState, GitlabError>`, read only.
//! - `ApprovalState { approved_by: Vec<GitlabUser>, approvals_required, user_has_approved,
//!   user_can_approve, require_password_to_approve }`, serialized in camelCase for the UI
//!   (`approvedBy`, `approvalsRequired`, `userHasApproved`, `userCanApprove`,
//!   `requirePasswordToApprove`); `approved_by` is the people of GitLab's `approved_by[].user`, in
//!   GitLab's order, so the tile's X is its length.
//!
//! Not pinned: `user_can_approve` and `user_has_approved` missing from an answer (both are in the
//! S5 key set); the Approve and Revoke calls are F-14.2's.
#![allow(clippy::unwrap_used, reason = "tests")]

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

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn approvals_route() -> String {
    format!("{MR}/approvals")
}

/// One entry of `approved_by`: GitLab wraps the person in `user`.
fn approver(id: u64, username: &str, name: &str) -> Value {
    json!({ "user": {
        "id": id, "username": username, "name": name, "state": "active", "locked": false,
        "avatar_url": "https://gitlab.local/avatar.png", "web_url": "https://gitlab.local/u"
    } })
}

/// The `/approvals` answer with every key of the S5 cassette; `left` is what GitLab computes.
fn answer(
    approved_by: &[Value],
    required: u64,
    user_has_approved: bool,
    user_can_approve: bool,
    require_password: bool,
) -> Value {
    let given = approved_by.len() as u64;
    json!({
        "id": 1006, "iid": 6, "project_id": 3, "title": "Retry in UploadWorker after network loss",
        "description": "", "state": "opened", "merge_status": "can_be_merged",
        "created_at": "2026-10-12T14:00:00.000Z", "updated_at": "2026-10-12T15:00:00.000Z",
        "approved": given >= required,
        "approvals_required": required, "approvals_left": required.saturating_sub(given),
        "approved_by": approved_by,
        "approval_rules_left": [], "has_approval_rules": required > 0,
        "invalid_approvers_rules": [], "approvers": [], "approver_groups": [],
        "suggested_approvers": [],
        "merge_request_approvers_available": true, "multiple_approval_rules_available": true,
        "user_has_approved": user_has_approved, "user_can_approve": user_can_approve,
        "require_password_to_approve": require_password
    })
}

async fn serve(server: &MockServer, response: ResponseTemplate) {
    Mock::given(method("GET"))
        .and(path(approvals_route()))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(response)
        .mount(server)
        .await;
}

#[tokio::test]
async fn f14_1_an_mr_that_asks_for_no_approval_reads_as_none_required_and_none_given() {
    let server = MockServer::start().await;
    serve(
        &server,
        ResponseTemplate::new(200).set_body_json(answer(&[], 0, false, true, false)),
    )
    .await;

    let state = approvals::state(&client(&server), PROJECT, 6)
        .await
        .unwrap();

    assert!(state.approved_by.is_empty());
    assert_eq!(state.approvals_required, 0);
    assert!(!state.user_has_approved);
    assert!(state.user_can_approve);
    assert!(!state.require_password_to_approve);
}

#[tokio::test]
async fn f14_1_state_is_one_get_of_the_approvals_of_the_mr_and_nothing_is_written() {
    let server = MockServer::start().await;
    serve(
        &server,
        ResponseTemplate::new(200).set_body_json(answer(&[], 1, false, true, false)),
    )
    .await;

    approvals::state(&client(&server), PROJECT, 6)
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1, "{requests:?}");
    assert_eq!(requests[0].method.as_str(), "GET");
    assert_eq!(requests[0].url.path(), approvals_route());
}

#[tokio::test]
async fn f14_1_state_lists_who_approved_in_gitlabs_order_and_that_the_user_did() {
    let server = MockServer::start().await;
    let people = [
        approver(2, "dev", "Dev Stand-in"),
        approver(7, "pawel.s", "Paweł Żółć-Gęśla"),
    ];
    serve(
        &server,
        ResponseTemplate::new(200).set_body_json(answer(&people, 3, true, false, false)),
    )
    .await;

    let state = approvals::state(&client(&server), PROJECT, 6)
        .await
        .unwrap();

    let who: Vec<(&str, &str)> = state
        .approved_by
        .iter()
        .map(|user| (user.username.as_str(), user.name.as_str()))
        .collect();
    assert_eq!(
        who,
        [("dev", "Dev Stand-in"), ("pawel.s", "Paweł Żółć-Gęśla")]
    );
    assert_eq!(state.approvals_required, 3);
    assert!(state.user_has_approved);
}

#[tokio::test]
async fn f14_1_someone_elses_approval_does_not_make_it_the_users() {
    let server = MockServer::start().await;
    let people = [approver(3, "alice", "Alice Stand-in")];
    serve(
        &server,
        ResponseTemplate::new(200).set_body_json(answer(&people, 2, false, true, false)),
    )
    .await;

    let state = approvals::state(&client(&server), PROJECT, 6)
        .await
        .unwrap();

    assert_eq!(state.approved_by.len(), 1);
    assert!(!state.user_has_approved);
}

#[tokio::test]
async fn f14_1_state_reads_that_gitlab_will_not_let_the_user_approve_and_that_a_password_is_asked()
{
    let server = MockServer::start().await;
    serve(
        &server,
        ResponseTemplate::new(200).set_body_json(answer(&[], 1, false, false, true)),
    )
    .await;

    let state = approvals::state(&client(&server), PROJECT, 6)
        .await
        .unwrap();

    assert!(!state.user_can_approve);
    assert!(state.require_password_to_approve);
}

#[tokio::test]
async fn f14_1_keys_the_answer_leaves_out_read_as_none_required_and_no_password() {
    let server = MockServer::start().await;
    serve(
        &server,
        ResponseTemplate::new(200).set_body_json(json!({
            "approved_by": [],
            "user_has_approved": false, "user_can_approve": true
        })),
    )
    .await;

    let state = approvals::state(&client(&server), PROJECT, 6)
        .await
        .unwrap();

    assert!(state.approved_by.is_empty());
    assert_eq!(state.approvals_required, 0);
    assert!(!state.require_password_to_approve);
}

#[tokio::test]
async fn f14_1_state_reaches_the_ui_in_camel_case() {
    let server = MockServer::start().await;
    let people = [approver(3, "alice", "Alice Stand-in")];
    serve(
        &server,
        ResponseTemplate::new(200).set_body_json(answer(&people, 2, false, true, false)),
    )
    .await;

    let state = approvals::state(&client(&server), PROJECT, 6)
        .await
        .unwrap();

    assert_eq!(
        serde_json::to_value(&state).unwrap(),
        json!({
            "approvedBy": [{ "username": "alice", "name": "Alice Stand-in" }],
            "approvalsRequired": 2,
            "userHasApproved": false,
            "userCanApprove": true,
            "requirePasswordToApprove": false
        })
    );
}

#[tokio::test]
async fn f14_1_a_refusal_or_a_missing_mr_is_an_error_never_an_unapproved_state() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/7/approvals",
        ))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(json!({ "message": "403 Forbidden" })),
        )
        .mount(&server)
        .await;
    serve(
        &server,
        ResponseTemplate::new(404).set_body_json(json!({ "message": "404 Not found" })),
    )
    .await;

    let missing = approvals::state(&client(&server), PROJECT, 6).await;
    assert!(matches!(missing, Err(GitlabError::NotFound)), "{missing:?}");

    let refused = approvals::state(&client(&server), PROJECT, 7).await;
    assert!(
        matches!(refused, Err(GitlabError::Forbidden { .. })),
        "{refused:?}"
    );
}

#[tokio::test]
async fn f14_1_an_answer_that_is_not_an_approvals_object_is_an_error_not_a_made_up_state() {
    let server = MockServer::start().await;
    serve(
        &server,
        ResponseTemplate::new(200).set_body_json(json!(["not", "an", "object"])),
    )
    .await;

    let result = approvals::state(&client(&server), PROJECT, 6).await;

    assert!(matches!(result, Err(GitlabError::Decode(_))), "{result:?}");
}
