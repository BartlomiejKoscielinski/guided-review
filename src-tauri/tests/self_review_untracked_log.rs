//! Self-review (F-17.1): a failed step of the uncommitted session with untracked files in a dot
//! directory is logged with its reason, and never with Claude's text (NFR-08). A test binary of
//! its own with one test, because the test installs the global logger and any other test in the
//! same binary would write its own failed steps into the same log. Fake `claude`, synthetic data
//! only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]
#![expect(
    clippy::disallowed_methods,
    reason = "own test binary: it installs the global logger"
)]

#[path = "support/fake_claude.rs"]
mod fake_claude;
#[path = "support/fixture_repo.rs"]
mod fixture_repo;
#[path = "support/untracked_session.rs"]
mod untracked_session;

use std::sync::Arc;

use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::logging::{self, rotate::RotatingFile};
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::step_runs::StepRuns;
use serde_json::json;
use untracked_session::{note_on, path, setup};

/// The log line of the failed step `id`.
fn failed_line<'a>(text: &'a str, id: &str) -> &'a str {
    text.lines()
        .find(|l| l.contains("step analysis failed") && l.contains(&format!("step={id} ")))
        .unwrap_or_else(|| panic!("no failed line for {id}: {text}"))
}

#[tokio::test]
async fn f17_1_a_failed_step_is_logged_with_its_reason_and_no_claude_text() {
    let dir = tempfile::tempdir().unwrap();
    let log = Arc::new(RotatingFile::open(dir.path(), "test", 1 << 20, 2).unwrap());
    let subscriber = logging::subscriber(
        Some(Arc::clone(&log)),
        logging::filter_from(Some("info")),
        false,
    );
    tracing::subscriber::set_global_default(subscriber).unwrap();

    let s = setup();
    let (files, cx) = s.planned().await;
    let order = cx.order(Strategy::ContractToUi);
    let runs = StepRuns::default();

    // Evidence in a file that isn't in the working tree: CLAUDE_SCHEMA, never partial notes. The
    // detail is the app's own text, so it is logged.
    let mut output = note_on(&path(&files[1]));
    output["findings"][0]["evidence"][1]["file"] = json!("src/Missing CANARY.cs");
    s.respond(&[output]);
    s.findings(&runs, &cx, &order, &order[1]).await.unwrap_err();

    // Claude Code fails with its own text in the result and on stderr: CLAUDE_FAILED, whose
    // detail carries that text, so only the code and message are logged.
    let failed = json!({ "type": "result", "is_error": true, "terminal_reason": "error",
        "session_id": "s", "result": "CLAUDE-CANARY Something in the code went wrong" });
    s.respond_raw(&[json!({ "stdout": failed.to_string(),
        "stderr": "STDERR-CANARY trace", "exit": 1 })]);
    let error = AppError::from(s.findings(&runs, &cx, &order, &order[2]).await.unwrap_err());
    assert_eq!(error.code, ErrorCode::ClaudeFailed);
    assert!(
        error
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("CANARY"),
        "{error:?}"
    );

    let text = std::fs::read_to_string(log.path(0)).unwrap();
    let schema = failed_line(&text, &order[1]);
    assert!(schema.contains("ClaudeSchema"), "{schema}");
    assert!(
        schema.contains("evidence cites a line that isn't in the worktree"),
        "{schema}"
    );
    let claude = failed_line(&text, &order[2]);
    assert!(claude.contains("ClaudeFailed"), "{claude}");
    assert!(
        claude.contains("Claude couldn't finish the task."),
        "{claude}"
    );
    assert!(!claude.contains("detail"), "{claude}");
    assert!(!text.contains("CANARY"), "{text}");
}
