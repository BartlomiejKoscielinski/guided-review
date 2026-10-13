//! MR lists (F-02.1, F-02.2, ADR-024) against wiremock with GraphQL answers recorded from the
//! stand-in (`seed.rb`: !2–!4 wait for `dev`, !5 approved by `dev`, !6 is `dev`'s, !7 a draft).
#![allow(clippy::unwrap_used, reason = "tests")]

#[path = "support/cassette.rs"]
mod cassette;

use cassette::cassette;
use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::mrs::{self, MrCounts, MrList, MrTab, PipelineState};
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use serde_json::{Value, json};
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";

async fn graphql(server: &MockServer, variables: Value, body: Value) {
    Mock::given(method("POST"))
        .and(path("/api/graphql"))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .and(body_partial_json(json!({ "variables": variables })))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .expect(1)
        .mount(server)
        .await;
}

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

async fn list(server: &MockServer, tab: MrTab, page_size: u32, pages: u32) -> MrList {
    mrs::list(&client(server), PROJECT, "dev", tab, page_size, pages)
        .await
        .unwrap()
}

const COUNTS: MrCounts = MrCounts {
    waiting: 3,
    mine: 1,
    all: 6,
};

#[tokio::test]
async fn f02_1_waiting_for_me_is_reviewer_and_not_approved() {
    let server = MockServer::start().await;
    graphql(
        &server,
        json!({"project": PROJECT, "me": "dev", "reviewer": "dev", "not": {"approvedBy": ["dev"]}}),
        cassette("mr_list_waiting"),
    )
    .await;
    let list = list(&server, MrTab::Waiting, 100, 5).await;
    assert_eq!(list.tab, MrTab::Waiting);
    assert_eq!(list.counts, COUNTS);
    assert!(!list.truncated);
    let iids: Vec<u32> = list.rows.iter().map(|r| r.iid).collect();
    assert_eq!(iids, [4, 3, 2]);
    assert!(
        list.rows
            .iter()
            .all(|r| r.reviewer && !r.approved && !r.mine)
    );
}

#[tokio::test]
async fn f02_1_mine_lists_my_merge_requests() {
    let server = MockServer::start().await;
    graphql(&server, json!({"author": "dev"}), cassette("mr_list_mine")).await;
    let list = list(&server, MrTab::Mine, 100, 5).await;
    assert_eq!(list.counts, COUNTS);
    let [row] = list.rows.as_slice() else {
        panic!("{:?}", list.rows)
    };
    assert_eq!(row.iid, 6);
    assert!(row.mine);
    assert_eq!(row.author.name, "Dev Stand-in");
    assert_eq!(row.unresolved_threads, 2);
    assert_eq!(
        row.note.as_deref(),
        Some("2 unresolved threads from reviewers")
    );
}

#[tokio::test]
async fn f02_1_all_open_follows_cursor_pages() {
    let server = MockServer::start().await;
    let page1 = cassette("mr_list_all_page1");
    let cursor = page1["data"]["project"]["list"]["pageInfo"]["endCursor"].clone();
    graphql(&server, json!({"first": 4, "after": null}), page1).await;
    graphql(
        &server,
        json!({"first": 4, "after": cursor}),
        cassette("mr_list_all_page2"),
    )
    .await;
    let list = list(&server, MrTab::All, 4, 5).await;
    assert_eq!(list.counts.all, 6);
    let iids: Vec<u32> = list.rows.iter().map(|r| r.iid).collect();
    assert_eq!(iids, [7, 6, 5, 4, 3, 2]);
    assert!(!list.truncated);
}

#[tokio::test]
async fn f02_1_stops_after_max_pages_and_says_so() {
    let server = MockServer::start().await;
    graphql(&server, json!({"first": 4}), cassette("mr_list_all_page1")).await;
    let list = list(&server, MrTab::All, 4, 1).await;
    assert_eq!(list.rows.len(), 4);
    assert!(list.truncated);
}

#[tokio::test]
async fn f02_2_row_model_from_the_stand_in() {
    let server = MockServer::start().await;
    graphql(
        &server,
        json!({"first": 4, "after": null}),
        cassette("mr_list_all_page1"),
    )
    .await;
    let page1 = cassette("mr_list_all_page1");
    let cursor = page1["data"]["project"]["list"]["pageInfo"]["endCursor"].clone();
    graphql(
        &server,
        json!({"after": cursor}),
        cassette("mr_list_all_page2"),
    )
    .await;
    let list = list(&server, MrTab::All, 4, 5).await;
    let row = |iid: u32| list.rows.iter().find(|r| r.iid == iid).unwrap();

    let draft = row(7);
    assert!(draft.draft && draft.pipeline.is_none() && draft.note.is_none());
    assert_eq!(draft.author.username, "alice");

    let approved = row(5);
    assert!(approved.reviewer && approved.approved);
    assert_eq!(approved.pipeline, Some(PipelineState::Running));
    assert_eq!(approved.note.as_deref(), Some("You\u{2019}re a reviewer"));

    let large = row(4);
    assert_eq!(
        (large.additions, large.deletions, large.files),
        (749, 2, 45)
    );
    assert_eq!(large.pipeline, Some(PipelineState::Failed));
    assert_eq!(
        large.note.as_deref(),
        Some("Large: the plan splits it by layer")
    );

    let small = row(3);
    assert_eq!((small.additions, small.deletions, small.files), (1, 2, 1));
    assert_eq!(small.pipeline, Some(PipelineState::Passed));
    assert!(
        small
            .web_url
            .ends_with("/sandbox/gr-sandbox/-/merge_requests/3")
    );
    assert!(small.created_at.starts_with("2026-"));

    let text = serde_json::to_string(&list).unwrap();
    assert!(!text.contains("wiremock0000000"), "token in the payload");
}

#[tokio::test]
async fn f02_1_unknown_project_and_graphql_errors() {
    let server = MockServer::start().await;
    graphql(&server, json!({}), json!({"data": {"project": null}})).await;
    let error = mrs::list(&client(&server), PROJECT, "dev", MrTab::All, 100, 5)
        .await
        .unwrap_err();
    assert_eq!(error, GitlabError::NotFound);
    assert_eq!(AppError::from(error).code, ErrorCode::GitlabNotFound);

    let server = MockServer::start().await;
    graphql(
        &server,
        json!({}),
        json!({"errors": [{"message": "Field 'diffStatsSummary' doesn't exist on type 'MergeRequest'"}]}),
    )
    .await;
    let error = mrs::list(&client(&server), PROJECT, "dev", MrTab::All, 100, 5)
        .await
        .unwrap_err();
    assert!(matches!(&error, GitlabError::Graphql(m) if m.contains("diffStatsSummary")));
    assert_eq!(AppError::from(error).code, ErrorCode::Internal);
}
