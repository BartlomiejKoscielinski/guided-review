//! What Explain failure (F-20.7, M6 decisions 10, 12 and 14) reads besides the task itself: the
//! job's log as the panel shows it, the job's suite of the pipeline's test report, the MR diff
//! (and, for a pipeline on an older version, the changes from its SHA to the head), and the
//! progress events S-08 shows ("Preparing the code…", then "Reading the log and the diff…").

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use super::job_log::parse_trace;
use crate::claude::result::clamp;
use crate::claude::tasks::pipeline_explain::PipelineExplanation;
use crate::error::AppError;

/// Bytes of one failed test case's output in the report summary.
const CASE_OUTPUT_MAX: usize = 2_000;
/// Failed test cases listed in the report summary.
const CASES_MAX: usize = 30;

/// One message of `job_explain` on its channel: `preparing` while the review worktree is made
/// ready, `reading` once the inputs are gathered (and while Claude runs), then `done` or `failed`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum JobExplainEvent {
    Preparing,
    Reading,
    Done { result: PipelineExplanation },
    Failed { error: AppError },
}

/// The log text Claude reads: the panel's last 500 lines without escapes (decision 10), with the
/// panel's note when lines were cut.
pub fn log_text(raw: &str) -> String {
    let parsed = parse_trace(raw);
    let mut out = String::new();
    if parsed.truncated {
        out.push_str("Showing the last 500 lines.\n");
    }
    for line in parsed.lines {
        out.push_str(&line.text);
        out.push('\n');
    }
    out
}

fn count(suite: &Value, field: &str) -> u64 {
    suite.get(field).and_then(Value::as_u64).unwrap_or(0)
}

/// The suite of `job_name` in a pipeline's test report: its counts and failed cases; empty when
/// the report has no such suite.
pub fn test_report_summary(report: &Value, job_name: &str) -> String {
    let Some(suite) = report
        .get("test_suites")
        .and_then(Value::as_array)
        .and_then(|suites| {
            suites
                .iter()
                .find(|s| s.get("name").and_then(Value::as_str) == Some(job_name))
        })
    else {
        return String::new();
    };
    let mut out = format!(
        "Suite {job_name}: {} failed, {} errors, {} passed, {} skipped\n",
        count(suite, "failed_count"),
        count(suite, "error_count"),
        count(suite, "success_count"),
        count(suite, "skipped_count"),
    );
    let failed = suite
        .get("test_cases")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|c| {
            matches!(
                c.get("status").and_then(Value::as_str),
                Some("failed" | "error")
            )
        });
    for case in failed.take(CASES_MAX) {
        let text = |f: &str| case.get(f).and_then(Value::as_str).unwrap_or("").trim();
        out.push_str(&format!("- {} {}\n", text("classname"), text("name")));
        let output = text("system_output");
        if !output.is_empty() {
            out.push_str(&format!(
                "  {}\n",
                clamp(output, CASE_OUTPUT_MAX).replace('\n', "\n  ")
            ));
        }
    }
    out
}

/// The diff file: the MR diff, then for a pipeline on an older SHA the changes since.
pub fn diff_text(mr_diff: &str, since: Option<(&str, &str)>) -> String {
    let mut out = format!("MR diff at its latest version:\n{mr_diff}");
    if let Some((label, diff)) = since {
        out.push_str(&format!("\n\nChanges since {label}:\n{diff}"));
    }
    out
}

/// Whether the panel says "Preparing the code…" (decision 12): only when the MR's review worktree
/// is missing or not registered at the MR's latest head (`latest_head` from GitLab; unknown counts
/// as behind).
pub fn needs_preparing(
    exists: bool,
    registered_head: Option<&str>,
    latest_head: Option<&str>,
) -> bool {
    !(exists && registered_head.is_some() && registered_head == latest_head)
}

/// The log line of a failed run: code, message and detail (never a token: `AppError` carries
/// none, docs/06).
pub fn failure_line(error: &AppError) -> String {
    let mut line = format!("{:?}: {}", error.code, error.message);
    if let Some(detail) = error.detail.as_deref().filter(|d| !d.is_empty()) {
        line.push_str(&format!(" ({detail})"));
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn f20_7_the_report_summary_is_the_jobs_suite_only() {
        let report = json!({ "test_suites": [
            { "name": "lint", "failed_count": 9 },
            { "name": "unit-tests", "failed_count": 1, "success_count": 212, "test_cases": [
                { "status": "success", "name": "ok", "classname": "Q" },
                { "status": "failed", "name": "Newest_first", "classname": "QueueOrderTests",
                  "system_output": "Expected 2" }
            ] }
        ] });
        let summary = test_report_summary(&report, "unit-tests");
        assert!(summary.starts_with("Suite unit-tests: 1 failed, 0 errors, 212 passed"));
        assert!(summary.contains("- QueueOrderTests Newest_first\n  Expected 2"));
        assert!(!summary.contains("ok"));
        assert_eq!(test_report_summary(&report, "ui-tests"), "");
        assert_eq!(test_report_summary(&json!({}), "unit-tests"), "");
    }

    #[test]
    fn f20_7_the_log_is_the_panels_text() {
        let text = log_text("\u{1b}[31;1mERROR: Job failed\u{1b}[0;m\n$ dotnet test\n");
        assert_eq!(text, "ERROR: Job failed\n$ dotnet test\n");
    }

    #[test]
    fn f20_7_preparing_shows_only_for_a_missing_or_behind_worktree() {
        assert!(!needs_preparing(true, Some("h2"), Some("h2")));
        assert!(needs_preparing(false, Some("h2"), Some("h2")));
        assert!(needs_preparing(true, Some("h1"), Some("h2")));
        assert!(needs_preparing(true, None, Some("h2")));
        assert!(needs_preparing(true, None, None));
        assert!(needs_preparing(true, Some("h2"), None));
    }

    #[test]
    fn f20_7_a_failed_run_logs_its_code_message_and_detail() {
        use crate::error::ErrorCode;
        let e = AppError::new(ErrorCode::ClaudeSchema, "Claude's answer didn't fit.")
            .with_detail("evidence Missing.cs:3 is not in the worktree");
        let line = failure_line(&e);
        assert!(line.contains("ClaudeSchema"), "{line}");
        assert!(line.contains("Claude's answer didn't fit."), "{line}");
        assert!(
            line.ends_with("(evidence Missing.cs:3 is not in the worktree)"),
            "{line}"
        );
        let plain = failure_line(&AppError::new(ErrorCode::ClaudeFailed, "Failed."));
        assert!(plain.ends_with("Failed."), "{plain}");
    }

    #[test]
    fn f20_7_the_diff_adds_the_changes_since_an_older_pipeline() {
        assert_eq!(diff_text("D", None), "MR diff at its latest version:\nD");
        assert!(
            diff_text("D", Some(("pipeline #2", "S"))).ends_with("Changes since pipeline #2:\nS")
        );
    }
}
