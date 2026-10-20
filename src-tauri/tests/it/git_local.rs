//! Local changes, staging, commit and push on fixture repositories (F-16.1, F-16.2, F-16.4,
//! F-16.5, F-15.6). Paths carry spaces and Polish characters.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]
#![expect(
    clippy::disallowed_methods,
    reason = "tests read the fixture repositories with git directly, never through the app"
)]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::commit;
use guided_review_lib::git::local::{self, FileRef, RepoOperation};
use guided_review_lib::git::model::{FileDiff, LineKind};
use guided_review_lib::git::staging::{self, LineRef, LineSide, Selection};
use guided_review_lib::git::tree::StageState;
use guided_review_lib::git::{Git, GitError};
use guided_review_lib::os::process::Cancel;

const FILE: &str = "src/Zażółć gęślą/Delivery Page.cs";

fn git(repo: &FixtureRepo) -> Git {
    Git::new(None, &repo.path)
}

fn tracked(path: &str) -> FileRef {
    FileRef {
        path: path.into(),
        old_path: None,
        untracked: false,
    }
}

fn new_line(no: u32) -> LineRef {
    LineRef {
        side: LineSide::New,
        no,
    }
}

fn old_line(no: u32) -> LineRef {
    LineRef {
        side: LineSide::Old,
        no,
    }
}

/// (kind, number, staged) of every changed line.
fn states(diff: &FileDiff) -> Vec<(LineKind, u32, bool)> {
    diff.hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter(|l| l.kind != LineKind::Ctx)
        .map(|l| {
            let no = if l.kind == LineKind::Del {
                l.old_no
            } else {
                l.new_no
            };
            (l.kind, no.unwrap(), l.staged.unwrap())
        })
        .collect()
}

/// HEAD: 10 lines; working tree: line 3 replaced, line 8 replaced, two lines appended.
fn repo_with_edits(label: &str) -> FixtureRepo {
    let repo = FixtureRepo::new(label);
    let head: String = (1..=10).map(|i| format!("line {i} ąę\n")).collect();
    repo.write(FILE, &head);
    repo.commit_all("base");
    let work = head
        .replace("line 3 ąę\n", "LINE 3 changed\n")
        .replace("line 8 ąę\n", "LINE 8 changed\n")
        + "line 11 new\nline 12 new\n";
    repo.write(FILE, &work);
    repo
}

#[tokio::test]
async fn f16_1_stage_selected_lines_only() {
    let repo = repo_with_edits("f16-1-stage");
    let git = git(&repo);
    let cancel = Cancel::new();
    // Stage the replacement of line 3 (both sides) and line 12 only.
    let selection = Selection::Lines {
        file: tracked(FILE),
        lines: vec![old_line(3), new_line(3), new_line(12)],
    };
    staging::stage(&git, &selection, &cancel).await.unwrap();
    let index = repo.index_content(FILE);
    assert!(index.contains("LINE 3 changed\n"));
    assert!(index.contains("line 8 ąę\n"), "line 8 stays as in HEAD");
    assert!(index.ends_with("line 10 ąę\nline 12 new\n"), "{index}");

    let diff = local::local_file_diff(&git, &tracked(FILE), &cancel)
        .await
        .unwrap();
    assert_eq!(
        states(&diff),
        [
            (LineKind::Del, 3, true),
            (LineKind::Add, 3, true),
            (LineKind::Del, 8, false),
            (LineKind::Add, 8, false),
            (LineKind::Add, 11, false),
            (LineKind::Add, 12, true),
        ]
    );
    let changes = local::local_changes(&git, &cancel).await.unwrap();
    let file = &changes.groups[0].files[0];
    assert_eq!(file.staged, Some(StageState::Partial));
    assert_eq!(changes.staged_files, 1);
}

#[tokio::test]
async fn f16_1_unstage_selected_lines_only() {
    let repo = repo_with_edits("f16-1-unstage");
    repo.git(&["add", "-A"]);
    let git = git(&repo);
    let cancel = Cancel::new();
    // Unstage the deletion of line 8 and the added line 11.
    let selection = Selection::Lines {
        file: tracked(FILE),
        lines: vec![old_line(8), new_line(11)],
    };
    staging::unstage(&git, &selection, &cancel).await.unwrap();
    let diff = local::local_file_diff(&git, &tracked(FILE), &cancel)
        .await
        .unwrap();
    assert_eq!(
        states(&diff),
        [
            (LineKind::Del, 3, true),
            (LineKind::Add, 3, true),
            (LineKind::Del, 8, false),
            (LineKind::Add, 8, true),
            (LineKind::Add, 11, false),
            (LineKind::Add, 12, true),
        ]
    );
    let index = repo.index_content(FILE);
    assert!(index.contains("line 8 ąę\nLINE 8 changed\n"), "{index}");
    assert!(!index.contains("line 11 new"));
}

