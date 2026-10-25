//! The git side of "Before you create" on S-11 (F-27.5) on fixture repositories: whether the
//! branch is on `origin` at HEAD (`git ls-remote`, not pushed / pushed / ahead) and which files
//! conflict with `origin/<target>` (`git merge-tree --write-tree --name-only`, M7 plan). Reads
//! only: the checkout, HEAD and the index stay as they are. Names carry Polish characters.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::git::Git;
use guided_review_lib::git::merge_check::{MergeCheck, PushState, merge_check};
use guided_review_lib::os::process::Cancel;

const BRANCH: &str = "feature/zażółć";
const SHARED: &str = "src/Wspólny ąę.cs";
const OTHER: &str = "App.xaml";

fn git(repo: &FixtureRepo) -> Git {
    Git::new(None, &repo.path)
}

async fn check(repo: &FixtureRepo, target: Option<&str>) -> MergeCheck {
    merge_check(&git(repo), target, &Cancel::new())
        .await
        .unwrap()
}

/// `origin/main` and the checkout start at the same commit (two files); the checkout is then on
/// `feature/zażółć`, one commit on top, not pushed.
fn repo_on_feature(label: &str) -> FixtureRepo {
    let repo = FixtureRepo::new(label);
    repo.write(SHARED, "one\ntwo\nthree\n");
    repo.write(OTHER, "<a/>\n");
    repo.commit_all("Base commit");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", BRANCH]);
    repo.write("src/Feature ż.cs", "f\n");
    repo.commit_all("Feature one");
    repo
}

/// `origin/main` moves on: the given files are rewritten on `main` and pushed, then the checkout
/// returns to the feature branch.
fn main_moves(repo: &FixtureRepo, files: &[(&str, &str)]) {
    repo.git(&["checkout", "-q", "main"]);
    for (path, content) in files {
        repo.write(path, content);
    }
    repo.commit_all("Main moves on");
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["checkout", "-q", BRANCH]);
}

#[tokio::test]
async fn f27_5_a_branch_that_is_not_on_origin_is_not_pushed() {
    let repo = repo_on_feature("f27-5-unpushed");
    let found = check(&repo, Some("main")).await;
    assert_eq!(found.branch, BRANCH);
    assert_eq!(found.target, "main");
    assert_eq!(found.pushed, PushState::NotPushed);
}

#[tokio::test]
async fn f27_5_a_branch_whose_origin_tip_is_head_is_pushed() {
    let repo = repo_on_feature("f27-5-pushed");
    repo.git(&["push", "-q", "-u", "origin", BRANCH]);
    assert_eq!(check(&repo, Some("main")).await.pushed, PushState::Pushed);
}

#[tokio::test]
async fn f27_5_a_commit_after_the_push_makes_the_branch_ahead_of_origin() {
    let repo = repo_on_feature("f27-5-ahead");
    repo.git(&["push", "-q", "-u", "origin", BRANCH]);
    repo.write("src/Feature ż.cs", "f\ng\n");
    repo.commit_all("Feature two");
    assert_eq!(check(&repo, Some("main")).await.pushed, PushState::Ahead);
}

#[tokio::test]
async fn f27_5_pushed_is_read_from_origin_not_from_the_stale_tracking_ref() {
    // The remote branch is deleted behind the checkout's back: origin/<branch> still exists
    // locally, `git ls-remote` says it is gone.
    let repo = repo_on_feature("f27-5-stale-ref");
    repo.git(&["push", "-q", "-u", "origin", BRANCH]);
    let bare = repo.git(&["remote", "get-url", "origin"]);
    repo.git(&["-C", bare.trim(), "branch", "-q", "-D", BRANCH]);
    assert_eq!(
        check(&repo, Some("main")).await.pushed,
        PushState::NotPushed
    );
}

