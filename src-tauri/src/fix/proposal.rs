//! F-25.3 The proposal of a fix (docs/plans/M7.md, ADR-018, M7 decision 3): after the guard
//! passed, the diff of the one file in the scratch worktree against the scratch's index (the
//! file as it was when the run started: the checked-out stash commit, or the staged copy of an
//! untracked target), and Claude's sentence. Only the scratch is read; the user's checkout is
//! never touched.

use std::ffi::OsString;

use serde::Serialize;
use ts_rs::TS;

use crate::claude::tasks::fix::FixOutcome;
use crate::error::AppResult;
use crate::git::Git;
use crate::git::diff::{self, PATCH_ARGS};
use crate::git::model::Hunk;
use crate::git::scratch::{self, Scratch};
use crate::os::process::Cancel;

/// What the fix card shows (F-25.3): no hunks means Claude made no change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FixProposal {
    pub id: String,
    /// The git path of the file (forward slashes, relative to the repository).
    pub file: String,
    /// Claude's edit only, unified with 3 lines of context.
    pub hunks: Vec<Hunk>,
    /// Claude's one sentence.
    pub explanation: String,
}

/// Builds the proposal of run `id` from the scratch worktree. `changed: false` gives no hunks
/// without reading the diff; an edit that left the bytes as they were gives none either.
pub async fn build(
    git: &Git,
    scratch: &Scratch,
    id: &str,
    outcome: &FixOutcome,
    cancel: &Cancel,
) -> AppResult<FixProposal> {
    let file = scratch::git_path(&scratch.file)?;
    let hunks = if outcome.changed {
        edit_of(git, scratch, &file, cancel).await?
    } else {
        Vec::new()
    };
    Ok(FixProposal {
        id: id.to_owned(),
        file,
        hunks,
        explanation: outcome.explanation.trim().to_owned(),
    })
}

/// `git diff` (index against working tree) of the one file in the scratch.
async fn edit_of(
    git: &Git,
    scratch: &Scratch,
    file: &str,
    cancel: &Cancel,
) -> AppResult<Vec<Hunk>> {
    let mut args: Vec<OsString> = PATCH_ARGS.iter().map(OsString::from).collect();
    args.extend([OsString::from("--"), OsString::from(file)]);
    let output = git.at(&scratch.path).run(args, cancel).await?;
    let patch = diff::parse_patches(&output.stdout)?
        .into_iter()
        .find(|p| p.path() == file);
    Ok(patch
        .map(|p| diff::to_model(&p, !output.lossy).hunks)
        .unwrap_or_default())
}
