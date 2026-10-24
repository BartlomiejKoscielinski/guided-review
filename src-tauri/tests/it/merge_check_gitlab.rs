//! "An MR for this branch already exists" of S-11 (F-27.5, M7 decision 19) against wiremock:
//! `GET /projects/:id/merge_requests?source_branch=<branch>&state=opened` and the first open MR
//! it names (the banner with the link; Create is disabled). Reads only.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::branch_mr::open_for_branch;
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use serde_json::json;
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const MRS: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests";
const BRANCH: &str = "feature/zażółć";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn mr(iid: u64, title: &str) -> serde_json::Value {
    json!({
        "id": 9000 + iid, "iid": iid, "title": title, "state": "opened",
        "source_branch": BRANCH, "target_branch": "develop",
        "web_url": format!("https://gitlab.local/sandbox/gr-sandbox/-/merge_requests/{iid}"),
        "draft": false
    })
}

async fn answer(server: &MockServer, body: serde_json::Value) {
    Mock::given(method("GET"))
        .and(path(MRS))
        .and(query_param("source_branch", BRANCH))
        .and(query_param("state", "opened"))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .expect(1)
        .mount(server)
        .await;
}

#[tokio::test]
async fn f27_5_a_branch_without_an_open_mr_has_none() {
    let server = MockServer::start().await;
    answer(&server, json!([])).await;
    let found = open_for_branch(&client(&server), PROJECT, BRANCH)
        .await
        .unwrap();
    assert!(found.is_none());
}

#[tokio::test]
async fn f27_5_an_open_mr_of_the_branch_gives_its_number_title_and_link() {
    let server = MockServer::start().await;
    answer(&server, json!([mr(482, "Enable compiled bindings")])).await;
    let found = open_for_branch(&client(&server), PROJECT, BRANCH)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.iid, 482);
    assert_eq!(found.title, "Enable compiled bindings");
    assert_eq!(
        found.web_url,
        "https://gitlab.local/sandbox/gr-sandbox/-/merge_requests/482"
    );
}

#[tokio::test]
async fn f27_5_the_first_of_several_open_mrs_is_named() {
    let server = MockServer::start().await;
    answer(&server, json!([mr(490, "Newer"), mr(482, "Older")])).await;
    let found = open_for_branch(&client(&server), PROJECT, BRANCH)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.iid, 490);
}

#[tokio::test]
async fn f27_5_a_rejected_token_is_the_unauthorized_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MRS))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(json!({"message": "401 Unauthorized"})),
        )
        .mount(&server)
        .await;
    let error = open_for_branch(&client(&server), PROJECT, BRANCH)
        .await
        .unwrap_err();
    assert_eq!(AppError::from(error).code, ErrorCode::GitlabUnauthorized);
}
