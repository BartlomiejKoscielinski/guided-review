//! Diffs between commits on fixture repositories (F-05.2, F-05.3, F-05.7).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::git::diff::{self, ChangedFile};
use guided_review_lib::git::model::{FileStatus, LineKind};
use guided_review_lib::os::process::Cancel;

fn git(repo: &FixtureRepo) -> Git {
    Git::new(None, &repo.path)
}

#[tokio::test]
async fn f05_2_diff_detects_renames_between_merge_base_and_head() {
    let repo = FixtureRepo::new("f05-2");
    let body: String = (1..=30).map(|i| format!("line {i} zażółć\n")).collect();
    repo.write("src/Old Name.cs", &body);
    repo.write("src/keep.cs", "a\nb\nc\n");
    repo.commit_all("base");
    repo.git(&["checkout", "-q", "-b", "feature/ąę"]);
    repo.git(&["mv", "src/Old Name.cs", "src/Nowa nazwa.cs"]);
    repo.write("src/keep.cs", "a\nB\nc\n");
    let head = repo.commit_all("rename and edit");
    // The target moves on after the branch point; the merge base ignores that.
    repo.git(&["checkout", "-q", "main"]);
    repo.write("other.txt", "target only\n");
    repo.commit_all("target change");

    let git = git(&repo);
    let cancel = Cancel::new();
    git.check_version(&cancel).await.unwrap();
    let base = diff::merge_base(&git, "main", &head, &cancel)
        .await
        .unwrap();
    let files = diff::range_files(&git, &base, &head, &cancel)
        .await
        .unwrap();
    assert_eq!(files.len(), 2, "{files:?}");
    let renamed = files
        .iter()
        .find(|f| f.status == FileStatus::Renamed)
        .unwrap();
    assert_eq!(renamed.old_path.as_deref(), Some("src/Old Name.cs"));
    assert_eq!(renamed.path, "src/Nowa nazwa.cs");
    let keep = files.iter().find(|f| f.path == "src/keep.cs").unwrap();
    assert_eq!((keep.additions, keep.deletions), (1, 1));

    let diff = diff::range_file_diff(&git, &base, &head, keep, &cancel)
        .await
        .unwrap();
    let kinds: Vec<_> = diff.hunks[0].lines.iter().map(|l| l.kind).collect();
    assert_eq!(
        kinds,
        [LineKind::Ctx, LineKind::Del, LineKind::Add, LineKind::Ctx]
    );
    // A pure rename has no text hunks: one file-level hunk (F-05.7).
    let rename = diff::range_file_diff(&git, &base, &head, renamed, &cancel)
        .await
        .unwrap();
    assert_eq!(rename.hunks.len(), 1);
    assert!(rename.hunks[0].file_level);
}

#[tokio::test]
async fn f05_2_binary_files_listed_not_rendered() {
    let repo = FixtureRepo::new("f05-2-bin");
    repo.write_bytes("img/logo ż.png", &[0x89, b'P', b'N', b'G', 0, 1, 2, 3]);
    let base = repo.commit_all("logo");
    repo.write_bytes("img/logo ż.png", &[0x89, b'P', b'N', b'G', 0, 9, 9, 9]);
    let head = repo.commit_all("new logo");

    let git = git(&repo);
    let cancel = Cancel::new();
    let files = diff::range_files(&git, &base, &head, &cancel)
        .await
        .unwrap();
    assert_eq!(files.len(), 1);
    assert!(files[0].binary);
    let diff = diff::range_file_diff(&git, &base, &head, &files[0], &cancel)
        .await
        .unwrap();
    assert!(diff.binary);
    assert!(!diff.line_staging);
    assert_eq!(diff.hunks.len(), 1);
    assert!(diff.hunks[0].file_level && diff.hunks[0].lines.is_empty());
}

#[tokio::test]
async fn f05_3_ids_are_stable_across_repositories_with_the_same_change() {
    let mut ids = Vec::new();
    for label in ["one", "two"] {
        let repo = FixtureRepo::new(label);
        repo.write("a.cs", "x\ny\nz\n");
        let base = repo.commit_all("base");
        repo.write("a.cs", "x\nY\nz\n");
        let head = repo.commit_all("edit");
        let git = git(&repo);
        let cancel = Cancel::new();
        let file = ChangedFile {
            path: "a.cs".into(),
            old_path: None,
            status: FileStatus::Modified,
            binary: false,
            additions: 1,
            deletions: 1,
        };
        let diff = diff::range_file_diff(&git, &base, &head, &file, &cancel)
            .await
            .unwrap();
        ids.push(diff.hunks[0].id.clone());
    }
    assert_eq!(ids[0], ids[1]);
}

#[tokio::test]
async fn f05_7_empty_file_added_gets_a_file_level_hunk() {
    let repo = FixtureRepo::new("f05-7");
    repo.write("a.txt", "a\n");
    let base = repo.commit_all("base");
    repo.write("empty ż.txt", "");
    let head = repo.commit_all("empty");
    let git = git(&repo);
    let cancel = Cancel::new();
    let files = diff::range_files(&git, &base, &head, &cancel)
        .await
        .unwrap();
    let diff = diff::range_file_diff(&git, &base, &head, &files[0], &cancel)
        .await
        .unwrap();
    assert_eq!(diff.status, FileStatus::Added);
    assert!(diff.hunks[0].file_level);
}

#[tokio::test]
async fn a_folder_that_is_not_a_repository_is_reported() {
    let dir = tempfile::tempdir().unwrap();
    let git = Git::new(None, dir.path());
    let err = git.git_dir(&Cancel::new()).await.unwrap_err();
    assert!(matches!(
        err,
        guided_review_lib::git::GitError::NotARepository(_)
    ));
}
