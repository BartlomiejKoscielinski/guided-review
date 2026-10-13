//! The files of a session's change for the plan, step and ask tasks, per source (F-17.1): an
//! MR, commits and the whole branch are `base → head`; uncommitted changes are HEAD → working
//! tree (untracked files included) and staged changes HEAD → index, read live from the
//! repository root (no worktree). Nothing here writes to the repository.

use std::ffi::OsString;

use crate::git::diff::{self, ChangedFile, PATCH_ARGS};
use crate::git::local::{self, FileRef};
use crate::git::model::FileDiff;
use crate::git::status::EntryKind;
use crate::git::{Git, GitError};
use crate::os::process::Cancel;
use crate::source::model::{LocalScope, Source};

/// Every file of the session's change with its hunks (`Hunk.mechanical` set).
pub async fn files(
    git: &Git,
    source: &Source,
    base: &str,
    head: &str,
    cancel: &Cancel,
) -> Result<Vec<FileDiff>, GitError> {
    match source {
        Source::Local {
            scope: LocalScope::Uncommitted,
        } => uncommitted(git, base, cancel).await,
        Source::Local {
            scope: LocalScope::Staged,
        } => staged(git, base, cancel).await,
        _ => range(git, base, head, cancel).await,
    }
}

/// Every file of `base → head` (commits or trees).
pub async fn range(
    git: &Git,
    base: &str,
    head: &str,
    cancel: &Cancel,
) -> Result<Vec<FileDiff>, GitError> {
    let mut out = Vec::new();
    for file in diff::range_files(git, base, head, cancel).await? {
        out.push(diff::range_file_diff(git, base, head, &file, cancel).await?);
    }
    Ok(out)
}

/// HEAD → working tree for tracked files, then every untracked file as added.
async fn uncommitted(git: &Git, base: &str, cancel: &Cancel) -> Result<Vec<FileDiff>, GitError> {
    let mut out = Vec::new();
    for file in local::tracked_changes(git, base, cancel).await? {
        out.push(patch(git, &[base], &file, cancel).await?);
    }
    let status = local::read_status(git, cancel).await?;
    for entry in status
        .entries
        .iter()
        .filter(|e| e.kind == EntryKind::Untracked)
    {
        let file = FileRef {
            path: entry.path.clone(),
            old_path: None,
            untracked: true,
        };
        let diffs = local::file_diffs(git, base, &file, (true, false, false), cancel).await?;
        if let Some(hw) = &diffs.hw {
            out.push(diff::to_model(hw, diffs.utf8));
        }
    }
    Ok(out)
}

/// HEAD → index (`git diff --cached`).
async fn staged(git: &Git, base: &str, cancel: &Cancel) -> Result<Vec<FileDiff>, GitError> {
    let output = git
        .run(
            [
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--raw",
                "--numstat",
                "-z",
                "-M",
                "--cached",
                base,
            ],
            cancel,
        )
        .await?;
    let list = diff::parse_raw_numstat(&output.stdout).ok_or(GitError::Parse {
        command: "diff --cached --raw --numstat".to_owned(),
        what: "file list",
    })?;
    let mut out = Vec::new();
    for file in list {
        out.push(patch(git, &["--cached", base], &file, cancel).await?);
    }
    Ok(out)
}

/// The patch of one file with `revs` (`<base>` or `--cached <base>`) as the diff's sides.
async fn patch(
    git: &Git,
    revs: &[&str],
    file: &ChangedFile,
    cancel: &Cancel,
) -> Result<FileDiff, GitError> {
    let mut args: Vec<OsString> = PATCH_ARGS.iter().map(OsString::from).collect();
    args.extend(revs.iter().map(OsString::from));
    args.push("--".into());
    if let Some(old) = &file.old_path {
        args.push(old.into());
    }
    args.push((&file.path).into());
    let output = git.run(args, cancel).await?;
    let patch = diff::parse_patches(&output.stdout)?
        .into_iter()
        .find(|p| p.path() == file.path)
        .ok_or(GitError::Parse {
            command: "diff".to_owned(),
            what: "patch for the requested file",
        })?;
    Ok(diff::to_model(&patch, !output.lossy))
}
