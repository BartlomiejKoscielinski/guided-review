//! The jobs of a pipeline as S-08's stage columns (F-20.2, M6 decisions 5 and 6) against wiremock:
//! `GET …/pipelines/:id/jobs` (paged, retried attempts hidden), the stages in the order GitLab
//! created the jobs, the status words mapped to the eight row states, the one row action, and the
//! two POSTs that act at once (`…/jobs/:id/retry`, `…/jobs/:id/cancel`). Synthetic values
//! (ADR-019); the names are those of the mock `Pipeline.dc.html` (build, test, quality,
//! distribute).
//!
//! The tests pin these names (the plan's `review/pipeline_view.rs`, next to F-20.1's tabs):
//! - `pipeline_view::stages(client, project, pipeline_id) -> Result<Vec<StageColumn>, GitlabError>`.
//! - `pipeline_view::retry_job(client, project, job_id) -> Result<JobRow, GitlabError>` and
//!   `pipeline_view::cancel_job(client, project, job_id) -> Result<JobRow, GitlabError>`: the POST
//!   answers with the job (for a retry, the new attempt with its new id); the row is built from it.
//! - `StageColumn { name: String, jobs: Vec<JobRow> }`: `name` is GitLab's stage name as it is.
//! - `JobRow { id: u64, name: String, state: JobState, action: Option<JobAction>,
//!   duration_secs: Option<u64> }`, serialized in camelCase (`durationSecs`).
//! - `JobState` (serialized `passed`, `failed`, `failedAllowed`, `running`, `waiting`, `manual`,
//!   `canceled`, `skipped`) and `JobAction` (`retry`, `run`, `cancel`), both camelCase.
//!
//! Not pinned: how the core decodes the rest of a job, how it rounds a fractional duration (only
//! that the whole seconds come out), and the REST word `canceling`.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::pipeline_view::{self, JobAction, JobRow, JobState};
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const BASE: &str = "/api/v4/projects/sandbox%2Fgr-sandbox";
const PIPELINE: u64 = 18_342;

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

/// One job of `GET …/pipelines/:id/jobs` with the keys of EE 17.11.7 the plan names.
fn job(
    id: u64,
    name: &str,
    stage: &str,
    status: &str,
    allow_failure: bool,
    duration: Value,
) -> Value {
    json!({
        "id": id, "name": name, "stage": stage, "status": status,
        "allow_failure": allow_failure, "retried": false, "duration": duration,
        "created_at": "2026-10-19T10:00:00.000Z", "started_at": "2026-10-19T10:01:00.000Z",
        "web_url": format!("https://gitlab.local/sandbox/gr-sandbox/-/jobs/{id}"),
        "pipeline": { "id": PIPELINE, "project_id": 3, "status": "success" }
    })
}

async fn serve_jobs(server: &MockServer, jobs: Vec<Value>) {
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{PIPELINE}/jobs")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(jobs))
        .mount(server)
        .await;
}

/// The nine jobs of the mock's #18342 in creation order (ids ascending).
fn mock_jobs() -> Vec<Value> {
    vec![
        job(101, "restore", "build", "success", false, json!(48.2)),
        job(
            102,
            "build:android",
            "build",
            "success",
            false,
            json!(372.0),
        ),
        job(103, "build:ios", "build", "success", false, json!(460.9)),
        job(104, "unit-tests", "test", "success", false, json!(112.0)),
        job(
            105,
            "ui-tests:android",
            "test",
            "failed",
            true,
            json!(185.5),
        ),
        job(
            106,
            "ui-tests:ios-device",
            "test",
            "manual",
            true,
            Value::Null,
        ),
        job(
            107,
            "dotnet-format",
            "quality",
            "success",
            false,
            json!(22.0),
        ),
        job(108, "sonar", "quality", "success", false, json!(130.0)),
        job(
            109,
            "distribute:qa",
            "distribute",
            "manual",
            false,
            Value::Null,
        ),
    ]
}