#[tokio::test]
async fn f27_5_a_clean_merge_has_no_conflicts() {
    let repo = repo_on_feature("f27-5-clean");
    // The target changed other files than the branch did.
    main_moves(&repo, &[(OTHER, "<a id=\"1\"/>\n")]);
    let found = check(&repo, Some("main")).await;
    assert!(found.conflicts.is_empty(), "{:?}", found.conflicts);
}

#[tokio::test]
async fn f27_5_changes_to_the_same_file_in_different_places_merge_cleanly() {
    let repo = FixtureRepo::new("f27-5-same-file");
    repo.write(SHARED, "a\nb\nc\nd\ne\nf\ng\nh\n");
    repo.commit_all("Base commit");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", BRANCH]);
    repo.write(SHARED, "A\nb\nc\nd\ne\nf\ng\nh\n");
    repo.commit_all("Top");
    main_moves(&repo, &[(SHARED, "a\nb\nc\nd\ne\nf\ng\nH\n")]);
    assert!(check(&repo, Some("main")).await.conflicts.is_empty());
}

#[tokio::test]
async fn f27_5_files_changed_on_both_sides_are_listed_as_conflicts_sorted_by_path() {
    let repo = repo_on_feature("f27-5-conflicts");
    repo.write(SHARED, "one\nBRANCH\nthree\n");
    repo.write(OTHER, "<branch/>\n");
    repo.commit_all("Branch edits both");
    main_moves(
        &repo,
        &[(SHARED, "one\nMAIN\nthree\n"), (OTHER, "<main/>\n")],
    );
    let found = check(&repo, Some("main")).await;
    assert_eq!(found.conflicts, [OTHER, SHARED]);
}

#[tokio::test]
async fn f27_5_a_file_deleted_on_one_side_and_edited_on_the_other_conflicts() {
    let repo = repo_on_feature("f27-5-delete-edit");
    repo.remove(OTHER);
    repo.commit_all("Branch deletes it");
    main_moves(&repo, &[(OTHER, "<main/>\n")]);
    assert_eq!(check(&repo, Some("main")).await.conflicts, [OTHER]);
}

#[tokio::test]
async fn f27_5_the_check_leaves_head_index_and_working_tree_alone() {
    let repo = repo_on_feature("f27-5-readonly");
    repo.write(SHARED, "one\nBRANCH\nthree\n");
    repo.commit_all("Branch edits");
    main_moves(&repo, &[(SHARED, "one\nMAIN\nthree\n")]);
    repo.write("src/Feature ż.cs", "uncommitted\n");
    let head = repo.head();
    let status = repo.git(&["status", "--porcelain"]);
    let branches = repo.git(&["branch", "--list"]);
    let found = check(&repo, Some("main")).await;
    assert_eq!(found.conflicts, [SHARED]);
    assert_eq!(repo.head(), head);
    assert_eq!(repo.git(&["status", "--porcelain"]), status);
    assert_eq!(repo.git(&["branch", "--list"]), branches);
    assert_eq!(repo.read("src/Feature ż.cs"), "uncommitted\n");
}

#[tokio::test]
async fn f27_5_the_target_is_checked_against_origin_and_may_be_spelled_with_origin() {
    let repo = repo_on_feature("f27-5-target");
    repo.git(&["push", "-q", "origin", "main:release/1.8"]);
    repo.git(&["fetch", "-q", "origin"]);
    let release = check(&repo, Some("origin/release/1.8")).await;
    assert_eq!(release.target, "release/1.8");
    let err = merge_check(&git(&repo), Some("nie-ma-takiej"), &Cancel::new())
        .await
        .unwrap_err();
    assert_eq!(
        AppError::from(err).code,
        ErrorCode::InvalidInput,
        "a target that is no branch on origin is refused like branch_info"
    );
}

#[tokio::test]
async fn f27_5_without_a_target_the_default_target_of_origin_is_checked() {
    let repo = repo_on_feature("f27-5-default");
    main_moves(&repo, &[(OTHER, "<main/>\n")]);
    let found = check(&repo, None).await;
    assert_eq!(found.target, "main");
}
