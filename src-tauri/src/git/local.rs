//! Local changes for S-06 (F-15.2, F-16.1, F-16.2): the files changed between HEAD and the
//! working tree with their index state, and per-file diffs whose lines say whether they are
//! staged (`line_state.rs`). Nothing here writes to the repository.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::diff::{self, PATCH_ARGS};
use super::error::GitError;
use super::line_state;
use super::model::{FileDiff, FileStatus};
use super::patch::PatchFile;
use super::runner::Git;
use super::status::{self, EntryKind, Status};
use super::tree::{self, FileGroup, StageState, TreeFile};
use crate::os::process::Cancel;

/// A merge, rebase, cherry-pick or revert that isn't finished: commit is disabled (02 › S-06).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RepoOperation {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LocalChanges {
    /// `None` on a detached HEAD.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// `None` before the first commit.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<RepoOperation>,
    pub groups: Vec<FileGroup>,
    pub total_files: u32,
    /// Files with anything in the index ("80 of 100 in commit", F-16.3).
    pub staged_files: u32,
}

/// HEAD, or the empty tree before the first commit.
pub async fn base(git: &Git, cancel: &Cancel) -> Result<String, GitError> {
    let spec = git.spec(["rev-parse", "--verify", "-q", "HEAD"]);
    let output = git.run_spec(spec, cancel, &[0, 1]).await?;
    match output.code {
        Some(0) => Ok(output.stdout.trim().to_owned()),
        _ => diff::empty_tree(git, cancel).await,
    }
}

pub async fn read_status(git: &Git, cancel: &Cancel) -> Result<Status, GitError> {
    let spec = git
        .spec([
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--untracked-files=all",
        ])
        // Reading only: never take the index lock while Rider works on the same repository.
        .env("GIT_OPTIONAL_LOCKS", "0");
    let output = git.run_spec(spec, cancel, &[0]).await?;
    status::parse(&output.stdout).ok_or(GitError::Parse {
        command: "status".to_owned(),
        what: "porcelain v2 status",
    })
}

/// The S-06 tree of local changes.
pub async fn local_changes(git: &Git, cancel: &Cancel) -> Result<LocalChanges, GitError> {
    let status = read_status(git, cancel).await?;
    let base = match &status.head {
        Some(head) => head.clone(),
        None => diff::empty_tree(git, cancel).await?,
    };
    let tracked = tracked_changes(git, &base, cancel).await?;
    let entries: HashMap<&str, _> = status
        .entries
        .iter()
        .map(|e| (e.path.as_str(), e))
        .collect();
    let mut files = Vec::new();
    for file in tracked {
        let mut state = entries
            .get(file.path.as_str())
            .map_or(StageState::None, |e| stage_state(e.index, e.worktree));
        if let Some(old) = &file.old_path {
            // A rename shown by H→W -M can be staged on one side only.
            let old_state = entries
                .get(old.as_str())
                .map_or(state, |e| stage_state(e.index, e.worktree));
            if old_state != state {
                state = StageState::Partial;
            }
        }
        files.push(TreeFile {
            name: tree::split(&file.path).1.to_owned(),
            path: file.path,
            old_path: file.old_path,
            status: file.status,
            binary: file.binary,
            additions: file.additions,
            deletions: file.deletions,
            staged: Some(state),
            untracked: false,
        });
    }
    for entry in status
        .entries
        .iter()
        .filter(|e| e.kind == EntryKind::Untracked)
    {
        let (binary, additions) = count_untracked(&git.repo().join(&entry.path)).await;
        files.push(TreeFile {
            name: tree::split(&entry.path).1.to_owned(),
            path: entry.path.clone(),
            old_path: None,
            status: FileStatus::Added,
            binary,
            additions,
            deletions: 0,
            staged: Some(StageState::None),
            untracked: true,
        });
    }
    let total_files = u32::try_from(files.len()).unwrap_or(u32::MAX);
    let staged_files = u32::try_from(
        files
            .iter()
            .filter(|f| f.staged != Some(StageState::None))
            .count(),
    )
    .unwrap_or(u32::MAX);
    let operation = operation(&git.git_dir(cancel).await?);
    Ok(LocalChanges {
        branch: status.branch,
        head: status.head,
        upstream: status.upstream,
        operation,
        groups: tree::group(files),
        total_files,
        staged_files,
    })
}

/// Tracked changes HEAD → working tree with renames (`git diff <base> --raw --numstat -M`).
pub(crate) async fn tracked_changes(
    git: &Git,
    base: &str,
    cancel: &Cancel,
) -> Result<Vec<diff::ChangedFile>, GitError> {
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
                base,
            ],
            cancel,
        )
        .await?;
    diff::parse_raw_numstat(&output.stdout).ok_or(GitError::Parse {
        command: "diff --raw --numstat".to_owned(),
        what: "file list",
    })
}

/// `X`/`Y` of porcelain v2 → whether the file's changes are in the index.
pub fn stage_state(index: char, worktree: char) -> StageState {
    match (index != '.', worktree != '.') {
        (true, false) => StageState::All,
        (true, true) => StageState::Partial,
        _ => StageState::None,
    }
}

