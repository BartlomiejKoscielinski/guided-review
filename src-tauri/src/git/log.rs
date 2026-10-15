//! The Commits column of S-01 (F-03.1): the newest 200 commits of a branch, filtered by message,
//! author or SHA prefix (docs/05 › Commit list); the messages of a commits session (F-17.1).

use serde::Serialize;
use ts_rs::TS;

use super::error::GitError;
use super::refs;
use super::runner::Git;
use crate::os::process::Cancel;

/// Commits shown at most (docs/05).
pub const LIMIT: usize = 200;

/// SHA, short SHA, subject, author, author date (ISO 8601), committer timestamp (merge order),
/// parents.
const FORMAT: &str = "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%ct%x1f%P%x1e";

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
    /// First parent; `None` for a root commit. A Shift+click range starts here, so the oldest
    /// selected commit is included (`from` is excluded, F-03.2).
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
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

/// Bytes of commit messages a commits session hands Claude as its description at most
/// (M3 decision 13); the rest is cut with a note.
pub const MESSAGES_MAX: usize = 64 * 1024;

/// The full messages (subject and body) of a single commit (`from` = `None`) or of the commits
/// in `from..to` (`from` excluded), oldest first, each headed by its short SHA, capped at
/// [`MESSAGES_MAX`] bytes: the description of a commits session (F-17.1, M3 decision 13).
pub async fn messages(
    git: &Git,
    from: Option<&str>,
    to: &str,
    cancel: &Cancel,
) -> Result<String, GitError> {
    let range = from.map(|from| format!("{from}..{to}"));
    let mut args = vec!["log", "--no-color", "--reverse", "--format=%h%x1f%B%x1e"];
    match &range {
        Some(range) => args.extend(["--end-of-options", range.as_str()]),
        None => args.extend(["-n", "1", "--end-of-options", to]),
    }
    args.push("--");
    let output = git.run(args, cancel).await?;
    let text = output
        .stdout
        .split('\x1e')
        .filter_map(|record| {
            let (short_sha, message) =
                record.trim_start_matches(['\n', '\r']).split_once('\x1f')?;
            let message = message.trim();
            (!message.is_empty()).then(|| format!("{short_sha} {message}"))
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(cap(&text, MESSAGES_MAX))
}

/// `text` cut to at most `max` bytes on a character boundary, with a note when cut.
fn cap(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{}\n\n[Commit messages cut at {} KB.]",
        text[..end].trim_end(),
        max / 1024
    )
}

fn parse(text: &str) -> Option<Vec<Entry>> {
    text.split('\x1e')
        .map(|record| record.trim_start_matches(['\n', '\r']))
        .filter(|record| !record.is_empty())
        .map(|record| {
            let fields: Vec<&str> = record.split('\x1f').collect();
            let [sha, short_sha, subject, author, date, time, parents] = fields.as_slice() else {
                return None;
            };
            Some(Entry {
                row: CommitRow {
                    sha: (*sha).to_owned(),
                    short_sha: (*short_sha).to_owned(),
                    subject: (*subject).to_owned(),
                    author: (*author).to_owned(),
                    date: (*date).to_owned(),
                    parent: parents.split_whitespace().next().map(str::to_owned),
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
        let text = "aaa\x1fa\x1fFix ąę\x1fŁukasz\x1f2026-10-01T10:00:00+02:00\x1f100\x1f\x1e\n\
                    bbb\x1fb\x1fAdd\x1fAnna\x1f2026-10-02T10:00:00+02:00\x1f200\x1faaa ccc\x1e\n";
        let mut entries = parse(text).unwrap();
        assert_eq!(entries[0].row.subject, "Fix ąę");
        assert_eq!(entries[0].row.parent, None);
        assert_eq!(entries[1].row.parent.as_deref(), Some("aaa"));
        entries.extend(parse(text).unwrap());
        let merged = merge(entries);
        let shas: Vec<_> = merged.iter().map(|e| e.row.sha.as_str()).collect();
        assert_eq!(shas, ["bbb", "aaa"]);
        assert!(parse("x\x1fy\x1e").is_none());
        assert_eq!(parse("").unwrap().len(), 0);
    }

    #[test]
    fn f17_1_caps_commit_messages_on_a_character_boundary() {
        assert_eq!(cap("Zażółć", 64), "Zażółć");
        // "ż" is two bytes; a cut inside it backs off to the character before.
        let capped = cap("aż gęś", 2);
        assert_eq!(capped, "a\n\n[Commit messages cut at 0 KB.]");
        let long = "ł".repeat(MESSAGES_MAX);
        let capped = cap(&long, MESSAGES_MAX);
        assert!(capped.len() < MESSAGES_MAX + 64);
        assert!(capped.ends_with("[Commit messages cut at 64 KB.]"));
    }
}
