//! F-26.4 below the Tauri layer: the commit of a fix on S-10 (M7 decisions 8 and 10). The fixup
//! target is the commit that last changed the thread's line (`git blame -L`) when it lies in
//! merge-base(origin/<target>, HEAD)..HEAD, else the newest commit of that range touching the
//! file, else HEAD. The commit takes only the fixed file (a pathspec), so other staged and
//! unstaged changes stay where they are, and as a fixup it reads `fixup! <subject>` with the
//! message as its body. Paths carry spaces and Polish characters. Synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::commit;
use guided_review_lib::git::fixup_target::{self, FixupTarget};
use guided_review_lib::git::{Git, GitError};
use guided_review_lib::os::process::Cancel;

const FILE: &str = "src/App Zażółć/Upload Worker.cs";
const OTHER: &str = "src/keep ąę.cs";
const UNTOUCHED: &str = "src/untouched.cs";

fn git(repo: &FixtureRepo) -> Git {
    Git::new(None, &repo.path)
}

fn body() -> String {
    (1..=60).map(|i| format!("line {i} zażółć\n")).collect()
}

/// Replaces line `no` of `FILE` in the working tree.
fn set_line(repo: &FixtureRepo, no: usize, text: &str) {
    let mut lines: Vec<String> = repo.read(FILE).lines().map(str::to_owned).collect();
    lines[no - 1] = text.to_owned();
    repo.write(FILE, &(lines.join("\n") + "\n"));
}

struct Branch {
    repo: FixtureRepo,
    /// "Add retry loop": changed line 10 of FILE.
    a: String,
    /// "Cap the delay at 60 s": changed line 20 of FILE.
    b: String,
    /// "Touch the other file": newest commit, touches only OTHER.
    c: String,
}

/// `main` pushed to a bare origin, `feature/ąę` with three commits (A and B change one line of
/// FILE each, C changes OTHER), the checkout on the branch.
fn author_checkout(label: &str) -> Branch {
    let repo = FixtureRepo::new(label);
    repo.write(FILE, &body());
    repo.write(OTHER, "a\nb\nc\n");
    repo.write(UNTOUCHED, "x\ny\n");
    repo.commit_all("base");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", "feature/ąę"]);
    set_line(&repo, 10, "retry loop A");
    let a = repo.commit_all("Add retry loop");
    set_line(&repo, 20, "cap B");
    let b = repo.commit_all("Cap the delay at 60 s");
    repo.write(OTHER, "a\nb\nc\nd\n");
    let c = repo.commit_all("Touch the other file");
    Branch { repo, a, b, c }
}

async fn target(repo: &FixtureRepo, path: &str, line: Option<u32>) -> FixupTarget {
    let cancel = Cancel::new();
    let git = git(repo);
    git.check_version(&cancel).await.unwrap();
    fixup_target::find(&git, "main", path, line, &cancel)
        .await
        .unwrap()
}

fn assert_is(found: &FixupTarget, sha: &str, subject: &str) {
    assert_eq!(found.sha, sha);
    assert_eq!(found.subject, subject);
    assert!(found.short_sha.len() >= 7, "{}", found.short_sha);
    assert!(sha.starts_with(&found.short_sha), "{}", found.short_sha);
}

#[tokio::test]
async fn f26_4_the_target_is_the_commit_that_last_changed_the_threads_line() {
    let b = author_checkout("f26-4-blame");

    assert_is(
        &target(&b.repo, FILE, Some(10)).await,
        &b.a,
        "Add retry loop",
    );
    assert_is(
        &target(&b.repo, FILE, Some(20)).await,
        &b.b,
        "Cap the delay at 60 s",
    );
}

#[tokio::test]
async fn f26_4_an_uncommitted_fix_on_the_line_does_not_change_the_target() {
    let b = author_checkout("f26-4-dirty");
    // The fix itself is in the working tree, on the very line the reviewer commented on.
    set_line(&b.repo, 10, "fixed with exponential backoff");

    assert_is(
        &target(&b.repo, FILE, Some(10)).await,
        &b.a,
        "Add retry loop",
    );
}

