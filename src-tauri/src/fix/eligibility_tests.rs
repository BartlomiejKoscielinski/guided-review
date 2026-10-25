//! F-25.1 Fix with Claude is available on the user's own code only (docs/plans/M7.md, F-25.1):
//! a self-review (Local, Commits) of the active repository's checkout, or an MR whose author is
//! me and whose source branch is the one checked out (F-26.8). Everything else is refused with
//! `FIX_NOT_ALLOWED` in the core, so the UI cannot bypass it.
//!
//! The pure rule is `fix_allowed(&Source, &FixContext)`: the session's source plus what the core
//! reads around it. `FixContext` fields: `active_repository` (the session's repository is the
//! active one), `me` (my GitLab username, `None` when unknown), `mr_author` (the MR author's
//! username) and `mr_source_branch` (both `None` for a session that is not an MR), and
//! `checkout_branch` (the branch the checkout is on, `None` when detached).
#![allow(clippy::unwrap_used, reason = "tests")]

use super::eligibility::{FixContext, fix_allowed};
use crate::error::{AppError, ErrorCode};
use crate::source::model::{LocalScope, Source};

fn local(scope: LocalScope) -> Source {
    Source::Local { scope }
}

fn commits() -> Source {
    Source::Commits {
        from: Some("a3f9c12".into()),
        to: "b81d0e4".into(),
    }
}

fn mr() -> Source {
    Source::Mr {
        project: "mobile/delivery-app".into(),
        iid: 480,
    }
}

/// A self-review in the active repository, the checkout on `feature/photos`.
fn own_checkout() -> FixContext {
    FixContext {
        active_repository: true,
        me: Some("bartek".into()),
        mr_author: None,
        mr_source_branch: None,
        checkout_branch: Some("feature/photos".into()),
    }
}

/// My MR from `feature/photos`, the checkout on that branch.
fn own_mr() -> FixContext {
    FixContext {
        mr_author: Some("bartek".into()),
        mr_source_branch: Some("feature/photos".into()),
        ..own_checkout()
    }
}

fn refused(source: &Source, cx: &FixContext) -> AppError {
    fix_allowed(source, cx).unwrap_err()
}

#[test]
fn f25_1_every_scope_of_a_local_self_review_is_allowed() {
    for scope in [
        LocalScope::Uncommitted,
        LocalScope::Staged,
        LocalScope::BranchVsTarget {
            target: "origin/develop".into(),
        },
    ] {
        fix_allowed(&local(scope), &own_checkout()).unwrap();
    }
}

#[test]
fn f25_1_a_review_of_commits_is_allowed() {
    fix_allowed(&commits(), &own_checkout()).unwrap();
    // A single commit (no `from`) is a self-review as well.
    let single = Source::Commits {
        from: None,
        to: "b81d0e4".into(),
    };
    fix_allowed(&single, &own_checkout()).unwrap();
}

#[test]
fn f25_1_a_self_review_needs_no_signed_in_user_and_no_branch() {
    // Nothing reaches GitLab, and a detached HEAD still has a checkout to fix in.
    let cx = FixContext {
        me: None,
        checkout_branch: None,
        ..own_checkout()
    };
    fix_allowed(&local(LocalScope::Staged), &cx).unwrap();
    fix_allowed(&commits(), &cx).unwrap();
}

#[test]
fn f25_1_a_self_review_of_another_repository_is_refused() {
    let cx = FixContext {
        active_repository: false,
        ..own_checkout()
    };
    assert_eq!(
        refused(&local(LocalScope::Uncommitted), &cx).code,
        ErrorCode::FixNotAllowed
    );
    assert_eq!(refused(&commits(), &cx).code, ErrorCode::FixNotAllowed);
}

#[test]
fn f25_1_my_mr_on_its_checked_out_source_branch_is_allowed() {
    fix_allowed(&mr(), &own_mr()).unwrap();
}

#[test]
fn f25_1_a_teammates_mr_is_refused_even_on_its_source_branch() {
    let cx = FixContext {
        mr_author: Some("ania".into()),
        ..own_mr()
    };
    assert_eq!(refused(&mr(), &cx).code, ErrorCode::FixNotAllowed);
}

#[test]
fn f25_1_my_mr_with_another_branch_checked_out_is_refused() {
    let cx = FixContext {
        checkout_branch: Some("develop".into()),
        ..own_mr()
    };
    assert_eq!(refused(&mr(), &cx).code, ErrorCode::FixNotAllowed);
}

#[test]
fn f25_1_my_mr_with_a_detached_head_is_refused() {
    let cx = FixContext {
        checkout_branch: None,
        ..own_mr()
    };
    assert_eq!(refused(&mr(), &cx).code, ErrorCode::FixNotAllowed);
}

#[test]
fn f25_1_my_mr_of_a_project_that_is_not_the_active_repository_is_refused() {
    let cx = FixContext {
        active_repository: false,
        ..own_mr()
    };
    assert_eq!(refused(&mr(), &cx).code, ErrorCode::FixNotAllowed);
}

#[test]
fn f25_1_an_mr_with_an_unknown_user_or_an_unknown_author_is_refused() {
    let unknown_me = FixContext {
        me: None,
        ..own_mr()
    };
    assert_eq!(refused(&mr(), &unknown_me).code, ErrorCode::FixNotAllowed);
    let unknown_author = FixContext {
        mr_author: None,
        ..own_mr()
    };
    assert_eq!(
        refused(&mr(), &unknown_author).code,
        ErrorCode::FixNotAllowed
    );
    // Two unknowns are not "the same person".
    let neither = FixContext {
        me: None,
        mr_author: None,
        ..own_mr()
    };
    assert_eq!(refused(&mr(), &neither).code, ErrorCode::FixNotAllowed);
}

#[test]
fn f25_1_an_mr_without_a_known_source_branch_is_refused() {
    let cx = FixContext {
        mr_source_branch: None,
        ..own_mr()
    };
    assert_eq!(refused(&mr(), &cx).code, ErrorCode::FixNotAllowed);
}

#[test]
fn f25_1_the_branch_must_match_exactly_whole_name_and_case() {
    for checked_out in [
        "feature/photos-2",
        "feature/phot",
        "Feature/Photos",
        "photos",
    ] {
        let cx = FixContext {
            checkout_branch: Some(checked_out.into()),
            ..own_mr()
        };
        assert_eq!(
            refused(&mr(), &cx).code,
            ErrorCode::FixNotAllowed,
            "{checked_out}"
        );
    }
}

#[test]
fn f25_1_a_branch_with_polish_characters_and_spaces_matches() {
    let branch = "feature/zażółć gęślą jaźń";
    let cx = FixContext {
        mr_source_branch: Some(branch.into()),
        checkout_branch: Some(branch.into()),
        ..own_mr()
    };
    fix_allowed(&mr(), &cx).unwrap();
}

#[test]
fn f25_1_the_refusal_is_a_plain_user_facing_error() {
    let error = refused(
        &mr(),
        &FixContext {
            mr_author: Some("ania".into()),
            ..own_mr()
        },
    );
    assert_eq!(error.code, ErrorCode::FixNotAllowed);
    assert_eq!(
        error.message,
        "Fix with Claude is only available on your own code."
    );
    assert!(!error.retryable, "trying again cannot make it allowed");
    assert_eq!(
        serde_json::to_value(error.code).unwrap(),
        serde_json::json!("FIX_NOT_ALLOWED")
    );
}
