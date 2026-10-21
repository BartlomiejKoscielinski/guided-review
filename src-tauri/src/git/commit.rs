//! Commit, amend and push (F-16.4, F-16.5) and the commit-mode details of S-06 (F-15.6).
//! The message goes to `git commit -F -` on stdin (T6); the user's hooks run and their output
//! is returned on failure. S-10 commits one fixed file, optionally as a fixup (F-26.4). Push is
//! `git push origin HEAD` (`-u` without an upstream) and never forces (T8).

use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

use super::diff::{self, ChangedFile};
use super::error::GitError;
use super::local;
use super::model::FileDiff;
use super::runner::Git;
use super::tree::{self, FileGroup, TreeFile};
use crate::os::process::Cancel;

/// Hooks may run builds or tests.
const COMMIT_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const PUSH_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitResult {
    pub sha: String,
    pub short_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PushResult {
    /// "origin/<branch>" for "Pushed to origin/<branch>."
    pub remote_branch: String,
}

/// Creates a commit (or amends HEAD) from what is staged.
pub async fn commit(
    git: &Git,
    message: &str,
    amend: bool,
    cancel: &Cancel,
) -> Result<CommitResult, GitError> {
    require_message(message)?;
    let mut args = vec!["commit", "-F", "-"];
    if amend {
        args.push("--amend");
    }
    run_commit(git, args, message, cancel).await
}

/// S-10's commit of a fix (F-26.4, M7 decision 10): only the files of `only`, from the working
/// tree with their staged and unstaged edits alike (`git commit -- <paths>`); other staged and
/// unstaged changes stay where they are. With `fixup` (a commit SHA, never an option or a branch)
/// the commit reads `fixup! <subject of fixup>` with `message` as its body, which
/// `git rebase --autosquash` folds into that commit; git refuses `--fixup` with `-F`, so the
/// message is composed here. Never amends.
pub async fn commit_only(
    git: &Git,
    message: &str,
    fixup: Option<&str>,
    only: &[String],
    cancel: &Cancel,
) -> Result<CommitResult, GitError> {
    require_message(message)?;
    if only.is_empty() {
        return Err(GitError::Invalid("Pick the file to commit.".to_owned()));
    }
    let text = match fixup {
        Some(sha) => format!(
            "fixup! {}

{}",
            subject_of(git, sha, cancel).await?,
            message.trim()
        ),
        None => message.to_owned(),
    };
    let mut changed = vec!["diff", "--quiet", "HEAD", "--"];
    changed.extend(only.iter().map(String::as_str));
    let output = git.run_spec(git.spec(changed), cancel, &[0, 1]).await?;
    if output.code == Some(0) {
        return Err(GitError::Invalid(
            "The file has no changes to commit.".to_owned(),
        ));
    }
    let mut args = vec!["commit", "-F", "-", "--"];
    args.extend(only.iter().map(String::as_str));
    run_commit(git, args, &text, cancel).await
}

fn require_message(message: &str) -> Result<(), GitError> {
    if message.trim().is_empty() {
        return Err(GitError::Invalid(
            "Write a commit message first.".to_owned(),
        ));
    }
    Ok(())
}

/// The subject of the fixup target; anything but a SHA of an existing commit is refused (T5).
async fn subject_of(git: &Git, sha: &str, cancel: &Cancel) -> Result<String, GitError> {
    validate_rev(sha)?;
    let rev = format!("{sha}^{{commit}}");
    let spec = git.spec(["log", "-1", "--format=%s", rev.as_str()]);
    let output = git.run_spec(spec, cancel, &[0, 128]).await?;
    let subject = output.stdout.trim();
    if output.code != Some(0) || subject.is_empty() {
        return Err(GitError::Invalid("That isn't a commit SHA.".to_owned()));
    }
    Ok(subject.to_owned())
}

/// Runs `git commit` with the message on stdin; a hook's rejection returns its output.
async fn run_commit(
    git: &Git,
    args: Vec<&str>,
    message: &str,
    cancel: &Cancel,
) -> Result<CommitResult, GitError> {
    let spec = git
        .spec(args)
        .stdin(message.as_bytes().to_vec())
        .timeout(COMMIT_TIMEOUT);
    let output = crate::os::process::run(&spec, cancel).await?;
    if !output.success() {
        let text = format!(
            "{}
{}",
            output.stdout.trim(),
            output.stderr.trim()
        );
        let text = text.trim().to_owned();
        if text.contains("nothing to commit") || text.contains("no changes added to commit") {
            return Err(GitError::Invalid(
                "Nothing is staged for this commit.".to_owned(),
            ));
        }
        if has_commit_hooks(git, cancel).await {
            return Err(GitError::HookFailed { output: text });
        }
        return Err(GitError::Failed {
            command: "commit".to_owned(),
            code: output.code,
            stderr: text,
        });
    }
    let sha = git
        .run(["rev-parse", "HEAD"], cancel)
        .await?
        .stdout
        .trim()
        .to_owned();
    let short_sha = git
        .run(["rev-parse", "--short", "HEAD"], cancel)
        .await?
        .stdout
        .trim()
        .to_owned();
    Ok(CommitResult { sha, short_sha })
}

/// Whether a hook that can reject a commit exists (honours `core.hooksPath`).
async fn has_commit_hooks(git: &Git, cancel: &Cancel) -> bool {
    let Ok(output) = git.run(["rev-parse", "--git-path", "hooks"], cancel).await else {
        return false;
    };
    let dir = git.repo().join(output.stdout.trim());
    ["pre-commit", "prepare-commit-msg", "commit-msg"]
        .iter()
        .any(|hook| dir.join(hook).is_file())
}

/// The full message of HEAD (Amend fills an empty message box with it).
pub async fn last_message(git: &Git, cancel: &Cancel) -> Result<Option<String>, GitError> {
    let spec = git.spec(["log", "-1", "--format=%B"]);
    let output = git.run_spec(spec, cancel, &[0, 128]).await?;
    Ok((output.code == Some(0)).then(|| output.stdout.trim_end().to_owned()))
}

/// The push arguments: never `--force` or `--force-with-lease`.
pub fn push_args(branch: &str, has_upstream: bool) -> Vec<String> {
    let mut args = vec!["push".to_owned(), "--porcelain".to_owned()];
    if has_upstream {
        args.extend(["origin".to_owned(), "HEAD".to_owned()]);
    } else {
        args.extend(["-u".to_owned(), "origin".to_owned(), branch.to_owned()]);
    }
    args
}

/// Pushes the current branch to `origin`.
pub async fn push(git: &Git, cancel: &Cancel) -> Result<PushResult, GitError> {
    let status = local::read_status(git, cancel).await?;
    let Some(branch) = status.branch else {
        return Err(GitError::Invalid("Check out a branch to push.".to_owned()));
    };
    let spec = git
        .spec(push_args(&branch, status.upstream.is_some()))
        .timeout(PUSH_TIMEOUT);
    let output = crate::os::process::run(&spec, cancel).await?;
    if output.success() {
        return Ok(PushResult {
            remote_branch: format!("origin/{branch}"),
        });
    }
    // --porcelain: "!\t<from>:<to>\t[rejected] (fetch first)" for refused refs.
    if let Some(line) = output.stdout.lines().find(|l| l.starts_with('!')) {
        let reason = line.split('\t').nth(2).unwrap_or(line).trim().to_owned();
        return Err(GitError::PushRejected(reason));
    }
    Err(GitError::Failed {
        command: "push".to_owned(),
        code: output.code,
        stderr: output.stderr.trim().to_owned(),
    })
}

/// S-06 commit mode: details panel and file tree (F-15.6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    /// Parent SHAs; the first one is the diff base.
    pub parents: Vec<String>,
    pub author: String,
    /// ISO 8601 author date.
    pub date: String,
    pub subject: String,
    pub body: String,
    pub groups: Vec<FileGroup>,
    pub total_files: u32,
}

