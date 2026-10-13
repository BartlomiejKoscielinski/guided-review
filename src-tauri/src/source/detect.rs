//! What the S-01 input names (F-01.1), in this order: an MR URL, `!iid`, a path to a local
//! repository, a commit SHA that resolves, a local or `origin/` branch. Errors carry the
//! F-01.5 copy. Detection only reads: an MR URL of another configured repository returns that
//! repository's id, and opening the source switches to it (M2 decision 7).

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::error::SourceError;
use super::folder;
use crate::git::{Git, refs};
use crate::os::process::Cancel;
use crate::store::repos::RepoRow;

/// The detected type shown next to the input (F-01.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum DetectedSource {
    /// `MERGE REQUEST !482`.
    #[serde(rename_all = "camelCase")]
    Mr {
        project: String,
        #[ts(type = "number")]
        iid: u64,
        /// The configured repository of the project.
        #[ts(type = "number")]
        repo_id: i64,
    },
    /// `COMMIT a3f9c12`.
    #[serde(rename_all = "camelCase")]
    Commit { sha: String, short_sha: String },
    /// `BRANCH chore/compiled-bindings`.
    Branch {
        /// `feature/x`, or `origin/feature/x` when only the remote branch exists.
        name: String,
        sha: String,
        remote: bool,
        /// The checked-out branch (self-review of local changes, M2 decision 3).
        current: bool,
    },
    /// A folder inside a local repository.
    #[serde(rename_all = "camelCase")]
    Repository {
        name: String,
        path: String,
        /// `None` when it isn't configured yet (opening it adds it).
        #[ts(optional, type = "number")]
        #[serde(skip_serializing_if = "Option::is_none")]
        repo_id: Option<i64>,
    },
}

/// What detection needs to know about the app's configuration.
pub struct DetectEnv<'a> {
    /// The configured GitLab server URL.
    pub server: Option<&'a str>,
    pub repos: &'a [RepoRow],
    pub active: Option<&'a RepoRow>,
    /// `git.path` from Settings.
    pub git_program: Option<&'a Path>,
}

/// `None` for blank input.
pub async fn detect(
    input: &str,
    env: &DetectEnv<'_>,
    cancel: &Cancel,
) -> Result<Option<DetectedSource>, SourceError> {
    let input = input.trim();
    if input.is_empty() {
        return Ok(None);
    }
    if input.starts_with("http://") || input.starts_with("https://") {
        let (project, iid) = parse_mr_url(input, env.server)?;
        return mr(env, project, iid).map(Some);
    }
    if let Some(iid) = parse_iid(input) {
        let active = env.active.ok_or(SourceError::NoRepository)?;
        let project = active
            .gitlab_project
            .clone()
            .ok_or(SourceError::NoProject)?;
        return Ok(Some(DetectedSource::Mr {
            project,
            iid,
            repo_id: active.id,
        }));
    }
    let unquoted = input.trim_matches('"');
    let path = Path::new(unquoted);
    if path.is_absolute() && path.is_dir() {
        return repository(env, path, cancel).await.map(Some);
    }
    let active = env.active.ok_or(SourceError::NoRepository)?;
    let git = Git::new(env.git_program, &active.path);
    if let Some(sha) = refs::resolve_sha(&git, input, cancel).await? {
        return Ok(Some(DetectedSource::Commit {
            short_sha: sha.chars().take(7).collect(),
            sha,
        }));
    }
    if let Some(found) = refs::branch(&git, input, cancel).await? {
        let current = !found.remote
            && refs::current_branch(&git, cancel).await?.as_deref() == Some(found.name.as_str());
        return Ok(Some(DetectedSource::Branch {
            name: found.name,
            sha: found.sha,
            remote: found.remote,
            current,
        }));
    }
    Err(SourceError::NoMatch(input.to_owned()))
}

fn mr(env: &DetectEnv<'_>, project: String, iid: u64) -> Result<DetectedSource, SourceError> {
    let repo = env
        .repos
        .iter()
        .find(|r| {
            r.gitlab_project
                .as_deref()
                .is_some_and(|p| p.eq_ignore_ascii_case(&project))
        })
        .ok_or_else(|| SourceError::UnknownProject(project.clone()))?;
    Ok(DetectedSource::Mr {
        project: repo.gitlab_project.clone().unwrap_or(project),
        iid,
        repo_id: repo.id,
    })
}

