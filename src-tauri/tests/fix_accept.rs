//! F-25.4 Accept and Discard of a fix proposal (docs/plans/M7.md F-25.4, docs/05 > Fix on own
//! code, ADR-018): Accept writes the scratch copy of the one file into the working copy
//! (unstaged: the index is not touched) only if the user's file still has the hash it had when
//! the run started (`Scratch::start_hash`); otherwise it fails with `FIX_STALE` ("The file
//! changed while Claude worked. Run it again."), the user's file is untouched and the proposal
//! stays open (Discard still works). Discard removes the scratch and never touches the checkout.
//! At app start leftover scratches are removed. Fixture repositories with spaces and Polish
//! characters in the path; synthetic data only (ADR-019).
//!
//! Contract the tests lock:
//! - `ErrorCode::FixStale` (serialized `FIX_STALE`, not retryable: the user must change something
//!   first).
//! - `fix::accept::accept(&Git /*the user's repo*/, &Store, &Proposals, id: &str) ->
//!   Result<(), AppError>` and `fix::accept::discard(..same..) -> Result<(), AppError>`. The
//!   proposal is looked up by `id` in `Proposals` (kept there with `Pending { repo, scratch }`,
//!   as `fix_propose` does). Accept takes the proposal out only when it succeeds; a stale Accept
//!   leaves it in. Accept of an id that is not open (never kept, already accepted or
//!   discarded, app restarted) is `INVALID_INPUT` "This fix is no longer open."; Discard of such
//!   an id is `Ok` (nothing to drop, so a double click is harmless).
//! - `fix::janitor::sweep(&Store, Option<&Path> /*git program*/)` (async): removes every
//!   registered worktree of kind `scratch` (git first, then the folder, then the registration)
//!   and nothing else (T8: other kinds and unregistered folders stay).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::path::{Path, PathBuf};

use fixture_repo::FixtureRepo;
use guided_review_lib::error::ErrorCode;
use guided_review_lib::fix::accept::{accept, discard};
use guided_review_lib::fix::janitor;
use guided_review_lib::fix::proposals::{Pending, Proposals};
use guided_review_lib::git::Git;
use guided_review_lib::git::scratch::{self, Scratch};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::store::{Store, repos, worktrees};

const FILE: &str = "src/Zażółć gęślą/Upload Queue.cs";
const OTHER: &str = "src/Mobile ąę/Other.cs";
const BASE: &str = "class Queue {\n    void Enqueue() { }\n}\n";
// The user's work in progress, not committed: it is in the scratch copy.
const MINE: &str = "class Queue {\n    void Enqueue() { }\n    // my work in progress\n}\n";
const FIXED: &str =
    "class Queue {\n    void Enqueue() { Check(); }\n    // my work in progress\n}\n";
const STALE_MESSAGE: &str = "The file changed while Claude worked. Run it again.";

struct Setup {
    repo: FixtureRepo,
    store: Store,
    git: Git,
    proposals: Proposals,
    scratch: Scratch,
}

/// A repository whose file is committed as `BASE` (`tracked`) or never committed, and edited to
/// `MINE` in the working copy; the scratch copy of run `fix-1` is made from it and kept as an
/// open proposal after "Claude" wrote `FIXED` there.
async fn setup(label: &str, tracked: bool) -> Setup {
    let repo = FixtureRepo::new(label);
    repo.write("README.md", "readme\n");
    repo.write(OTHER, "<ContentPage />\n");
    if tracked {
        repo.write(FILE, BASE);
    }
    repo.commit_all("Start the queue");
    repo.write(FILE, MINE);
    repo.write("notes ąę.txt", "private notes\n");
    let store = Store::open_in_memory().unwrap();
    let path = repo.path.to_string_lossy().into_owned();
    let row = store
        .with_conn(|c| repos::add(c, "mobile-app ąę", &path, None))
        .unwrap();
    let git = Git::new(None, &repo.path);
    let root: PathBuf = repo.root.join("tmp zażółć").join("scratch");
    let scratch = scratch::create(
        &git,
        &store,
        row.id,
        &root,
        "fix-1",
        Path::new(FILE),
        &Cancel::new(),
    )
    .await
    .unwrap();
    std::fs::write(scratch.path.join(FILE), FIXED).unwrap();
    let proposals = Proposals::default();
    proposals.keep(
        "fix-1",
        Pending {
            repo: repo.path.clone(),
            scratch: scratch.clone(),
        },
    );
    Setup {
        repo,
        store,
        git,
        proposals,
        scratch,
    }
}

