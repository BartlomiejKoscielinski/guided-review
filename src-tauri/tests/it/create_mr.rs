//! "Create merge request" of S-11 (F-27.6) against wiremock: `POST /projects/:id/merge_requests`
//! with the source and target branch, the title (`Draft: ` in front when Mark as draft is on),
//! the description, `reviewer_ids`, `remove_source_branch` and `squash`; the answer gives the
//! number, title, link and head pipeline of the MR GitLab made (`CreatedMr`, camelCase for IPC:
//! `iid`, `title`, `webUrl`, `pipeline` = `{ id, status }` or null while GitLab has none yet).
//! GitLab's own words for a refusal (409 an MR of the branch exists, 422 invalid) reach the
//! `AppError` message. Sent only by the explicit click, once per call.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::create_mr::{NewMr, create};
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path};
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

fn new_mr() -> NewMr {
    NewMr {
        source_branch: BRANCH.into(),
        target_branch: "develop".into(),
        title: "Enable compiled bindings".into(),
        description: "## What\nZażółć gęślą jaźń\n\n## Why\nBuild".into(),
        reviewer_ids: vec![2, 3],
        draft: false,
        remove_source_branch: true,
        squash: false,
    }
}

fn answer(pipeline: Value) -> Value {
    json!({
        "id": 9483, "iid": 483, "title": "Enable compiled bindings", "state": "opened",
        "source_branch": BRANCH, "target_branch": "develop",
        "web_url": "https://gitlab.local/sandbox/gr-sandbox/-/merge_requests/483",
        "draft": false, "head_pipeline": pipeline
    })
}

async fn accept(server: &MockServer, response: ResponseTemplate) {
    Mock::given(method("POST"))
        .and(path(MRS))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(response)
        .expect(1)
        .mount(server)
        .await;
}

async fn accept_created(server: &MockServer, pipeline: Value) {
    accept(
        server,
        ResponseTemplate::new(201).set_body_json(answer(pipeline)),
    )
    .await;
}

/// The JSON body of the one request the server got.
async fn sent(server: &MockServer) -> Value {
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1, "one POST per call");
    serde_json::from_slice(&requests[0].body).unwrap()
}

async fn created_json(server: &MockServer, mr: &NewMr) -> Value {
    let created = create(&client(server), PROJECT, mr).await.unwrap();
    serde_json::to_value(&created).unwrap()
}

#[tokio::test]
async fn f27_6_posts_the_branches_title_description_reviewers_and_options() {
    let server = MockServer::start().await;
    accept_created(&server, Value::Null).await;
    create(&client(&server), PROJECT, &new_mr()).await.unwrap();
    let body = sent(&server).await;
    assert_eq!(body["source_branch"], BRANCH);
    assert_eq!(body["target_branch"], "develop");
    assert_eq!(body["title"], "Enable compiled bindings");
    assert_eq!(
        body["description"],
        "## What\nZażółć gęślą jaźń\n\n## Why\nBuild"
    );
    assert_eq!(body["reviewer_ids"], json!([2, 3]));
    assert_eq!(body["remove_source_branch"], true);
    assert_eq!(body["squash"], false);
}

#[tokio::test]
async fn f27_6_the_options_are_sent_as_chosen() {
    let server = MockServer::start().await;
    accept_created(&server, Value::Null).await;
    let mr = NewMr {
        remove_source_branch: false,
        squash: true,
        ..new_mr()
    };
    create(&client(&server), PROJECT, &mr).await.unwrap();
    let body = sent(&server).await;
    assert_eq!(body["remove_source_branch"], false);
    assert_eq!(body["squash"], true);
}

#[tokio::test]
async fn f27_6_mark_as_draft_puts_draft_in_front_of_the_title() {
    let server = MockServer::start().await;
    accept_created(&server, Value::Null).await;
    let mr = NewMr {
        draft: true,
        ..new_mr()
    };
    create(&client(&server), PROJECT, &mr).await.unwrap();
    assert_eq!(
        sent(&server).await["title"],
        "Draft: Enable compiled bindings"
    );
}

#[tokio::test]
async fn f27_6_a_title_that_already_starts_with_draft_is_not_prefixed_twice() {
    let server = MockServer::start().await;
    accept_created(&server, Value::Null).await;
    let mr = NewMr {
        draft: true,
        title: "Draft: Enable compiled bindings".into(),
        ..new_mr()
    };
    create(&client(&server), PROJECT, &mr).await.unwrap();
    assert_eq!(
        sent(&server).await["title"],
        "Draft: Enable compiled bindings"
    );
}

#[tokio::test]
async fn f27_6_without_mark_as_draft_the_title_goes_as_typed() {
    let server = MockServer::start().await;
    accept_created(&server, Value::Null).await;
    let mr = NewMr {
        title: "Draft: my own choice".into(),
        ..new_mr()
    };
    create(&client(&server), PROJECT, &mr).await.unwrap();
    assert_eq!(sent(&server).await["title"], "Draft: my own choice");
}

