//! F-25.4 Accept and Discard of a fix proposal (docs/plans/M7.md, ADR-018). Accept copies the
//! scratch's one file into the user's working copy, byte for byte and unstaged (the index is
//! never touched), only while the user's file still has the hash it had when the run started;
//! otherwise it refuses with `FIX_STALE` and the proposal stays open. Discard removes the
//! scratch; the user's checkout is never touched.

use std::path::Path;

use super::proposals::{Pending, Proposals};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::Git;
use crate::git::scratch::{self, file_hash};
use crate::store::Store;

/// What a stale Accept says (F-25.4).
pub const STALE: &str = "The file changed while Claude worked. Run it again.";
/// Accept of a proposal that was accepted, discarded or lost with a restart.
pub const NOT_OPEN: &str = "This fix is no longer open.";
/// The user's file could not be read or written.
const NOT_WRITTEN: &str = "The change could not be written.";

/// The refusal of an Accept whose proposal is not open.
pub fn not_open() -> AppError {
    AppError::new(ErrorCode::InvalidInput, NOT_OPEN)
}

/// Accept of proposal `id`: writes the scratch's file over the user's copy when that copy is
/// unchanged since the run started, then removes the scratch and closes the proposal. `git`
/// runs in the user's repository (for removing the scratch worktree).
pub async fn accept(git: &Git, store: &Store, proposals: &Proposals, id: &str) -> AppResult<()> {
    let pending = proposals.get(id).ok_or_else(not_open)?;
    let rel = scratch::git_path(&pending.scratch.file)?;
    let target = pending.repo.join(&rel);
    ensure_unchanged(&target, &pending)?;
    let bytes = std::fs::read(pending.scratch.path.join(&rel)).map_err(|e| {
        AppError::internal(NOT_WRITTEN).with_detail(format!("reading the scratch copy: {e}"))
    })?;
    // Taken only now: a stale or failed Accept leaves the proposal open for Discard.
    let Some(pending) = proposals.take(id) else {
        return Err(not_open());
    };
    if let Err(error) = std::fs::write(&target, &bytes) {
        proposals.keep(id, pending);
        return Err(AppError::internal(NOT_WRITTEN)
            .with_detail(format!("writing the working copy: {error}")));
    }
    scratch::remove(git, store, &pending.scratch).await;
    Ok(())
}

/// The user's copy still hashes as at the start of the run; a missing file is a change too.
fn ensure_unchanged(target: &Path, pending: &Pending) -> AppResult<()> {
    match file_hash(target) {
        Ok(hash) if hash == pending.scratch.start_hash => Ok(()),
        Ok(_) => Err(AppError::new(ErrorCode::FixStale, STALE)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(AppError::new(ErrorCode::FixStale, STALE))
        }
        Err(e) => {
            Err(AppError::internal(NOT_WRITTEN).with_detail(format!("reading the file: {e}")))
        }
    }
}

/// Discard of proposal `id`: removes its scratch. Nothing open is fine (a second click).
pub async fn discard(git: &Git, store: &Store, proposals: &Proposals, id: &str) -> AppResult<()> {
    if let Some(pending) = proposals.take(id) {
        scratch::remove(git, store, &pending.scratch).await;
    }
    Ok(())
}