fn names(stages: &[pipeline_view::StageColumn]) -> Vec<&str> {
    stages.iter().map(|s| s.name.as_str()).collect()
}

fn row<'a>(stages: &'a [pipeline_view::StageColumn], name: &str) -> &'a JobRow {
    stages
        .iter()
        .flat_map(|s| s.jobs.iter())
        .find(|j| j.name == name)
        .unwrap_or_else(|| panic!("no job {name}"))
}

#[tokio::test]
async fn f20_2_the_stages_follow_the_creation_order_whatever_order_gitlab_answers_in() {
    let server = MockServer::start().await;
    // GitLab lists the newest job first; the columns still run build, test, quality, distribute.
    let mut scrambled = mock_jobs();
    scrambled.reverse();
    scrambled.swap(0, 4);
    serve_jobs(&server, scrambled).await;

    let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap();

    assert_eq!(
        names(&stages),
        vec!["build", "test", "quality", "distribute"]
    );
}

#[tokio::test]
async fn f20_2_the_jobs_of_a_column_run_in_creation_order() {
    let server = MockServer::start().await;
    let mut scrambled = mock_jobs();
    scrambled.reverse();
    serve_jobs(&server, scrambled).await;

    let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap();

    let jobs: Vec<Vec<&str>> = stages
        .iter()
        .map(|s| s.jobs.iter().map(|j| j.name.as_str()).collect())
        .collect();
    assert_eq!(
        jobs,
        vec![
            vec!["restore", "build:android", "build:ios"],
            vec!["unit-tests", "ui-tests:android", "ui-tests:ios-device"],
            vec!["dotnet-format", "sonar"],
            vec!["distribute:qa"],
        ]
    );
}

#[tokio::test]
async fn f20_2_a_row_carries_the_job_id_and_name() {
    let server = MockServer::start().await;
    serve_jobs(&server, mock_jobs()).await;

    let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap();

    let sonar = row(&stages, "sonar");
    assert_eq!(sonar.id, 108);
    assert_eq!(sonar.name, "sonar");
}

#[tokio::test]
async fn f20_2_the_rest_statuses_map_to_the_eight_row_states() {
    let table: [(&str, bool, JobState); 12] = [
        ("success", false, JobState::Passed),
        ("failed", false, JobState::Failed),
        ("failed", true, JobState::FailedAllowed),
        ("running", false, JobState::Running),
        ("created", false, JobState::Waiting),
        ("pending", false, JobState::Waiting),
        ("preparing", false, JobState::Waiting),
        ("waiting_for_resource", false, JobState::Waiting),
        ("scheduled", false, JobState::Waiting),
        ("manual", false, JobState::Manual),
        ("canceled", false, JobState::Canceled),
        ("skipped", false, JobState::Skipped),
    ];
    for (index, (status, allow, state)) in table.into_iter().enumerate() {
        let server = MockServer::start().await;
        serve_jobs(
            &server,
            vec![job(
                1 + index as u64,
                "one",
                "test",
                status,
                allow,
                Value::Null,
            )],
        )
        .await;

        let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
            .await
            .unwrap();

        assert_eq!(row(&stages, "one").state, state, "{status} allow={allow}");
    }
}

#[tokio::test]
async fn f20_2_a_passed_job_that_is_allowed_to_fail_is_passed_not_failed_allowed() {
    let server = MockServer::start().await;
    serve_jobs(
        &server,
        vec![
            job(1, "lint", "test", "success", true, json!(5.0)),
            job(2, "unit", "test", "failed", false, json!(5.0)),
        ],
    )
    .await;

    let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap();

    assert_eq!(row(&stages, "lint").state, JobState::Passed);
    assert_eq!(row(&stages, "unit").state, JobState::Failed);
}

