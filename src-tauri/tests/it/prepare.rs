//! MR preparation on a fixture repository with a bare origin that holds
//! `refs/merge-requests/<iid>/head` (F-05.1, F-05.6). Paths carry spaces and Polish
//! characters; content is synthetic.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use std::path::Path;
use std::sync::{Arc, Mutex};

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::prepare::{
    self, PrepareError, PrepareInput, PrepareProgress, Prepared, worktree_path,
};
use guided_review_lib::store::repos::{self, RepoRow};
use guided_review_lib::store::{Store, worktrees};

const PROJECT: &str = "mobile/mobile-app";
const TITLE: &str = "Scanner: torch toggle ąę";

struct Setup {
    repo: FixtureRepo,
    row: RepoRow,
    store: Store,
    head: String,
}

/// The user's checkout on `main` with an uncommitted change, and MR !482 on origin.
fn setup(label: &str) -> Setup {
    let repo = FixtureRepo::new(label);
    repo.write("src/App/MauiProgram.cs", "base\n");
    repo.write("README.md", "readme\n");
    repo.commit_all("Base");
    let head = repo.add_mr_on_origin(
        482,
        &[
            ("src/App/Views/Scanner Ąę.xaml", "<ContentPage />\n"),
            ("src/App/MauiProgram.cs", "base\ntorch\n"),
        ],
    );
    repo.write("README.md", "readme\nmy own work in progress\n");
    let store = Store::open_in_memory().unwrap();
    let path = repo.path.to_string_lossy().into_owned();
    let mut row = store
        .with_conn(|c| repos::add(c, "mobile-app ąę", &path, Some(PROJECT)))
        .unwrap();
    row.worktree_root = Some(
        repo.root
            .join("worktrees zażółć")
            .to_string_lossy()
            .into_owned(),
    );
    Setup {
        repo,
        row,
        store,
        head,
    }
}

async fn run(
    s: &Setup,
    on_progress: impl Fn(&PrepareProgress, &Cancel) + Send + Sync,
) -> (Result<Prepared, PrepareError>, Vec<PrepareProgress>) {
    let git = Git::new(None, &s.repo.path);
    let input = PrepareInput {
        git: &git,
        repo: &s.row,
        project: PROJECT,
        iid: 482,
        title: TITLE,
        target_branch: "main",
    };
    let seen = Arc::new(Mutex::new(Vec::new()));
    let cancel = Cancel::new();
    let progress = {
        let seen = Arc::clone(&seen);
        let cancel = cancel.clone();
        move |p: PrepareProgress| {
            on_progress(&p, &cancel);
            seen.lock().unwrap().push(p);
        }
    };
    let result = prepare::prepare(&input, &s.store, &progress, &cancel).await;
    let seen = seen.lock().unwrap().clone();
    (result, seen)
}

fn registered(s: &Setup, path: &Path) -> bool {
    let key = path.to_string_lossy().into_owned();
    s.store
        .with_conn(|c| worktrees::get(c, &key))
        .unwrap()
        .is_some()
}

fn in_git_worktrees(s: &Setup, path: &Path) -> bool {
    let wanted = path.to_string_lossy().replace('\\', "/").to_lowercase();
    s.repo
        .git(&["worktree", "list", "--porcelain"])
        .lines()
        .filter_map(|l| l.strip_prefix("worktree "))
        .any(|p| p.to_lowercase() == wanted)
}

fn user_checkout(s: &Setup) -> (String, String, String) {
    (
        s.repo.git(&["symbolic-ref", "HEAD"]),
        s.repo.head(),
        s.repo.git(&["status", "--porcelain"]),
    )
}

#[tokio::test]
async fn f05_1_prepare_fetches_the_mr_head_into_a_worktree_and_leaves_the_checkout_alone() {
    let s = setup("prepare create");
    let before = user_checkout(&s);
    let (result, _) = run(&s, |_, _| {}).await;
    let prepared = result.unwrap();

    let expected = s
        .repo
        .root
        .join("worktrees zażółć")
        .join("mobile-app ąę")
        .join("482");
    assert_eq!(prepared.worktree, expected);
    assert_eq!(worktree_path(&s.row, 482), expected);
    assert_eq!(prepared.head_sha, s.head);
    assert_eq!(
        s.repo.git(&["rev-parse", "refs/review/mr/482"]).trim(),
        s.head
    );
    let worktree_head = Git::new(None, &expected);
    let at = worktree_head
        .run(["rev-parse", "HEAD"], &Cancel::new())
        .await
        .unwrap();
    assert_eq!(at.stdout.trim(), s.head);
    assert!(expected.join("src/App/Views/Scanner Ąę.xaml").is_file());
    let mut paths: Vec<&str> = prepared.files.iter().map(|f| f.path.as_str()).collect();
    paths.sort_unstable();
    assert_eq!(
        paths,
        ["src/App/MauiProgram.cs", "src/App/Views/Scanner Ąę.xaml"]
    );
    assert!(registered(&s, &expected));
    assert!(in_git_worktrees(&s, &expected));
    assert_eq!(
        user_checkout(&s),
        before,
        "the user's checkout is unchanged"
    );
    assert_eq!(
        s.repo.read("README.md"),
        "readme\nmy own work in progress\n"
    );
}

