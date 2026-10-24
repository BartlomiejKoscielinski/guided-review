//! F-26.6 below the Tauri layer: after **Push and reply** S-10 links to the pipeline GitLab started
//! for the pushed commit (docs/plans/M7.md F-26.6, decision 13). GitLab creates that pipeline
//! asynchronously, so the lookup answers `None` until the MR's pipeline list holds one for exactly
//! the pushed sha, and never points at an older pipeline. The screen asks again until the pipeline
//! is found (it polls for up to 30 s; the core answers one lookup per call). Read only.
//! Synthetic data only (ADR-019).
//!
//! The tests pin this name (beside `pipeline_view::tabs`, same `PipelineTab` as S-08's strip):
//! - `pipeline_view::tab_for_sha(client, project, iid, sha) -> Result<Option<PipelineTab>,
//!   GitlabError>`: the newest pipeline of the MR whose full `sha` equals `sha` (a short or
//!   partial sha matches nothing), `None` when there is none yet; a GitLab failure is an `Err`,
//!   never `None`.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::gitlab::client::GitlabClient;
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
const IID: u64 = 480;

/// The commit before the push (pipeline #18338 passed) and the pushed fix commit.
const OLD: &str = "9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40";
const PUSHED: &str = "c4a81f03d2e6b7a95f1c0e3d8b2a7469e5f0c1d2";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn listed(id: u64, sha: &str, status: &str) -> Value {
    json!({
        "id": id, "iid": id - 18_300, "project_id": 3, "sha": sha,
        "ref": "refs/merge-requests/480/head", "status": status,
        "source": "merge_request_event",
        "created_at": "2026-10-24T10:00:00.000Z", "updated_at": "2026-10-24T10:20:00.000Z",
        "web_url": format!("https://gitlab.local/sandbox/gr-sandbox/-/pipelines/{id}")
    })
}

async fn serve(server: &MockServer, pipelines: Value) {
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/versions")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            { "id": 902, "head_commit_sha": PUSHED, "base_commit_sha": "ba5e00",
              "start_commit_sha": "57a400", "state": "collected" },
            { "id": 901, "head_commit_sha": OLD, "base_commit_sha": "ba5e00",
              "start_commit_sha": "57a400", "state": "collected" }
        ])))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/pipelines")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(pipelines))
        .mount(server)
        .await;
}

#[tokio::test]
async fn f26_6_until_gitlab_started_one_for_the_pushed_sha_there_is_none_not_the_old_pipeline() {
    let server = MockServer::start().await;
    serve(&server, json!([listed(18_338, OLD, "success")])).await;

    let found = pipeline_view::tab_for_sha(&client(&server), PROJECT, IID, PUSHED)
        .await
        .unwrap();

    assert_eq!(found, None);
}

#[tokio::test]
async fn f26_6_the_pipeline_of_the_pushed_sha_is_found_with_its_number_and_state() {
    let server = MockServer::start().await;
    serve(
        &server,
        json!([
            listed(18_338, OLD, "success"),
            listed(18_360, PUSHED, "running")
        ]),
    )
    .await;

    let tab = pipeline_view::tab_for_sha(&client(&server), PROJECT, IID, PUSHED)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(tab.number, 18_360);
    assert_eq!(tab.sha, PUSHED);
    assert_eq!(tab.status, PipelineState::Running);
    assert!(tab.latest);
    assert_eq!(tab.version, Some(2));
}

#[tokio::test]
async fn f26_6_a_pending_pipeline_reads_as_running_and_a_finished_one_as_its_result() {
    for (rest, expected) in [
        ("pending", PipelineState::Running),
        ("created", PipelineState::Running),
        ("success", PipelineState::Passed),
        ("failed", PipelineState::Failed),
    ] {
        let server = MockServer::start().await;
        serve(&server, json!([listed(18_360, PUSHED, rest)])).await;

        let tab = pipeline_view::tab_for_sha(&client(&server), PROJECT, IID, PUSHED)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(tab.status, expected, "GitLab status {rest}");
    }
}

#[tokio::test]
async fn f26_6_with_several_pipelines_for_the_sha_the_newest_one_is_linked() {
    let server = MockServer::start().await;
    serve(
        &server,
        json!([
            listed(18_361, PUSHED, "running"),
            listed(18_338, OLD, "success"),
            listed(18_360, PUSHED, "failed")
        ]),
    )
    .await;

    let tab = pipeline_view::tab_for_sha(&client(&server), PROJECT, IID, PUSHED)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(tab.number, 18_361);
}

#[tokio::test]
async fn f26_6_a_short_or_partial_sha_matches_no_pipeline() {
    let server = MockServer::start().await;
    serve(&server, json!([listed(18_360, PUSHED, "running")])).await;

    for sha in [&PUSHED[..7], &PUSHED[..39], ""] {
        let found = pipeline_view::tab_for_sha(&client(&server), PROJECT, IID, sha)
            .await
            .unwrap();
        assert_eq!(found, None, "sha {sha:?}");
    }
}

#[tokio::test]
async fn f26_6_a_gitlab_failure_is_an_error_and_not_an_empty_answer() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/pipelines")))
        .respond_with(
            ResponseTemplate::new(500).set_body_json(json!({ "message": "500 Server Error" })),
        )
        .mount(&server)
        .await;

    let found = pipeline_view::tab_for_sha(&client(&server), PROJECT, IID, PUSHED).await;

    assert!(found.is_err());
}

#[tokio::test]
async fn f26_6_the_lookup_only_reads() {
    let server = MockServer::start().await;
    serve(&server, json!([listed(18_360, PUSHED, "running")])).await;

    pipeline_view::tab_for_sha(&client(&server), PROJECT, IID, PUSHED)
        .await
        .unwrap();

    let methods: Vec<String> = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| r.method.to_string())
        .collect();
    assert!(!methods.is_empty());
    assert!(methods.iter().all(|m| m == "GET"), "{methods:?}");
}
