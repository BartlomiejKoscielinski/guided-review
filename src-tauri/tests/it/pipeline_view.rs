//! The pipelines of an MR (F-20.1, M6 decisions 1 to 3) against wiremock: the tab strip of S-08
//! (`GET …/merge_requests/:iid/pipelines`, paged, newest first, "version N · latest") and the
//! status block of the selected pipeline (`GET …/pipelines/:id` plus its jobs for the allowed
//! failures). Everything is read only. The answers carry the fields of EE 17.11.7 as far as the
//! plan names them (the MR list has no `user` or `duration`, so the head needs the second GET);
//! synthetic values (ADR-019). The SHAs and numbers are those of the mock `Pipeline.dc.html`
//! (!482: #18342 and #18321 and #18320, versions 3 and 2).
//!
//! The tests pin these names (the plan's `review/pipeline_view.rs`):
//! - `pipeline_view::tabs(client, project, iid) -> Result<Vec<PipelineTab>, GitlabError>`.
//! - `pipeline_view::head(client, project, iid, pipeline_id, me) -> Result<PipelineHead,
//!   GitlabError>`; `me` is the signed-in username (as `mrs::list` takes it).
//! - `PipelineTab { id: u64, number: u64, sha: String, version: Option<u32>, latest: bool,
//!   status: PipelineState }`; `number` is GitLab's pipeline `id` (what its web page shows as
//!   "#18342", not the per-project `iid`); `sha` is the full SHA (the screen shows 7 chars).
//! - `PipelineHead { status: PipelineState, allowed_failures: u32, number: u64, kind: String,
//!   sha: String, version: Option<u32>, author: Option<String>, started_by_me: bool,
//!   started_at: Option<String>, duration_secs: Option<u64> }`, serialized in camelCase for the
//!   UI (`allowedFailures`, `startedByMe`, `startedAt`, `durationSecs`). `author` is the user's
//!   display name; `started_at` is GitLab's ISO time (the screen formats the age); the jobs are
//!   read from `GET …/pipelines/:id/jobs`.
//! - Version = the 1-based position of the MR version whose `head_commit_sha` is the pipeline SHA,
//!   counting from the oldest version (lowest id) as 1; `None` when no version has that head.
//!
//! Not pinned: the `PipelineState` of the other GitLab words beyond those below (`created`,
//! `preparing`, `waiting_for_resource`, `scheduled`, `manual`, `skipped`).
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::mrs::PipelineState;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::pipeline_view;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const BASE: &str = "/api/v4/projects/sandbox%2Fgr-sandbox";
const IID: u64 = 482;

const V1: &str = "1111111e0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a";
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

