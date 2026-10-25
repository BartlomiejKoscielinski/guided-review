//! The commit a fix on S-10 is a fixup of (F-26.4, M7 decision 8): the commit that last changed
//! the thread's line (`git blame -L n,n HEAD`) when it lies in merge-base(origin/<target>, HEAD)..
//! HEAD, else the newest commit of that range touching the file, else HEAD. Blame reads HEAD, not
//! the working tree, so the uncommitted fix on the line itself does not hide the commit. Read only.

use serde::Serialize;
use ts_rs::TS;

use super::diff;
use super::error::GitError;
use super::refs;
use super::runner::Git;
use crate::os::process::Cancel;

/// The fixup switch's commit: "As a fixup of <short_sha> “<subject>”".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FixupTarget {
    /// The full SHA, sent back with the commit.
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
}

/// The fixup target of a thread on `line` of `path` (None: a removed line or an outdated
/// position) in my MR against `target`.
pub async fn find(
    git: &Git,
    target: &str,
    path: &str,
    line: Option<u32>,
    cancel: &Cancel,
) -> Result<FixupTarget, GitError> {
    let base = diff::author_base(git, target, cancel).await?;
    let blamed = match line {
        Some(no) if no > 0 => blame(git, path, no, cancel).await?,
        _ => None,
    };
    let in_range = match blamed {
        Some(sha) if !refs::is_ancestor(git, &sha, &base, cancel).await? => Some(sha),
        _ => None,
    };
    let sha = match in_range {
        Some(sha) => sha,
        None => match newest_touching(git, &base, path, cancel).await? {
            Some(sha) => sha,
            None => "HEAD".to_owned(),
        },
    };
    describe(git, &sha, cancel).await
}

/// The commit that last changed line `no` of `path` at HEAD; None past the end or for a file
/// HEAD does not have.
async fn blame(
    git: &Git,
    path: &str,
    no: u32,
    cancel: &Cancel,
) -> Result<Option<String>, GitError> {
    let range = format!("{no},{no}");
    let spec = git.spec([
        "blame",
        "--porcelain",
        "-L",
        range.as_str(),
        "HEAD",
        "--",
        path,
    ]);
    let output = git.run_spec(spec, cancel, &[0, 128]).await?;
    if output.code != Some(0) {
        return Ok(None);
    }
    Ok(output
        .stdout
        .split_whitespace()
        .next()
        .filter(|sha| sha.len() == 40 && refs::is_sha_like(sha))
        .map(str::to_owned))
}

/// The newest commit of `base..HEAD` that touches `path`.
async fn newest_touching(
    git: &Git,
    base: &str,
    path: &str,
    cancel: &Cancel,
) -> Result<Option<String>, GitError> {
    let range = format!("{base}..HEAD");
    let output = git
        .run(
            ["log", "-1", "--format=%H", range.as_str(), "--", path],
            cancel,
        )
        .await?;
    let sha = output.stdout.trim();
    Ok((!sha.is_empty()).then(|| sha.to_owned()))
}

async fn describe(git: &Git, rev: &str, cancel: &Cancel) -> Result<FixupTarget, GitError> {
    let output = git
        .run(["show", "-s", "--format=%H%x00%h%x00%s", rev], cancel)
        .await?;
    let mut parts = output.stdout.trim_end().splitn(3, '\0');
    let (Some(sha), Some(short_sha), Some(subject)) = (parts.next(), parts.next(), parts.next())
    else {
        return Err(GitError::Parse {
            command: "show".to_owned(),
            what: "the fixup target",
        });
    };
    Ok(FixupTarget {
        sha: sha.to_owned(),
        short_sha: short_sha.to_owned(),
        subject: subject.to_owned(),
    })
}