#[tokio::test]
async fn f05_1_prepare_reuses_the_worktree_and_moves_it_to_a_new_version() {
    let s = setup("prepare reuse");
    let (first, _) = run(&s, |_, _| {}).await;
    let first = first.unwrap();
    let new_head = s
        .repo
        .add_mr_on_origin(482, &[("src/Core/Torch.cs", "v2\n")]);
    let before = user_checkout(&s);

    let (second, _) = run(&s, |_, _| {}).await;
    let second = second.unwrap();
    assert_eq!(second.worktree, first.worktree);
    assert_eq!(second.head_sha, new_head);
    let at = Git::new(None, &second.worktree)
        .run(["rev-parse", "HEAD"], &Cancel::new())
        .await
        .unwrap();
    assert_eq!(at.stdout.trim(), new_head);
    let key = second.worktree.to_string_lossy().into_owned();
    let row = s
        .store
        .with_conn(|c| worktrees::get(c, &key))
        .unwrap()
        .unwrap();
    assert_eq!(row.head_sha.as_deref(), Some(new_head.as_str()));
    assert_eq!(user_checkout(&s), before);
}

#[tokio::test]
async fn f05_1_registered_worktree_that_disappeared_is_created_again() {
    let s = setup("prepare recreate");
    let (first, _) = run(&s, |_, _| {}).await;
    let path = first.unwrap().worktree;
    std::fs::remove_dir_all(&path).unwrap();
    let (again, _) = run(&s, |_, _| {}).await;
    assert_eq!(again.unwrap().worktree, path);
    assert!(path.join("src/App/MauiProgram.cs").is_file());
}

#[tokio::test]
async fn f05_1_an_unregistered_folder_at_the_worktree_path_is_never_touched() {
    let s = setup("prepare foreign");
    let path = worktree_path(&s.row, 482);
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("mine.txt"), "keep me").unwrap();
    let (result, _) = run(&s, |_, _| {}).await;
    assert!(
        matches!(result, Err(PrepareError::Worktree(_))),
        "{result:?}"
    );
    assert_eq!(
        std::fs::read_to_string(path.join("mine.txt")).unwrap(),
        "keep me"
    );
    assert!(!registered(&s, &path));
}

#[tokio::test]
async fn f05_6_progress_reports_each_stage_in_order() {
    let s = setup("prepare progress");
    let (result, seen) = run(&s, |_, _| {}).await;
    result.unwrap();
    assert_eq!(
        seen,
        [
            PrepareProgress::Fetching {
                iid: 482,
                title: TITLE.into()
            },
            PrepareProgress::CreatingWorktree,
            PrepareProgress::ComputingDiff { files: None },
            PrepareProgress::ComputingDiff { files: Some(2) },
        ]
    );
    assert_eq!(
        serde_json::to_value(&seen[3]).unwrap(),
        serde_json::json!({ "stage": "computingDiff", "files": 2 })
    );
}

#[tokio::test]
async fn f05_6_cancel_while_creating_the_worktree_leaves_nothing_behind() {
    let s = setup("prepare cancel create");
    let (result, _) = run(&s, |p, cancel| {
        if *p == PrepareProgress::CreatingWorktree {
            cancel.cancel();
        }
    })
    .await;
    assert!(matches!(result, Err(PrepareError::Cancelled)), "{result:?}");
    let path = worktree_path(&s.row, 482);
    assert!(!path.exists());
    assert!(!registered(&s, &path));
    assert!(!in_git_worktrees(&s, &path));
}

#[tokio::test]
async fn f05_6_cancel_after_the_worktree_was_made_removes_it() {
    let s = setup("prepare cancel diff");
    let before = user_checkout(&s);
    let (result, _) = run(&s, |p, cancel| {
        if *p == (PrepareProgress::ComputingDiff { files: None }) {
            cancel.cancel();
        }
    })
    .await;
    assert!(matches!(result, Err(PrepareError::Cancelled)), "{result:?}");
    let path = worktree_path(&s.row, 482);
    assert!(!path.exists(), "half-made worktree removed");
    assert!(!registered(&s, &path));
    assert!(!in_git_worktrees(&s, &path));
    assert_eq!(user_checkout(&s), before);
}

#[tokio::test]
async fn f05_6_cancel_keeps_a_reused_worktree() {
    let s = setup("prepare cancel reuse");
    let (first, _) = run(&s, |_, _| {}).await;
    let path = first.unwrap().worktree;
    let (result, _) = run(&s, |p, cancel| {
        if *p == (PrepareProgress::ComputingDiff { files: None }) {
            cancel.cancel();
        }
    })
    .await;
    assert!(matches!(result, Err(PrepareError::Cancelled)), "{result:?}");
    assert!(path.join("src/App/MauiProgram.cs").is_file());
    assert!(registered(&s, &path));
}