/// Line count and binary flag of an untracked file (git's rule: a NUL in the first 8000 bytes).
pub(crate) async fn count_untracked(path: &Path) -> (bool, u32) {
    let Ok(bytes) = tokio::fs::read(path).await else {
        return (false, 0);
    };
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return (true, 0);
    }
    let newlines = bytes.iter().filter(|b| **b == b'\n').count();
    let partial_last = usize::from(!bytes.is_empty() && bytes.last() != Some(&b'\n'));
    (
        false,
        u32::try_from(newlines + partial_last).unwrap_or(u32::MAX),
    )
}

/// Which unfinished operation the git directory shows.
pub fn operation(git_dir: &Path) -> Option<RepoOperation> {
    if git_dir.join("rebase-merge").is_dir() || git_dir.join("rebase-apply").is_dir() {
        Some(RepoOperation::Rebase)
    } else if git_dir.join("MERGE_HEAD").is_file() {
        Some(RepoOperation::Merge)
    } else if git_dir.join("CHERRY_PICK_HEAD").is_file() {
        Some(RepoOperation::CherryPick)
    } else if git_dir.join("REVERT_HEAD").is_file() {
        Some(RepoOperation::Revert)
    } else {
        None
    }
}

/// A local file as the UI names it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileRef {
    pub path: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[serde(default)]
    pub untracked: bool,
}

/// The three diffs of one tracked file: HEAD → working tree (shown), HEAD → index (staged)
/// and index → working tree (unstaged).
pub struct FileDiffs {
    pub hw: Option<PatchFile>,
    pub hi: Option<PatchFile>,
    pub iw: Option<PatchFile>,
    pub utf8: bool,
}

/// Runs the diffs a local file needs. `which` selects them: (hw, hi, iw).
pub async fn file_diffs(
    git: &Git,
    base: &str,
    file: &FileRef,
    which: (bool, bool, bool),
    cancel: &Cancel,
) -> Result<FileDiffs, GitError> {
    if file.untracked {
        let mut args: Vec<OsString> = PATCH_ARGS.iter().map(OsString::from).collect();
        args.extend(["--no-index", "--", "/dev/null"].map(OsString::from));
        args.push((&file.path).into());
        let output = git.run_spec(git.spec(args), cancel, &[0, 1]).await?;
        let patch = find(diff::parse_patches(&output.stdout)?, &file.path);
        return Ok(FileDiffs {
            hw: patch.clone(),
            hi: None,
            iw: patch,
            utf8: !output.lossy,
        });
    }
    let paths: Vec<OsString> = file
        .old_path
        .iter()
        .chain(std::iter::once(&file.path))
        .map(OsString::from)
        .collect();
    let run = |extra: Vec<OsString>, paths: Vec<OsString>| {
        let mut args: Vec<OsString> = PATCH_ARGS.iter().map(OsString::from).collect();
        args.extend(extra);
        args.push("--".into());
        args.extend(paths);
        async move { git.run(args, cancel).await }
    };
    let none = || async { Ok::<_, GitError>(None) };
    let (hw, hi, iw) = tokio::join!(
        async {
            if which.0 {
                run(vec![base.into()], paths.clone()).await.map(Some)
            } else {
                none().await
            }
        },
        async {
            if which.1 {
                run(vec!["--cached".into(), base.into()], paths.clone())
                    .await
                    .map(Some)
            } else {
                none().await
            }
        },
        async {
            if which.2 {
                run(Vec::new(), vec![(&file.path).into()]).await.map(Some)
            } else {
                none().await
            }
        },
    );
    let (hw, hi, iw) = (hw?, hi?, iw?);
    let utf8 = [&hw, &hi, &iw]
        .iter()
        .all(|o| o.as_ref().is_none_or(|o| !o.lossy));
    let parse =
        |o: Option<crate::os::process::ProcessOutput>| -> Result<Option<PatchFile>, GitError> {
            match o {
                Some(o) => Ok(find(diff::parse_patches(&o.stdout)?, &file.path)),
                None => Ok(None),
            }
        };
    Ok(FileDiffs {
        hw: parse(hw)?,
        hi: parse(hi)?,
        iw: parse(iw)?,
        utf8,
    })
}

fn find(patches: Vec<PatchFile>, path: &str) -> Option<PatchFile> {
    patches.into_iter().find(|p| p.path() == path)
}

/// The S-06 diff of one local file with the index state of every change.
pub async fn local_file_diff(
    git: &Git,
    file: &FileRef,
    cancel: &Cancel,
) -> Result<FileDiff, GitError> {
    let base = base(git, cancel).await?;
    let diffs = file_diffs(git, &base, file, (true, true, true), cancel).await?;
    let Some(hw) = diffs.hw.as_ref() else {
        // Not changed anymore (refreshed meanwhile): an empty diff.
        return Ok(FileDiff {
            old_path: file.old_path.clone(),
            new_path: Some(file.path.clone()),
            status: FileStatus::Modified,
            binary: false,
            mode_change: None,
            additions: 0,
            deletions: 0,
            layer: crate::review::layer::layer_of(&file.path),
            hunks: Vec::new(),
            line_staging: false,
        });
    };
    let mut model = diff::to_model(hw, diffs.utf8);
    if !model.binary {
        line_state::apply(&mut model, diffs.hi.as_ref(), diffs.iw.as_ref());
    }
    Ok(model)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_state_from_porcelain_xy() {
        assert_eq!(stage_state('M', '.'), StageState::All);
        assert_eq!(stage_state('M', 'M'), StageState::Partial);
        assert_eq!(stage_state('.', 'M'), StageState::None);
        assert_eq!(stage_state('.', 'D'), StageState::None);
    }
}
