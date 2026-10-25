//! The pipeline-level writes of S-08 (F-20.4, M6 decisions 6 and 9) against wiremock: **Retry
//! failed jobs** (`POST …/pipelines/:id/retry`) and **Cancel pipeline** (`POST …/pipelines/:id/
//! cancel`), each sent once and answered with the pipeline, and the `web_url` that **Open in
//! GitLab** hands to the browser (decision 13). Synthetic values (ADR-019); the numbers and SHAs
//! are those of the mock `Pipeline.dc.html` (!482: #18321 failed, the new #18351 running).
//!
//! The tests pin these names (the plan's `gitlab/pipelines.rs` and `review/pipeline_view.rs`):
//! - `gitlab::pipelines::retry(client, project, pipeline_id) -> Result<Pipeline, GitlabError>` and
//!   `gitlab::pipelines::cancel(client, project, pipeline_id) -> Result<Pipeline, GitlabError>`:
//!   exactly one POST, no job-level request; the answer is the pipeline GitLab returns.
//! - `pipeline_view::retry_pipeline(client, project, iid, pipeline_id, me)` and
//!   `pipeline_view::cancel_pipeline(...)`, both `-> Result<PipelineHead, GitlabError>` with the
//!   arguments of `pipeline_view::head`: the write, then the status block as it now is.
//! - `PipelineHead.web_url: Option<String>`, serialized `webUrl`: the pipeline's `web_url`, which
//!   `Open in GitLab` opens; `None` when GitLab sends none.
//! - A GitLab 403 stays `GitlabError::Forbidden { message }` with GitLab's own message (the
//!   screen's tooltip, decision 9).
//!
//! Not pinned: whether the head is built from the POST answer or from a second GET, the other
//! fields of the answer.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::mrs::PipelineState;
use guided_review_lib::gitlab::pipelines;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::pipeline_view;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const BASE: &str = "/api/v4/projects/sandbox%2Fgr-sandbox";
const IID: u64 = 482;

const V1: &str = "1111111e0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a";
const V2: &str = "6a02f9e0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0";
const V3: &str = "a3f9c120c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn web_url(id: u64) -> String {
    format!("https://gitlab.local/sandbox/gr-sandbox/-/pipelines/{id}")
}

/// A pipeline object as `GET`/`POST …/pipelines/:id…` answer it.
fn pipeline(id: u64, sha: &str, status: &str) -> Value {
    json!({
        "id": id, "iid": id - 18_300, "project_id": 3, "sha": sha,
        "ref": "refs/merge-requests/482/head", "status": status,
        "source": "merge_request_event",
        "created_at": "2026-10-19T10:00:00.000Z", "updated_at": "2026-10-19T10:20:00.000Z",
        "started_at": "2026-10-19T10:01:00.000Z",
        "user": { "id": 7, "username": "marta.k", "name": "Marta K.",
                  "web_url": "https://gitlab.local/u" },
        "web_url": web_url(id)
    })
}

async fn serve_versions(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/versions")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            { "id": 903, "head_commit_sha": V3, "base_commit_sha": "ba5e00",
              "start_commit_sha": "57a400", "state": "collected" },
            { "id": 902, "head_commit_sha": V2, "base_commit_sha": "ba5e00",
              "start_commit_sha": "57a400", "state": "collected" },
            { "id": 901, "head_commit_sha": V1, "base_commit_sha": "ba5e00",
              "start_commit_sha": "57a400", "state": "collected" }
        ])))
        .mount(server)
        .await;
}

async fn serve_get(server: &MockServer, body: Value) {
    let id = body["id"].as_u64().unwrap();
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{id}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{id}/jobs")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(server)
        .await;
}

