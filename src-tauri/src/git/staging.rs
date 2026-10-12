//! Writes the user's checkbox choices to the git index (F-16.1, ADR-008). Only the index is
//! ever changed: `git add`, `git apply --cached`, `git restore --staged` (index only) and
//! `git rm --cached` before the first commit. The working tree is never touched.

use std::collections::HashSet;

use serde::Deserialize;
use ts_rs::TS;

use super::error::GitError;
use super::line_state;
use super::local::{self, FileRef};
use super::model::{FileStatus, LineKind};
use super::patch_builder::{self, Direction};
use super::runner::Git;
use crate::os::process::Cancel;

/// Which side of the S-06 diff (HEAD → working tree) a line number belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LineSide {
    /// A deleted line, numbered in HEAD.
    Old,
    /// An added line, numbered in the working tree.
    New,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[ts(export)]
pub struct LineRef {
    pub side: LineSide,
    pub no: u32,
}

/// What to stage or unstage: whole files (directories, master checkbox, files) or lines of
/// one file (a hunk checkbox sends all its lines, Shift+click one line).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Selection {
    Files { files: Vec<FileRef> },
    Lines { file: FileRef, lines: Vec<LineRef> },
}

/// Puts the selection into the index.
pub async fn stage(git: &Git, selection: &Selection, cancel: &Cancel) -> Result<(), GitError> {
    match selection {
        Selection::Files { files } => stage_files(git, files, cancel).await,
        Selection::Lines { file, lines } => stage_lines(git, file, lines, cancel).await,
    }
}

/// Takes the selection out of the index.
pub async fn unstage(git: &Git, selection: &Selection, cancel: &Cancel) -> Result<(), GitError> {
    match selection {
        Selection::Files { files } => unstage_files(git, files, cancel).await,
        Selection::Lines { file, lines } => unstage_lines(git, file, lines, cancel).await,
    }
}

/// Paths on stdin, NUL-separated (no command-line length limit for 1000 files).
fn pathspec(files: &[FileRef], include_untracked: bool) -> Vec<u8> {
    let mut out = Vec::new();
    for file in files.iter().filter(|f| include_untracked || !f.untracked) {
        for path in file.old_path.iter().chain(std::iter::once(&file.path)) {
            out.extend_from_slice(path.as_bytes());
            out.push(0);
        }
    }
    out
}