#[tokio::test]
async fn f16_1_staging_all_lines_of_a_hunk_and_back() {
    let repo = repo_with_edits("f16-1-hunk");
    let git = git(&repo);
    let cancel = Cancel::new();
    let hunk = vec![old_line(8), new_line(8)];
    let selection = Selection::Lines {
        file: tracked(FILE),
        lines: hunk,
    };
    staging::stage(&git, &selection, &cancel).await.unwrap();
    assert!(repo.staged().contains("+LINE 8 changed"));
    staging::unstage(&git, &selection, &cancel).await.unwrap();
    assert_eq!(repo.staged(), "");
}

#[tokio::test]
async fn f16_1_partial_stage_of_a_new_file() {
    let repo = FixtureRepo::new("f16-1-new");
    repo.write("a.txt", "a\n");
    repo.commit_all("base");
    let path = "nowy katalog/Nowy plik ż.cs";
    repo.write(path, "one\ntwo\nthree\n");
    let git = git(&repo);
    let cancel = Cancel::new();
    let file = FileRef {
        path: path.into(),
        old_path: None,
        untracked: true,
    };
    let diff = local::local_file_diff(&git, &file, &cancel).await.unwrap();
    assert!(states(&diff).iter().all(|(_, _, staged)| !staged));

    staging::stage(
        &git,
        &Selection::Lines {
            file: file.clone(),
            lines: vec![new_line(1), new_line(3)],
        },
        &cancel,
    )
    .await
    .unwrap();
    assert_eq!(repo.index_content(path), "one\nthree\n");
    let diff = local::local_file_diff(&git, &tracked(path), &cancel)
        .await
        .unwrap();
    assert_eq!(
        states(&diff),
        [
            (LineKind::Add, 1, true),
            (LineKind::Add, 2, false),
            (LineKind::Add, 3, true)
        ]
    );
    // Unstaging everything takes the new file out of the index again.
    staging::unstage(
        &git,
        &Selection::Lines {
            file: tracked(path),
            lines: vec![new_line(1), new_line(3)],
        },
        &cancel,
    )
    .await
    .unwrap();
    let changes = local::local_changes(&git, &cancel).await.unwrap();
    let row = changes
        .groups
        .iter()
        .flat_map(|g| &g.files)
        .find(|f| f.path == path)
        .unwrap();
    assert!(row.untracked);
}

#[tokio::test]
async fn f16_1_whole_files_and_crlf_with_autocrlf() {
    let repo = FixtureRepo::new("f16-1-crlf");
    repo.git(&["config", "core.autocrlf", "true"]);
    repo.write("win ą.txt", "a\r\nb\r\nc\r\n");
    repo.commit_all("base");
    repo.write("win ą.txt", "a\r\nB\r\nc\r\nd\r\n");
    let git = git(&repo);
    let cancel = Cancel::new();
    // Line-level staging on a CRLF working tree with LF in the index.
    staging::stage(
        &git,
        &Selection::Lines {
            file: tracked("win ą.txt"),
            lines: vec![new_line(4)],
        },
        &cancel,
    )
    .await
    .unwrap();
    assert_eq!(repo.index_content("win ą.txt"), "a\nb\nc\nd\n");
    let diff = local::local_file_diff(&git, &tracked("win ą.txt"), &cancel)
        .await
        .unwrap();
    assert!(diff.hunks[0].lines.iter().all(|l| !l.text.ends_with('\r')));
    // Whole-file staging and unstaging.
    let files = Selection::Files {
        files: vec![tracked("win ą.txt")],
    };
    staging::stage(&git, &files, &cancel).await.unwrap();
    assert_eq!(repo.unstaged(), "");
    staging::unstage(&git, &files, &cancel).await.unwrap();
    assert_eq!(repo.staged(), "");
}

#[tokio::test]
async fn f16_2_line_state_reflects_external_git_add() {
    let repo = repo_with_edits("f16-2");
    let git = git(&repo);
    let cancel = Cancel::new();
    // Something else (Rider, a terminal) stages the whole file.
    repo.git(&["add", "--", FILE]);
    let diff = local::local_file_diff(&git, &tracked(FILE), &cancel)
        .await
        .unwrap();
    assert!(states(&diff).iter().all(|(_, _, staged)| *staged));
    let changes = local::local_changes(&git, &cancel).await.unwrap();
    assert_eq!(changes.groups[0].files[0].staged, Some(StageState::All));
    // …and edits the file again after staging: the hunk says so.
    let work = repo
        .read(FILE)
        .replace("LINE 3 changed", "LINE 3 edited again");
    repo.write(FILE, &work);
    let diff = local::local_file_diff(&git, &tracked(FILE), &cancel)
        .await
        .unwrap();
    assert!(diff.hunks.iter().any(|h| h.staged_differs));
}