async fn serve_post(
    server: &MockServer,
    id: u64,
    verb: &str,
    status: u16,
    body: Value,
    times: u64,
) {
    Mock::given(method("POST"))
        .and(path(format!("{BASE}/pipelines/{id}/{verb}")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .expect(times)
        .mount(server)
        .await;
}

#[tokio::test]
async fn f20_4_retry_posts_the_pipeline_retry_once_and_returns_the_pipeline() {
    let server = MockServer::start().await;
    serve_post(
        &server,
        18_321,
        "retry",
        201,
        pipeline(18_321, V2, "running"),
        1,
    )
    .await;

    let answered = pipelines::retry(&client(&server), PROJECT, 18_321)
        .await
        .unwrap();

    assert_eq!(answered.id, 18_321);
    assert_eq!(answered.status, "running");
    // `expect(1)` on the POST is checked when the server drops; any other request would be a 404.
}

#[tokio::test]
async fn f20_4_cancel_posts_the_pipeline_cancel_once_and_returns_the_pipeline() {
    let server = MockServer::start().await;
    serve_post(
        &server,
        18_351,
        "cancel",
        200,
        pipeline(18_351, V3, "canceling"),
        1,
    )
    .await;

    let answered = pipelines::cancel(&client(&server), PROJECT, 18_351)
        .await
        .unwrap();

    assert_eq!(answered.id, 18_351);
    assert_eq!(answered.status, "canceling");
}

#[tokio::test]
async fn f20_4_retry_never_touches_the_cancel_endpoint_and_cancel_never_the_retry_endpoint() {
    let server = MockServer::start().await;
    serve_post(
        &server,
        18_321,
        "retry",
        201,
        pipeline(18_321, V2, "running"),
        1,
    )
    .await;
    serve_post(
        &server,
        18_321,
        "cancel",
        200,
        pipeline(18_321, V2, "canceled"),
        0,
    )
    .await;

    pipelines::retry(&client(&server), PROJECT, 18_321)
        .await
        .unwrap();
}

#[tokio::test]
async fn f20_4_a_forbidden_retry_is_gitlab_forbidden_with_its_message() {
    let server = MockServer::start().await;
    serve_post(
        &server,
        18_321,
        "retry",
        403,
        json!({ "message": "403 Forbidden - You can't retry pipelines on this branch." }),
        1,
    )
    .await;

    let error = pipelines::retry(&client(&server), PROJECT, 18_321)
        .await
        .unwrap_err();

    assert!(
        matches!(&error, GitlabError::Forbidden { message }
            if message.as_deref() == Some("403 Forbidden - You can't retry pipelines on this branch.")),
        "{error:?}"
    );
}

#[tokio::test]
async fn f20_4_a_forbidden_cancel_is_gitlab_forbidden_with_its_message() {
    let server = MockServer::start().await;
    serve_post(
        &server,
        18_351,
        "cancel",
        403,
        json!({ "message": "403 Forbidden" }),
        1,
    )
    .await;

    let error = pipelines::cancel(&client(&server), PROJECT, 18_351)
        .await
        .unwrap_err();

    assert!(
        matches!(&error, GitlabError::Forbidden { message } if message.as_deref() == Some("403 Forbidden")),
        "{error:?}"
    );
}

#[tokio::test]
async fn f20_4_retrying_the_pipeline_returns_its_head_as_running() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_post(
        &server,
        18_321,
        "retry",
        201,
        pipeline(18_321, V2, "running"),
        1,
    )
    .await;
    serve_get(&server, pipeline(18_321, V2, "running")).await;

    let head = pipeline_view::retry_pipeline(&client(&server), PROJECT, IID, 18_321, "bartek.k")
        .await
        .unwrap();

    assert_eq!(head.status, PipelineState::Running);
    assert_eq!(head.number, 18_321);
    assert_eq!(head.version, Some(2));
    assert_eq!(head.web_url.as_deref(), Some(web_url(18_321).as_str()));
}

#[tokio::test]
async fn f20_4_canceling_the_pipeline_returns_its_head_as_canceled() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_post(
        &server,
        18_351,
        "cancel",
        200,
        pipeline(18_351, V3, "canceled"),
        1,
    )
    .await;
    serve_get(&server, pipeline(18_351, V3, "canceled")).await;

    let head = pipeline_view::cancel_pipeline(&client(&server), PROJECT, IID, 18_351, "bartek.k")
        .await
        .unwrap();

    assert_eq!(head.status, PipelineState::Canceled);
    assert_eq!(head.number, 18_351);
    assert_eq!(head.version, Some(3));
}

#[tokio::test]
async fn f20_4_a_forbidden_pipeline_retry_is_the_error_not_a_head() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_post(
        &server,
        18_321,
        "retry",
        403,
        json!({ "message": "403 Forbidden" }),
        1,
    )
    .await;
    serve_get(&server, pipeline(18_321, V2, "failed")).await;

    let error = pipeline_view::retry_pipeline(&client(&server), PROJECT, IID, 18_321, "bartek.k")
        .await
        .unwrap_err();

    assert!(matches!(error, GitlabError::Forbidden { .. }), "{error:?}");
}

#[tokio::test]
async fn f20_4_the_head_carries_the_web_url_for_open_in_gitlab() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_get(&server, pipeline(18_342, V3, "success")).await;

    let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_342, "bartek.k")
        .await
        .unwrap();
    let json = serde_json::to_value(&head).unwrap();

    assert_eq!(head.web_url.as_deref(), Some(web_url(18_342).as_str()));
    assert_eq!(json["webUrl"], web_url(18_342));
}

#[tokio::test]
async fn f20_4_a_pipeline_without_a_web_url_has_none_to_open() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    let mut body = pipeline(18_342, V3, "success");
    body.as_object_mut().unwrap().remove("web_url");
    serve_get(&server, body).await;

    let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_342, "bartek.k")
        .await
        .unwrap();

    assert_eq!(head.web_url, None);
    assert_eq!(serde_json::to_value(&head).unwrap()["webUrl"], Value::Null);
}