impl Setup {
    async fn accept(&self) -> Result<(), guided_review_lib::error::AppError> {
        accept(&self.git, &self.store, &self.proposals, "fix-1").await
    }

    async fn discard(&self) -> Result<(), guided_review_lib::error::AppError> {
        discard(&self.git, &self.store, &self.proposals, "fix-1").await
    }

    /// Everything git says about the user's checkout, byte for byte.
    fn checkout_snapshot(&self) -> Vec<String> {
        vec![
            self.repo.git(&["status"]),
            self.repo.git(&["status", "--porcelain=v2", "-z", "-uall"]),
            self.repo.git(&["diff"]),
            self.repo.git(&["diff", "--cached"]),
            self.repo.git(&["stash", "list"]),
            self.repo.git(&["rev-parse", "HEAD"]),
            self.repo.read("README.md"),
            self.repo.read(OTHER),
            self.repo.read("notes ąę.txt"),
        ]
    }

    fn worktree_listed(&self) -> bool {
        let key = |p: &str| p.replace('\\', "/").to_lowercase();
        let wanted = key(&self.scratch.path.to_string_lossy());
        self.repo
            .git(&["worktree", "list", "--porcelain"])
            .lines()
            .filter_map(|l| l.strip_prefix("worktree "))
            .any(|p| key(p) == wanted)
    }

    fn registered(&self) -> bool {
        let key = self.scratch.path.to_string_lossy().into_owned();
        self.store
            .with_conn(|c| worktrees::get(c, &key))
            .unwrap()
            .is_some()
    }

    fn scratch_gone(&self) -> bool {
        !self.scratch.path.exists() && !self.worktree_listed() && !self.registered()
    }
}

#[test]
fn f25_4_fix_stale_is_a_code_the_user_must_act_on() {
    assert_eq!(
        serde_json::to_value(ErrorCode::FixStale).unwrap(),
        serde_json::json!("FIX_STALE")
    );
    assert!(!ErrorCode::FixStale.is_retryable());
}

