//! The job log of S-08 (F-20.5, M6 decision 10) against wiremock: `GET …/jobs/:id/trace` read as
//! text, ANSI escapes and GitLab section markers removed, the last 500 lines kept (`truncated`
//! when lines were cut), each line classified, and the follow loop that re-reads the trace while
//! the job runs and sends only new lines. Synthetic values (ADR-019).
//!
//! The tests pin these names (the plan's `gitlab/jobs.rs` and `review/job_log.rs`):
//! - `gitlab::jobs::trace(client, project, job_id) -> Result<String, GitlabError>`: the raw body
//!   of `GET /projects/:id/jobs/:job/trace`.
//! - `job_log::parse_trace(raw: &str) -> ParsedLog { lines: Vec<LogLine>, truncated: bool }`.
//! - `LogLine { kind: LogKind, text: String }`; `LogKind::{Command, Pass, Error, Plain}`
//!   (`Copy`, `Debug`, `PartialEq`) serialized `command`, `pass`, `error`, `plain`.
//! - `JobLogEvent { lines: Vec<LogLine>, replace: bool, truncated: bool, done: bool }`, keys as
//!   named; `replace` is true only on the first event of a stream.
//! - `job_log::follow(client, project, job_id, interval, emit) -> Result<(), GitlabError>` with
//!   `emit: FnMut(JobLogEvent) -> bool` (false = nobody listens any more, stop). Each round reads
//!   the job (`GET …/jobs/:id`) and then its trace; it emits when there are new lines, on the
//!   first round, and on the last round (`done`), and stops after the round that saw the job
//!   finished (any status except `created`, `pending`, `waiting_for_resource`, `preparing`,
//!   `running`).
//!
//! Locked readings (the spec leaves them open): leading spaces do not hide a prefix (`  Failed …`
//! is an error line, as in the mock); a command beats an error or pass word; an error word beats
//! a pass word; `section_end` lines vanish, a `section_start` line keeps its text.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::time::Duration;

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::jobs;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::review::job_log::{self, JobLogEvent, LogKind, LogLine};
use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const BASE: &str = "/api/v4/projects/sandbox%2Fgr-sandbox";
const JOB: u64 = 1_832_104;

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn kinds(raw: &str) -> Vec<LogKind> {
    job_log::parse_trace(raw)
        .lines
        .iter()
        .map(|l| l.kind)
        .collect()
}

fn texts(lines: &[LogLine]) -> Vec<&str> {
    lines.iter().map(|l| l.text.as_str()).collect()
}

fn job_body(status: &str) -> serde_json::Value {
    json!({
        "id": JOB, "name": "unit-tests", "stage": "test", "status": status,
        "allow_failure": false, "retried": false, "duration": null,
        "web_url": format!("https://gitlab.local/sandbox/gr-sandbox/-/jobs/{JOB}")
    })
}

async fn serve_job(server: &MockServer, status: &str, times: Option<u64>) {
    let mock = Mock::given(method("GET"))
        .and(path(format!("{BASE}/jobs/{JOB}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(job_body(status)));
    match times {
        Some(n) => mock.up_to_n_times(n).mount(server).await,
        None => mock.mount(server).await,
    }
}

async fn serve_trace(server: &MockServer, body: &str, times: Option<u64>) {
    let mock = Mock::given(method("GET"))
        .and(path(format!("{BASE}/jobs/{JOB}/trace")))
        .respond_with(ResponseTemplate::new(200).set_body_string(body));
    match times {
        Some(n) => mock.up_to_n_times(n).mount(server).await,
        None => mock.mount(server).await,
    }
}

async fn run_follow(server: &MockServer) -> Result<Vec<JobLogEvent>, GitlabError> {
    let mut events = Vec::new();
    job_log::follow(
        &client(server),
        PROJECT,
        JOB,
        Duration::from_millis(10),
        |event| {
            events.push(event);
            true
        },
    )
    .await?;
    Ok(events)
}

#[tokio::test]
async fn f20_5_trace_reads_the_job_trace_as_text_with_the_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/jobs/{JOB}/trace")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_string("$ dotnet test\nPassed!\n"))
        .mount(&server)
        .await;

    let body = jobs::trace(&client(&server), PROJECT, JOB).await.unwrap();

    assert_eq!(body, "$ dotnet test\nPassed!\n");
}

#[tokio::test]
async fn f20_5_trace_of_an_unknown_job_is_not_found() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/jobs/{JOB}/trace")))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "message": "404 Not Found" })),
        )
        .mount(&server)
        .await;

    let err = jobs::trace(&client(&server), PROJECT, JOB)
        .await
        .unwrap_err();

    assert!(matches!(err, GitlabError::NotFound), "{err:?}");
}

