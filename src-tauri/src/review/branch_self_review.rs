//! "Self-review done" of S-11's "Before you create" (F-27.5, M7 plan: "from the newest
//! self-review session of this branch head"): the newest self-review of the repository whose
//! HEAD at the time is in the current HEAD's history. A self-review made on uncommitted changes
//! still counts after they are committed; one of another branch does not. Reads only.

use crate::error::AppError;
use crate::git::Git;
use crate::git::merge_check::head_contains;
use crate::os::process::Cancel;
use crate::store::session_progress::{self, Progress};
use crate::store::{Store, sessions};

/// The progress of the current branch's newest self-review in repository `repo_id`; `None`
/// without one.
pub async fn of_head(
    store: &Store,
    git: &Git,
    repo_id: i64,
    cancel: &Cancel,
) -> Result<Option<Progress>, AppError> {
    let reviews = store.with_conn(|c| sessions::self_reviews(c, repo_id))?;
    for review in reviews {
        let Some(head) = review.head_sha.as_deref() else {
            continue;
        };
        if head_contains(git, head, cancel).await? {
            let progress = store.with_conn(|c| session_progress::of(c, &review.id))?;
            return Ok(Some(progress));
        }
    }
    Ok(None)
}

#[cfg(test)]
#[path = "branch_self_review_tests.rs"]
mod tests;
