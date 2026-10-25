//! The git side of S-11's "Before you create" (F-27.5): whether the current branch is on `origin`
//! at HEAD (`git ls-remote`, so a remote branch deleted behind the checkout's back counts as not
//! pushed) and which files conflict with `origin/<target>` (`git merge-tree --write-tree`, which
//! writes objects only: HEAD, the index and the working tree stay as they are). The self-review
//! and an open MR of the branch are added by the command (`commands::merge_check`).

use serde::Serialize;
use ts_rs::TS;

use super::branch_info::targets_and_target;
use super::error::GitError;
use super::refs;
use super::runner::Git;
use crate::os::process::Cancel;

/// Whether `origin` has the branch at HEAD.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PushState {
    /// `origin` has no such branch (Create is disabled, M7 decision 19).
    NotPushed,
    /// `origin/<branch>` is HEAD.
    Pushed,
    /// `origin/<branch>` is another commit than HEAD (usually commits after the push).
    Ahead,
}

/// The newest self-review of the repository: "6 of 6 steps · 0 open notes".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct SelfReviewProgress {
    pub reviewed: u32,
    pub total: u32,
    /// Notes not published yet.
    pub notes: u32,
}

/// An open MR of the branch (the banner; Create is disabled).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ExistingMr {
    #[ts(type = "number")]
    pub iid: u64,
    pub title: String,
}

/// The checks of "Before you create".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MergeCheck {
    pub branch: String,
    /// Without `origin/`.
    pub target: String,
    pub pushed: PushState,
    /// Files that conflict with `origin/<target>`, sorted by path; empty for a clean merge.
    pub conflicts: Vec<String>,
    /// `None` while the repository has no self-review.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub self_review: Option<SelfReviewProgress>,
    /// `None` without an open MR of the branch (or without GitLab).
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_mr: Option<ExistingMr>,
}

const DETACHED: &str = "Check out a branch to create a merge request.";
const NO_TARGET: &str = "No branch on origin to merge into.";

/// The git checks for an MR of the current branch into `target` (a branch on `origin`, with or
/// without `origin/`; the default target when missing). A target that is no branch on `origin`
/// is refused like `branch_info`. Reads only.
pub async fn merge_check(
    git: &Git,
    target: Option<&str>,
    cancel: &Cancel,
) -> Result<MergeCheck, GitError> {
    let branch = refs::current_branch(git, cancel)
        .await?
        .filter(|b| refs::is_branch_name(b))
        .ok_or_else(|| GitError::Invalid(DETACHED.to_owned()))?;
    let (_, target) = targets_and_target(git, Some(&branch), target, cancel).await?;
    let target = target.ok_or_else(|| GitError::Invalid(NO_TARGET.to_owned()))?;
    let head = refs::head(git, cancel)
        .await?
        .ok_or_else(|| GitError::Invalid(DETACHED.to_owned()))?;
    let pushed = push_state(git, &branch, &head, cancel).await?;
    let conflicts = conflicts(git, &target, cancel).await?;
    Ok(MergeCheck {
        branch,
        target,
        pushed,
        conflicts,
        self_review: None,
        existing_mr: None,
    })
}

/// `git ls-remote origin refs/heads/<branch>` against HEAD.
async fn push_state(
    git: &Git,
    branch: &str,
    head: &str,
    cancel: &Cancel,
) -> Result<PushState, GitError> {
    let reference = format!("refs/heads/{branch}");
    let output = git
        .run(["ls-remote", "origin", reference.as_str()], cancel)
        .await?;
    Ok(read_ls_remote(&output.stdout, &reference, head))
}

/// The state from `ls-remote` lines `<sha>\t<ref>`; only the exact ref counts (the pattern also
/// matches refs that end with it).
fn read_ls_remote(stdout: &str, reference: &str, head: &str) -> PushState {
    let remote = stdout.lines().find_map(|line| {
        let (sha, name) = line.trim_end().split_once('\t')?;
        (name == reference).then_some(sha.trim())
    });
    match remote {
        None => PushState::NotPushed,
        Some(sha) if sha.eq_ignore_ascii_case(head) => PushState::Pushed,
        Some(_) => PushState::Ahead,
    }
}

/// `git merge-tree --write-tree --no-messages --name-only -z origin/<target> HEAD`: exit 0 is a
/// clean merge, 1 lists the conflicting files after the tree's OID.
async fn conflicts(git: &Git, target: &str, cancel: &Cancel) -> Result<Vec<String>, GitError> {
    let remote = format!("refs/remotes/origin/{target}");
    let spec = git.spec([
        "merge-tree",
        "--write-tree",
        "--no-messages",
        "--name-only",
        "-z",
        remote.as_str(),
        "HEAD",
    ]);
    let output = git.run_spec(spec, cancel, &[0, 1]).await?;
    if output.code == Some(0) {
        return Ok(Vec::new());
    }
    Ok(read_conflicts(&output.stdout))
}

/// Whether HEAD's history holds commit `sha` (`git merge-base --is-ancestor <sha> HEAD`): a
/// self-review counts for the branch it was made on, also once its uncommitted changes are
/// committed (F-27.5). Anything but a full hex SHA, and a commit the repository lacks, is `false`.
pub async fn head_contains(git: &Git, sha: &str, cancel: &Cancel) -> Result<bool, GitError> {
    let sha = sha.trim();
    if sha.len() < 40 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Ok(false);
    }
    let spec = git.spec(["merge-base", "--is-ancestor", sha, "HEAD"]);
    let output = git.run_spec(spec, cancel, &[0, 1, 128]).await?;
    Ok(output.code == Some(0))
}

/// The file names after the OID, sorted and without repeats.
fn read_conflicts(stdout: &str) -> Vec<String> {
    let mut names: Vec<String> = stdout
        .split('\0')
        .skip(1)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect();
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEAD: &str = "92ca24ad606746b1ac99ea06d043151b4ecf29f0";

    #[test]
    fn f27_5_ls_remote_reads_only_the_exact_branch() {
        let reference = "refs/heads/feature/x";
        assert_eq!(read_ls_remote("", reference, HEAD), PushState::NotPushed);
        let other = format!("{HEAD}\trefs/heads/other/refs/heads/feature/x\n");
        assert_eq!(
            read_ls_remote(&other, reference, HEAD),
            PushState::NotPushed
        );
        let same = format!("{HEAD}\trefs/heads/feature/x\n");
        assert_eq!(read_ls_remote(&same, reference, HEAD), PushState::Pushed);
        let older = "1631 4cd5\trefs/heads/feature/x\n".replace(' ', "");
        assert_eq!(read_ls_remote(&older, reference, HEAD), PushState::Ahead);
    }

    #[test]
    fn f27_5_merge_tree_names_follow_the_tree_oid() {
        assert!(read_conflicts(&format!("{HEAD}\0")).is_empty());
        assert_eq!(
            read_conflicts(&format!("{HEAD}\0src/ż ą.cs\0App.xaml\0App.xaml\0")),
            ["App.xaml", "src/ż ą.cs"]
        );
    }
}
