//! The title S-11 opens with, read without Claude from the branch's commits (F-27.2, docs/plans/M7.md
//! F-27.2 and decision 15): a single commit gives its subject; several give the branch name in
//! words (`chore/compiled-bindings` → "Chore compiled bindings"). Synthetic repositories; branch
//! names carry Polish characters.
//!
//! The tests pin `git::mr_title::mr_title(git: &Git, target: Option<&str>, cancel: &Cancel) ->
//! Result<String, GitError>` (the target as for `git::branch_info::branch_info`: a branch on
//! origin, the default target when `None`; the commits are those since the merge base).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::git::mr_title::mr_title;
use guided_review_lib::os::process::Cancel;

/// `main` is on origin (its `HEAD`); the checkout is on `branch` with one commit per subject.
fn repo_on(branch: &str, subjects: &[&str]) -> FixtureRepo {
    let repo = FixtureRepo::new("mr title ż");
    repo.write("src/Delivery ąę.cs", "one\n");
    repo.commit_all("Base commit");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["remote", "set-head", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", branch]);
    for (n, subject) in subjects.iter().enumerate() {
        repo.write(&format!("Plik {n} ż.txt"), "x\n");
        repo.commit_all(subject);
    }
    repo
}

async fn title(repo: &FixtureRepo, target: Option<&str>) -> String {
    mr_title(&Git::new(None, &repo.path), target, &Cancel::new())
        .await
        .unwrap()
}

#[tokio::test]
async fn f27_2_a_single_commit_gives_its_subject() {
    let repo = repo_on("feature/zażółć", &["Cap the upload retries"]);
    assert_eq!(title(&repo, None).await, "Cap the upload retries");
}

#[tokio::test]
async fn f27_2_a_single_commit_gives_its_subject_not_its_body() {
    let repo = repo_on(
        "feature/one",
        &["Cap the upload retries\n\nA flaky network used to retry forever."],
    );
    assert_eq!(title(&repo, None).await, "Cap the upload retries");
}

#[tokio::test]
async fn f27_2_several_commits_give_the_branch_name_in_words() {
    let repo = repo_on("chore/compiled-bindings", &["One", "Two", "Three"]);
    assert_eq!(title(&repo, None).await, "Chore compiled bindings");
}

#[tokio::test]
async fn f27_2_words_come_from_slashes_dashes_and_underscores_and_keep_the_rest_as_written() {
    let repo = repo_on("fix/scanner-crash_on_Rotate", &["One", "Two"]);
    assert_eq!(title(&repo, None).await, "Fix scanner crash on Rotate");
}

#[tokio::test]
async fn f27_2_the_first_letter_is_capitalised_also_when_it_is_polish() {
    let repo = repo_on("żółw/pływa-szybko", &["One", "Two"]);
    assert_eq!(title(&repo, None).await, "Żółw pływa szybko");
}

#[tokio::test]
async fn f27_2_the_commits_counted_are_those_since_the_merge_base_with_the_target() {
    // develop is one commit ahead of main; the branch has one commit on develop. Against develop
    // that is a single commit (its subject), against main it is two (the branch name in words).
    let repo = FixtureRepo::new("mr title target ż");
    repo.write("src/Delivery ąę.cs", "one\n");
    repo.commit_all("Base commit");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", "develop"]);
    repo.write("Dev.txt", "d1\n");
    repo.commit_all("Develop moves ahead");
    repo.git(&["push", "-q", "origin", "develop"]);
    repo.git(&["remote", "set-head", "origin", "develop"]);
    repo.git(&["checkout", "-q", "-b", "feature/map-pins"]);
    repo.write("Pins.txt", "p\n");
    repo.commit_all("Show pins on the map");
    assert_eq!(title(&repo, None).await, "Show pins on the map");
    assert_eq!(title(&repo, Some("develop")).await, "Show pins on the map");
    assert_eq!(title(&repo, Some("main")).await, "Feature map pins");
}
