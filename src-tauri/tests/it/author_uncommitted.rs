//! F-26.8 review fix below the Tauri layer (M7 decision 10): S-10 warns "You have other
//! uncommitted changes. They won't be part of this commit." above the fix actions, so the core
//! lists the checkout's uncommitted files (HEAD → working tree, staged and untracked included).
//! Read only. Synthetic data only (ADR-019); paths carry spaces and Polish characters. Declared
//! from `author_push_pipeline.rs` (`tests/it/main.rs` is locked for F-26.8).
#![allow(clippy::unwrap_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::author_mr;

const FILE: &str = "src/App Zażółć/Upload Worker.cs";
const OTHER: &str = "docs/Notatki ąę.md";

fn committed(label: &str) -> FixtureRepo {
    let repo = FixtureRepo::new(label);
    repo.write(FILE, "a\nb\nc\n");
    repo.write(OTHER, "x\n");
    repo.commit_all("base");
    repo
}

async fn files(repo: &FixtureRepo) -> Vec<String> {
    let git = Git::new(None, &repo.path);
    git.check_version(&Cancel::new()).await.unwrap();
    author_mr::uncommitted_files(&git, &Cancel::new())
        .await
        .unwrap()
}

#[tokio::test]
async fn f26_8_a_clean_checkout_has_no_uncommitted_files() {
    let repo = committed("f26-8-clean");
    assert!(files(&repo).await.is_empty());
}

#[tokio::test]
async fn f26_8_changed_staged_and_untracked_files_are_listed_and_left_alone() {
    let repo = committed("f26-8-dirty");
    repo.write(FILE, "a\nb2\nc\n");
    repo.write(OTHER, "y\n");
    repo.git(&["add", "--", OTHER]);
    repo.write("Nowy plik ż.txt", "new\n");
    let staged = repo.staged();

    let listed = files(&repo).await;

    assert_eq!(listed, vec!["Nowy plik ż.txt", OTHER, FILE]);
    // Read only: the index and the working tree are as they were.
    assert_eq!(repo.staged(), staged);
    assert_eq!(repo.read(FILE), "a\nb2\nc\n");
}
