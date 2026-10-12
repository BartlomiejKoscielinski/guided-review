//! Counts for the My changes column of S-01 (F-03.3): uncommitted changes, staged only, and the
//! whole branch against the target from `origin/HEAD`. Reads only.

use serde::Serialize;
use ts_rs::TS;

use super::diff::{self, ChangedFile};
use super::error::GitError;
use super::local::{count_untracked, read_status, tracked_changes};
use super::refs;
use super::runner::Git;
use super::status::EntryKind;
use crate::os::process::Cancel;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScopeCount {
    pub files: u32,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BranchCount {
    /// Commits on the branch since the merge base with the target.
    pub commits: u32,
    pub files: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StatusSummary {
    /// `None` on a detached HEAD.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// The target ref, e.g. `origin/develop`; `None` without `origin`.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// The target's branch name as shown ("Whole branch vs develop").
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    /// HEAD → working tree, untracked files included.
    pub uncommitted: ScopeCount,
    /// HEAD → index.
    pub staged: ScopeCount,
    /// `None` without a target or before the first commit.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_vs_target: Option<BranchCount>,
}

fn count(files: &[ChangedFile]) -> ScopeCount {
    ScopeCount {
        files: u32::try_from(files.len()).unwrap_or(u32::MAX),
        additions: files
            .iter()
            .map(|f| f.additions)
            .fold(0, u32::saturating_add),
        deletions: files
            .iter()
            .map(|f| f.deletions)
            .fold(0, u32::saturating_add),
    }
}

fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

pub async fn status_summary(git: &Git, cancel: &Cancel) -> Result<StatusSummary, GitError> {
    let status = read_status(git, cancel).await?;
    let base = match &status.head {
        Some(head) => head.clone(),
        None => diff::empty_tree(git, cancel).await?,
    };
    let mut uncommitted = count(&tracked_changes(git, &base, cancel).await?);
    for entry in status
        .entries
        .iter()
        .filter(|e| e.kind == EntryKind::Untracked)
    {
        let (_, lines) = count_untracked(&git.repo().join(&entry.path)).await;
        uncommitted.files = uncommitted.files.saturating_add(1);
        uncommitted.additions = uncommitted.additions.saturating_add(lines);
    }
    let staged = count(&staged_changes(git, &base, cancel).await?);
    let target = refs::default_target(git, cancel).await?;
    let branch_vs_target = match (&target, &status.head) {
        (Some(target), Some(head)) => Some(branch_count(git, target, head, cancel).await?),
        _ => None,
    };
    Ok(StatusSummary {
        branch: status.branch,
        target_name: target
            .as_deref()
            .map(|t| t.strip_prefix("origin/").unwrap_or(t).to_owned()),
        target,
        uncommitted,
        staged,
        branch_vs_target,
    })
}

async fn staged_changes(
    git: &Git,
    base: &str,
    cancel: &Cancel,
) -> Result<Vec<ChangedFile>, GitError> {
    let output = git
        .run(
            [
                "diff",
                "--cached",
                "--no-color",
                "--no-ext-diff",
                "--raw",
                "--numstat",
                "-z",
                "-M",
                base,
            ],
            cancel,
        )
        .await?;
    diff::parse_raw_numstat(&output.stdout).ok_or(GitError::Parse {
        command: "diff --cached --raw --numstat".to_owned(),
        what: "file list",
    })
}

/// Commits and files of `merge-base(target, HEAD)..HEAD` (docs/05 › Local diffs).
async fn branch_count(
    git: &Git,
    target: &str,
    head: &str,
    cancel: &Cancel,
) -> Result<BranchCount, GitError> {
    let Some(target_sha) = refs::target_commit(git, target, cancel).await? else {
        return Ok(BranchCount::default());
    };
    let spec = git.spec(["merge-base", &target_sha, head]);
    let output = git.run_spec(spec, cancel, &[0, 1]).await?;
    let base = output.stdout.trim();
    if output.code != Some(0) || base.is_empty() {
        // Unrelated histories: nothing to compare.
        return Ok(BranchCount::default());
    }
    let commits = git
        .run(["rev-list", "--count", &format!("{base}..{head}")], cancel)
        .await?;
    let files = diff::range_files(git, base, head, cancel).await?;
    Ok(BranchCount {
        commits: commits.stdout.trim().parse().unwrap_or(0),
        files: to_u32(files.len()),
    })
}
