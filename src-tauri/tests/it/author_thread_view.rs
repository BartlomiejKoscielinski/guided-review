//! F-26.2 below the Tauri layer: a selected thread of S-10 opens in the code at its line with
//! its conversation (M7 decision 6). The thread list rows carry the file, the line and the notes
//! of the discussion; the file's diff runs from merge-base(`origin/<target>`, HEAD) to the working
//! tree, so local fixes show at once; a General thread has no file and no line. Synthetic data
//! only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::git::diff;
use guided_review_lib::git::model::{FileDiff, LineKind};
use guided_review_lib::gitlab::account::GitlabUser;
use guided_review_lib::gitlab::discussions::{Thread, ThreadNote, ThreadPosition};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::author_threads;
use std::collections::HashSet;

const ME: &str = "bartek.k";
const FILE: &str = "src/App/Zażółć/Upload Worker.cs";

fn user(username: &str, name: &str) -> GitlabUser {
    GitlabUser {
        username: username.to_owned(),
        name: name.to_owned(),
    }
}

fn note(id: u64, username: &str, name: &str, body: &str, at: &str) -> ThreadNote {
    ThreadNote {
        id,
        author: user(username, name),
        body: body.to_owned(),
        created_at: at.to_owned(),
    }
}

fn position(new_path: &str, old_line: Option<u32>, new_line: Option<u32>) -> ThreadPosition {
    ThreadPosition {
        old_path: new_path.to_owned(),
        new_path: new_path.to_owned(),
        old_line,
        new_line,
        head_sha: "a".repeat(40),
        base_sha: "b".repeat(40),
    }
}

fn thread(id: &str, position: Option<ThreadPosition>, notes: Vec<ThreadNote>) -> Thread {
    Thread {
        id: id.to_owned(),
        resolvable: true,
        resolved: false,
        position,
        notes,
        outdated: false,
        placed_line: None,
    }
}

fn listed(threads: &[Thread]) -> Vec<author_threads::AuthorThread> {
    author_threads::of(threads, ME, &HashSet::new(), &HashSet::new()).threads
}

// --- the thread rows: file, line, conversation ---------------------------------------------------

#[test]
fn f26_2_a_diff_thread_row_carries_its_file_and_its_new_line() {
    let t = thread(
        "d1",
        Some(position(FILE, None, Some(46))),
        vec![note(
            1,
            "marta.k",
            "Marta K.",
            "Make the delay exponential.",
            "2026-10-20T08:00:00Z",
        )],
    );

    let rows = listed(&[t]);

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].path.as_deref(), Some(FILE));
    assert_eq!(rows[0].line, Some(46));
}

#[test]
fn f26_2_a_general_thread_has_no_file_and_no_line() {
    let t = thread(
        "g1",
        None,
        vec![note(
            1,
            "marta.k",
            "Marta K.",
            "Overall this looks fine, one question about naming.",
            "2026-10-20T08:00:00Z",
        )],
    );

    let rows = listed(&[t]);

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].path, None);
    assert_eq!(rows[0].line, None);
    assert_eq!(rows[0].place, "General");
    assert_eq!(rows[0].notes.len(), 1, "the conversation is still there");
}

#[test]
fn f26_2_a_thread_on_a_deleted_line_has_its_file_but_no_line_to_open() {
    // GitLab sends only `old_line` for a comment on a removed line; Rider and the working tree
    // have no such line, so there is nothing to open at.
    let t = thread(
        "d2",
        Some(position(FILE, Some(36), None)),
        vec![note(
            1,
            "marta.k",
            "Marta K.",
            "Why remove this?",
            "2026-10-20T08:00:00Z",
        )],
    );

    let rows = listed(&[t]);

    assert_eq!(rows[0].path.as_deref(), Some(FILE));
    assert_eq!(rows[0].line, None);
}

#[test]
fn f26_2_the_notes_come_in_order_with_author_initials_full_text_time_and_mine() {
    let long = format!("First line.\n{}", "The delay grows linearly. ".repeat(20));
    assert!(long.chars().count() > 200, "longer than the list excerpt");
    let t = thread(
        "d3",
        Some(position(FILE, None, Some(46))),
        vec![
            note(1, "marta.k", "Marta K.", &long, "2026-10-20T08:00:00Z"),
            note(
                2,
                ME,
                "Bartek K.",
                "Fixed in 9e1d4b7.",
                "2026-10-20T09:30:00Z",
            ),
            note(
                3,
                "marta.k",
                "Marta K.",
                "Thanks, looks good.",
                "2026-10-20T10:00:00Z",
            ),
        ],
    );

    let rows = listed(&[t]);
    let notes = &rows[0].notes;

    assert_eq!(notes.len(), 3);
    assert_eq!(notes[0].author, "Marta K.");
    assert_eq!(notes[0].avatar, "MK");
    assert_eq!(
        notes[0].body, long,
        "the conversation is not cut like the excerpt"
    );
    assert_eq!(notes[0].created_at, "2026-10-20T08:00:00Z");
    assert!(!notes[0].mine);
    assert_eq!(notes[1].author, "Bartek K.");
    assert_eq!(notes[1].avatar, "BK");
    assert_eq!(notes[1].body, "Fixed in 9e1d4b7.");
    assert!(
        notes[1].mine,
        "my own note is the one by the signed-in user"
    );
    assert!(!notes[2].mine);
    assert_eq!(notes[2].body, "Thanks, looks good.");
}

// --- the file's diff: merge base of origin/<target> and HEAD -> working tree -----------------------

fn git(repo: &FixtureRepo) -> Git {
    Git::new(None, &repo.path)
}

/// 60 numbered lines, so edits 10 lines apart land in hunks of their own.
fn body() -> String {
    (1..=60).map(|i| format!("line {i} zażółć\n")).collect()
}

