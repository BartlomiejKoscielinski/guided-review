//! GitLab's side of the reviewer suggestions of S-11 (F-27.3) against wiremock: the project
//! members that the free search and the suggestions are matched to (`GET /projects/:id/members/
//! all?query=`, docs/05-integrations.md) and the merged MRs of the last 30 days with their
//! reviewers and changed paths (GraphQL, M7 decision 17). Reads only.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::members;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::reviewers::history::merged_mrs;
use serde_json::json;
use wiremock::matchers::{body_partial_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const MEMBERS: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/members/all";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

/// One entry of GitLab's members list with the keys it really sends.
fn user(id: u64, username: &str, name: &str, state: &str) -> serde_json::Value {
    json!({
        "id": id, "username": username, "name": name, "state": state,
        "avatar_url": "https://gitlab.local/avatar.png", "web_url": "https://gitlab.local/u",
        "access_level": 30, "created_at": "2026-01-02T10:00:00.000Z", "expires_at": null
    })
}

async fn found(server: &MockServer, query: &str, body: serde_json::Value) {
    Mock::given(method("GET"))
        .and(path(MEMBERS))
        .and(query_param("query", query))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .expect(1)
        .mount(server)
        .await;
}

fn rows(found: &[members::Member]) -> Vec<(u64, &str, &str)> {
    found
        .iter()
        .map(|m| (m.id, m.username.as_str(), m.name.as_str()))
        .collect()
}

#[tokio::test]
async fn f27_3_members_search_asks_the_project_and_keeps_active_members() {
    let server = MockServer::start().await;
    found(
        &server,
        "ola",
        json!([
            user(7, "ola.m", "Ola M.", "active"),
            user(8, "ola.stara", "Ola S.", "blocked"),
        ]),
    )
    .await;
    let list = members::search(&client(&server), PROJECT, "ola")
        .await
        .unwrap();
    assert_eq!(rows(&list), [(7, "ola.m", "Ola M.")]);
}

#[tokio::test]
async fn f27_3_members_search_sends_polish_characters_as_typed() {
    let server = MockServer::start().await;
    found(
        &server,
        "Żółć",
        json!([user(9, "zolc.l", "Łukasz Żółć", "active")]),
    )
    .await;
    let list = members::search(&client(&server), PROJECT, "Żółć")
        .await
        .unwrap();
    assert_eq!(rows(&list), [(9, "zolc.l", "Łukasz Żółć")]);
}

#[tokio::test]
async fn f27_3_members_search_a_rejected_token_is_the_unauthorized_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MEMBERS))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(json!({"message": "401 Unauthorized"})),
        )
        .mount(&server)
        .await;
    let error = members::search(&client(&server), PROJECT, "ola")
        .await
        .unwrap_err();
    assert_eq!(AppError::from(error).code, ErrorCode::GitlabUnauthorized);
}

#[tokio::test]
async fn f27_3_history_reads_reviewers_and_paths_of_the_merged_mrs() {
    let server = MockServer::start().await;
    let since = "2026-09-24T10:00:00Z";
    Mock::given(method("POST"))
        .and(path("/api/graphql"))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .and(body_partial_json(
            json!({ "variables": { "project": PROJECT, "mergedAfter": since } }),
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": { "project": {
            "mergeRequests": { "nodes": [
                {
                    "reviewers": { "nodes": [{ "username": "piotr.s" }, { "username": "ola.m" }] },
                    "diffStats": [{ "path": "src/App/Views/Main.xaml" }, { "path": "README.md" }]
                },
                {
                    "reviewers": { "nodes": [] },
                    "diffStats": [{ "path": "Widoki/Żółć/Lista ąę.cs" }]
                }
            ] }
        } } })),
        )
        .expect(1)
        .mount(&server)
        .await;
    let mrs = merged_mrs(&client(&server), PROJECT, since).await.unwrap();
    assert_eq!(mrs.len(), 2);
    assert_eq!(mrs[0].reviewers, ["piotr.s", "ola.m"]);
    assert_eq!(mrs[0].paths, ["src/App/Views/Main.xaml", "README.md"]);
    assert!(mrs[1].reviewers.is_empty());
    assert_eq!(mrs[1].paths, ["Widoki/Żółć/Lista ąę.cs"]);
}