#[tokio::test]
async fn f20_2_the_one_row_action_follows_decision_6() {
    let table: [(&str, bool, Option<JobAction>); 12] = [
        ("failed", false, Some(JobAction::Retry)),
        ("failed", true, Some(JobAction::Retry)),
        ("canceled", false, Some(JobAction::Retry)),
        ("running", false, Some(JobAction::Cancel)),
        ("pending", false, Some(JobAction::Cancel)),
        ("created", false, Some(JobAction::Cancel)),
        ("waiting_for_resource", false, Some(JobAction::Cancel)),
        ("scheduled", false, Some(JobAction::Cancel)),
        ("manual", false, Some(JobAction::Run)),
        ("success", false, None),
        ("success", true, None),
        ("skipped", false, None),
    ];
    for (index, (status, allow, action)) in table.into_iter().enumerate() {
        let server = MockServer::start().await;
        serve_jobs(
            &server,
            vec![job(
                1 + index as u64,
                "one",
                "test",
                status,
                allow,
                Value::Null,
            )],
        )
        .await;

        let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
            .await
            .unwrap();

        assert_eq!(row(&stages, "one").action, action, "{status} allow={allow}");
    }
}

#[tokio::test]
async fn f20_2_the_duration_is_whole_seconds_or_none() {
    let server = MockServer::start().await;
    serve_jobs(&server, mock_jobs()).await;

    let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap();

    // GitLab sends job durations as fractional seconds; null while a job has none.
    assert_eq!(row(&stages, "build:android").duration_secs, Some(372));
    assert_eq!(row(&stages, "unit-tests").duration_secs, Some(112));
    assert!(matches!(
        row(&stages, "restore").duration_secs,
        Some(48 | 49)
    ));
    assert!(matches!(
        row(&stages, "ui-tests:android").duration_secs,
        Some(185 | 186)
    ));
    assert_eq!(row(&stages, "ui-tests:ios-device").duration_secs, None);
    assert_eq!(row(&stages, "distribute:qa").duration_secs, None);
}

#[tokio::test]
async fn f20_2_retried_attempts_are_hidden_and_the_stage_order_survives_a_retry() {
    let server = MockServer::start().await;
    // build holds one job, which was retried: its new attempt (id 120) has a higher id than the
    // test job (id 111), but the build column still comes first.
    let mut old = job(110, "compile", "build", "failed", false, json!(30.0));
    old["retried"] = json!(true);
    let test = job(111, "unit", "test", "success", false, json!(10.0));
    let new = job(120, "compile", "build", "running", false, Value::Null);
    // With the retried attempts, as the plan's `include_retried` asks for them.
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{PIPELINE}/jobs")))
        .and(query_param("include_retried", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            new.clone(),
            test.clone(),
            old
        ])))
        .with_priority(1)
        .mount(&server)
        .await;
    // GitLab's default answer: the latest attempts only.
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{PIPELINE}/jobs")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([new, test])))
        .with_priority(5)
        .mount(&server)
        .await;

    let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap();

    assert_eq!(names(&stages), vec!["build", "test"]);
    let ids: Vec<u64> = stages
        .iter()
        .flat_map(|s| s.jobs.iter().map(|j| j.id))
        .collect();
    assert_eq!(ids, vec![120, 111], "the failed first attempt is not a row");
    assert_eq!(row(&stages, "compile").state, JobState::Running);
}

#[tokio::test]
async fn f20_2_the_jobs_follow_every_page() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{PIPELINE}/jobs")))
        .and(query_param("page", "1"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", "2")
                .set_body_json(json!([job(
                    1,
                    "restore",
                    "build",
                    "success",
                    false,
                    json!(1.0)
                )])),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{PIPELINE}/jobs")))
        .and(query_param("page", "2"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", "")
                .set_body_json(json!([job(
                    2,
                    "unit",
                    "test",
                    "success",
                    false,
                    json!(1.0)
                )])),
        )
        .expect(1)
        .mount(&server)
        .await;

    let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap();

    assert_eq!(names(&stages), vec!["build", "test"]);
}

#[tokio::test]
async fn f20_2_a_pipeline_without_jobs_has_no_columns() {
    let server = MockServer::start().await;
    serve_jobs(&server, vec![]).await;

    let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap();

    assert!(stages.is_empty());
}

#[tokio::test]
async fn f20_2_a_gitlab_refusal_on_the_jobs_is_the_error_not_empty_columns() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/pipelines/{PIPELINE}/jobs")))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(json!({ "message": "403 Forbidden" })),
        )
        .mount(&server)
        .await;

    let error = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap_err();

    assert!(matches!(error, GitlabError::Forbidden { .. }), "{error:?}");
}

