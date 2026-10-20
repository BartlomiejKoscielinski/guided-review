//! F-25.2 Claude works in an app-managed scratch copy of the working tree, never in the user's
//! working copy, and may edit only the one file; afterwards the app verifies that no other file
//! changed (docs/05 > Fix on own code, ADR-018, docs/plans/M7.md F-25.2). Fixture repositories
//! with spaces and Polish characters in every path; synthetic data only (ADR-019).
//!
//! Contract the tests lock:
//! - `git::scratch::create(&Git /*the user's repo*/, &Store, repo_id: i64, root: &Path
//!   /*<app tmp>/scratch*/, id: &str, file: &Path /*relative to the repo*/, &Cancel)
//!   -> Result<Scratch, E: Debug>`; `Scratch { path: PathBuf /*root/id*/, base_sha: String,
//!   file: PathBuf /*as given*/, start_hash: String /*hash of the user's copy of `file`
//!   when the run started*/ }` (Debug, Clone).
//!   `git stash create` gives the base (empty output = `HEAD`), then `git worktree add --detach`;
//!   an untracked target file is copied in; the path is registered in `worktrees` with kind
//!   "scratch" (so the janitor can remove it).
//! - `git::scratch::remove(&Git, &Store, &Scratch)` (returns `()`, never fails): git removes the
//!   worktree, the folder is gone, the registration is gone, the user's checkout is not touched.
//! - `fix::guard::verify(&Git, &Store, &Scratch, &Cancel) -> Result<(), AppError>`: `Ok` when
//!   nothing but `scratch.file` differs from the base in the scratch (untracked files listed one
//!   by one, so a new file next to an untracked target is seen); otherwise the scratch is
//!   removed as in `remove` and the error code is `CLAUDE_GUARD_VIOLATION`.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use std::path::{Path, PathBuf};

use fixture_repo::FixtureRepo;
use guided_review_lib::error::ErrorCode;
use guided_review_lib::fix::guard;
use guided_review_lib::git::Git;
use guided_review_lib::git::scratch::{self, Scratch};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::store::{Store, repos, worktrees};

const FILE: &str = "src/Zażółć gęślą/Upload Queue.cs";
const OTHER: &str = "src/App/Main Page.xaml";
const BASE: &str = "class Queue {\n    void Enqueue() { }\n}\n";
const MINE: &str = "class Queue {\n    void Enqueue() { }\n    // my work in progress\n}\n";
const FIXED: &str = "class Queue {\n    void Enqueue() { Check(); }\n}\n";

struct Setup {
    repo: FixtureRepo,
    store: Store,
    repo_id: i64,
    git: Git,
    root: PathBuf,
}

fn setup(label: &str) -> Setup {
    let repo = FixtureRepo::new(label);
    repo.write(FILE, BASE);
    repo.write(OTHER, "<ContentPage />\n");
    repo.write("README.md", "readme\n");
    repo.commit_all("Start the queue");
    let store = Store::open_in_memory().unwrap();
    let path = repo.path.to_string_lossy().into_owned();
    let row = store
        .with_conn(|c| repos::add(c, "mobile-app ąę", &path, None))
        .unwrap();
    let git = Git::new(None, &repo.path);
    let root = repo.root.join("tmp zażółć").join("scratch");
    Setup {
        repo,
        store,
        repo_id: row.id,
        git,
        root,
    }
}

impl Setup {
    async fn create(&self, id: &str) -> Scratch {
        scratch::create(
            &self.git,
            &self.store,
            self.repo_id,
            &self.root,
            id,
            Path::new(FILE),
            &Cancel::new(),
        )
        .await
        .unwrap()
    }

    async fn verify(&self, scratch: &Scratch) -> Result<(), guided_review_lib::error::AppError> {
        guard::verify(&self.git, &self.store, scratch, &Cancel::new()).await
    }

    /// Everything `git status` and friends say about the user's checkout, byte for byte.
    fn checkout_snapshot(&self) -> Vec<String> {
        vec![
            self.repo.git(&["status"]),
            self.repo.git(&["status", "--porcelain=v2", "-z", "-uall"]),
            self.repo.git(&["diff"]),
            self.repo.git(&["diff", "--cached"]),
            self.repo.git(&["stash", "list"]),
            self.repo.git(&["rev-parse", "HEAD"]),
        ]
    }

    fn worktree_listed(&self, path: &Path) -> bool {
        let key = |p: &str| p.replace('\\', "/").to_lowercase();
        let wanted = key(&path.to_string_lossy());
        self.repo
            .git(&["worktree", "list", "--porcelain"])
            .lines()
            .filter_map(|l| l.strip_prefix("worktree "))
            .any(|p| key(p) == wanted)
    }