async fn repository(
    env: &DetectEnv<'_>,
    path: &Path,
    cancel: &Cancel,
) -> Result<DetectedSource, SourceError> {
    let found = folder::inspect(env.git_program, path, None, cancel)
        .await
        .map_err(|e| match e {
            crate::git::GitError::NotARepository(_) => {
                SourceError::NoMatch(path.display().to_string())
            }
            other => other.into(),
        })?;
    let repo_id = env
        .repos
        .iter()
        .find(|r| r.path.eq_ignore_ascii_case(&found.path))
        .map(|r| r.id);
    Ok(DetectedSource::Repository {
        name: found.name,
        path: found.path,
        repo_id,
    })
}

/// `!482` → 482.
fn parse_iid(input: &str) -> Option<u64> {
    let digits = input.strip_prefix('!')?;
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|iid| *iid > 0)
}

/// `https://<host>[/<sub path>]/<group>/<project>/-/merge_requests/<iid>[/<tab>][?…][#…]` →
/// (`group/project`, iid). The host (and port) must be the configured server's.
pub fn parse_mr_url(input: &str, server: Option<&str>) -> Result<(String, u64), SourceError> {
    let no_match = || SourceError::NoMatch(input.to_owned());
    let url = reqwest::Url::parse(input).map_err(|_| no_match())?;
    let host = url.host_str().ok_or_else(no_match)?;
    let path = url.path();
    let (before, after) = path.split_once("/-/merge_requests/").ok_or_else(no_match)?;
    let iid = after
        .split('/')
        .next()
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|iid| *iid > 0)
        .ok_or_else(no_match)?;
    let server = server
        .and_then(|s| reqwest::Url::parse(s.trim()).ok())
        .ok_or(SourceError::NoServer)?;
    let same_host = server
        .host_str()
        .is_some_and(|h| h.eq_ignore_ascii_case(host))
        && server.port_or_known_default() == url.port_or_known_default();
    if !same_host {
        let shown = match url.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_owned(),
        };
        return Err(SourceError::OtherServer(shown));
    }
    let prefix = server.path().trim_end_matches('/');
    let project = before
        .strip_prefix(prefix)
        .unwrap_or(before)
        .trim_matches('/');
    if !project.contains('/') || project.split('/').any(str::is_empty) {
        return Err(no_match());
    }
    let project = percent_decode(project);
    Ok((project, iid))
}

/// GitLab paths are ASCII, but a pasted URL may carry `%2F`-style escapes.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok())
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVER: Option<&str> = Some("https://gitlab.example.com");

    #[test]
    fn f01_1_mr_url_forms() {
        for url in [
            "https://gitlab.example.com/mobile/mobile-app/-/merge_requests/482",
            "https://gitlab.example.com/mobile/mobile-app/-/merge_requests/482/diffs",
            "https://GitLab.example.com/mobile/mobile-app/-/merge_requests/482?tab=x#note_1",
            "https://gitlab.example.com:443/mobile/mobile-app/-/merge_requests/482/",
        ] {
            assert_eq!(
                parse_mr_url(url, SERVER).unwrap(),
                ("mobile/mobile-app".to_owned(), 482),
                "{url}"
            );
        }
        assert_eq!(
            parse_mr_url(
                "https://example.com/gitlab/a/b/c/-/merge_requests/7",
                Some("https://example.com/gitlab/")
            )
            .unwrap(),
            ("a/b/c".to_owned(), 7)
        );
    }

    #[test]
    fn f01_5_mr_url_errors() {
        let err = |url: &str, server| parse_mr_url(url, server).unwrap_err().to_string();
        assert_eq!(
            err(
                "https://gitlab.other.org/mobile/x/-/merge_requests/1",
                SERVER
            ),
            "gitlab.other.org is not the configured GitLab server."
        );
        assert_eq!(
            err(
                "https://gitlab.example.com:8443/mobile/x/-/merge_requests/1",
                SERVER
            ),
            "gitlab.example.com:8443 is not the configured GitLab server."
        );
        assert_eq!(
            err(
                "https://gitlab.example.com/mobile/x/-/merge_requests/1",
                None
            ),
            "Add a GitLab token in Settings › GitLab."
        );
        for url in [
            "https://gitlab.example.com/mobile/x/-/issues/1",
            "https://gitlab.example.com/x/-/merge_requests/1",
            "https://gitlab.example.com/mobile/x/-/merge_requests/abc",
        ] {
            assert_eq!(
                err(url, SERVER),
                format!("No commit, branch or repository matches “{url}”.")
            );
        }
    }

    #[test]
    fn f01_1_iid_forms() {
        assert_eq!(parse_iid("!482"), Some(482));
        assert_eq!(parse_iid("!0"), None);
        assert_eq!(parse_iid("!"), None);
        assert_eq!(parse_iid("!48a"), None);
        assert_eq!(parse_iid("482"), None);
    }
}
