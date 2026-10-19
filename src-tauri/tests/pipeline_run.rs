//! Run new pipeline (F-20.3, M6 decision 8) against wiremock: the one `POST …/merge_requests/
//! :iid/pipelines` that starts a merge request pipeline, the tab it returns, GitLab's refusal
//! reason, and the MR's head SHA the confirmation strip shows ("Run a new merge request pipeline
//! on a3f9c12? …"). Synthetic values (ADR-019); the SHAs and numbers are those of the mock
//! `Pipeline.dc.html` (!482, the new pipeline #18351 on version 3).
//!
//! The tests pin these names (the plan's `review/pipeline_view.rs` next to F-20.1's tabs):
//! - `pipeline_view::run_mr_pipeline(client, project, iid) -> Result<PipelineTab, GitlabError>`:
//!   exactly one POST (no body is needed), answered with the new pipeline; the tab is built from
//!   that answer (`id`, `number` = `id`, `sha`, `status` per decision 1, `latest: true`) and the
//!   MR's versions (`version` by the pipeline SHA, `None` when no version has that head).
//! - `pipeline_view::mr_head_sha(client, project, iid) -> Result<String, GitlabError>`: the full
//!   head SHA of the MR from `GET …/merge_requests/:iid` (the screen shows 7 chars). Read only.
//! - `AppError::from(GitlabError::Status { status: 400, message: Some(text) })` carries `text` as
//!   its `message` (code `InvalidInput`), so the screen's "Couldn't run a pipeline. <reason>" can
//!   show GitLab's reason in plain words; without a message it still has a sentence of its own.
//!
//! Not pinned: how the POST body looks, the other fields of the answer, the paging of versions.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::mrs::PipelineState;
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

const V2: &str = "6a02f9e0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0";
const V3: &str = "a3f9c120c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
const ORPHAN: &str = "dead0000d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

async fn serve_versions(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/versions")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            { "id": 903, "head_commit_sha": V3, "base_commit_sha": "ba5e00",
              "start_commit_sha": "57a400", "state": "collected" },
            { "id": 902, "head_commit_sha": V2, "base_commit_sha": "ba5e00",
              "start_commit_sha": "57a400", "state": "collected" }
        ])))
        .mount(server)
        .await;
}

/// The answer of `POST …/merge_requests/:iid/pipelines`: the new pipeline, just created.
fn created(sha: &str) -> Value {
    json!({
        "id": 18_351, "iid": 51, "project_id": 3, "sha": sha,
        "ref": "refs/merge-requests/482/head", "status": "created",
        "source": "merge_request_event",
        "created_at": "2026-10-19T12:00:00.000Z", "updated_at": "2026-10-19T12:00:00.000Z",
        "user": { "id": 7, "username": "bartek.k", "name": "Bartek K." },
        "web_url": "https://gitlab.local/sandbox/gr-sandbox/-/pipelines/18351"
    })
}

async fn serve_post(server: &MockServer, status: u16, body: Value, times: u64) {
    Mock::given(method("POST"))
        .and(path(format!("{BASE}/merge_requests/{IID}/pipelines")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .expect(times)
        .mount(server)
        .await;
}

#[tokio::test]
async fn f20_3_running_sends_exactly_one_post_and_returns_the_new_pipeline_as_the_latest_tab() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_post(&server, 201, created(V3), 1).await;

    let tab = pipeline_view::run_mr_pipeline(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    assert_eq!(tab.id, 18_351);
    assert_eq!(tab.number, 18_351, "the number is the pipeline id, as in F-20.1");
    assert_eq!(tab.sha, V3, "the full SHA; the screen shows 7 chars");
    assert_eq!(tab.version, Some(3));
    assert!(tab.latest, "the new pipeline is the newest, so it is the latest tab");
    assert_eq!(tab.status, PipelineState::Running, "created reads as Running (decision 1)");
    // `expect(1)` on the POST is checked when the server drops.
}

#[tokio::test]
async fn f20_3_a_pipeline_on_a_sha_no_version_has_gets_no_version() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_post(&server, 201, created(ORPHAN), 1).await;

    let tab = pipeline_view::run_mr_pipeline(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    assert_eq!(tab.id, 18_351);
    assert_eq!(tab.version, None);
}

#[tokio::test]
async fn f20_3_the_confirmation_reads_the_head_and_posts_nothing() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "iid": IID, "title": "Fix the login redirect", "source_branch": "fix/login",
            "target_branch": "main", "sha": V3, "state": "opened"
        })))
        .expect(1)
        .mount(&server)
        .await;
    // Reading the head must never start a pipeline.
    serve_post(&server, 201, created(V3), 0).await;

    let sha = pipeline_view::mr_head_sha(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    assert_eq!(sha, V3);
}

#[tokio::test]
async fn f20_3_a_gitlab_400_keeps_its_message_for_the_screen() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_post(
        &server,
        400,
        json!({ "message": "No stages / jobs for this pipeline." }),
        1,
    )
    .await;

    let error = pipeline_view::run_mr_pipeline(&client(&server), PROJECT, IID)
        .await
        .unwrap_err();

    assert!(
        matches!(&error, GitlabError::Status { status: 400, message }
            if message.as_deref() == Some("No stages / jobs for this pipeline.")),
        "{error:?}"
    );
}

#[tokio::test]
async fn f20_3_a_forbidden_run_is_gitlab_forbidden_with_its_message() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_post(&server, 403, json!({ "message": "403 Forbidden" }), 1).await;

    let error = pipeline_view::run_mr_pipeline(&client(&server), PROJECT, IID)
        .await
        .unwrap_err();

    assert!(
        matches!(&error, GitlabError::Forbidden { message } if message.as_deref() == Some("403 Forbidden")),
        "{error:?}"
    );
}

#[test]
fn f20_3_a_400_reaches_the_screen_with_gitlabs_reason_as_its_message() {
    let app = AppError::from(GitlabError::Status {
        status: 400,
        message: Some("No stages / jobs for this pipeline.".into()),
    });

    assert_eq!(app.code, ErrorCode::InvalidInput);
    assert_eq!(app.message, "No stages / jobs for this pipeline.");
    assert!(!app.retryable);
}

#[test]
fn f20_3_a_400_without_a_message_still_says_something() {
    let app = AppError::from(GitlabError::Status {
        status: 400,
        message: None,
    });

    assert_eq!(app.code, ErrorCode::InvalidInput);
    assert!(!app.message.trim().is_empty());
}
