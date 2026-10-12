//! The Commits column of S-01 (F-03.1): the newest 200 commits of a branch, filtered by message,
//! author or SHA prefix (docs/05 › Commit list).

use serde::Serialize;
use ts_rs::TS;

use super::error::GitError;
use super::refs;
use super::runner::Git;
use crate::os::process::Cancel;

/// Commits shown at most (docs/05).
pub const LIMIT: usize = 200;

/// SHA, short SHA, subject, author, author date (ISO 8601), committer timestamp (merge order).
const FORMAT: &str = "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%ct%x1e";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitRow {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub author: String,
    /// ISO 8601 author date.
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitList {
    /// The branch listed (header of the column); `None` on a detached HEAD.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// Newest first.
    pub commits: Vec<CommitRow>,
}

struct Entry {
    row: CommitRow,
    time: i64,
}

/// Commits of `branch` (the current branch when `None`), newest first. A query matches the
/// message or the author (case-insensitive, literal) or is a SHA prefix of a commit on the
/// branch.
pub async fn log(
    git: &Git,
    branch: Option<&str>,
    query: Option<&str>,
    cancel: &Cancel,
) -> Result<CommitList, GitError> {
    let (name, rev) = match branch {
        Some(name) => {
            let found = refs::branch(git, name, cancel)
                .await?
                .ok_or_else(|| GitError::Invalid(format!("There is no branch {name}.")))?;
            (Some(found.name), found.full_ref)
        }
        None => {
            if refs::head(git, cancel).await?.is_none() {
                return Ok(CommitList {
                    branch: refs::current_branch(git, cancel).await?,
                    commits: Vec::new(),
                });
            }
            (refs::current_branch(git, cancel).await?, "HEAD".to_owned())
        }
    };
    let query = query.map(str::trim).filter(|q| !q.is_empty());
    let commits = match query {
        None => run(git, &rev, None, cancel).await?,
        Some(q) => {
            let mut found = run(git, &rev, Some(&format!("--grep={q}")), cancel).await?;
            found.extend(run(git, &rev, Some(&format!("--author={q}")), cancel).await?);
            if let Some(entry) = by_sha(git, &rev, q, cancel).await? {
                found.push(entry);
            }
            merge(found)
        }
    };
    Ok(CommitList {
        branch: name,
        commits: commits.into_iter().map(|e| e.row).collect(),
    })
}

async fn run(
    git: &Git,
    rev: &str,
    filter: Option<&str>,
    cancel: &Cancel,
) -> Result<Vec<Entry>, GitError> {
    let limit = LIMIT.to_string();
    let mut args = vec!["log", "--no-color", FORMAT, "-n", &limit];
    if let Some(filter) = filter {
        args.extend(["--regexp-ignore-case", "--fixed-strings", filter]);
    }
    args.extend([rev, "--"]);
    let output = git.run(args, cancel).await?;
    parse(&output.stdout).ok_or(GitError::Parse {
        command: "log".to_owned(),
        what: "commit list",
    })
}

/// The commit a SHA prefix names, if it is on the branch.
async fn by_sha(
    git: &Git,
    rev: &str,
    query: &str,
    cancel: &Cancel,
) -> Result<Option<Entry>, GitError> {
    if !(4..=40).contains(&query.len()) || !query.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(None);
    }
    let spec = git.spec([
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        &format!("{}^{{commit}}", query.to_ascii_lowercase()),
    ]);
    let output = git.run_spec(spec, cancel, &[0, 1, 128]).await?;
    let sha = output.stdout.trim();
    if output.code != Some(0) || !sha.starts_with(&query.to_ascii_lowercase()) {
        return Ok(None);
    }
    let head = git.run(["rev-parse", "--verify", rev], cancel).await?;
    if !refs::is_ancestor(git, sha, head.stdout.trim(), cancel).await? {
        return Ok(None);
    }
    let output = git
        .run(["log", "--no-color", FORMAT, "-n", "1", sha, "--"], cancel)
        .await?;
    Ok(parse(&output.stdout).and_then(|mut e| e.pop()))
}

/// Union of the filtered lists, newest first, without duplicates, at most [`LIMIT`].
fn merge(mut entries: Vec<Entry>) -> Vec<Entry> {
    entries.sort_by_key(|e| std::cmp::Reverse(e.time));
    let mut seen = std::collections::HashSet::new();
    entries.retain(|e| seen.insert(e.row.sha.clone()));
    entries.truncate(LIMIT);
    entries
}

fn parse(text: &str) -> Option<Vec<Entry>> {
    text.split('\x1e')
        .map(|record| record.trim_start_matches(['\n', '\r']))
        .filter(|record| !record.is_empty())
        .map(|record| {
            let fields: Vec<&str> = record.split('\x1f').collect();
            let [sha, short_sha, subject, author, date, time] = fields.as_slice() else {
                return None;
            };
            Some(Entry {
                row: CommitRow {
                    sha: (*sha).to_owned(),
                    short_sha: (*short_sha).to_owned(),
                    subject: (*subject).to_owned(),
                    author: (*author).to_owned(),
                    date: (*date).to_owned(),
                },
                time: time.trim().parse().ok()?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f03_1_parses_records_and_merges_newest_first() {
        let text = "aaa\x1fa\x1fFix ąę\x1fŁukasz\x1f2026-10-01T10:00:00+02:00\x1f100\x1e\n\
                    bbb\x1fb\x1fAdd\x1fAnna\x1f2026-10-02T10:00:00+02:00\x1f200\x1e\n";
        let mut entries = parse(text).unwrap();
        assert_eq!(entries[0].row.subject, "Fix ąę");
        entries.extend(parse(text).unwrap());
        let merged = merge(entries);
        let shas: Vec<_> = merged.iter().map(|e| e.row.sha.as_str()).collect();
        assert_eq!(shas, ["bbb", "aaa"]);
        assert!(parse("x\x1fy\x1e").is_none());
        assert_eq!(parse("").unwrap().len(), 0);
    }
}
