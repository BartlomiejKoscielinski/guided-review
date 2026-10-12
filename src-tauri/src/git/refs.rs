//! Resolving what the user typed or picked into commits (F-01.1, F-03): SHAs, local and
//! `origin/` branches, the current branch and the target from `origin/HEAD`.
//!
//! Revisions are never passed through as typed: SHAs must be hex, branch names are checked and
//! always given to git as full `refs/…` names, so input can't become an option or a revision
//! expression (`HEAD~1`, `x^{tree}`, `@{-1}`).

use super::error::GitError;
use super::runner::Git;
use crate::os::process::Cancel;

/// A hex SHA or SHA prefix of 7 to 40 characters (F-01.1).
pub fn is_sha_like(text: &str) -> bool {
    (7..=40).contains(&text.len()) && text.chars().all(|c| c.is_ascii_hexdigit())
}

/// A plausible branch name: what `git check-ref-format --branch` would accept, minus the
/// `@{-N}` forms.
pub fn is_branch_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(['-', '/', '.'])
        && !name.ends_with(['/', '.'])
        && !name.ends_with(".lock")
        && !name.contains("..")
        && !name.contains("//")
        && !name.contains("@{")
        && !name.contains("/.")
        && name != "@"
        && !name
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
}

/// The full SHA of `<rev>^{commit}`, or `None` when it doesn't name a commit. `rev` must already
/// be safe (a hex SHA or a full `refs/…` name).
async fn verify_commit(git: &Git, rev: &str, cancel: &Cancel) -> Result<Option<String>, GitError> {
    let spec = git.spec([
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        &format!("{rev}^{{commit}}"),
    ]);
    let output = git.run_spec(spec, cancel, &[0, 1, 128]).await?;
    Ok((output.code == Some(0))
        .then(|| output.stdout.trim().to_owned())
        .filter(|sha| !sha.is_empty()))
}

/// The full SHA of a commit given by a hex SHA or prefix; `None` when nothing (or more than
/// one object) matches.
pub async fn resolve_sha(
    git: &Git,
    sha: &str,
    cancel: &Cancel,
) -> Result<Option<String>, GitError> {
    if !is_sha_like(sha) {
        return Ok(None);
    }
    let prefix = sha.to_ascii_lowercase();
    // A branch or tag named like the prefix resolves first in git; only a real SHA match counts.
    Ok(verify_commit(git, &prefix, cancel)
        .await?
        .filter(|full| full.starts_with(&prefix)))
}

/// A branch found for a name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchRef {
    /// The name as shown: `feature/x` for a local branch, `origin/feature/x` for a remote one.
    pub name: String,
    /// `refs/heads/feature/x` or `refs/remotes/origin/feature/x`.
    pub full_ref: String,
    pub sha: String,
    pub remote: bool,
}

/// A local branch, else the same branch on `origin` (`x` or `origin/x`).
pub async fn branch(git: &Git, name: &str, cancel: &Cancel) -> Result<Option<BranchRef>, GitError> {
    if !is_branch_name(name) {
        return Ok(None);
    }
    let remote_name = name.strip_prefix("origin/").unwrap_or(name);
    let candidates = [
        (name.to_owned(), format!("refs/heads/{name}"), false),
        (
            format!("origin/{remote_name}"),
            format!("refs/remotes/origin/{remote_name}"),
            true,
        ),
    ];
    for (shown, full_ref, remote) in candidates {
        if let Some(sha) = verify_commit(git, &full_ref, cancel).await? {
            return Ok(Some(BranchRef {
                name: shown,
                full_ref,
                sha,
                remote,
            }));
        }
    }
    Ok(None)
}

/// The checked-out branch; `None` on a detached HEAD.
pub async fn current_branch(git: &Git, cancel: &Cancel) -> Result<Option<String>, GitError> {
    let spec = git.spec(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    let output = git.run_spec(spec, cancel, &[0, 1, 128]).await?;
    Ok((output.code == Some(0))
        .then(|| output.stdout.trim().to_owned())
        .filter(|b| !b.is_empty()))
}

/// The HEAD commit; `None` before the first commit.
pub async fn head(git: &Git, cancel: &Cancel) -> Result<Option<String>, GitError> {
    verify_commit(git, "HEAD", cancel).await
}

/// The target branch of local changes (F-03.3): `origin/HEAD` (e.g. `origin/develop`), else
/// `origin/main` or `origin/master` when they exist.
pub async fn default_target(git: &Git, cancel: &Cancel) -> Result<Option<String>, GitError> {
    let spec = git.spec(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    let output = git.run_spec(spec, cancel, &[0, 1, 128]).await?;
    let symbolic = (output.code == Some(0))
        .then(|| output.stdout.trim().strip_prefix("refs/remotes/"))
        .flatten()
        .filter(|t| t.starts_with("origin/"))
        .map(str::to_owned);
    let candidates = symbolic
        .into_iter()
        .chain(["origin/main".to_owned(), "origin/master".to_owned()]);
    for target in candidates {
        if verify_commit(git, &format!("refs/remotes/{target}"), cancel)
            .await?
            .is_some()
        {
            return Ok(Some(target));
        }
    }
    Ok(None)
}

/// The commit of a target given as `origin/<branch>` or a local branch name.
pub async fn target_commit(
    git: &Git,
    target: &str,
    cancel: &Cancel,
) -> Result<Option<String>, GitError> {
    if !is_branch_name(target) {
        return Ok(None);
    }
    let remote = if target.starts_with("origin/") {
        verify_commit(git, &format!("refs/remotes/{target}"), cancel).await?
    } else {
        None
    };
    match remote {
        Some(sha) => Ok(Some(sha)),
        None => verify_commit(git, &format!("refs/heads/{target}"), cancel).await,
    }
}

/// Whether `ancestor` is reachable from `descendant` (both full SHAs).
pub async fn is_ancestor(
    git: &Git,
    ancestor: &str,
    descendant: &str,
    cancel: &Cancel,
) -> Result<bool, GitError> {
    let spec = git.spec(["merge-base", "--is-ancestor", ancestor, descendant]);
    let output = git.run_spec(spec, cancel, &[0, 1]).await?;
    Ok(output.code == Some(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f01_1_sha_like_is_7_to_40_hex() {
        assert!(is_sha_like("a3f9c12"));
        assert!(is_sha_like(&"0123456789abcdef".repeat(2)));
        assert!(is_sha_like(&"A".repeat(40)));
        assert!(!is_sha_like("a3f9c1"));
        assert!(!is_sha_like(&"a".repeat(41)));
        assert!(!is_sha_like("a3f9c1g"));
    }

    #[test]
    fn f01_1_branch_names_that_could_be_revision_expressions_are_rejected() {
        for ok in [
            "main",
            "chore/compiled-bindings",
            "feature/zażółć-gęślą",
            "origin/main",
            "v1.2",
        ] {
            assert!(is_branch_name(ok), "{ok}");
        }
        for bad in [
            "",
            "-x",
            "--output=x",
            "HEAD~1",
            "main^{tree}",
            "@{-1}",
            "@",
            "a..b",
            "a b",
            "a:b",
            "x.lock",
            "x/",
            "/x",
            "a\\b",
            "a*",
        ] {
            assert!(!is_branch_name(bad), "{bad}");
        }
    }
}