async fn stage_files(git: &Git, files: &[FileRef], cancel: &Cancel) -> Result<(), GitError> {
    if files.is_empty() {
        return Ok(());
    }
    let spec = git
        .spec(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"])
        .stdin(pathspec(files, true));
    git.run_spec(spec, cancel, &[0]).await.map(drop)
}

async fn unstage_files(git: &Git, files: &[FileRef], cancel: &Cancel) -> Result<(), GitError> {
    let paths = pathspec(files, false);
    if paths.is_empty() {
        return Ok(());
    }
    let unborn = local::read_status(git, cancel).await?.head.is_none();
    let args: &[&str] = if unborn {
        &[
            "rm",
            "--cached",
            "-r",
            "-q",
            "--ignore-unmatch",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ]
    } else {
        &[
            "restore",
            "--staged",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ]
    };
    let spec = git.spec(args.iter().copied()).stdin(paths);
    git.run_spec(spec, cancel, &[0]).await.map(drop)
}

fn split_lines(lines: &[LineRef]) -> (HashSet<u32>, HashSet<u32>) {
    let old = lines
        .iter()
        .filter(|l| l.side == LineSide::Old)
        .map(|l| l.no)
        .collect();
    let new = lines
        .iter()
        .filter(|l| l.side == LineSide::New)
        .map(|l| l.no)
        .collect();
    (old, new)
}

async fn stage_lines(
    git: &Git,
    file: &FileRef,
    lines: &[LineRef],
    cancel: &Cancel,
) -> Result<(), GitError> {
    let (dels_head, adds_work) = split_lines(lines);
    let base = local::base(git, cancel).await?;
    let mut file = file.clone();
    if file.untracked {
        let diffs = local::file_diffs(git, &base, &file, (false, false, true), cancel).await?;
        let total = diffs.iw.as_ref().map_or(0, |p| p.additions());
        if u32::try_from(adds_work.len()).unwrap_or(u32::MAX) >= total {
            return stage_files(git, std::slice::from_ref(&file), cancel).await;
        }
        // Lines of a new file: an intent-to-add entry first, then the partial patch.
        git.run(["add", "-N", "--", &file.path], cancel).await?;
        file.untracked = false;
    }
    let diffs = local::file_diffs(git, &base, &file, (false, true, true), cancel).await?;
    let Some(iw) = diffs.iw.as_ref() else {
        return Ok(()); // Nothing unstaged left.
    };
    if !diffs.utf8 || iw.binary {
        return Err(GitError::Invalid(
            "Single lines of this file can't be staged; use the file checkbox.".to_owned(),
        ));
    }
    // HEAD line numbers of deletions → index line numbers (unchanged lines of H→I).
    let dels_index: HashSet<u32> = dels_head
        .iter()
        .filter_map(|h| line_state::old_to_new(diffs.hi.as_ref(), *h))
        .collect();
    let patch = patch_builder::build(iw, Direction::Forward, &|kind, old, new| match kind {
        LineKind::Add => new.is_some_and(|w| adds_work.contains(&w)),
        LineKind::Del => old.is_some_and(|i| dels_index.contains(&i)),
        LineKind::Ctx => false,
    });
    match patch {
        Some(patch) => apply(git, patch, Direction::Forward, cancel).await,
        None => Ok(()),
    }
}

async fn unstage_lines(
    git: &Git,
    file: &FileRef,
    lines: &[LineRef],
    cancel: &Cancel,
) -> Result<(), GitError> {
    if file.untracked {
        return Ok(()); // Nothing of it is in the index.
    }
    let (dels_head, adds_work) = split_lines(lines);
    let base = local::base(git, cancel).await?;
    let diffs = local::file_diffs(git, &base, file, (false, true, true), cancel).await?;
    let Some(hi) = diffs.hi.as_ref() else {
        return Ok(()); // Nothing staged.
    };
    if !diffs.utf8 || hi.binary {
        return Err(GitError::Invalid(
            "Single lines of this file can't be unstaged; use the file checkbox.".to_owned(),
        ));
    }
    // Working-tree line numbers of additions → index line numbers (unchanged lines of I→W).
    let adds_index: HashSet<u32> = adds_work
        .iter()
        .filter_map(|w| line_state::new_to_old(diffs.iw.as_ref(), *w))
        .collect();
    let selected = |kind: LineKind, old: Option<u32>, new: Option<u32>| match kind {
        LineKind::Del => old.is_some_and(|h| dels_head.contains(&h)),
        LineKind::Add => new.is_some_and(|i| adds_index.contains(&i)),
        LineKind::Ctx => false,
    };
    // All of a new file: take it out of the index instead of emptying it.
    let all_added = hi
        .hunks
        .iter()
        .flat_map(|h| h.numbered())
        .all(|(o, n, l)| l.kind == LineKind::Ctx || selected(l.kind, o, n));
    if hi.status == FileStatus::Added && all_added {
        let whole = FileRef {
            path: file.path.clone(),
            old_path: None,
            untracked: false,
        };
        return unstage_files(git, std::slice::from_ref(&whole), cancel).await;
    }
    match patch_builder::build(hi, Direction::Reverse, &selected) {
        Some(patch) => apply(git, patch, Direction::Reverse, cancel).await,
        None => Ok(()),
    }
}

async fn apply(
    git: &Git,
    patch: String,
    direction: Direction,
    cancel: &Cancel,
) -> Result<(), GitError> {
    let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
    if direction == Direction::Reverse {
        args.push("--reverse");
    }
    args.push("-");
    let spec = git.spec(args).stdin(patch.into_bytes());
    git.run_spec(spec, cancel, &[0]).await.map(drop)
}
