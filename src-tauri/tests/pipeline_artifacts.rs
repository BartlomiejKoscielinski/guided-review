//! The artifacts of a successful job on S-08 (F-20.8, M6 decision 13) against wiremock:
//! `GET …/jobs/:id` (its `artifacts` list) and `GET …/projects/:id` (the project's `web_url`,
//! which the download URL is built from). Read only. Synthetic values (ADR-019); the files are
//! those of the mock `Pipeline.dc.html` (app-release.apk 48 MB, report.xml 212 KB).
//!
//! The tests pin these names (the plan's `review/pipeline_view.rs::artifacts`):
//! - `pipeline_view::artifacts(client, project, job_id) -> Result<Vec<JobArtifact>, GitlabError>`.
//! - `JobArtifact { name: String, size: String, url: String }`, serialized as is (all lower case
//!   words): `name` is the entry's `filename`; `size` is the entry's `size` in bytes shown in
//!   KB or MB (1024 based, whole numbers: 217088 B reads "212 KB", 50331648 B reads "48 MB");
//!   `url` is `<project web_url>/-/jobs/<id>/artifacts/download?file_type=<file_type>`.
//! - The `trace` and `metadata` kinds are not listed (they are the log and GitLab's own index).
//!
//! Not pinned: the size label under 1 KB, fractional sizes beyond the whole-number rule.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::pipeline_view;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const BASE: &str = "/api/v4/projects/sandbox%2Fgr-sandbox";
const WEB: &str = "https://gitlab.example/sandbox/gr-sandbox";
const JOB: u64 = 102;

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn entry(file_type: &str, filename: &str, size: u64) -> Value {
    json!({ "file_type": file_type, "filename": filename, "size": size, "file_format": null })
}

async fn serve(server: &MockServer, artifacts: Value) {
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/jobs/{JOB}")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": JOB, "name": "build:android", "stage": "build", "status": "success",
            "allow_failure": false, "artifacts": artifacts
        })))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(BASE))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": 3, "path_with_namespace": PROJECT, "web_url": WEB
        })))
        .mount(server)
        .await;
}

#[tokio::test]
async fn f20_8_the_trace_and_metadata_kinds_are_not_listed() {
    let server = MockServer::start().await;
    serve(
        &server,
        json!([
            entry("archive", "app-release.apk", 50_331_648),
            entry("metadata", "metadata.gz", 301),
            entry("trace", "job.log", 9_000),
            entry("junit", "report.xml", 217_088)
        ]),
    )
    .await;

    let list = pipeline_view::artifacts(&client(&server), PROJECT, JOB)
        .await
        .unwrap();

    let names: Vec<&str> = list.iter().map(|a| a.name.as_str()).collect();
    assert_eq!(names, vec!["app-release.apk", "report.xml"]);
}

#[tokio::test]
async fn f20_8_a_size_reads_in_kb_or_mb() {
    let server = MockServer::start().await;
    serve(
        &server,
        json!([
            entry("archive", "app-release.apk", 50_331_648),
            entry("junit", "report.xml", 217_088)
        ]),
    )
    .await;

    let list = pipeline_view::artifacts(&client(&server), PROJECT, JOB)
        .await
        .unwrap();

    assert_eq!(list[0].size, "48 MB");
    assert_eq!(list[1].size, "212 KB");
}

#[tokio::test]
async fn f20_8_the_download_url_is_built_from_the_projects_web_url() {
    let server = MockServer::start().await;
    serve(
        &server,
        json!([
            entry("archive", "app-release.apk", 50_331_648),
            entry("junit", "report.xml", 217_088)
        ]),
    )
    .await;

    let list = pipeline_view::artifacts(&client(&server), PROJECT, JOB)
        .await
        .unwrap();

    assert_eq!(
        list[0].url,
        format!("{WEB}/-/jobs/{JOB}/artifacts/download?file_type=archive")
    );
    assert_eq!(
        list[1].url,
        format!("{WEB}/-/jobs/{JOB}/artifacts/download?file_type=junit")
    );
}

#[tokio::test]
async fn f20_8_a_job_with_only_trace_and_metadata_has_no_artifacts() {
    let server = MockServer::start().await;
    serve(
        &server,
        json!([
            entry("trace", "job.log", 9_000),
            entry("metadata", "metadata.gz", 301)
        ]),
    )
    .await;

    let list = pipeline_view::artifacts(&client(&server), PROJECT, JOB)
        .await
        .unwrap();

    assert!(list.is_empty());
}

#[tokio::test]
async fn f20_8_a_job_without_the_artifacts_field_has_no_artifacts() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/jobs/{JOB}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": JOB, "name": "build:android", "stage": "build", "status": "success"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(BASE))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "web_url": WEB })))
        .mount(&server)
        .await;

    let list = pipeline_view::artifacts(&client(&server), PROJECT, JOB)
        .await
        .unwrap();

    assert!(list.is_empty());
}

#[tokio::test]
async fn f20_8_a_gitlab_refusal_is_the_error_not_an_empty_list() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/jobs/{JOB}")))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "message": "404 Not found" })),
        )
        .mount(&server)
        .await;

    let result = pipeline_view::artifacts(&client(&server), PROJECT, JOB).await;

    assert!(matches!(result, Err(GitlabError::NotFound)), "{result:?}");
}
