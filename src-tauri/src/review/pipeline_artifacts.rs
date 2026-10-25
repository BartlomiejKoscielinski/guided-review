//! The artifacts of a successful job on S-08 (F-20.8, M6 decision 13), read only: the job's
//! `artifacts` list without the `trace` (the log) and `metadata` (GitLab's own index) kinds, each
//! with its size in KB or MB and the download URL on the project's GitLab page. **Download** opens
//! that URL in the browser, whose own GitLab sign-in does the download; the token stays here.

use serde::Serialize;
use ts_rs::TS;

use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::jobs::{self, JobArtifactEntry};

/// Kinds that are not files for the user: the log and GitLab's artifact index.
const HIDDEN_KINDS: [&str; 2] = ["trace", "metadata"];

/// One downloadable file of a job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct JobArtifact {
    /// The file name as GitLab lists it (`app-release.apk`).
    pub name: String,
    /// The size as the row shows it (`48 MB`, `212 KB`).
    pub size: String,
    /// `<project web_url>/-/jobs/<id>/artifacts/download?file_type=<type>`.
    pub url: String,
}

/// `bytes` as a whole number of B, KB, MB or GB (1024 based, rounded to the nearest).
pub fn size_label(bytes: u64) -> String {
    const UNITS: [&str; 3] = ["KB", "MB", "GB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64 / 1024.0;
    let mut unit = 0;
    while value.round() >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    format!("{} {}", value.round() as u64, UNITS[unit])
}

/// The listed files of `entries` for job `job` of the project at `web_url`.
pub fn listed(entries: &[JobArtifactEntry], web_url: &str, job: u64) -> Vec<JobArtifact> {
    let base = web_url.trim_end_matches('/');
    entries
        .iter()
        .filter(|e| !HIDDEN_KINDS.contains(&e.file_type.as_str()))
        .map(|e| JobArtifact {
            name: e.filename.clone(),
            size: size_label(e.size.unwrap_or(0)),
            url: format!(
                "{base}/-/jobs/{job}/artifacts/download?file_type={}",
                urlencoding_kind(&e.file_type)
            ),
        })
        .collect()
}

/// GitLab's kinds are lower-case words with `_`; anything else is percent-encoded.
fn urlencoding_kind(kind: &str) -> String {
    kind.bytes()
        .map(|b| match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'-' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The artifacts of job `job` of `project`: `GET …/jobs/:id`, then (only when it lists files)
/// `GET …/projects/:id` for the page the download URLs are built on.
pub async fn artifacts(
    client: &GitlabClient,
    project: &str,
    job: u64,
) -> Result<Vec<JobArtifact>, GitlabError> {
    let found = jobs::job(client, project, job).await?;
    if found
        .artifacts
        .iter()
        .all(|e| HIDDEN_KINDS.contains(&e.file_type.as_str()))
    {
        return Ok(Vec::new());
    }
    let web_url = jobs::project_web_url(client, project).await?;
    Ok(listed(&found.artifacts, &web_url, job))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(kind: &str, name: &str, size: u64) -> JobArtifactEntry {
        JobArtifactEntry {
            file_type: kind.to_owned(),
            filename: name.to_owned(),
            size: Some(size),
        }
    }

    #[test]
    fn f20_8_sizes_round_to_whole_units() {
        assert_eq!(size_label(301), "301 B");
        assert_eq!(size_label(217_088), "212 KB");
        assert_eq!(size_label(50_331_648), "48 MB");
        assert_eq!(size_label(1_048_000), "1023 KB");
        assert_eq!(size_label(1_048_500), "1 MB");
        assert_eq!(size_label(3 * 1024 * 1024 * 1024), "3 GB");
    }

    #[test]
    fn f20_8_listed_drops_trace_and_metadata_and_builds_urls() {
        let list = listed(
            &[
                entry("trace", "job.log", 9),
                entry("archive", "a.zip", 2048),
                entry("metadata", "m.gz", 1),
            ],
            "https://gitlab.example/g/p/",
            5,
        );
        assert_eq!(
            list,
            vec![JobArtifact {
                name: "a.zip".to_owned(),
                size: "2 KB".to_owned(),
                url: "https://gitlab.example/g/p/-/jobs/5/artifacts/download?file_type=archive"
                    .to_owned(),
            }]
        );
    }
}
