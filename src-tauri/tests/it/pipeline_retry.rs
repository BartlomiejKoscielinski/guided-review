//! "Retried: failed again on the same test." on S-08 (F-20.9, M6 decision 15) against wiremock.
//! A failed attempt whose previous attempt of the same job in the same pipeline failed on exactly
//! the same set of tests reads `retried_same_failure = true`; different tests, no test names in
//! either attempt, a first attempt or a job that did not fail read false. Read only. Synthetic
//! values (ADR-019).
//!
//! The tests pin these names (the plan's `review/pipeline_view.rs` and `review/retry_signature.rs`):
//! - `pipeline_view::job_details(client, project, job_id) -> Result<JobDetailsView, GitlabError>`.
//! - `JobDetailsView { retried_same_failure: bool }`, serialized camelCase (`retriedSameFailure`).
//!
//! What the core may call (every endpoint below is mounted in every test, so the order and the
//! number of reads are free): `GET …/jobs/:id` (name, status, `pipeline.id`),
//! `GET …/pipelines/:p/jobs?include_retried=true` (the earlier attempts of a name are the jobs of
//! that name with `retried: true`; the previous attempt is the one with the highest id below the
//! job's), `GET …/pipelines/:p/test_report` (the suite named like the job lists failed cases;
//! it describes the latest attempt only) and `GET …/jobs/:id/trace` (the `Failed <name>` lines
//! of a log). The signature is the sorted set of failed test names; order does not matter.
//!
//! Not pinned: which of the report or the log is read first when both name tests.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::pipeline_view;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const BASE: &str = "/api/v4/projects/sandbox%2Fgr-sandbox";
const PIPELINE: u64 = 18_342;
const NAME: &str = "unit-tests";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn job(id: u64, status: &str, retried: bool) -> Value {
    json!({
        "id": id, "name": NAME, "stage": "test", "status": status, "allow_failure": false,
        "retried": retried, "pipeline": { "id": PIPELINE, "sha": "a3f9c12" }
    })
}

fn log_of(tests: &[&str]) -> String {
    let mut text = String::from("$ dotnet test\n");
    for t in tests {
        text.push_str(&format!("  Failed {t} [41 ms]\n"));
    }
    text.push_str("ERROR: Job failed: exit code 1\n");
    text
}

fn report_of(tests: &[&str]) -> Value {
    let cases: Vec<Value> = tests
        .iter()
        .map(|t| json!({ "status": "failed", "name": t, "classname": "Queue.Tests" }))
        .collect();
    json!({ "test_suites": [{ "name": NAME, "failed_count": cases.len(), "test_cases": cases }] })
}

fn no_report() -> Value {
    json!({ "test_suites": [] })
}

struct Attempt<'a> {
    id: u64,
    log: &'a [&'a str],
}

async fn mount_get(server: &MockServer, url: String, response: ResponseTemplate) {
    Mock::given(method("GET"))
        .and(path(url))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(response)
        .mount(server)
        .await;
}