/// GitLab lists the versions newest first; the highest id is the latest.
async fn serve_versions(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/versions")))
        .and(header("PRIVATE-TOKEN", TOKEN))
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

/// One entry of the MR's pipeline list (no `user`, no `duration`: the S5 key set).
fn listed(id: u64, sha: &str, status: &str) -> Value {
    json!({
        "id": id, "iid": id - 18_300, "project_id": 3, "sha": sha, "ref": "refs/merge-requests/482/head",
        "status": status, "source": "merge_request_event",
        "created_at": "2026-10-19T10:00:00.000Z", "updated_at": "2026-10-19T10:20:00.000Z",
        "web_url": format!("https://gitlab.local/sandbox/gr-sandbox/-/pipelines/{id}")
    })
}

async fn serve_list(server: &MockServer, body: Value) {
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/pipelines")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

/// The three pipelines of the mock, listed in a scrambled order on purpose.
async fn serve_mock_pipelines(server: &MockServer) {
    serve_versions(server).await;
    serve_list(
        server,
        json!([
            listed(18_320, V2, "canceled"),
            listed(18_342, V3, "success"),
            listed(18_321, V2, "failed")
        ]),
    )
    .await;
}

#[tokio::test]
async fn f20_1_the_tabs_are_newest_first_whatever_order_gitlab_answers_in() {
    let server = MockServer::start().await;
    serve_mock_pipelines(&server).await;

    let tabs = pipeline_view::tabs(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    let ids: Vec<u64> = tabs.iter().map(|t| t.id).collect();
    assert_eq!(ids, vec![18_342, 18_321, 18_320]);
    // The number is the pipeline id of GitLab's page ("#18342"), not the per-project iid (42).
    let numbers: Vec<u64> = tabs.iter().map(|t| t.number).collect();
    assert_eq!(numbers, vec![18_342, 18_321, 18_320]);
}

#[tokio::test]
async fn f20_1_only_the_newest_pipeline_is_latest() {
    let server = MockServer::start().await;
    serve_mock_pipelines(&server).await;

    let tabs = pipeline_view::tabs(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    let latest: Vec<bool> = tabs.iter().map(|t| t.latest).collect();
    assert_eq!(latest, vec![true, false, false]);
}

#[tokio::test]
async fn f20_1_the_version_is_the_position_of_the_mr_version_with_the_pipelines_sha() {
    let server = MockServer::start().await;
    serve_mock_pipelines(&server).await;

    let tabs = pipeline_view::tabs(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    // GitLab lists the versions newest first (ids 903, 902, 901); version 1 is the oldest.
    let versions: Vec<Option<u32>> = tabs.iter().map(|t| t.version).collect();
    assert_eq!(versions, vec![Some(3), Some(2), Some(2)]);
    let shas: Vec<&str> = tabs.iter().map(|t| t.sha.as_str()).collect();
    assert_eq!(shas, vec![V3, V2, V2]);
}

#[tokio::test]
async fn f20_1_a_pipeline_whose_sha_is_in_no_version_has_no_version() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_list(
        &server,
        json!([
            listed(18_343, ORPHAN, "running"),
            listed(18_342, V3, "success")
        ]),
    )
    .await;

    let tabs = pipeline_view::tabs(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    assert_eq!(tabs[0].id, 18_343);
    assert_eq!(tabs[0].version, None);
    assert!(tabs[0].latest);
    assert_eq!(tabs[1].version, Some(3));
    assert!(!tabs[1].latest);
}

#[tokio::test]
async fn f20_1_a_tab_carries_the_status_of_its_pipeline() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_list(
        &server,
        json!([
            listed(18_345, V3, "pending"),
            listed(18_344, V3, "running"),
            listed(18_343, V3, "waiting_for_resource"),
            listed(18_342, V3, "success"),
            listed(18_321, V2, "failed"),
            listed(18_320, V2, "canceled"),
            listed(18_319, V2, "manual")
        ]),
    )
    .await;

    let tabs = pipeline_view::tabs(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    let status: Vec<PipelineState> = tabs.iter().map(|t| t.status).collect();
    assert_eq!(
        status,
        vec![
            // Decision 1: pending, created and preparing read as Running; waiting for a resource
            // and scheduled as Waiting.
            PipelineState::Running,
            PipelineState::Running,
            PipelineState::Waiting,
            PipelineState::Passed,
            PipelineState::Failed,
            PipelineState::Canceled,
            PipelineState::Manual,
        ]
    );
}

#[tokio::test]
async fn f20_1_the_tabs_follow_every_page_of_the_list() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/pipelines")))
        .and(query_param("page", "1"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", "2")
                .set_body_json(json!([listed(18_342, V3, "success")])),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/pipelines")))
        .and(query_param("page", "2"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", "")
                .set_body_json(json!([listed(18_321, V2, "failed")])),
        )
        .expect(1)
        .mount(&server)
        .await;

    let tabs = pipeline_view::tabs(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    let ids: Vec<u64> = tabs.iter().map(|t| t.id).collect();
    assert_eq!(ids, vec![18_342, 18_321]);
}

#[tokio::test]
async fn f20_1_an_mr_without_pipelines_has_no_tabs() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_list(&server, json!([])).await;

    let tabs = pipeline_view::tabs(&client(&server), PROJECT, IID)
        .await
        .unwrap();

    assert!(tabs.is_empty());
}

#[tokio::test]
async fn f20_1_a_gitlab_refusal_is_the_error_not_an_empty_strip() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/merge_requests/{IID}/pipelines")))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(json!({ "message": "403 Forbidden" })),
        )
        .mount(&server)
        .await;

    let error = pipeline_view::tabs(&client(&server), PROJECT, IID)
        .await
        .unwrap_err();

    assert!(matches!(error, GitlabError::Forbidden { .. }), "{error:?}");
}

/// `GET …/pipelines/:id`: the full object, with the user, the start and the duration.
fn full(
    id: u64,
    sha: &str,
    status: &str,
    source: &str,
    user: (&str, &str),
    duration: Value,
) -> Value {
    json!({
        "id": id, "iid": id - 18_300, "project_id": 3, "sha": sha, "ref": "refs/merge-requests/482/head",
        "status": status, "source": source,
        "created_at": "2026-10-19T10:00:00.000Z", "updated_at": "2026-10-19T10:20:00.000Z",
        "started_at": "2026-10-19T10:01:00.000Z", "finished_at": "2026-10-19T10:15:00.000Z",
        "duration": duration, "queued_duration": 3,
        "user": { "id": 7, "username": user.0, "name": user.1, "state": "active",
                  "web_url": "https://gitlab.local/u" },
        "web_url": format!("https://gitlab.local/sandbox/gr-sandbox/-/pipelines/{id}")
    })
}

async fn serve_pipeline(server: &MockServer, body: Value) {
    let id = body["id"].as_u64().unwrap();
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{id}")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

fn job(name: &str, status: &str, allow_failure: bool) -> Value {
    json!({ "id": 1, "name": name, "stage": "test", "status": status,
            "allow_failure": allow_failure, "retried": false })
}

async fn serve_jobs(server: &MockServer, id: u64, jobs: Vec<Value>) {
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{id}/jobs")))
        .respond_with(ResponseTemplate::new(200).set_body_json(jobs))
        .mount(server)
        .await;
}

#[tokio::test]
async fn f20_1_the_head_of_the_mock_pipeline_18342_reads_as_the_status_block() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_pipeline(
        &server,
        full(
            18_342,
            V3,
            "success",
            "merge_request_event",
            ("marta.k", "Marta K."),
            json!(840),
        ),
    )
    .await;
    serve_jobs(
        &server,
        18_342,
        vec![
            job("build:android", "success", false),
            job("ui-tests:android", "failed", true),
        ],
    )
    .await;

    let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_342, "bartek.k")
        .await
        .unwrap();

    assert_eq!(head.status, PipelineState::Passed);
    assert_eq!(head.number, 18_342);
    assert_eq!(head.kind, "Merge request pipeline");
    assert_eq!(head.sha, V3);
    assert_eq!(head.version, Some(3));
    assert_eq!(head.author.as_deref(), Some("Marta K."));
    assert!(!head.started_by_me);
    assert_eq!(head.started_at.as_deref(), Some("2026-10-19T10:01:00.000Z"));
    assert_eq!(head.duration_secs, Some(840));
    assert_eq!(head.allowed_failures, 1);
}

#[tokio::test]
async fn f20_1_the_head_serializes_in_camel_case_for_the_ui() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_pipeline(
        &server,
        full(
            18_342,
            V3,
            "success",
            "merge_request_event",
            ("marta.k", "Marta K."),
            json!(840),
        ),
    )
    .await;
    serve_jobs(
        &server,
        18_342,
        vec![job("ui-tests:android", "failed", true)],
    )
    .await;

    let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_342, "bartek.k")
        .await
        .unwrap();
    let json = serde_json::to_value(&head).unwrap();

    assert_eq!(json["status"], "passed");
    assert_eq!(json["allowedFailures"], 1);
    assert_eq!(json["startedByMe"], false);
    assert_eq!(json["durationSecs"], 840);
    assert_eq!(json["startedAt"], "2026-10-19T10:01:00.000Z");
}

#[tokio::test]
async fn f20_1_allowed_failures_are_counted_only_on_a_passed_pipeline() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_pipeline(
        &server,
        full(
            18_321,
            V2,
            "failed",
            "merge_request_event",
            ("marta.k", "Marta K."),
            json!(540),
        ),
    )
    .await;
    serve_jobs(
        &server,
        18_321,
        vec![
            job("unit-tests", "failed", false),
            job("ui-tests:android", "failed", true),
        ],
    )
    .await;

    let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_321, "bartek.k")
        .await
        .unwrap();

    assert_eq!(head.status, PipelineState::Failed);
    assert_eq!(head.version, Some(2));
    assert_eq!(head.allowed_failures, 0);
}