#[tokio::test]
async fn f26_4_a_line_older_than_the_range_falls_back_to_the_newest_commit_touching_the_file() {
    let b = author_checkout("f26-4-old-line");

    // Line 3 comes from `base`, which is not in merge-base..HEAD; B is the newest commit of the
    // range that touches FILE (C, the newest overall, does not).
    assert_is(
        &target(&b.repo, FILE, Some(3)).await,
        &b.b,
        "Cap the delay at 60 s",
    );
    // A thread without a line (a removed line, an outdated position) and a line past the end.
    assert_is(
        &target(&b.repo, FILE, None).await,
        &b.b,
        "Cap the delay at 60 s",
    );
    assert_is(
        &target(&b.repo, FILE, Some(9999)).await,
        &b.b,
        "Cap the delay at 60 s",
    );
}

#[tokio::test]
async fn f26_4_a_file_the_range_never_touched_falls_back_to_head() {
    let b = author_checkout("f26-4-untouched");

    assert_is(
        &target(&b.repo, UNTOUCHED, Some(1)).await,
        &b.c,
        "Touch the other file",
    );
    assert_is(
        &target(&b.repo, "src/does not exist.cs", Some(4)).await,
        &b.c,
        "Touch the other file",
    );
}

#[tokio::test]
async fn f26_4_the_file_commit_is_the_blame_in_range_and_the_newest_commit_otherwise() {
    let b = author_checkout("f26-4-other-file");

    // OTHER line 4 was added by C; line 1 belongs to `base` (outside the range), so the newest
    // commit of the range touching OTHER is C as well.
    assert_is(
        &target(&b.repo, OTHER, Some(4)).await,
        &b.c,
        "Touch the other file",
    );
    assert_is(
        &target(&b.repo, OTHER, Some(1)).await,
        &b.c,
        "Touch the other file",
    );
}

/// Edits line 20 of FILE in the working tree (unstaged), the way Rider or Claude would.
fn edit_the_fixed_file(repo: &FixtureRepo) {
    set_line(repo, 20, "exponential backoff");
}

