//! F-25.1 Fix with Claude only on the user's own code (docs/plans/M7.md, F-25.1).
//!
//! Allowed: a self-review (Local, Commits) of the active repository's checkout, or an MR whose
//! author is me and whose source branch is the one checked out (F-26.8). Everything else is
//! refused with `FIX_NOT_ALLOWED` here in the core, so no screen can bypass it.

use crate::error::{AppError, AppResult, ErrorCode};
use crate::source::model::Source;

/// What the core knows around a session when a fix is asked for.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FixContext {
    /// The session's repository is the active repository (its checkout is the one fixed).
    pub active_repository: bool,
    /// My GitLab username; `None` when not signed in or not known.
    pub me: Option<String>,
    /// The MR author's username; `None` for a session that is not an MR or when unknown.
    pub mr_author: Option<String>,
    /// The MR's source branch; `None` for a session that is not an MR or when unknown.
    pub mr_source_branch: Option<String>,
    /// The branch the checkout is on; `None` when HEAD is detached.
    pub checkout_branch: Option<String>,
}

const NOT_ALLOWED: &str = "Fix with Claude is only available on your own code.";

/// `Ok(())` when Fix with Claude may run on this session's code, `FIX_NOT_ALLOWED` otherwise.
pub fn fix_allowed(source: &Source, cx: &FixContext) -> AppResult<()> {
    if is_own_code(source, cx) {
        Ok(())
    } else {
        Err(AppError::new(ErrorCode::FixNotAllowed, NOT_ALLOWED))
    }
}

fn is_own_code(source: &Source, cx: &FixContext) -> bool {
    if !cx.active_repository {
        return false;
    }
    match source {
        // Nothing reaches GitLab and a detached HEAD still has a checkout to fix in.
        Source::Local { .. } | Source::Commits { .. } => true,
        Source::Mr { .. } => {
            let mine = matches!((&cx.me, &cx.mr_author), (Some(me), Some(author)) if me == author);
            let on_branch = matches!(
                (&cx.mr_source_branch, &cx.checkout_branch),
                (Some(source), Some(checkout)) if source == checkout
            );
            mine && on_branch
        }
    }
}