#[tokio::test]
async fn f20_2_the_rows_serialize_in_camel_case_for_the_ui() {
    let server = MockServer::start().await;
    serve_jobs(&server, mock_jobs()).await;

    let stages = pipeline_view::stages(&client(&server), PROJECT, PIPELINE)
        .await
        .unwrap();

    let value = serde_json::to_value(&stages).unwrap();
    let test_column = &value[1];
    assert_eq!(test_column["name"], "test");
    let allowed = &test_column["jobs"][1];
    assert_eq!(allowed["id"], 105);
    assert_eq!(allowed["name"], "ui-tests:android");
    assert_eq!(allowed["state"], "failedAllowed");
    assert_eq!(allowed["action"], "retry");
    assert!(matches!(allowed["durationSecs"].as_u64(), Some(185 | 186)));
    let manual = &test_column["jobs"][2];
    assert_eq!(manual["state"], "manual");
    assert_eq!(manual["action"], "run");
    assert!(manual["durationSecs"].is_null());
    assert!(
        value[0]["jobs"][0]["action"].is_null(),
        "a passed job has no action"
    );
}

#[tokio::test]
async fn f20_2_retry_posts_the_job_retry_and_returns_the_new_attempt_as_a_waiting_row() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{BASE}/jobs/105/retry")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(201).set_body_json(job(
            230,
            "ui-tests:android",
            "test",
            "pending",
            true,
            Value::Null,
        )))
        .expect(1)
        .mount(&server)
        .await;

    let row = pipeline_view::retry_job(&client(&server), PROJECT, 105)
        .await
        .unwrap();

    assert_eq!(row.id, 230, "the row is the new attempt, not the old job");
    assert_eq!(row.name, "ui-tests:android");
    assert_eq!(row.state, JobState::Waiting);
    assert_eq!(row.action, Some(JobAction::Cancel));
}

#[tokio::test]
async fn f20_2_cancel_posts_the_job_cancel_and_returns_the_canceled_row_with_retry() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{BASE}/jobs/104/cancel")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(201).set_body_json(job(
            104,
            "unit-tests",
            "test",
            "canceled",
            false,
            json!(12.0),
        )))
        .expect(1)
        .mount(&server)
        .await;

    let row = pipeline_view::cancel_job(&client(&server), PROJECT, 104)
        .await
        .unwrap();

    assert_eq!(row.id, 104);
    assert_eq!(row.state, JobState::Canceled);
    assert_eq!(row.action, Some(JobAction::Retry));
}

#[tokio::test]
async fn f20_2_a_forbidden_retry_is_gitlab_forbidden_with_its_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{BASE}/jobs/105/retry")))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(json!({ "message": "403 Forbidden" })),
        )
        .mount(&server)
        .await;

    let error = pipeline_view::retry_job(&client(&server), PROJECT, 105)
        .await
        .unwrap_err();

    assert!(
        matches!(&error, GitlabError::Forbidden { message } if message.as_deref() == Some("403 Forbidden")),
        "{error:?}"
    );
}

#[tokio::test]
async fn f20_2_a_forbidden_cancel_is_gitlab_forbidden() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{BASE}/jobs/104/cancel")))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(json!({ "message": "403 Forbidden" })),
        )
        .mount(&server)
        .await;

    let error = pipeline_view::cancel_job(&client(&server), PROJECT, 104)
        .await
        .unwrap_err();

    assert!(matches!(error, GitlabError::Forbidden { .. }), "{error:?}");
}