#[tokio::test]
async fn f16_3_many_files_by_pathspec_on_stdin() {
    let repo = FixtureRepo::new("f16-3");
    fixture_repo::mobile_app_with_local_change(&repo);
    let git = git(&repo);
    let cancel = Cancel::new();
    let changes = local::local_changes(&git, &cancel).await.unwrap();
    assert_eq!(changes.total_files, 100);
    assert_eq!(changes.staged_files, 0);
    assert_eq!(changes.branch.as_deref(), Some("chore/compiled-bindings"));
    let files: Vec<FileRef> = changes
        .groups
        .iter()
        .flat_map(|g| &g.files)
        .filter(|f| !f.path.starts_with("docs/") && !f.path.starts_with("tests/"))
        .map(|f| tracked(&f.path))
        .collect();
    staging::stage(&git, &Selection::Files { files }, &cancel)
        .await
        .unwrap();
    let changes = local::local_changes(&git, &cancel).await.unwrap();
    assert_eq!(changes.staged_files, 80);
}

#[tokio::test]
async fn f16_4_commit_and_amend_from_message_on_stdin() {
    let repo = repo_with_edits("f16-4");
    repo.git(&["add", "-A"]);
    let git = git(&repo);
    let cancel = Cancel::new();
    let message = "Enable compiled bindings\n\n- \"quotes\" & ampersands\n# not a comment";
    let result = commit::commit(&git, message, false, &cancel).await.unwrap();
    assert_eq!(result.sha, repo.head());
    assert!(result.sha.starts_with(&result.short_sha));
    assert_eq!(repo.git(&["log", "-1", "--format=%B"]).trim_end(), message);
    assert_eq!(
        commit::last_message(&git, &cancel)
            .await
            .unwrap()
            .as_deref(),
        Some(message)
    );
    // Amend replaces HEAD.
    let amended = commit::commit(&git, "Better subject", true, &cancel)
        .await
        .unwrap();
    assert_ne!(amended.sha, result.sha);
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]).trim(), "2");
    // Nothing staged.
    let err = commit::commit(&git, "Again", false, &cancel)
        .await
        .unwrap_err();
    assert!(matches!(err, GitError::Invalid(_)), "{err:?}");
    let err = commit::commit(&git, "  \n", false, &cancel)
        .await
        .unwrap_err();
    assert!(matches!(err, GitError::Invalid(_)));
}

#[tokio::test]
async fn f16_4_hook_failure_returns_its_output() {
    let repo = repo_with_edits("f16-4-hook");
    repo.git(&["config", "core.hooksPath", "hooks ż"]);
    repo.write(
        "hooks ż/pre-commit",
        "#!/bin/sh\necho 'lint failed: Delivery Page.cs'\nexit 1\n",
    );
    repo.git(&["add", "--", FILE]);
    let git = git(&repo);
    let err = commit::commit(&git, "Subject", false, &Cancel::new())
        .await
        .unwrap_err();
    match err {
        GitError::HookFailed { output } => assert!(output.contains("lint failed"), "{output}"),
        other => panic!("expected a hook failure, got {other:?}"),
    }
}

#[tokio::test]
async fn f16_5_push_sets_upstream_on_bare_remote() {
    let repo = repo_with_edits("f16-5");
    let bare = repo.add_bare_origin();
    repo.git(&["checkout", "-q", "-b", "feature/zażółć"]);
    repo.git(&["add", "-A"]);
    let git = git(&repo);
    let cancel = Cancel::new();
    commit::commit(&git, "Edit", false, &cancel).await.unwrap();
    let pushed = commit::push(&git, &cancel).await.unwrap();
    assert_eq!(pushed.remote_branch, "origin/feature/zażółć");
    assert_eq!(
        repo.git(&["rev-parse", "--abbrev-ref", "@{upstream}"])
            .trim(),
        "origin/feature/zażółć"
    );
    // A second push uses the upstream.
    repo.write("more.txt", "x\n");
    repo.git(&["add", "-A"]);
    commit::commit(&git, "More", false, &cancel).await.unwrap();
    commit::push(&git, &cancel).await.unwrap();
    let remote_head = std::process::Command::new("git")
        .args(["rev-parse", "feature/zażółć"])
        .current_dir(&bare)
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(remote_head.stdout).unwrap().trim(),
        repo.head()
    );
}

