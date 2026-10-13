//! MR heads and review worktrees (docs/05 › git: "Fetch MR head", "Review worktree"). These
//! commands only fetch into the user's repository and add, move or remove app-managed
//! worktrees; the user's checkout is never touched. Callers make sure only paths registered in
//! `worktrees` are moved or removed (T8).

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::error::GitError;
use super::refs;
use super::runner::Git;
use crate::os::process::Cancel;

/// A fetch of a large repository over VPN can take minutes.
const FETCH_TIMEOUT: Duration = Duration::from_secs(600);

/// The local ref an MR head is fetched to.
pub fn mr_ref(iid: u64) -> String {
    format!("refs/review/mr/{iid}")
}

/// What a fetch of an MR resolved to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchedMr {
    pub head_sha: String,
    pub target_sha: String,
}

/// `git fetch origin +refs/merge-requests/<iid>/head:refs/review/mr/<iid>` and the target
/// branch into `origin/<target>`. `target` must be a valid branch name.
pub async fn fetch_mr(
    git: &Git,
    iid: u64,
    target: &str,
    cancel: &Cancel,
) -> Result<FetchedMr, GitError> {
    let local = mr_ref(iid);
    let spec = git
        .spec([
            "fetch".to_owned(),
            "--quiet".to_owned(),
            "--no-tags".to_owned(),
            "origin".to_owned(),
            format!("+refs/merge-requests/{iid}/head:{local}"),
            format!("+refs/heads/{target}:refs/remotes/origin/{target}"),
        ])
        .timeout(FETCH_TIMEOUT);
    git.run_spec(spec, cancel, &[0]).await?;
    let commit = |rev: String| async move {
        refs::verify_commit(git, &rev, cancel)
            .await?
            .ok_or(GitError::Parse {
                command: "rev-parse".to_owned(),
                what: "fetched commit",
            })
    };
    Ok(FetchedMr {
        head_sha: commit(local).await?,
        target_sha: commit(format!("refs/remotes/origin/{target}")).await?,
    })
}

/// Paths of the repository's worktrees (`git worktree list --porcelain`), as git prints them.
pub async fn list(git: &Git, cancel: &Cancel) -> Result<Vec<PathBuf>, GitError> {
    let output = git
        .run(["worktree", "list", "--porcelain", "-z"], cancel)
        .await?;
    Ok(output
        .stdout
        .split('\0')
        .filter_map(|field| field.strip_prefix("worktree "))
        .map(PathBuf::from)
        .collect())
}

/// Whether `path` is one of `listed` (git prints `/`, Windows paths compare case-insensitively).
pub fn contains(listed: &[PathBuf], path: &Path) -> bool {
    let key = |p: &Path| {
        p.to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    let wanted = key(path);
    listed.iter().any(|p| key(p) == wanted)
}

/// `git worktree add --detach <path> <sha>`.
pub async fn add(git: &Git, path: &Path, sha: &str, cancel: &Cancel) -> Result<(), GitError> {
    let args = [
        "worktree".into(),
        "add".into(),
        "--quiet".into(),
        "--detach".into(),
        path.as_os_str().to_owned(),
        sha.into(),
    ];
    git.run(args, cancel).await.map(drop)
}

/// The worktree's HEAD commit.
pub async fn head(worktree: &Git, cancel: &Cancel) -> Result<String, GitError> {
    let output = worktree.run(["rev-parse", "HEAD"], cancel).await?;
    Ok(output.stdout.trim().to_owned())
}

/// A new MR version: `git -C <path> checkout --detach <sha>` in the app-managed worktree.
pub async fn move_to(worktree: &Git, sha: &str, cancel: &Cancel) -> Result<(), GitError> {
    worktree
        .run(["checkout", "--quiet", "--detach", sha], cancel)
        .await
        .map(drop)
}

/// `git worktree remove --force <path>`.
pub async fn remove(git: &Git, path: &Path, cancel: &Cancel) -> Result<(), GitError> {
    let args = [
        "worktree".into(),
        "remove".into(),
        "--force".into(),
        path.as_os_str().to_owned(),
    ];
    git.run(args, cancel).await.map(drop)
}

/// `git worktree prune`: forgets worktrees whose folders are gone.
pub async fn prune(git: &Git, cancel: &Cancel) -> Result<(), GitError> {
    git.run(["worktree", "prune"], cancel).await.map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f05_1_listed_paths_compare_like_windows_paths() {
        let listed = vec![PathBuf::from("C:/src/.review/mobile ąę/482")];
        assert!(contains(
            &listed,
            Path::new(r"c:\SRC\.review\mobile ĄĘ\482\")
        ));
        assert!(!contains(
            &listed,
            Path::new(r"C:\src\.review\mobile ąę\48")
        ));
    }
}
