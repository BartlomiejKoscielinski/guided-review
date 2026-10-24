//! The branch block of S-11 New merge request (F-27.1): the current branch, its upstream, the
//! branches on `origin` it can be merged into (the default from `origin/HEAD` first) and
//! `N commits · N files · +/−` of `merge-base(origin/<target>, HEAD)..HEAD`. Reads only.

use serde::Serialize;
use ts_rs::TS;

use super::diff;
use super::error::GitError;
use super::refs;
use super::runner::Git;
use crate::os::process::Cancel;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BranchInfo {
    /// The checked-out branch; `None` on a detached HEAD.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// The upstream, e.g. `origin/feature/x`; `None` before the first push.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    /// Branches on `origin` (without `origin/`), the default first, then by name; never the
    /// current branch or `origin/HEAD`.
    pub targets: Vec<String>,
    /// The target the numbers are counted against (without `origin/`); `None` without targets.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub commits: u32,
    pub files: u32,
    pub additions: u32,
    pub deletions: u32,
}

const REMOTE_PREFIX: &str = "refs/remotes/origin/";
/// S-11 shows it in place of the numbers when the chosen target is gone.
const NOT_ON_ORIGIN: &str = "That target is not a branch on origin.";

/// The branch block for `target` (a branch on `origin`, with or without `origin/`), or for the
/// default target when it is missing. A target that is no branch on `origin` is refused.
pub async fn branch_info(
    git: &Git,
    target: Option<&str>,
    cancel: &Cancel,
) -> Result<BranchInfo, GitError> {
    let branch = refs::current_branch(git, cancel).await?;
    let upstream = match &branch {
        Some(name) => upstream(git, name, cancel).await?,
        None => None,
    };
    let default = refs::default_target(git, cancel)
        .await?
        .map(|t| t.strip_prefix("origin/").unwrap_or(&t).to_owned());
    let targets = origin_branches(git, branch.as_deref(), default.as_deref(), cancel).await?;
    let target = match target {
        Some(asked) => {
            let name = asked.strip_prefix("origin/").unwrap_or(asked);
            if !refs::is_branch_name(name) || !targets.iter().any(|t| t == name) {
                return Err(GitError::Invalid(NOT_ON_ORIGIN.to_owned()));
            }
            Some(name.to_owned())
        }
        None => default
            .filter(|d| targets.contains(d))
            .or_else(|| targets.first().cloned()),
    };
    let mut info = BranchInfo {
        branch,
        upstream,
        targets,
        target,
        ..BranchInfo::default()
    };
    if let (Some(target), Some(head)) = (info.target.clone(), refs::head(git, cancel).await?) {
        count(git, &target, &head, &mut info, cancel).await?;
    }
    Ok(info)
}

/// `origin/<branch>` when `branch` tracks it; `None` before the first push.
async fn upstream(git: &Git, branch: &str, cancel: &Cancel) -> Result<Option<String>, GitError> {
    if !refs::is_branch_name(branch) {
        return Ok(None);
    }
    let spec = git.spec([
        "for-each-ref",
        "--format=%(upstream:short)",
        &format!("refs/heads/{branch}"),
    ]);
    let output = git.run_spec(spec, cancel, &[0]).await?;
    Ok(output
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned))
}

/// Branch names under `refs/remotes/origin/`, the default first, then sorted by name.
async fn origin_branches(
    git: &Git,
    current: Option<&str>,
    default: Option<&str>,
    cancel: &Cancel,
) -> Result<Vec<String>, GitError> {
    let output = git
        .run(
            [
                "for-each-ref",
                "--format=%(refname)",
                "refs/remotes/origin/",
            ],
            cancel,
        )
        .await?;
    Ok(order_targets(&output.stdout, current, default))
}

/// Parses `for-each-ref --format=%(refname)` lines into target names.
fn order_targets(stdout: &str, current: Option<&str>, default: Option<&str>) -> Vec<String> {
    let mut names: Vec<String> = stdout
        .lines()
        .filter_map(|line| line.trim().strip_prefix(REMOTE_PREFIX))
        .filter(|name| *name != "HEAD" && Some(*name) != current)
        .map(str::to_owned)
        .collect();
    names.sort();
    names.dedup();
    if let Some(position) = default.and_then(|d| names.iter().position(|n| n == d)) {
        let first = names.remove(position);
        names.insert(0, first);
    }
    names
}

/// Commits, files and lines of `merge-base(origin/<target>, head)..head`.
async fn count(
    git: &Git,
    target: &str,
    head: &str,
    info: &mut BranchInfo,
    cancel: &Cancel,
) -> Result<(), GitError> {
    let Some(target_sha) =
        refs::verify_commit(git, &format!("{REMOTE_PREFIX}{target}"), cancel).await?
    else {
        return Ok(());
    };
    let spec = git.spec(["merge-base", &target_sha, head]);
    let output = git.run_spec(spec, cancel, &[0, 1]).await?;
    let base = output.stdout.trim();
    if output.code != Some(0) || base.is_empty() {
        // Unrelated histories: nothing to count.
        return Ok(());
    }
    let commits = git
        .run(["rev-list", "--count", &format!("{base}..{head}")], cancel)
        .await?;
    let files = diff::range_files(git, base, head, cancel).await?;
    info.commits = commits.stdout.trim().parse().unwrap_or(0);
    info.files = u32::try_from(files.len()).unwrap_or(u32::MAX);
    info.additions = files
        .iter()
        .map(|f| f.additions)
        .fold(0, u32::saturating_add);
    info.deletions = files
        .iter()
        .map(|f| f.deletions)
        .fold(0, u32::saturating_add);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f27_1_targets_skip_head_and_the_current_branch_and_put_the_default_first() {
        let stdout = "refs/remotes/origin/HEAD\nrefs/remotes/origin/main\n\
                      refs/remotes/origin/release/1.8\nrefs/remotes/origin/feature/zażółć\n\
                      refs/remotes/origin/develop\n";
        assert_eq!(
            order_targets(stdout, Some("feature/zażółć"), Some("develop")),
            ["develop", "main", "release/1.8"]
        );
        assert_eq!(
            order_targets(stdout, None, None),
            ["develop", "feature/zażółć", "main", "release/1.8"]
        );
        assert!(order_targets("", None, Some("main")).is_empty());
    }

    #[test]
    fn f27_1_a_refused_target_says_it_is_not_on_origin() {
        let error = crate::error::AppError::from(GitError::Invalid(NOT_ON_ORIGIN.to_owned()));
        assert_eq!(error.message, "That target is not a branch on origin.");
    }
}