#[tokio::test]
async fn f20_1_a_passed_pipeline_counts_each_allowed_failed_job_and_nothing_else() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_pipeline(
        &server,
        full(
            18_342,
            V3,
            "success",
            "merge_request_event",
            ("marta.k", "Marta K."),
            json!(840),
        ),
    )
    .await;
    serve_jobs(
        &server,
        18_342,
        vec![
            job("ui-tests:android", "failed", true),
            job("sonar", "failed", true),
            job("build:android", "success", true),
            job("distribute:qa", "manual", true),
            job("unit-tests", "success", false),
        ],
    )
    .await;

    let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_342, "bartek.k")
        .await
        .unwrap();

    assert_eq!(head.allowed_failures, 2);
}

#[tokio::test]
async fn f20_1_a_passed_pipeline_without_allowed_failures_counts_none() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_pipeline(
        &server,
        full(
            18_342,
            V3,
            "success",
            "merge_request_event",
            ("marta.k", "Marta K."),
            json!(840),
        ),
    )
    .await;
    serve_jobs(
        &server,
        18_342,
        vec![job("build:android", "success", false)],
    )
    .await;

    let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_342, "bartek.k")
        .await
        .unwrap();

    assert_eq!(head.allowed_failures, 0);
}

#[tokio::test]
async fn f20_1_the_kind_is_gitlabs_source_in_words() {
    let sources = [
        ("merge_request_event", "Merge request pipeline"),
        ("push", "Branch pipeline"),
        ("schedule", "Schedule pipeline"),
        ("web", "Web pipeline"),
    ];
    for (source, kind) in sources {
        let server = MockServer::start().await;
        serve_versions(&server).await;
        serve_pipeline(
            &server,
            full(
                18_342,
                V3,
                "failed",
                source,
                ("marta.k", "Marta K."),
                json!(840),
            ),
        )
        .await;
        serve_jobs(&server, 18_342, vec![]).await;

        let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_342, "bartek.k")
            .await
            .unwrap();

        assert_eq!(head.kind, kind, "source {source}");
    }
}