#[tokio::test]
async fn f25_4_accept_writes_the_change_into_the_working_copy_unstaged() {
    let s = setup("accept unstaged", true).await;
    let head = s.repo.git(&["rev-parse", "HEAD"]);
    let before_other = (
        s.repo.read("README.md"),
        s.repo.read(OTHER),
        s.repo.read("notes ąę.txt"),
    );

    s.accept().await.unwrap();

    assert_eq!(s.repo.read(FILE), FIXED);
    // Unstaged: the index still holds the committed file.
    assert_eq!(s.repo.git(&["diff", "--cached"]), "");
    let unstaged = s.repo.git(&["diff"]);
    assert!(
        unstaged.contains("+    void Enqueue() { Check(); }"),
        "{unstaged}"
    );
    assert!(
        unstaged.contains("+    // my work in progress"),
        "{unstaged}"
    );
    // Nothing else moved.
    assert_eq!(s.repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(s.repo.git(&["stash", "list"]), "");
    assert_eq!(
        (
            s.repo.read("README.md"),
            s.repo.read(OTHER),
            s.repo.read("notes ąę.txt")
        ),
        before_other
    );
}

#[tokio::test]
async fn f25_4_accept_removes_the_scratch_and_closes_the_proposal() {
    let s = setup("accept removes", true).await;
    assert!(s.registered() && s.worktree_listed());

    s.accept().await.unwrap();

    assert!(s.scratch_gone());
    // The proposal is taken: a second Accept finds nothing open.
    let again = s.accept().await.unwrap_err();
    assert_eq!(again.code, ErrorCode::InvalidInput);
}

#[tokio::test]
async fn f25_4_accept_leaves_the_users_staged_changes_as_they_were() {
    let s = setup("accept staged", true).await;
    // The user staged their work in progress (self-review of the staged changes).
    s.repo.git(&["add", "--", FILE]);
    let staged_before = s.repo.git(&["diff", "--cached"]);
    assert!(staged_before.contains("my work in progress"));
    // Staging does not change the bytes, so the file still counts as unchanged.

    s.accept().await.unwrap();

    assert_eq!(s.repo.read(FILE), FIXED);
    assert_eq!(s.repo.git(&["diff", "--cached"]), staged_before);
    // The unstaged diff is Claude's edit alone, on top of what the user staged.
    let unstaged = s.repo.git(&["diff"]);
    assert!(
        unstaged.contains("+    void Enqueue() { Check(); }"),
        "{unstaged}"
    );
    assert!(
        !unstaged.contains("+    // my work in progress"),
        "{unstaged}"
    );
}

#[tokio::test]
async fn f25_4_accept_on_an_untracked_file_leaves_it_untracked() {
    let s = setup("accept untracked", false).await;

    s.accept().await.unwrap();

    assert_eq!(s.repo.read(FILE), FIXED);
    assert_eq!(s.repo.git(&["ls-files", "--stage", "--", FILE]), "");
    let status = s.repo.git(&["status", "--porcelain", "-uall"]);
    assert!(status.contains("?? "), "{status}");
    assert!(status.contains("Upload Queue.cs"), "{status}");
    assert!(s.scratch_gone());
}

#[tokio::test]
async fn f25_4_accept_writes_the_bytes_as_they_are() {
    let s = setup("accept bytes", true).await;
    // A BOM, CRLF line ends and Polish text: no re-encoding, no line-end conversion.
    let bytes: Vec<u8> = [
        &[0xEF, 0xBB, 0xBF][..],
        "class Queue {\r\n    // zażółć gęślą\r\n    void Enqueue() { Check(); }\r\n}\r\n"
            .as_bytes(),
    ]
    .concat();
    std::fs::write(s.scratch.path.join(FILE), &bytes).unwrap();

    s.accept().await.unwrap();

    assert_eq!(std::fs::read(s.repo.file(FILE)).unwrap(), bytes);
}

#[tokio::test]
async fn f25_4_a_rewrite_with_the_same_bytes_is_not_a_change() {
    let s = setup("accept same bytes", true).await;
    // Saved again by an editor, nothing different: the hash is what counts.
    s.repo.write(FILE, MINE);

    s.accept().await.unwrap();

    assert_eq!(s.repo.read(FILE), FIXED);
}

#[tokio::test]
async fn f25_4_an_edit_during_the_run_makes_accept_stale_and_touches_nothing() {
    let s = setup("accept stale", true).await;
    let edited = format!("{MINE}// typed while Claude worked\n");
    s.repo.write(FILE, &edited);
    let before = s.checkout_snapshot();

    let error = s.accept().await.unwrap_err();

    assert_eq!(error.code, ErrorCode::FixStale);
    assert_eq!(error.message, STALE_MESSAGE);
    assert!(!error.retryable);
    assert_eq!(s.repo.read(FILE), edited);
    assert_eq!(s.checkout_snapshot(), before);
    // The proposal stays: the scratch is still there.
    assert!(s.scratch.path.join(FILE).exists());
    assert!(s.registered() && s.worktree_listed());
}

#[tokio::test]
async fn f25_4_a_stale_proposal_stays_open_for_discard_and_for_a_restored_file() {
    let s = setup("accept stale kept", true).await;
    s.repo.write(FILE, "something else\n");
    assert_eq!(s.accept().await.unwrap_err().code, ErrorCode::FixStale);
    // Still open: it is stale again, not "no longer open".
    assert_eq!(s.accept().await.unwrap_err().code, ErrorCode::FixStale);

    // The user puts their file back as it was when the run started: Accept works now.
    s.repo.write(FILE, MINE);
    s.accept().await.unwrap();
    assert_eq!(s.repo.read(FILE), FIXED);
}

#[tokio::test]
async fn f25_4_discard_after_a_stale_accept_removes_the_scratch() {
    let s = setup("accept stale discard", true).await;
    s.repo.write(FILE, "something else\n");
    assert_eq!(s.accept().await.unwrap_err().code, ErrorCode::FixStale);

    s.discard().await.unwrap();

    assert!(s.scratch_gone());
    assert_eq!(s.repo.read(FILE), "something else\n");
}

#[tokio::test]
async fn f25_4_a_file_deleted_during_the_run_is_stale() {
    let s = setup("accept deleted", true).await;
    s.repo.remove(FILE);

    let error = s.accept().await.unwrap_err();

    assert_eq!(error.code, ErrorCode::FixStale);
    assert_eq!(error.message, STALE_MESSAGE);
    assert!(!s.repo.file(FILE).exists());
}

#[tokio::test]
async fn f25_4_accept_of_a_fix_that_is_not_open_is_invalid_input() {
    let s = setup("accept unknown", true).await;

    let error = accept(&s.git, &s.store, &s.proposals, "fix-other")
        .await
        .unwrap_err();

    assert_eq!(error.code, ErrorCode::InvalidInput);
    assert_eq!(error.message, "This fix is no longer open.");
    assert_eq!(s.repo.read(FILE), MINE);
    assert!(s.registered());
}

#[tokio::test]
async fn f25_4_discard_leaves_the_checkout_byte_identical() {
    let s = setup("discard", true).await;
    s.repo.git(&["add", "--", OTHER]);
    let before = s.checkout_snapshot();

    s.discard().await.unwrap();

    assert!(s.scratch_gone());
    assert_eq!(s.checkout_snapshot(), before);
    assert_eq!(s.repo.read(FILE), MINE);
}

#[tokio::test]
async fn f25_4_discard_never_writes_the_file_even_when_the_user_changed_it() {
    let s = setup("discard edited", true).await;
    s.repo.write(FILE, "typed meanwhile\n");

    s.discard().await.unwrap();

    assert_eq!(s.repo.read(FILE), "typed meanwhile\n");
    assert!(s.scratch_gone());
}

#[tokio::test]
async fn f25_4_discard_closes_the_proposal_and_a_second_discard_is_harmless() {
    let s = setup("discard twice", true).await;

    s.discard().await.unwrap();

    assert_eq!(s.accept().await.unwrap_err().code, ErrorCode::InvalidInput);
    s.discard().await.unwrap();
    assert_eq!(s.repo.read(FILE), MINE);
}

#[tokio::test]
async fn f25_4_app_start_removes_the_leftover_scratches_and_nothing_else() {
    let s = setup("sweep", true).await;
    // A folder that is registered as a teammate's review worktree is not a scratch.
    let review = s.repo.root.join("worktrees ąę").join("mr-7");
    std::fs::create_dir_all(&review).unwrap();
    let review_key = review.to_string_lossy().into_owned();
    let repo_path = s.repo.path.to_string_lossy().into_owned();
    s.store
        .with_conn(|c| {
            let repo = repos::by_path(c, &repo_path)?.expect("repository");
            worktrees::register(
                c,
                &worktrees::WorktreeRow {
                    path: review_key.clone(),
                    repo_id: repo.id,
                    kind: worktrees::KIND_REVIEW.to_owned(),
                    project: None,
                    iid: Some(7),
                    head_sha: None,
                },
            )
        })
        .unwrap();
    // A folder next to the scratch that nobody registered stays too.
    let stray = s.scratch.path.parent().unwrap().join("not ours");
    std::fs::create_dir_all(&stray).unwrap();
    let before = s.checkout_snapshot();

    janitor::sweep(&s.store, None).await;

    assert!(s.scratch_gone());
    assert!(review.exists());
    assert!(
        s.store
            .with_conn(|c| worktrees::get(c, &review_key))
            .unwrap()
            .is_some()
    );
    assert!(stray.exists());
    assert_eq!(s.checkout_snapshot(), before);
    assert_eq!(s.repo.read(FILE), MINE);
}