/// Accepts `HEAD` or a hex SHA (4–64 characters) only, never an arbitrary revision (T5).
pub fn validate_rev(rev: &str) -> Result<(), GitError> {
    let hex = (4..=64).contains(&rev.len()) && rev.chars().all(|c| c.is_ascii_hexdigit());
    if rev == "HEAD" || hex {
        Ok(())
    } else {
        Err(GitError::Invalid("That isn't a commit SHA.".to_owned()))
    }
}

pub async fn commit_info(git: &Git, rev: &str, cancel: &Cancel) -> Result<CommitInfo, GitError> {
    validate_rev(rev)?;
    let spec = git.spec([
        "show",
        "-s",
        "--format=%H%x00%h%x00%P%x00%an%x00%aI%x00%s%x00%b",
        rev,
        "--",
    ]);
    let output = git.run_spec(spec, cancel, &[0]).await?;
    let mut parts = output.stdout.splitn(7, '\0');
    let mut next = || parts.next().unwrap_or_default().to_owned();
    let (sha, short_sha, parents, author, date, subject, body) =
        (next(), next(), next(), next(), next(), next(), next());
    if sha.is_empty() {
        return Err(GitError::Parse {
            command: "show".to_owned(),
            what: "commit",
        });
    }
    let parents: Vec<String> = parents.split_whitespace().map(str::to_owned).collect();
    let base = match parents.first() {
        Some(parent) => parent.clone(),
        None => diff::empty_tree(git, cancel).await?,
    };
    let files = diff::range_files(git, &base, &sha, cancel).await?;
    let total_files = u32::try_from(files.len()).unwrap_or(u32::MAX);
    Ok(CommitInfo {
        sha,
        short_sha,
        parents,
        author,
        date,
        subject,
        body: body.trim_end().to_owned(),
        groups: tree::group(files.into_iter().map(tree_file).collect()),
        total_files,
    })
}