    fn registered(&self, path: &Path) -> Option<worktrees::WorktreeRow> {
        let key = path.to_string_lossy().into_owned();
        self.store.with_conn(|c| worktrees::get(c, &key)).unwrap()
    }
}

async fn git_in(scratch: &Scratch, args: &[&str]) -> String {
    Git::new(None, &scratch.path)
        .run(args.iter().copied(), &Cancel::new())
        .await
        .unwrap()
        .stdout
}

fn read(scratch: &Scratch, rel: &str) -> String {
    std::fs::read_to_string(scratch.path.join(rel)).unwrap()
}

fn write(scratch: &Scratch, rel: &str, content: &str) {
    let path = scratch.path.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

#[tokio::test]
async fn f25_2_a_dirty_tree_is_copied_without_touching_the_checkout() {
    let s = setup("fix dirty");
    // Work in progress: an unstaged edit of the file, a staged edit of another file, and an
    // untracked file that is not the target.
    s.repo.write(FILE, MINE);
    s.repo.write(OTHER, "<ContentPage Title=\"mine\" />\n");
    s.repo.git(&["add", OTHER]);
    s.repo.write("notes ąę.txt", "private notes\n");
    let before = s.checkout_snapshot();
    let head = s.repo.head();

    let scratch = s.create("fix-1").await;

    assert_eq!(
        s.checkout_snapshot(),
        before,
        "the checkout must not change"
    );
    assert_eq!(s.repo.read(FILE), MINE);
    assert_eq!(scratch.path, s.root.join("fix-1"));
    assert!(scratch.path.is_dir());
    assert!(s.worktree_listed(&scratch.path));
    // The scratch holds the work in progress, as a detached commit that is not HEAD and not a stash.
    assert_eq!(read(&scratch, FILE), MINE);
    assert_eq!(read(&scratch, OTHER), "<ContentPage Title=\"mine\" />\n");
    assert!(
        !scratch.path.join("notes ąę.txt").exists(),
        "other untracked files stay behind"
    );
    assert_ne!(scratch.base_sha, head);
    assert_eq!(
        git_in(&scratch, &["rev-parse", "HEAD"]).await.trim(),
        scratch.base_sha
    );
    assert!(
        git_in(&scratch, &["status", "--porcelain=v2", "-z", "-uall"])
            .await
            .is_empty(),
        "the scratch starts clean, so the guard sees only Claude's change"
    );
    assert!(s.repo.git(&["stash", "list"]).is_empty());
}

#[tokio::test]
async fn f25_2_a_clean_tree_uses_head() {
    let s = setup("fix clean");
    let head = s.repo.head();
    let before = s.checkout_snapshot();

    let scratch = s.create("fix-2").await;

    assert_eq!(scratch.base_sha, head);
    assert_eq!(git_in(&scratch, &["rev-parse", "HEAD"]).await.trim(), head);
    assert_eq!(read(&scratch, FILE), BASE);
    assert_eq!(s.checkout_snapshot(), before);
}

#[tokio::test]
async fn f25_2_the_scratch_is_registered_for_the_janitor() {
    let s = setup("fix registered");
    let scratch = s.create("fix-3").await;
    let row = s
        .registered(&scratch.path)
        .expect("registered in worktrees");
    assert_eq!(row.kind, "scratch");
    assert_eq!(row.repo_id, s.repo_id);
}

#[tokio::test]
async fn f25_2_an_untracked_target_file_is_copied_in() {
    let s = setup("fix untracked");
    let new_file = "src/Nowe Ćmy/Page View.cs";
    s.repo.write(new_file, "class Page { }\n");
    s.repo.write("src/Nowe Ćmy2/Other.cs", "class Other { }\n");
    let before = s.checkout_snapshot();

    let scratch = scratch::create(
        &s.git,
        &s.store,
        s.repo_id,
        &s.root,
        "fix-4",
        Path::new(new_file),
        &Cancel::new(),
    )
    .await
    .unwrap();

    assert_eq!(read(&scratch, new_file), "class Page { }\n");
    assert!(!scratch.path.join("src/Nowe Ćmy2/Other.cs").exists());
    assert_eq!(s.checkout_snapshot(), before);
    // Untouched, the target (a new file in a new folder) is not "another file" for the guard.
    s.verify(&scratch).await.unwrap();
    assert!(scratch.path.is_dir());
}

#[tokio::test]
async fn f25_2_a_second_file_next_to_an_untracked_target_is_a_violation() {
    let s = setup("fix untracked sibling");
    let new_file = "src/Nowe Ćmy/Page View.cs";
    s.repo.write(new_file, "class Page { }\n");
    let scratch = scratch::create(
        &s.git,
        &s.store,
        s.repo_id,
        &s.root,
        "fix-5",
        Path::new(new_file),
        &Cancel::new(),
    )
    .await
    .unwrap();
    write(&scratch, "src/Nowe Ćmy/Sibling.cs", "class Sibling { }\n");

    let error = s.verify(&scratch).await.unwrap_err();

    assert_eq!(error.code, ErrorCode::ClaudeGuardViolation);
    assert!(!scratch.path.exists());
}

#[tokio::test]
async fn f25_2_the_start_hash_is_the_hash_of_the_users_copy() {
    let s = setup("fix hash");
    let clean = s.create("fix-6a").await;
    scratch::remove(&s.git, &s.store, &clean).await;
    let again = s.create("fix-6b").await;
    assert!(!clean.start_hash.is_empty());
    assert_eq!(
        again.start_hash, clean.start_hash,
        "same content, same hash"
    );
    scratch::remove(&s.git, &s.store, &again).await;

    // The user's working copy counts, not HEAD.
    s.repo.write(FILE, MINE);
    let dirty = s.create("fix-6c").await;
    assert_ne!(dirty.start_hash, clean.start_hash);
}

#[tokio::test]
async fn f25_2_an_edit_of_the_one_file_passes_the_guard_and_the_users_copy_stays() {
    let s = setup("fix guard ok");
    s.repo.write(FILE, MINE);
    let scratch = s.create("fix-7").await;
    // Untouched run: nothing changed, still fine.
    s.verify(&scratch).await.unwrap();

    write(&scratch, FILE, FIXED);
    let before = s.checkout_snapshot();
    s.verify(&scratch).await.unwrap();

    assert!(
        scratch.path.is_dir(),
        "a clean run keeps the scratch for the proposal"
    );
    assert!(s.registered(&scratch.path).is_some());
    assert_eq!(read(&scratch, FILE), FIXED);
    assert_eq!(s.repo.read(FILE), MINE, "the user's copy is never written");
    assert_eq!(s.checkout_snapshot(), before);
}

#[tokio::test]
async fn f25_2_any_other_change_discards_the_run_with_a_guard_violation() {
    type Change = (&'static str, fn(&Scratch));
    let changes: [Change; 5] = [
        ("another tracked file edited", |s| {
            write(s, OTHER, "<Hacked />\n")
        }),
        ("a new file at the root", |s| write(s, "new.txt", "x\n")),
        ("a new file in a new folder", |s| {
            write(s, "src/Gen/New.cs", "x\n")
        }),
        ("another tracked file deleted", |s| {
            std::fs::remove_file(s.path.join("README.md")).unwrap();
        }),
        ("the file and another one", |s| {
            write(s, FILE, FIXED);
            write(s, OTHER, "<Hacked />\n");
        }),
    ];
    for (name, change) in changes {
        let s = setup("fix guard violation");
        s.repo.write(FILE, MINE);
        let scratch = s.create("fix-8").await;
        change(&scratch);
        let before = s.checkout_snapshot();

        let error = s.verify(&scratch).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::ClaudeGuardViolation, "{name}");
        assert!(
            !scratch.path.exists(),
            "{name}: the scratch folder is removed"
        );
        assert!(
            !s.worktree_listed(&scratch.path),
            "{name}: git forgot the worktree"
        );
        assert!(
            s.registered(&scratch.path).is_none(),
            "{name}: unregistered"
        );
        assert_eq!(
            s.checkout_snapshot(),
            before,
            "{name}: the checkout is untouched"
        );
        assert_eq!(s.repo.read(FILE), MINE, "{name}");
    }
}

#[tokio::test]
async fn f25_2_removing_the_scratch_leaves_the_checkout_byte_identical() {
    let s = setup("fix remove");
    s.repo.write(FILE, MINE);
    s.repo.write("notes ąę.txt", "private notes\n");
    let scratch = s.create("fix-9").await;
    write(&scratch, FILE, FIXED);
    let before = s.checkout_snapshot();

    scratch::remove(&s.git, &s.store, &scratch).await;

    assert!(!scratch.path.exists());
    assert!(!s.worktree_listed(&scratch.path));
    assert!(s.registered(&scratch.path).is_none());
    assert_eq!(s.checkout_snapshot(), before);
    assert_eq!(s.repo.read(FILE), MINE);
    assert_eq!(s.repo.read("notes ąę.txt"), "private notes\n");
}
