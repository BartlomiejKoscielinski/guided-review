//! "Retried: failed again on the same test." on S-08 (F-20.9, M6 decision 15), read only. The
//! failure signature of a job attempt is the sorted set of its failed test names: the cases of the
//! pipeline test report's suite named like the job (the report describes the latest attempt only),
//! else the `Failed <name>` lines of the attempt's log. A failed attempt "failed again on the same
//! test" when the previous attempt of the same name in the same pipeline (the retried one with the
//! highest id below it) failed too and both signatures are equal and not empty; different tests,
//! no known test names or a first attempt read false, since a wrong claim misleads more than
//! silence.

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use super::job_log::parse_lines;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::jobs::{self, Job};
use crate::gitlab::pipelines;

/// What the job details panel adds to a failed job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct JobDetailsView {
    /// The previous attempt of this job failed on exactly the same tests.
    pub retried_same_failure: bool,
}

/// A set of failed test names; empty when none are known.
pub type Signature = BTreeSet<String>;

/// The failed test names of `job_name`'s suite in a pipeline test report.
pub fn from_report(report: &Value, job_name: &str) -> Signature {
    report
        .get("test_suites")
        .and_then(Value::as_array)
        .and_then(|suites| {
            suites
                .iter()
                .find(|s| s.get("name").and_then(Value::as_str) == Some(job_name))
        })
        .and_then(|suite| suite.get("test_cases"))
        .and_then(Value::as_array)
        .map(|cases| {
            cases
                .iter()
                .filter(|c| {
                    matches!(
                        c.get("status").and_then(Value::as_str),
                        Some("failed" | "error")
                    )
                })
                .filter_map(|c| c.get("name").and_then(Value::as_str))
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The names of the `Failed <name>` lines of a raw job log (escapes and sections removed).
pub fn from_log(raw: &str) -> Signature {
    parse_lines(raw)
        .iter()
        .filter_map(|line| line.text.trim_start().strip_prefix("Failed "))
        .filter_map(|rest| rest.split_whitespace().next())
        .map(str::to_owned)
        .collect()
}

/// True when both attempts name failed tests and they are the same set.
pub fn same_failure(previous: &Signature, current: &Signature) -> bool {
    !current.is_empty() && previous == current
}

/// The previous attempt of `job` among the pipeline's jobs (with retried ones): the same name, a
/// lower id, the highest such id.
pub fn previous_attempt<'a>(all: &'a [Job], job: &Job) -> Option<&'a Job> {
    all.iter()
        .filter(|j| j.name == job.name && j.id < job.id)
        .max_by_key(|j| j.id)
}

async fn log_signature(
    client: &GitlabClient,
    project: &str,
    job_id: u64,
) -> Result<Signature, GitlabError> {
    Ok(from_log(&jobs::trace(client, project, job_id).await?))
}

/// The details of job `job_id` for its panel (F-20.9).
pub async fn job_details(
    client: &GitlabClient,
    project: &str,
    job_id: u64,
) -> Result<JobDetailsView, GitlabError> {
    let no = JobDetailsView {
        retried_same_failure: false,
    };
    let job = jobs::job(client, project, job_id).await?;
    if job.status != "failed" {
        return Ok(no);
    }
    let Some(pipeline) = job.pipeline.as_ref() else {
        return Ok(no);
    };
    let all = jobs::pipeline_jobs(client, project, pipeline.id, true).await?;
    let Some(previous) = previous_attempt(&all, &job) else {
        return Ok(no);
    };
    if previous.status != "failed" {
        return Ok(no);
    }
    let mut current = Signature::new();
    if !job.retried {
        // A missing report (404) is no news: the log names the tests then.
        if let Ok(report) = pipelines::test_report(client, project, pipeline.id).await {
            current = from_report(&report, &job.name);
        }
    }
    if current.is_empty() {
        current = log_signature(client, project, job.id).await?;
    }
    if current.is_empty() {
        return Ok(no);
    }
    let before = log_signature(client, project, previous.id).await?;
    Ok(JobDetailsView {
        retried_same_failure: same_failure(&before, &current),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn set(names: &[&str]) -> Signature {
        names.iter().map(|n| (*n).to_owned()).collect()
    }

    #[test]
    fn f20_9_the_log_signature_is_the_failed_lines() {
        let raw = "$ dotnet test\n\u{1b}[31m  Failed Queue.B [3 ms]\u{1b}[0m\n  Passed Queue.C\n  Failed Queue.A [1 ms]\nFailed!  - Failed: 2\n";
        assert_eq!(from_log(raw), set(&["Queue.A", "Queue.B"]));
    }

    #[test]
    fn f20_9_the_report_signature_is_the_jobs_suite_failed_cases() {
        let report = json!({ "test_suites": [
            { "name": "lint", "test_cases": [{ "status": "failed", "name": "X" }] },
            { "name": "unit-tests", "test_cases": [
                { "status": "success", "name": "ok" },
                { "status": "failed", "name": "Queue.B" },
                { "status": "error", "name": "Queue.A" }
            ] }
        ] });
        assert_eq!(
            from_report(&report, "unit-tests"),
            set(&["Queue.A", "Queue.B"])
        );
        assert!(from_report(&report, "ui-tests").is_empty());
    }

    #[test]
    fn f20_9_same_failure_needs_equal_non_empty_sets() {
        assert!(same_failure(&set(&["A", "B"]), &set(&["B", "A"])));
        assert!(!same_failure(&set(&["A"]), &set(&["B"])));
        assert!(!same_failure(&set(&[]), &set(&[])));
        assert!(!same_failure(&set(&[]), &set(&["A"])));
    }
}
