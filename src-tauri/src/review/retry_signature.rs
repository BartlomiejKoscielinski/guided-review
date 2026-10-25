//! "Retried: failed again on the same test." on S-08 (F-20.9, M6 decision 15), read only. The
//! failure signature of a job attempt is the sorted set of its failed test names, the `Failed <name>`
//! lines of the attempt's log (both attempts read the same way; the pipeline test report describes
//! only the latest attempt, so it is not used). A failed attempt "failed again on the same
//! test" when the previous attempt of the same name in the same pipeline (the retried one with the
//! highest id below it) failed too and both signatures are equal and not empty; different tests,
//! no known test names or a first attempt read false, since a wrong claim misleads more than
//! silence.

use std::collections::BTreeSet;

use serde::Serialize;
use ts_rs::TS;

use super::job_log::parse_lines;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::jobs::{self, Job};

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

/// The names of the `Failed <name>` lines of a raw job log (escapes and sections removed); a
/// trailing duration like ` [3 ms]` is not part of the name, spaces inside a parameterized name
/// (`Queue.B(x: 1)`) are.
pub fn from_log(raw: &str) -> Signature {
    parse_lines(raw)
        .iter()
        .filter_map(|line| line.text.trim_start().strip_prefix("Failed "))
        .map(test_name)
        .filter(|n| !n.is_empty())
        .map(str::to_owned)
        .collect()
}

fn test_name(rest: &str) -> &str {
    let rest = rest.trim();
    match rest.rfind(" [") {
        Some(at) if rest.ends_with(']') => rest[..at].trim_end(),
        _ => rest,
    }
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
    // Both signatures come from the logs: the previous attempt has nothing else, and names
    // read two different ways would never compare equal.
    let current = log_signature(client, project, job.id).await?;
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

    fn set(names: &[&str]) -> Signature {
        names.iter().map(|n| (*n).to_owned()).collect()
    }

    #[test]
    fn f20_9_the_log_signature_is_the_failed_lines() {
        let raw = "$ dotnet test\n\u{1b}[31m  Failed Queue.B [3 ms]\u{1b}[0m\n  Passed Queue.C\n  Failed Queue.A [1 ms]\nFailed!  - Failed: 2\n";
        assert_eq!(from_log(raw), set(&["Queue.A", "Queue.B"]));
    }

    #[test]
    fn f20_9_a_parameterized_test_keeps_its_whole_name() {
        let raw = "  Failed Queue.B(x: 1) [3 ms]
  Failed Queue.B(x: 2)
";
        assert_eq!(from_log(raw), set(&["Queue.B(x: 1)", "Queue.B(x: 2)"]));
    }

    #[test]
    fn f20_9_same_failure_needs_equal_non_empty_sets() {
        assert!(same_failure(&set(&["A", "B"]), &set(&["B", "A"])));
        assert!(!same_failure(&set(&["A"]), &set(&["B"])));
        assert!(!same_failure(&set(&[]), &set(&[])));
        assert!(!same_failure(&set(&[]), &set(&["A"])));
    }
}
