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
    fn f20_7_the_diff_adds_the_changes_since_an_older_pipeline() {
        assert_eq!(diff_text("D", None), "MR diff at its latest version:\nD");
        assert!(
            diff_text("D", Some(("pipeline #2", "S"))).ends_with("Changes since pipeline #2:\nS")
        );
    }
}