/// A changed file as a tree row without index state (commit mode, MR browse).
pub fn tree_file(file: ChangedFile) -> TreeFile {
    TreeFile {
        name: tree::split(&file.path).1.to_owned(),
        path: file.path,
        old_path: file.old_path,
        status: file.status,
        binary: file.binary,
        additions: file.additions,
        deletions: file.deletions,
        staged: None,
        untracked: false,
    }
}

/// One file of a commit against its first parent.
pub async fn commit_file_diff(
    git: &Git,
    sha: &str,
    file: &ChangedFile,
    cancel: &Cancel,
) -> Result<FileDiff, GitError> {
    validate_rev(sha)?;
    let parent = format!("{sha}^1");
    let spec = git.spec(["rev-parse", "--verify", "-q", &parent]);
    let output = git.run_spec(spec, cancel, &[0, 1]).await?;
    let base = match output.code {
        Some(0) => output.stdout.trim().to_owned(),
        _ => diff::empty_tree(git, cancel).await?,
    };
    diff::range_file_diff(git, &base, sha, file, cancel).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f16_5_push_args_never_force() {
        for args in [push_args("feature/ż", false), push_args("main", true)] {
            assert!(
                args.iter()
                    .all(|a| !a.contains("force") && a != "-f" && !a.starts_with('+'))
            );
        }
        assert_eq!(
            push_args("feature/ż", false),
            ["push", "--porcelain", "-u", "origin", "feature/ż"]
        );
        assert_eq!(
            push_args("main", true),
            ["push", "--porcelain", "origin", "HEAD"]
        );
    }

    #[test]
    fn only_head_or_hex_shas_are_accepted() {
        assert!(validate_rev("HEAD").is_ok());
        assert!(validate_rev("a3f9c12").is_ok());
        assert!(validate_rev("--output=x").is_err());
        assert!(validate_rev("main").is_err());
        assert!(validate_rev("abc").is_err());
    }
}