#[test]
fn f20_5_ansi_escapes_are_stripped_from_the_text() {
    let parsed = job_log::parse_trace(
        "\u{1b}[0KRunning with gitlab-runner\u{1b}[0;m\n\u{1b}[32;1mGetting source\u{1b}[0;m\n",
    );

    assert_eq!(
        texts(&parsed.lines),
        vec!["Running with gitlab-runner", "Getting source"]
    );
}

#[test]
fn f20_5_section_markers_are_stripped_and_a_section_end_line_vanishes() {
    let raw = concat!(
        "section_start:1760868000:step_script\r\u{1b}[0K\u{1b}[36;1mExecuting step_script\u{1b}[0;m\r\n",
        "$ dotnet test\r\n",
        "section_end:1760868060:step_script\r\u{1b}[0K\r\n",
        "Job succeeded\r\n",
    );

    let parsed = job_log::parse_trace(raw);

    assert_eq!(
        texts(&parsed.lines),
        vec!["Executing step_script", "$ dotnet test", "Job succeeded"]
    );
    assert!(!parsed.truncated);
}

#[test]
fn f20_5_a_trailing_newline_adds_no_line() {
    let parsed = job_log::parse_trace("one\ntwo\n");

    assert_eq!(texts(&parsed.lines), vec!["one", "two"]);
}

#[test]
fn f20_5_lines_are_classified_command_pass_error_or_plain() {
    use LogKind::{Command, Error, Pass, Plain};
    let table: Vec<(&str, LogKind)> = vec![
        ("$ dotnet test tests/App.Tests -c Release", Command),
        ("ERROR: Job failed: exit code 1", Error),
        ("error: pathspec 'x' did not match", Error),
        (
            "Failed!  Failed: 2, Passed: 210, Skipped: 0, Total: 212",
            Error,
        ),
        ("FAIL  src/queue.test.ts", Error),
        ("The build hit an error while linking", Error),
        ("Unhandled Error: boom", Error),
        ("✔  uploaded new release 1.8.0 (482) successfully", Pass),
        (
            "Passed!  Failed: 0, Passed: 214, Skipped: 0, Total: 214",
            Pass,
        ),
        ("PASS  src/queue.test.ts", Pass),
        ("Job succeeded", Pass),
        ("Total tests: 18. Passed: 17. Failed: 1.", Plain),
        ("i  uploading binary...", Plain),
        ("  App -> src/App/bin/Release/App.dll", Plain),
    ];
    for (line, expected) in table {
        assert_eq!(kinds(line), vec![expected], "{line}");
    }
}

#[test]
fn f20_5_leading_spaces_do_not_hide_a_prefix() {
    use LogKind::{Error, Pass};

    assert_eq!(
        kinds("  Failed  SqliteUploadQueueTests.Dequeue_ReturnsOldestFirst [41 ms]"),
        vec![Error]
    );
    assert_eq!(
        kinds("  Passed  LoginPageTests.Login_WithValidUser [12 s]"),
        vec![Pass]
    );
}

#[test]
fn f20_5_a_command_beats_an_error_word_and_an_error_word_beats_a_pass_word() {
    use LogKind::{Command, Error};

    assert_eq!(kinds("$ echo ERROR: nothing"), vec![Command]);
    assert_eq!(kinds("✔ finished with Error: exit 1"), vec![Error]);
}

#[test]
fn f20_5_gitlab_colors_classify_a_line_and_are_not_part_of_the_text() {
    use LogKind::{Error, Pass, Plain};
    let parsed = job_log::parse_trace(
        "\u{1b}[31;1mboom\u{1b}[0;m\n\u{1b}[91mnot good\u{1b}[0m\n\u{1b}[32;1mall fine\u{1b}[0;m\n\u{1b}[36;1mjust cyan\u{1b}[0;m\n",
    );

    assert_eq!(
        parsed.lines.iter().map(|l| l.kind).collect::<Vec<_>>(),
        vec![Error, Error, Pass, Plain]
    );
    assert_eq!(
        texts(&parsed.lines),
        vec!["boom", "not good", "all fine", "just cyan"]
    );
}

#[test]
fn f20_5_a_501_line_trace_keeps_the_last_500_and_says_truncated() {
    let raw: String = (1..=501).map(|n| format!("line {n}\n")).collect();

    let parsed = job_log::parse_trace(&raw);

    assert_eq!(parsed.lines.len(), 500);
    assert_eq!(parsed.lines[0].text, "line 2");
    assert_eq!(parsed.lines[499].text, "line 501");
    assert!(parsed.truncated);
}

