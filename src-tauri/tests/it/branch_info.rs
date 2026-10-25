//! The branch block of S-11 on fixture repositories (F-27.1): current branch, upstream, the
//! `origin/*` targets and `N commits · N files · +/−` since the merge base with the target.
//! Branch and file names carry Polish characters; remotes are synthetic.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::git::branch_info::{BranchInfo, branch_info};
use guided_review_lib::os::process::Cancel;

const BRANCH: &str = "feature/zażółć";

fn git(repo: &FixtureRepo) -> Git {
    Git::new(None, &repo.path)
}

async fn info(repo: &FixtureRepo, target: Option<&str>) -> BranchInfo {
    branch_info(&git(repo), target, &Cancel::new())
        .await
        .unwrap()
}

/// `origin` has main, develop (one commit ahead of main, `origin/HEAD`) and release/1.8; the
/// checkout is on `feature/zażółć`, three commits on top of develop, not pushed.
/// Against develop: 3 commits, 3 files, +5 −1. Against main: 4 commits, 4 files, +6 −1.
fn repo_on_feature(label: &str) -> FixtureRepo {
    let repo = FixtureRepo::new(label);
    repo.write("src/Delivery ąę.cs", "one\ntwo\nthree\n");
    repo.commit_all("Base commit");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["push", "-q", "origin", "main:release/1.8"]);
    repo.git(&["checkout", "-q", "-b", "develop"]);
    repo.write("Dev.txt", "d1\n");
    repo.commit_all("Develop moves ahead");
    repo.git(&["push", "-q", "origin", "develop"]);
    repo.git(&["remote", "set-head", "origin", "develop"]);
    repo.git(&["checkout", "-q", "-b", BRANCH]);
    repo.write("src/Feature.cs", "a\nb\n");
    repo.commit_all("Feature one");
    repo.write("Plik ż ć.txt", "x\n");
    repo.commit_all("Feature two");
    repo.write("src/Delivery ąę.cs", "one\nTWO\nthree\nfour\n");
    repo.commit_all("Feature three");
    // A branch that exists only here is no merge target.
    repo.git(&["branch", "local-only", "main"]);
    repo
}

#[tokio::test]
async fn f27_1_counts_the_branch_against_the_default_target() {
    let repo = repo_on_feature("f27-1-default");
    let info = info(&repo, None).await;
    assert_eq!(info.branch.as_deref(), Some(BRANCH));
    assert_eq!(info.target.as_deref(), Some("develop"));
    assert_eq!(
        (info.commits, info.files, info.additions, info.deletions),
        (3, 3, 5, 1)
    );
}

#[tokio::test]
async fn f27_1_switching_the_target_recomputes_the_counts() {
    let repo = repo_on_feature("f27-1-switch");
    let on_main = info(&repo, Some("main")).await;
    assert_eq!(on_main.target.as_deref(), Some("main"));
    assert_eq!(
        (
            on_main.commits,
            on_main.files,
            on_main.additions,
            on_main.deletions
        ),
        (4, 4, 6, 1)
    );
    // A slash in the target's name and the `origin/` spelling both work.
    let release = info(&repo, Some("origin/release/1.8")).await;
    assert_eq!(release.target.as_deref(), Some("release/1.8"));
    assert_eq!((release.commits, release.files), (4, 4));
    // The default is still what the select starts on.
    assert_eq!(info(&repo, None).await.target.as_deref(), Some("develop"));
}

#[tokio::test]
async fn f27_1_targets_are_the_origin_branches_default_first() {
    let repo = repo_on_feature("f27-1-targets");
    let info = info(&repo, None).await;
    // Not the current branch, not `origin/HEAD`, not a branch that exists only locally.
    assert_eq!(info.targets, ["develop", "main", "release/1.8"]);
    // The list does not depend on the chosen target.
    assert_eq!(
        self::info(&repo, Some("main")).await.targets,
        ["develop", "main", "release/1.8"]
    );
}

#[tokio::test]
async fn f27_1_upstream_appears_once_the_branch_is_pushed() {
    let repo = repo_on_feature("f27-1-upstream");
    assert_eq!(info(&repo, None).await.upstream, None);
    repo.git(&["push", "-q", "-u", "origin", BRANCH]);
    let pushed = info(&repo, None).await;
    assert_eq!(
        pushed.upstream.as_deref(),
        Some("origin/feature/zażółć"),
        "the pushed branch is on origin"
    );
    // The pushed branch is itself a branch on origin, still no target of its own MR.
    assert!(!pushed.targets.iter().any(|t| t == BRANCH));
    assert_eq!((pushed.commits, pushed.files), (3, 3));
}

#[tokio::test]
async fn f27_1_an_unknown_or_unsafe_target_is_refused() {
    let repo = repo_on_feature("f27-1-refused");
    let cancel = Cancel::new();
    for target in ["nie-ma-takiej", "--upload-pack=x", "local-only"] {
        assert!(
            branch_info(&git(&repo), Some(target), &cancel)
                .await
                .is_err(),
            "{target} is not a branch on origin"
        );
    }
}

#[tokio::test]
async fn f27_1_without_origin_there_are_no_targets_and_nothing_to_count() {
    let repo = FixtureRepo::new("f27-1-no-origin");
    repo.write("a.txt", "a\n");
    repo.commit_all("Base");
    repo.git(&["checkout", "-q", "-b", BRANCH]);
    repo.write("b.txt", "b\n");
    repo.commit_all("More");
    let info = info(&repo, None).await;
    assert_eq!(info.branch.as_deref(), Some(BRANCH));
    assert_eq!(info.upstream, None);
    assert!(info.targets.is_empty());
    assert_eq!(info.target, None);
    assert_eq!(
        (info.commits, info.files, info.additions, info.deletions),
        (0, 0, 0, 0)
    );
}