/// Mounts the pipeline with `earlier` attempts (retried) and the `current` one, all failed.
async fn serve(server: &MockServer, earlier: &[Attempt<'_>], current: &Attempt<'_>, report: Value) {
    let mut all: Vec<Value> = earlier.iter().map(|a| job(a.id, "failed", true)).collect();
    all.push(job(current.id, "failed", false));
    for a in earlier.iter().chain(std::iter::once(current)) {
        let one = job(a.id, "failed", a.id != current.id);
        mount_get(
            server,
            format!("{BASE}/jobs/{}", a.id),
            ResponseTemplate::new(200).set_body_json(one),
        )
        .await;
        mount_get(
            server,
            format!("{BASE}/jobs/{}/trace", a.id),
            ResponseTemplate::new(200).set_body_string(log_of(a.log)),
        )
        .await;
    }
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{PIPELINE}/jobs")))
        .and(query_param("include_retried", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(all))
        .mount(server)
        .await;
    mount_get(
        server,
        format!("{BASE}/pipelines/{PIPELINE}/test_report"),
        ResponseTemplate::new(200).set_body_json(report),
    )
    .await;
}

async fn same(server: &MockServer, job_id: u64) -> bool {
    pipeline_view::job_details(&client(server), PROJECT, job_id)
        .await
        .unwrap()
        .retried_same_failure
}

#[tokio::test]
async fn f20_9_same_failed_tests_in_both_attempts_is_true() {
    let server = MockServer::start().await;
    let a = ["Queue.Orders_Sort", "Queue.Orders_Page"];
    let b = ["Queue.Orders_Page", "Queue.Orders_Sort"];
    serve(
        &server,
        &[Attempt { id: 101, log: &a }],
        &Attempt { id: 102, log: &b },
        report_of(&b),
    )
    .await;

    assert!(same(&server, 102).await);
}

#[tokio::test]
async fn f20_9_same_failed_tests_from_the_logs_alone_is_true() {
    let server = MockServer::start().await;
    let a = ["Queue.Orders_Sort"];
    serve(
        &server,
        &[Attempt { id: 101, log: &a }],
        &Attempt { id: 102, log: &a },
        no_report(),
    )
    .await;

    assert!(same(&server, 102).await);
}

#[tokio::test]
async fn f20_9_a_different_failed_test_is_false() {
    let server = MockServer::start().await;
    let before = ["Queue.Orders_Sort"];
    let after = ["Queue.Orders_Page"];
    serve(
        &server,
        &[Attempt {
            id: 101,
            log: &before,
        }],
        &Attempt {
            id: 102,
            log: &after,
        },
        report_of(&after),
    )
    .await;

    assert!(!same(&server, 102).await);
}

#[tokio::test]
async fn f20_9_one_extra_failed_test_is_false() {
    let server = MockServer::start().await;
    let before = ["Queue.Orders_Sort"];
    let after = ["Queue.Orders_Sort", "Queue.Orders_Page"];
    serve(
        &server,
        &[Attempt {
            id: 101,
            log: &before,
        }],
        &Attempt {
            id: 102,
            log: &after,
        },
        report_of(&after),
    )
    .await;

    assert!(!same(&server, 102).await);
}

#[tokio::test]
async fn f20_9_no_test_names_in_either_attempt_is_false() {
    let server = MockServer::start().await;
    serve(
        &server,
        &[Attempt { id: 101, log: &[] }],
        &Attempt { id: 102, log: &[] },
        no_report(),
    )
    .await;

    assert!(!same(&server, 102).await);
}

#[tokio::test]
async fn f20_9_test_names_in_only_one_attempt_is_false() {
    let server = MockServer::start().await;
    let after = ["Queue.Orders_Sort"];
    serve(
        &server,
        &[Attempt { id: 101, log: &[] }],
        &Attempt {
            id: 102,
            log: &after,
        },
        report_of(&after),
    )
    .await;

    assert!(!same(&server, 102).await);
}

#[tokio::test]
async fn f20_9_a_first_attempt_is_false() {
    let server = MockServer::start().await;
    let a = ["Queue.Orders_Sort"];
    serve(&server, &[], &Attempt { id: 102, log: &a }, report_of(&a)).await;

    assert!(!same(&server, 102).await);
}

#[tokio::test]
async fn f20_9_only_the_previous_attempt_counts() {
    let server = MockServer::start().await;
    let old = ["Queue.Orders_Page"];
    let last = ["Queue.Orders_Sort"];
    serve(
        &server,
        &[
            Attempt { id: 101, log: &old },
            Attempt {
                id: 102,
                log: &last,
            },
        ],
        &Attempt {
            id: 103,
            log: &last,
        },
        report_of(&last),
    )
    .await;

    assert!(same(&server, 103).await);
}

#[tokio::test]
async fn f20_9_a_job_that_did_not_fail_is_false() {
    let server = MockServer::start().await;
    let a = ["Queue.Orders_Sort"];
    mount_get(
        &server,
        format!("{BASE}/jobs/102"),
        ResponseTemplate::new(200).set_body_json(job(102, "success", false)),
    )
    .await;
    mount_get(
        &server,
        format!("{BASE}/pipelines/{PIPELINE}/jobs"),
        ResponseTemplate::new(200)
            .set_body_json(vec![job(101, "failed", true), job(102, "success", false)]),
    )
    .await;
    mount_get(
        &server,
        format!("{BASE}/jobs/101/trace"),
        ResponseTemplate::new(200).set_body_string(log_of(&a)),
    )
    .await;
    mount_get(
        &server,
        format!("{BASE}/jobs/102/trace"),
        ResponseTemplate::new(200).set_body_string(log_of(&[])),
    )
    .await;
    mount_get(
        &server,
        format!("{BASE}/pipelines/{PIPELINE}/test_report"),
        ResponseTemplate::new(200).set_body_json(no_report()),
    )
    .await;

    assert!(!same(&server, 102).await);
}

#[test]
fn f20_9_the_view_serializes_as_retried_same_failure_in_camel_case() {
    let view = pipeline_view::JobDetailsView {
        retried_same_failure: true,
    };

    assert_eq!(
        serde_json::to_value(view).unwrap(),
        json!({ "retriedSameFailure": true })
    );
}