#[test]
fn f20_5_a_500_line_trace_is_not_truncated() {
    let raw: String = (1..=500).map(|n| format!("line {n}\n")).collect();

    let parsed = job_log::parse_trace(&raw);

    assert_eq!(parsed.lines.len(), 500);
    assert_eq!(parsed.lines[0].text, "line 1");
    assert!(!parsed.truncated);
}

#[test]
fn f20_5_the_event_and_its_lines_serialize_with_the_names_the_screen_reads() {
    let event = JobLogEvent {
        lines: vec![LogLine {
            kind: LogKind::Command,
            text: "$ dotnet test".to_owned(),
        }],
        replace: true,
        truncated: false,
        done: false,
    };

    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({
            "lines": [{ "kind": "command", "text": "$ dotnet test" }],
            "replace": true, "truncated": false, "done": false
        })
    );
}

#[tokio::test]
async fn f20_5_follow_sends_the_first_read_then_only_new_lines_and_ends_at_success() {
    let server = MockServer::start().await;
    serve_job(&server, "running", Some(2)).await;
    serve_job(&server, "success", None).await;
    serve_trace(&server, "a\nb\n", Some(1)).await;
    serve_trace(&server, "a\nb\nc\n", Some(1)).await;
    serve_trace(&server, "a\nb\nc\nd\n", None).await;

    let events = run_follow(&server).await.unwrap();

    assert_eq!(events.len(), 3, "{events:?}");
    assert_eq!(texts(&events[0].lines), vec!["a", "b"]);
    assert_eq!(texts(&events[1].lines), vec!["c"]);
    assert_eq!(texts(&events[2].lines), vec!["d"]);
    assert_eq!(
        events.iter().map(|e| e.replace).collect::<Vec<_>>(),
        vec![true, false, false]
    );
    assert_eq!(
        events.iter().map(|e| e.done).collect::<Vec<_>>(),
        vec![false, false, true]
    );
    let trace_reads = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path().ends_with("/trace"))
        .count();
    assert_eq!(trace_reads, 3, "no read after the job finished");
}

#[tokio::test]
async fn f20_5_follow_sends_nothing_for_a_read_without_new_lines() {
    let server = MockServer::start().await;
    serve_job(&server, "running", Some(3)).await;
    serve_job(&server, "failed", None).await;
    serve_trace(&server, "a\n", Some(3)).await;
    serve_trace(&server, "a\nb\n", None).await;

    let events = run_follow(&server).await.unwrap();

    assert_eq!(events.len(), 2, "{events:?}");
    assert_eq!(texts(&events[0].lines), vec!["a"]);
    assert!(events[0].replace);
    assert_eq!(texts(&events[1].lines), vec!["b"]);
    assert!(events[1].done);
}

#[tokio::test]
async fn f20_5_follow_of_a_finished_job_sends_the_whole_log_once_and_is_done() {
    let server = MockServer::start().await;
    serve_job(&server, "success", None).await;
    serve_trace(&server, "$ dotnet test\nJob succeeded\n", None).await;

    let events = run_follow(&server).await.unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(
        texts(&events[0].lines),
        vec!["$ dotnet test", "Job succeeded"]
    );
    assert!(events[0].replace && events[0].done && !events[0].truncated);
}

#[tokio::test]
async fn f20_5_follow_says_truncated_for_a_long_log() {
    let server = MockServer::start().await;
    serve_job(&server, "success", None).await;
    let raw: String = (1..=501).map(|n| format!("line {n}\n")).collect();
    serve_trace(&server, &raw, None).await;

    let events = run_follow(&server).await.unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].lines.len(), 500);
    assert!(events[0].truncated);
}

#[tokio::test]
async fn f20_5_follow_stops_when_nobody_listens_any_more() {
    let server = MockServer::start().await;
    serve_job(&server, "running", None).await;
    serve_trace(&server, "a\n", Some(1)).await;
    serve_trace(&server, "a\nb\n", None).await;
    let mut seen = 0;

    job_log::follow(
        &client(&server),
        PROJECT,
        JOB,
        Duration::from_millis(10),
        |_| {
            seen += 1;
            false
        },
    )
    .await
    .unwrap();

    assert_eq!(seen, 1);
}

#[tokio::test]
async fn f20_5_follow_of_a_missing_trace_is_the_gitlab_error() {
    let server = MockServer::start().await;
    serve_job(&server, "running", None).await;
    Mock::given(method("GET"))
        .and(path(format!("{BASE}/jobs/{JOB}/trace")))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "message": "404 Not Found" })),
        )
        .mount(&server)
        .await;

    let err = run_follow(&server).await.unwrap_err();

    assert!(matches!(err, GitlabError::NotFound), "{err:?}");
}