#[tokio::test]
async fn f26_4_a_fixup_commit_reads_fixup_subject_with_the_message_as_its_body() {
    let b = author_checkout("f26-4-fixup");
    edit_the_fixed_file(&b.repo);
    let message = "Backoff doubles and stops at 60 s.\n\nSecond paragraph.";
    let before = b.repo.git(&["rev-list", "--count", "HEAD"]);

    let result = commit::commit_only(
        &git(&b.repo),
        message,
        Some(b.b.as_str()),
        &[FILE.to_owned()],
        &Cancel::new(),
    )
    .await
    .unwrap();

    assert_eq!(result.sha, b.repo.head());
    assert!(result.sha.starts_with(&result.short_sha));
    assert_eq!(
        b.repo.git(&["log", "-1", "--format=%s"]).trim_end(),
        "fixup! Cap the delay at 60 s"
    );
    assert_eq!(b.repo.git(&["log", "-1", "--format=%b"]).trim(), message);
    assert_eq!(
        b.repo
            .git(&["rev-list", "--count", "HEAD"])
            .trim()
            .parse::<u32>()
            .unwrap(),
        before.trim().parse::<u32>().unwrap() + 1,
        "a new commit, nothing amended"
    );
    // The fix is in the commit and the working tree is clean for that file.
    assert_eq!(
        b.repo
            .git(&["show", "--name-only", "--format=", "HEAD"])
            .trim(),
        FILE
    );
    assert!(b.repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[tokio::test]
async fn f26_4_without_the_fixup_switch_it_is_a_plain_separate_commit() {
    let b = author_checkout("f26-4-plain");
    edit_the_fixed_file(&b.repo);

    commit::commit_only(
        &git(&b.repo),
        "Address review on Upload Worker.cs:20",
        None,
        &[FILE.to_owned()],
        &Cancel::new(),
    )
    .await
    .unwrap();

    assert_eq!(
        b.repo.git(&["log", "-1", "--format=%s"]).trim_end(),
        "Address review on Upload Worker.cs:20"
    );
}

#[tokio::test]
async fn f26_4_the_pathspec_keeps_other_staged_and_unstaged_changes_out_of_the_commit() {
    let b = author_checkout("f26-4-pathspec");
    edit_the_fixed_file(&b.repo);
    // Another file staged, a third one changed but not staged.
    b.repo.write(OTHER, "a\nb\nc\nd\nstaged elsewhere\n");
    b.repo.git(&["add", "--", OTHER]);
    b.repo.write(UNTOUCHED, "x\ny\nunstaged elsewhere\n");

    commit::commit_only(
        &git(&b.repo),
        "Fix",
        Some(b.b.as_str()),
        &[FILE.to_owned()],
        &Cancel::new(),
    )
    .await
    .unwrap();

    assert_eq!(
        b.repo
            .git(&["show", "--name-only", "--format=", "HEAD"])
            .trim(),
        FILE,
        "only the fixed file is in the commit"
    );
    assert!(
        b.repo.staged().contains("staged elsewhere"),
        "the other staged file stays staged: {}",
        b.repo.staged()
    );
    assert!(
        b.repo.unstaged().contains("unstaged elsewhere"),
        "the other change stays unstaged: {}",
        b.repo.unstaged()
    );
}

#[tokio::test]
async fn f26_4_the_whole_fixed_file_goes_in_staged_and_unstaged_edits_alike() {
    let b = author_checkout("f26-4-both-edits");
    set_line(&b.repo, 20, "staged half");
    b.repo.git(&["add", "--", FILE]);
    set_line(&b.repo, 30, "unstaged half");

    commit::commit_only(
        &git(&b.repo),
        "Fix",
        None,
        &[FILE.to_owned()],
        &Cancel::new(),
    )
    .await
    .unwrap();

    let committed = b
        .repo
        .git(&["show", "HEAD:src/App Zażółć/Upload Worker.cs"]);
    assert!(committed.contains("staged half"), "{committed}");
    assert!(committed.contains("unstaged half"), "{committed}");
    assert!(b.repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[tokio::test]
async fn f26_4_an_empty_message_or_nothing_to_commit_in_the_file_is_refused() {
    let b = author_checkout("f26-4-refused");
    let git = git(&b.repo);
    let head = b.repo.head();

    // An empty message, with a change in the file.
    edit_the_fixed_file(&b.repo);
    let err = commit::commit_only(
        &git,
        "  \n",
        Some(b.b.as_str()),
        &[FILE.to_owned()],
        &Cancel::new(),
    )
    .await
    .unwrap_err();
    assert!(matches!(err, GitError::Invalid(_)), "{err:?}");
    assert_eq!(b.repo.head(), head);

    // A file without changes, even though another file has some.
    b.repo.write(OTHER, "a\nb\nc\nd\nchanged\n");
    let err = commit::commit_only(
        &git,
        "Fix",
        Some(b.b.as_str()),
        &[UNTOUCHED.to_owned()],
        &Cancel::new(),
    )
    .await
    .unwrap_err();
    assert!(matches!(err, GitError::Invalid(_)), "{err:?}");
    assert_eq!(b.repo.head(), head);
}

#[tokio::test]
async fn f26_4_a_fixup_target_is_a_sha_never_an_option() {
    let b = author_checkout("f26-4-option");
    edit_the_fixed_file(&b.repo);
    let head = b.repo.head();

    for bogus in ["--amend", "-n", "main", "HEAD~1 --no-verify"] {
        let err = commit::commit_only(
            &git(&b.repo),
            "Fix",
            Some(bogus),
            &[FILE.to_owned()],
            &Cancel::new(),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, GitError::Invalid(_)), "{bogus}: {err:?}");
    }
    assert_eq!(b.repo.head(), head, "nothing was committed");
}

#[tokio::test]
async fn f26_4_a_rejecting_hook_returns_its_output_and_commits_nothing() {
    let b = author_checkout("f26-4-hook");
    edit_the_fixed_file(&b.repo);
    b.repo.git(&["config", "core.hooksPath", "hooks ż"]);
    b.repo.write(
        "hooks ż/pre-commit",
        "#!/bin/sh\necho 'lint failed: Upload Worker.cs'\nexit 1\n",
    );
    let head = b.repo.head();

    let err = commit::commit_only(
        &git(&b.repo),
        "Fix",
        Some(b.b.as_str()),
        &[FILE.to_owned()],
        &Cancel::new(),
    )
    .await
    .unwrap_err();

    match err {
        GitError::HookFailed { output } => assert!(output.contains("lint failed"), "{output}"),
        other => panic!("expected a hook failure, got {other:?}"),
    }
    assert_eq!(b.repo.head(), head);
}
