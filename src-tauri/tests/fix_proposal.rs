//! F-25.3 The proposal of a fix (docs/plans/M7.md F-25.3, docs/05 > Fix on own code, ADR-018,
//! M7 decision 3): after Claude edited the one file in the scratch copy and the guard passed,
//! the core builds the `FixProposal` the fix card shows: the diff of that file only, and
//! Claude's sentence. Fixture repositories with spaces and Polish characters in the path;
//! synthetic data only (ADR-019).
//!
//! Contract the tests lock (the module is `fix::proposal`):
//! `build(&Git /*the user's repo, as for guard::verify*/, &Scratch, id: &str, &FixOutcome,
//! &Cancel) -> Result<FixProposal, AppError>` and
//! `FixProposal { id: String, file: String /*git path of `scratch.file`, forward slashes*/,
//! hunks: Vec<Hunk> /*git::model::Hunk, unified, from what Claude changed in the scratch*/,
//! explanation: String }` (Debug, Clone, PartialEq, Serialize with camelCase keys, ts-rs
//! export `FixProposal`). The hunks hold only what Claude changed: the diff base is the scratch
//! as it was when the run started (the user's work in progress is part of it, not of the
//! proposal). No edit (`changed: false`, or an edit that left the file as it was) gives no hunks
//! and keeps the explanation: the card then says "Claude made no change." (M7 decision 3).
//! `build` writes nothing to the user's checkout.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::path::{Path, PathBuf};

use fixture_repo::FixtureRepo;
use guided_review_lib::claude::tasks::fix::FixOutcome;
use guided_review_lib::fix::proposal::{self, FixProposal};
use guided_review_lib::git::Git;
use guided_review_lib::git::model::LineKind;
use guided_review_lib::git::scratch::{self, Scratch};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::store::{Store, repos};

const FILE: &str = "src/Zażółć gęślą/Upload Queue.cs";
const BASE: &str = "class Queue {\n    void Enqueue() { }\n}\n";
// The user's work in progress, not committed: it is in the scratch copy but not in the proposal.
const MINE: &str = "class Queue {\n    void Enqueue() { }\n    // my work in progress\n}\n";
const FIXED: &str =
    "class Queue {\n    void Enqueue() { Check(); }\n    // my work in progress\n}\n";
const SENTENCE: &str = "Guarded Enqueue with a check.";

struct Setup {
    repo: FixtureRepo,
    git: Git,
    scratch: Scratch,
}

/// A repository whose file is committed as `BASE` and edited to `MINE` (`tracked`), or whose
/// file was never committed (`!tracked`); the scratch copy is made from it.
async fn setup(label: &str, tracked: bool) -> Setup {
    let repo = FixtureRepo::new(label);
    repo.write("README.md", "readme\n");
    if tracked {
        repo.write(FILE, BASE);
    }
    repo.commit_all("Start the queue");
    repo.write(FILE, MINE);
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
    Setup { repo, git, scratch }
}

impl Setup {
    /// What Claude's `Edit` does: writes the file in the scratch copy.
    fn claude_writes(&self, content: &str) {
        std::fs::write(self.scratch.path.join(FILE), content).unwrap();
    }

    async fn build(&self, changed: bool) -> FixProposal {
        let outcome = FixOutcome {
            changed,
            explanation: SENTENCE.to_owned(),
        };
        proposal::build(&self.git, &self.scratch, "fix-1", &outcome, &Cancel::new())
            .await
            .unwrap()
    }

    /// Added and deleted lines of every hunk, in order, as `+text` and `-text`.
    fn changes(proposal: &FixProposal) -> Vec<String> {
        proposal
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter_map(|l| match l.kind {
                LineKind::Add => Some(format!("+{}", l.text)),
                LineKind::Del => Some(format!("-{}", l.text)),
                LineKind::Ctx => None,
            })
            .collect()
    }
}

#[tokio::test]
async fn f25_3_the_proposal_holds_claudes_edit_of_that_file_and_nothing_of_the_work_in_progress() {
    let s = setup("fix proposal", true).await;
    s.claude_writes(FIXED);
    let before = (
        s.repo.read(FILE),
        s.repo.git(&["status", "--porcelain=v2", "-z", "-uall"]),
        s.repo.git(&["diff"]),
    );

    let p = s.build(true).await;

    assert_eq!(p.id, "fix-1");
    assert_eq!(p.file, FILE, "the git path, forward slashes");
    assert_eq!(p.explanation, SENTENCE);
    assert_eq!(
        Setup::changes(&p),
        [
            "-    void Enqueue() { }",
            "+    void Enqueue() { Check(); }"
        ],
        "only what Claude changed: {p:?}"
    );
    // Context lines come from the scratch copy, so the work in progress may show as context but
    // never as a change.
    let all: Vec<&str> = p
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter().map(|l| l.text.as_str()))
        .collect();
    assert!(all.contains(&"class Queue {"), "{all:?}");
    // The user's checkout is untouched by building it.
    assert_eq!(
        before,
        (
            s.repo.read(FILE),
            s.repo.git(&["status", "--porcelain=v2", "-z", "-uall"]),
            s.repo.git(&["diff"]),
        )
    );
    assert_eq!(s.repo.read(FILE), MINE);
}

#[tokio::test]
async fn f25_3_the_proposal_of_an_untracked_file_shows_only_claudes_edit() {
    let s = setup("fix proposal untracked", false).await;
    s.claude_writes(FIXED);
    let p = s.build(true).await;
    assert_eq!(
        Setup::changes(&p),
        [
            "-    void Enqueue() { }",
            "+    void Enqueue() { Check(); }"
        ],
        "not the whole new file as added: {p:?}"
    );
    assert_eq!(s.repo.read(FILE), MINE);
}

#[tokio::test]
async fn f25_3_changed_false_gives_no_hunks_and_keeps_claudes_sentence() {
    let s = setup("fix proposal none", true).await;
    let p = s.build(false).await;
    assert!(p.hunks.is_empty(), "{p:?}");
    assert_eq!(p.explanation, SENTENCE);
    assert_eq!(p.id, "fix-1");
    assert_eq!(p.file, FILE);
}

#[tokio::test]
async fn f25_3_an_edit_that_left_the_file_as_it_was_is_no_change_either() {
    let s = setup("fix proposal same", true).await;
    // Claude said it changed the file but wrote the same bytes.
    s.claude_writes(MINE);
    let p = s.build(true).await;
    assert!(p.hunks.is_empty(), "{p:?}");
    assert_eq!(p.explanation, SENTENCE);
}

#[tokio::test]
async fn f25_3_the_proposal_goes_to_the_ui_with_these_keys() {
    let s = setup("fix proposal json", true).await;
    s.claude_writes(FIXED);
    let p = s.build(true).await;
    let json = serde_json::to_value(&p).unwrap();
    let mut keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["explanation", "file", "hunks", "id"]);
    assert_eq!(json["file"], FILE);
    let first = &json["hunks"][0];
    assert!(first["oldStart"].is_number(), "{first}");
    assert!(first["lines"].as_array().is_some_and(|l| !l.is_empty()));
}
