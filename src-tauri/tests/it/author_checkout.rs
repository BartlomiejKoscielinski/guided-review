//! F-26.8 below the Tauri layer: S-10 is editable only while the user's checkout is on the MR's
//! source branch (`git symbolic-ref` of HEAD equals `source_branch`). Another branch, a detached
//! HEAD or a checkout git can't read gives read-only, and reading it never switches the branch.
//! Synthetic data only (ADR-019); the branch and the paths carry Polish characters.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::author_mr::{self, AuthorMr};
use guided_review_lib::review::author_threads::ResolvedSummary;
use serde_json::json;

const BRANCH: &str = "feature/ąę";
const OTHER: &str = "spike/inny-ąę";

/// `main` with one commit and the MR's branch checked out with one more.
fn on_the_mr_branch(label: &str) -> FixtureRepo {
    let repo = FixtureRepo::new(label);
    repo.write("src/App Zażółć/Upload Worker.cs", "a\nb\nc\n");
    repo.commit_all("base");
    repo.git(&["checkout", "-q", "-b", BRANCH]);
    repo.write("src/App Zażółć/Upload Worker.cs", "a\nb2\nc\n");
    repo.commit_all("Add retry loop");
    repo
}

async fn open(repo: &FixtureRepo) -> Git {
    let git = Git::new(None, &repo.path);
    git.check_version(&Cancel::new()).await.unwrap();
    git
}

#[tokio::test]
async fn f26_8_a_checkout_on_the_source_branch_is_editable() {
    let repo = on_the_mr_branch("f26-8-on-branch");
    let git = open(&repo).await;

    assert!(author_mr::on_source_branch(&git, BRANCH, &Cancel::new()).await);
}

#[tokio::test]
async fn f26_8_a_checkout_on_another_branch_is_read_only_and_stays_where_it_is() {
    let repo = on_the_mr_branch("f26-8-other-branch");
    repo.git(&["checkout", "-q", "-b", OTHER]);
    let head = repo.head();
    let git = open(&repo).await;

    assert!(!author_mr::on_source_branch(&git, BRANCH, &Cancel::new()).await);

    // The app never switches the branch (F-26.8): HEAD is where the user left it.
    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]).trim(), OTHER);
    assert_eq!(repo.head(), head);
}

#[tokio::test]
async fn f26_8_a_branch_that_only_starts_with_the_source_branch_is_another_branch() {
    let repo = on_the_mr_branch("f26-8-prefix");
    repo.git(&["checkout", "-q", "-b", &format!("{BRANCH}-2")]);
    let git = open(&repo).await;

    assert!(!author_mr::on_source_branch(&git, BRANCH, &Cancel::new()).await);
}

#[tokio::test]
async fn f26_8_a_detached_head_on_the_source_branch_commit_is_read_only() {
    let repo = on_the_mr_branch("f26-8-detached");
    repo.git(&["checkout", "-q", "--detach", BRANCH]);
    let git = open(&repo).await;

    assert!(!author_mr::on_source_branch(&git, BRANCH, &Cancel::new()).await);
}

#[tokio::test]
async fn f26_8_a_checkout_git_cannot_read_is_read_only() {
    let repo = on_the_mr_branch("f26-8-unreadable");
    let missing = Git::new(None, &repo.path.join("nie ma tego folderu"));

    assert!(!author_mr::on_source_branch(&missing, BRANCH, &Cancel::new()).await);
}

#[test]
fn f26_8_author_mr_carries_the_checkout_state_to_the_screen() {
    let mr = |on_source_branch: bool| AuthorMr {
        iid: 6,
        title: "Retry".to_owned(),
        source_branch: BRANCH.to_owned(),
        target_branch: "develop".to_owned(),
        pipeline: None,
        threads: Vec::new(),
        to_answer: 0,
        resolved: ResolvedSummary {
            count: 0,
            first_excerpt: None,
        },
        waiting: Vec::new(),
        on_source_branch,
    };

    let value = serde_json::to_value(mr(false)).unwrap();
    assert_eq!(value["onSourceBranch"], json!(false));
    assert_eq!(
        serde_json::to_value(mr(true)).unwrap()["onSourceBranch"],
        json!(true)
    );
}
