//! F-20.6: playing a manual job with variables (M6 decision 11) against wiremock, and the last
//! values kept per project and job name in the `job_variables` table. Synthetic values (ADR-019).
//!
//! The tests pin these names:
//! - `gitlab::jobs::JobVariable { key: String, value: String }` (Clone, Debug, PartialEq).
//! - `pipeline_view::play_job(client, project, job_id, &[JobVariable]) -> Result<JobRow,
//!   GitlabError>`: exactly one `POST …/jobs/:id/play` whose JSON body carries
//!   `job_variables_attributes: [{key, value}]` in the given order; the row is built from the job
//!   GitLab answers with. A GitLab 403 stays `GitlabError::Forbidden { message }`.
//! - `store::job_variables::get(conn, project, job_name) -> Result<Vec<JobVariable>, StoreError>`
//!   (empty for a job name never played) and `store::job_variables::save(conn, project, job_name,
//!   &[JobVariable]) -> Result<(), StoreError>` (replaces the earlier values of that project and
//!   job name; the table is keyed by both).
//!
//! Not pinned: the body for an empty list beyond "no variable in it", the command wrapper that
//! saves only after a successful play (covered by the mock tests of the client).
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::jobs::JobVariable;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::pipeline_view;
use guided_review_lib::store::{Store, job_variables};
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const BASE: &str = "/api/v4/projects/sandbox%2Fgr-sandbox";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn var(key: &str, value: &str) -> JobVariable {
    JobVariable {
        key: key.to_owned(),
        value: value.to_owned(),
    }
}

fn job(id: u64, name: &str, status: &str) -> Value {
    json!({
        "id": id, "name": name, "stage": "test", "status": status, "allow_failure": false,
        "retried": false, "duration": null,
        "web_url": format!("https://gitlab.local/sandbox/gr-sandbox/-/jobs/{id}")
    })
}

async fn serve_play(server: &MockServer, id: u64, status: u16, body: Value, times: u64) {
    Mock::given(method("POST"))
        .and(path(format!("{BASE}/jobs/{id}/play")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .expect(times)
        .mount(server)
        .await;
}

fn body_of(request: &Request) -> Value {
    serde_json::from_slice(&request.body).unwrap()
}

#[tokio::test]
async fn f20_6_play_posts_the_variables_in_the_order_given_and_returns_the_job() {
    let server = MockServer::start().await;
    serve_play(
        &server,
        4401,
        200,
        job(4401, "ui-tests:ios-device", "pending"),
        1,
    )
    .await;

    let row = pipeline_view::play_job(
        &client(&server),
        PROJECT,
        4401,
        &[var("DEVICE", "iPhone 15"), var("RETRIES", "2")],
    )
    .await
    .unwrap();

    assert_eq!(row.id, 4401);
    assert_eq!(row.name, "ui-tests:ios-device");
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1, "play is the only request");
    assert_eq!(
        body_of(&requests[0]),
        json!({ "job_variables_attributes": [
            { "key": "DEVICE", "value": "iPhone 15" },
            { "key": "RETRIES", "value": "2" }
        ] })
    );
}

#[tokio::test]
async fn f20_6_play_sends_values_as_typed_including_spaces_and_polish_characters() {
    let server = MockServer::start().await;
    serve_play(&server, 4402, 200, job(4402, "distribute:qa", "pending"), 1).await;

    pipeline_view::play_job(
        &client(&server),
        PROJECT,
        4402,
        &[var("RELEASE_NOTES", "  MR !482 · kolejka zdjęć dostawy  ")],
    )
    .await
    .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        body_of(&requests[0])["job_variables_attributes"][0]["value"],
        "  MR !482 · kolejka zdjęć dostawy  "
    );
}

#[tokio::test]
async fn f20_6_play_without_variables_sends_no_variable() {
    let server = MockServer::start().await;
    serve_play(&server, 4403, 200, job(4403, "distribute:qa", "pending"), 1).await;

    pipeline_view::play_job(&client(&server), PROJECT, 4403, &[])
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    let attrs = &body_of(&requests[0])["job_variables_attributes"];
    assert!(attrs.is_null() || attrs.as_array().is_some_and(Vec::is_empty));
}

#[tokio::test]
async fn f20_6_a_forbidden_play_is_gitlab_forbidden_with_its_message() {
    let server = MockServer::start().await;
    serve_play(
        &server,
        4404,
        403,
        json!({ "message": "403 Forbidden - You are not allowed to play this job." }),
        1,
    )
    .await;

    let error = pipeline_view::play_job(&client(&server), PROJECT, 4404, &[var("A", "1")])
        .await
        .unwrap_err();

    match error {
        GitlabError::Forbidden { message } => {
            assert!(
                message
                    .unwrap()
                    .contains("You are not allowed to play this job.")
            );
        }
        other => panic!("expected Forbidden, got {other:?}"),
    }
}

#[test]
fn f20_6_a_job_name_never_played_has_no_saved_variables() {
    let store = Store::open_in_memory().unwrap();

    let vars = store
        .with_conn(|c| job_variables::get(c, PROJECT, "distribute:qa"))
        .unwrap();

    assert!(vars.is_empty());
}

#[test]
fn f20_6_saved_variables_are_read_back_per_project_and_job_name() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            job_variables::save(
                c,
                PROJECT,
                "ui-tests:ios-device",
                &[var("DEVICE", "iPhone 15")],
            )?;
            job_variables::save(c, PROJECT, "distribute:qa", &[var("RELEASE_NOTES", "x")])?;
            job_variables::save(c, "other/project", "distribute:qa", &[var("OTHER", "y")])
        })
        .unwrap();

    let get = |project: &str, name: &str| {
        store
            .with_conn(|c| job_variables::get(c, project, name))
            .unwrap()
    };

    assert_eq!(
        get(PROJECT, "ui-tests:ios-device"),
        vec![var("DEVICE", "iPhone 15")]
    );
    assert_eq!(
        get(PROJECT, "distribute:qa"),
        vec![var("RELEASE_NOTES", "x")]
    );
    assert_eq!(
        get("other/project", "distribute:qa"),
        vec![var("OTHER", "y")]
    );
    assert!(get(PROJECT, "sonar").is_empty());
}

#[test]
fn f20_6_saving_again_replaces_the_earlier_values_and_keeps_their_order() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            job_variables::save(c, PROJECT, "distribute:qa", &[var("A", "1"), var("B", "2")])?;
            job_variables::save(c, PROJECT, "distribute:qa", &[var("C", "3"), var("A", "9")])
        })
        .unwrap();

    let vars = store
        .with_conn(|c| job_variables::get(c, PROJECT, "distribute:qa"))
        .unwrap();

    assert_eq!(vars, vec![var("C", "3"), var("A", "9")]);
}