#[tokio::test]
async fn f20_1_a_pipeline_started_by_the_signed_in_user_is_started_by_me() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_pipeline(
        &server,
        full(
            18_351,
            V3,
            "running",
            "merge_request_event",
            ("bartek.k", "Bartek K."),
            Value::Null,
        ),
    )
    .await;
    serve_jobs(&server, 18_351, vec![]).await;

    let mine = pipeline_view::head(&client(&server), PROJECT, IID, 18_351, "bartek.k")
        .await
        .unwrap();
    let other = pipeline_view::head(&client(&server), PROJECT, IID, 18_351, "marta.k")
        .await
        .unwrap();

    assert!(mine.started_by_me);
    assert_eq!(mine.author.as_deref(), Some("Bartek K."));
    assert_eq!(mine.status, PipelineState::Running);
    assert!(!other.started_by_me);
}

#[tokio::test]
async fn f20_1_a_running_pipeline_has_no_duration_yet() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_pipeline(
        &server,
        full(
            18_351,
            V3,
            "running",
            "merge_request_event",
            ("bartek.k", "Bartek K."),
            Value::Null,
        ),
    )
    .await;
    serve_jobs(&server, 18_351, vec![]).await;

    let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_351, "bartek.k")
        .await
        .unwrap();

    assert_eq!(head.duration_secs, None);
}

#[tokio::test]
async fn f20_1_a_head_whose_sha_is_in_no_version_has_no_version() {
    let server = MockServer::start().await;
    serve_versions(&server).await;
    serve_pipeline(
        &server,
        full(
            18_343,
            ORPHAN,
            "failed",
            "merge_request_event",
            ("marta.k", "Marta K."),
            json!(60),
        ),
    )
    .await;
    serve_jobs(&server, 18_343, vec![]).await;

    let head = pipeline_view::head(&client(&server), PROJECT, IID, 18_343, "bartek.k")
        .await
        .unwrap();

    assert_eq!(head.version, None);
    assert_eq!(head.sha, ORPHAN);
}