#[tokio::test]
async fn f16_5_rejected_push_is_reported_and_never_forced() {
    let repo = repo_with_edits("f16-5-reject");
    let bare = repo.add_bare_origin();
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    // Someone else pushes first.
    let other = repo.root.join("other clone");
    let status = std::process::Command::new("git")
        .args(["clone", "-q"])
        .arg(&bare)
        .arg(&other)
        .status()
        .unwrap();
    assert!(status.success());
    for args in [
        vec![
            "-c",
            "user.name=O",
            "-c",
            "user.email=o@example.invalid",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "theirs",
        ],
        vec!["push", "-q", "origin", "main"],
    ] {
        assert!(
            std::process::Command::new("git")
                .args(&args)
                .current_dir(&other)
                .status()
                .unwrap()
                .success()
        );
    }
    repo.git(&["add", "-A"]);
    let git = git(&repo);
    let cancel = Cancel::new();
    commit::commit(&git, "Mine", false, &cancel).await.unwrap();
    let err = commit::push(&git, &cancel).await.unwrap_err();
    assert!(matches!(err, GitError::PushRejected(_)), "{err:?}");
}

#[tokio::test]
async fn s06_merge_in_progress_is_detected() {
    let repo = FixtureRepo::new("merge");
    repo.write("a.txt", "base\n");
    repo.commit_all("base");
    repo.git(&["checkout", "-q", "-b", "other"]);
    repo.write("a.txt", "other\n");
    repo.commit_all("other");
    repo.git(&["checkout", "-q", "main"]);
    repo.write("a.txt", "main\n");
    repo.commit_all("main");
    let out = std::process::Command::new("git")
        .args(["merge", "other"])
        .current_dir(&repo.path)
        .output()
        .unwrap();
    assert!(!out.status.success(), "the merge should conflict");
    let changes = local::local_changes(&git(&repo), &Cancel::new())
        .await
        .unwrap();
    assert_eq!(changes.operation, Some(RepoOperation::Merge));
}

#[tokio::test]
async fn f15_6_commit_info_subject_body_parent() {
    let repo = FixtureRepo::new("f15-6");
    repo.write("src/Core/QueueItemStatus.cs", "namespace Mobile.Core;\n");
    let root = repo.commit_all("Root");
    repo.write("src/Infrastructure/Workers/UploadWorker.cs", "a\nb\n");
    repo.git(&["add", "-A"]);
    repo.git(&[
        "commit",
        "-q",
        "-m",
        "UploadWorker: jittered backoff",
        "-m",
        "The delay between retries grows exponentially.\nRandom jitter spreads retries.",
    ]);
    let git = git(&repo);
    let cancel = Cancel::new();
    let info = commit::commit_info(&git, "HEAD", &cancel).await.unwrap();
    assert_eq!(info.subject, "UploadWorker: jittered backoff");
    assert!(info.body.starts_with("The delay between retries"));
    assert_eq!(info.author, "Test Łukasz");
    assert_eq!(info.parents, std::slice::from_ref(&root));
    assert_eq!(info.total_files, 1);
    assert_eq!(info.groups[0].dir, "src/Infrastructure/Workers");
    // The root commit diffs against the empty tree.
    let first = commit::commit_info(&git, &root, &cancel).await.unwrap();
    assert!(first.parents.is_empty());
    assert_eq!(first.total_files, 1);
    let file = guided_review_lib::git::diff::ChangedFile {
        path: "src/Core/QueueItemStatus.cs".into(),
        old_path: None,
        status: guided_review_lib::git::model::FileStatus::Added,
        binary: false,
        additions: 1,
        deletions: 0,
    };
    let diff = commit::commit_file_diff(&git, &root, &file, &cancel)
        .await
        .unwrap();
    assert_eq!(diff.additions, 1);
}

#[tokio::test]
async fn unborn_repository_stages_and_unstages() {
    let repo = FixtureRepo::new("unborn");
    repo.write("first ż.txt", "a\nb\n");
    let git = git(&repo);
    let cancel = Cancel::new();
    let changes = local::local_changes(&git, &cancel).await.unwrap();
    assert_eq!(changes.head, None);
    assert_eq!(changes.total_files, 1);
    let files = Selection::Files {
        files: vec![FileRef {
            path: "first ż.txt".into(),
            old_path: None,
            untracked: true,
        }],
    };
    staging::stage(&git, &files, &cancel).await.unwrap();
    assert_eq!(repo.index_content("first ż.txt"), "a\nb\n");
    let files = Selection::Files {
        files: vec![tracked("first ż.txt")],
    };
    staging::unstage(&git, &files, &cancel).await.unwrap();
    let changes = local::local_changes(&git, &cancel).await.unwrap();
    assert!(changes.groups[0].files[0].untracked);
}