fn added(diff: &FileDiff) -> Vec<(u32, String)> {
    diff.hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter(|l| l.kind == LineKind::Add)
        .map(|l| (l.new_no.unwrap(), l.text.clone()))
        .collect()
}

fn removed(diff: &FileDiff) -> Vec<(u32, String)> {
    diff.hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter(|l| l.kind == LineKind::Del)
        .map(|l| (l.old_no.unwrap(), l.text.clone()))
        .collect()
}

/// `main` pushed to a bare origin, `feature/ąę` branched from it with one committed insertion,
/// then `main` moved on (line 55 and `other.txt`, pushed) and the checkout back on the branch.
fn author_checkout(label: &str) -> FixtureRepo {
    let repo = FixtureRepo::new(label);
    repo.write(FILE, &body());
    repo.write("src/keep.cs", "a\nb\nc\n");
    repo.commit_all("base");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "-u", "origin", "main"]);

    repo.git(&["checkout", "-q", "-b", "feature/ąę"]);
    let committed = body().replacen(
        "line 9 zażółć\n",
        "line 9 zażółć\ninserted by the branch\n",
        1,
    );
    repo.write(FILE, &committed);
    repo.commit_all("insert a line on the branch");

    repo.git(&["checkout", "-q", "main"]);
    repo.write(
        FILE,
        &body().replacen("line 55 zażółć\n", "target only 55\n", 1),
    );
    repo.write("other.txt", "target only\n");
    repo.commit_all("the target moves on");
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["checkout", "-q", "feature/ąę"]);
    repo
}

#[tokio::test]
async fn f26_2_the_diff_runs_from_the_merge_base_to_the_working_tree_with_working_tree_line_numbers()
 {
    let repo = author_checkout("f26-2-diff");
    // Uncommitted fixes: one unstaged (line 30, which is line 31 on the branch), one staged
    // (line 40, which is line 41).
    let staged = repo.read(FILE).replacen(
        "line 40 zażółć
",
        "staged fix
",
        1,
    );
    repo.write(FILE, &staged);
    repo.git(&["add", FILE]);
    repo.write(
        FILE,
        &staged.replacen(
            "line 30 zażółć
",
            "unstaged fix
",
            1,
        ),
    );
    let cancel = Cancel::new();
    let git = git(&repo);
    git.check_version(&cancel).await.unwrap();

    let diff = diff::author_file_diff(&git, "main", FILE, &cancel)
        .await
        .unwrap();

    let adds = added(&diff);
    assert!(
        adds.contains(&(10, "inserted by the branch".to_owned())),
        "the committed line of the branch: {adds:?}"
    );
    assert!(
        adds.contains(&(31, "unstaged fix".to_owned())),
        "the uncommitted line, numbered in the working tree: {adds:?}"
    );
    assert!(
        adds.contains(&(41, "staged fix".to_owned())),
        "the fix that was staged shows too: {adds:?}"
    );
    assert_eq!(adds.len(), 3, "{adds:?}");
    let dels = removed(&diff);
    assert!(
        dels.contains(&(30, "line 30 zażółć".to_owned())),
        "{dels:?}"
    );
    assert!(
        dels.contains(&(40, "line 40 zażółć".to_owned())),
        "{dels:?}"
    );
    assert_eq!(dels.len(), 2, "{dels:?}");
    assert_eq!((diff.additions, diff.deletions), (3, 2));
}

#[tokio::test]
async fn f26_2_what_the_target_changed_after_the_branch_point_is_not_in_the_diff() {
    let repo = author_checkout("f26-2-target");
    let cancel = Cancel::new();
    let git = git(&repo);
    git.check_version(&cancel).await.unwrap();

    let diff = diff::author_file_diff(&git, "main", FILE, &cancel)
        .await
        .unwrap();

    let all: Vec<String> = diff
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .map(|l| l.text.clone())
        .collect();
    assert!(
        !all.iter().any(|t| t.contains("target only")),
        "line 55 changed on origin/main is not the author's change: {all:?}"
    );
    assert_eq!(diff.additions, 1, "only the branch's insertion");
    assert_eq!(diff.deletions, 0);
}

#[tokio::test]
async fn f26_2_a_file_the_author_did_not_change_has_an_empty_diff_not_an_error() {
    let repo = author_checkout("f26-2-unchanged");
    let cancel = Cancel::new();
    let git = git(&repo);
    git.check_version(&cancel).await.unwrap();

    let diff = diff::author_file_diff(&git, "main", "src/keep.cs", &cancel)
        .await
        .unwrap();

    assert!(diff.hunks.is_empty());
    assert_eq!((diff.additions, diff.deletions), (0, 0));
}

#[tokio::test]
async fn f26_2_the_diff_leaves_the_users_checkout_alone() {
    let repo = author_checkout("f26-2-readonly");
    let working = repo
        .read(FILE)
        .replacen("line 30 zażółć\n", "unstaged fix\n", 1);
    repo.write(FILE, &working);
    let before_status = repo.git(&["status", "--porcelain"]);
    let before_head = repo.head();
    let before_branch = repo.git(&["rev-parse", "--abbrev-ref", "HEAD"]);
    let cancel = Cancel::new();
    let git = git(&repo);
    git.check_version(&cancel).await.unwrap();

    diff::author_file_diff(&git, "main", FILE, &cancel)
        .await
        .unwrap();

    assert_eq!(repo.git(&["status", "--porcelain"]), before_status);
    assert_eq!(repo.head(), before_head);
    assert_eq!(
        repo.git(&["rev-parse", "--abbrev-ref", "HEAD"]),
        before_branch
    );
    assert_eq!(repo.read(FILE), working, "the file is as the user left it");
}