#[tokio::test]
async fn f27_6_without_reviewers_none_are_sent() {
    let server = MockServer::start().await;
    accept_created(&server, Value::Null).await;
    let mr = NewMr {
        reviewer_ids: Vec::new(),
        ..new_mr()
    };
    create(&client(&server), PROJECT, &mr).await.unwrap();
    let body = sent(&server).await;
    let reviewers = &body["reviewer_ids"];
    assert!(
        reviewers.is_null() || reviewers == &json!([]),
        "no reviewer IDs expected, got {reviewers}"
    );
}

#[tokio::test]
async fn f27_6_the_created_mr_gives_its_number_title_link_and_pipeline() {
    let server = MockServer::start().await;
    let pipeline = json!({ "id": 18361, "iid": 7, "status": "running", "sha": "a".repeat(40) });
    accept_created(&server, pipeline).await;
    assert_eq!(
        created_json(&server, &new_mr()).await,
        json!({
            "iid": 483,
            "title": "Enable compiled bindings",
            "webUrl": "https://gitlab.local/sandbox/gr-sandbox/-/merge_requests/483",
            "pipeline": { "id": 18361, "status": "running" }
        })
    );
}

#[tokio::test]
async fn f27_6_a_draft_mr_gives_the_title_gitlab_stored() {
    let server = MockServer::start().await;
    let mut stored = answer(Value::Null);
    stored["title"] = json!("Draft: Enable compiled bindings");
    stored["draft"] = json!(true);
    accept(&server, ResponseTemplate::new(201).set_body_json(stored)).await;
    let mr = NewMr {
        draft: true,
        ..new_mr()
    };
    let created = created_json(&server, &mr).await;
    assert_eq!(created["title"], "Draft: Enable compiled bindings");
}

#[tokio::test]
async fn f27_6_no_pipeline_yet_is_null_and_not_an_error() {
    let server = MockServer::start().await;
    accept_created(&server, Value::Null).await;
    let created = created_json(&server, &new_mr()).await;
    assert_eq!(created["iid"], 483);
    assert!(created["pipeline"].is_null());
}

#[tokio::test]
async fn f27_6_a_pipeline_status_maps_to_the_pipeline_states_of_the_screens() {
    for (gitlab, expected) in [
        ("success", "passed"),
        ("pending", "running"),
        ("failed", "failed"),
    ] {
        let server = MockServer::start().await;
        accept_created(&server, json!({ "id": 18361, "status": gitlab })).await;
        let created = created_json(&server, &new_mr()).await;
        assert_eq!(
            created["pipeline"]["status"], expected,
            "GitLab said {gitlab}"
        );
    }
}

#[tokio::test]
async fn f27_6_an_open_mr_of_the_branch_is_a_conflict_with_gitlabs_words() {
    let server = MockServer::start().await;
    accept(
        &server,
        ResponseTemplate::new(409).set_body_json(json!({
            "message": ["Another open merge request already exists for this source branch: !482"]
        })),
    )
    .await;
    let error = create(&client(&server), PROJECT, &new_mr())
        .await
        .unwrap_err();
    let error = AppError::from(error);
    assert_eq!(error.code, ErrorCode::Conflict);
    assert!(
        error
            .message
            .contains("Another open merge request already exists for this source branch"),
        "message was: {}",
        error.message
    );
}

#[tokio::test]
async fn f27_6_a_refused_mr_shows_gitlabs_validation_words() {
    let server = MockServer::start().await;
    accept(
        &server,
        ResponseTemplate::new(422).set_body_json(json!({
            "message": { "base": ["You can't use same project/branch for source and target"] }
        })),
    )
    .await;
    let error = create(&client(&server), PROJECT, &new_mr())
        .await
        .unwrap_err();
    let error = AppError::from(error);
    assert_eq!(error.code, ErrorCode::InvalidInput);
    assert_eq!(
        error.message,
        "You can't use same project/branch for source and target"
    );
}

#[tokio::test]
async fn f27_6_a_blank_title_shows_gitlabs_422_words() {
    let server = MockServer::start().await;
    accept(
        &server,
        ResponseTemplate::new(422).set_body_json(json!({
            "message": { "title": ["can't be blank"] }
        })),
    )
    .await;
    let mr = NewMr {
        title: String::new(),
        ..new_mr()
    };
    let error = AppError::from(create(&client(&server), PROJECT, &mr).await.unwrap_err());
    assert_eq!(error.code, ErrorCode::InvalidInput);
    assert!(
        error.message.contains("title can't be blank"),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn f27_6_a_rejected_token_is_the_unauthorized_error() {
    let server = MockServer::start().await;
    accept(
        &server,
        ResponseTemplate::new(401).set_body_json(json!({"message": "401 Unauthorized"})),
    )
    .await;
    let error = create(&client(&server), PROJECT, &new_mr())
        .await
        .unwrap_err();
    assert_eq!(AppError::from(error).code, ErrorCode::GitlabUnauthorized);
}

#[tokio::test]
async fn f27_6_a_refused_post_is_not_sent_again() {
    let server = MockServer::start().await;
    accept(
        &server,
        ResponseTemplate::new(409).set_body_json(json!({"message": ["exists"]})),
    )
    .await;
    create(&client(&server), PROJECT, &new_mr())
        .await
        .unwrap_err();
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}
