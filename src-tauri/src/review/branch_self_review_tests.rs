#![allow(clippy::unwrap_used, reason = "tests")]

use rusqlite::params;

use super::of_head;
use crate::git::Git;
use crate::os::process::Cancel;
use crate::store::Store;
use crate::store::session_progress::Progress;

const LOCAL: &str = r#"{"kind":"local","scope":{"kind":"uncommitted"}}"#;
const MR: &str = r#"{"kind":"mr","project":"g/p","iid":7}"#;

async fn git(git: &Git, args: &[&str]) -> String {
    let mut all = vec![
        "-c",
        "user.name=Łukasz Żółw",
        "-c",
        "user.email=l@example.test",
    ];
    all.extend_from_slice(args);
    git.run(all, &Cancel::new())
        .await
        .unwrap()
        .stdout
        .trim()
        .to_owned()
}

async fn commit(repo: &Git, message: &str) -> String {
    git(repo, &["commit", "-q", "--allow-empty", "-m", message]).await;
    git(repo, &["rev-parse", "HEAD"]).await
}

/// A self-review session with `notes` open notes, so the tests can tell sessions apart.
fn session(store: &Store, id: &str, source: &str, head: &str, updated: &str, notes: usize) {
    store
        .with_conn(|c| {
            c.execute(
                "INSERT INTO sessions (id, repo_id, source_json, head_sha, status, updated_at)
                 VALUES (?1, 1, ?2, ?3, 'done', ?4)",
                params![id, source, head, updated],
            )?;
            for n in 0..notes {
                c.execute(
                    "INSERT INTO drafts (id, session_id) VALUES (?1, ?2)",
                    params![format!("{id}-{n}"), id],
                )?;
            }
            Ok(())
        })
        .unwrap();
}

fn notes(n: usize) -> Option<Progress> {
    Some(Progress {
        reviewed: 0,
        total: 0,
        drafts: n,
    })
}

/// main at `base`; branch `gałąź-a` one commit ahead; `gałąź-b` from `base`, checked out.
async fn two_branches(dir: &std::path::Path) -> (Git, String, String, String) {
    let repo = Git::new(None, dir);
    git(&repo, &["init", "-q", "-b", "main"]).await;
    let base = commit(&repo, "base").await;
    git(&repo, &["switch", "-q", "-c", "gałąź-a"]).await;
    let a = commit(&repo, "a").await;
    git(&repo, &["switch", "-q", "-c", "gałąź-b", "main"]).await;
    let b = commit(&repo, "b").await;
    (repo, base, a, b)
}

fn temp() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("gr przegląd ")
        .tempdir()
        .unwrap()
}

#[tokio::test]
async fn f27_5_a_newer_self_review_of_another_branch_does_not_count() {
    let dir = temp();
    let (repo, _, a, _) = two_branches(dir.path()).await;
    let store = Store::open_in_memory().unwrap();
    session(&store, "of-a", LOCAL, &a, "2026-10-11T09:00:00Z", 3);
    assert_eq!(
        of_head(&store, &repo, 1, &Cancel::new()).await.unwrap(),
        None
    );
}

#[tokio::test]
async fn f27_5_the_newest_self_review_of_this_branch_counts_past_newer_ones_elsewhere() {
    let dir = temp();
    let (repo, base, a, b) = two_branches(dir.path()).await;
    let store = Store::open_in_memory().unwrap();
    // Made on uncommitted changes at `base`, committed afterwards as `b`.
    session(
        &store,
        "before-commit",
        LOCAL,
        &base,
        "2026-10-11T08:00:00Z",
        1,
    );
    session(&store, "at-b", LOCAL, &b, "2026-10-11T09:00:00Z", 2);
    session(&store, "of-a", LOCAL, &a, "2026-10-11T10:00:00Z", 3);
    session(&store, "mr", MR, &b, "2026-10-11T11:00:00Z", 4);
    assert_eq!(
        of_head(&store, &repo, 1, &Cancel::new()).await.unwrap(),
        notes(2)
    );
}

#[tokio::test]
async fn f27_5_a_self_review_before_the_branch_commits_counts_after_them() {
    let dir = temp();
    let (repo, base, _, _) = two_branches(dir.path()).await;
    let store = Store::open_in_memory().unwrap();
    session(
        &store,
        "before-commit",
        LOCAL,
        &base,
        "2026-10-11T08:00:00Z",
        1,
    );
    assert_eq!(
        of_head(&store, &repo, 1, &Cancel::new()).await.unwrap(),
        notes(1)
    );
}

#[tokio::test]
async fn f27_5_a_head_the_repository_lacks_or_no_sha_does_not_count() {
    let dir = temp();
    let (repo, _, _, _) = two_branches(dir.path()).await;
    let store = Store::open_in_memory().unwrap();
    let missing = "0123456789abcdef".repeat(3);
    session(
        &store,
        "gone",
        LOCAL,
        &missing[..40],
        "2026-10-11T08:00:00Z",
        1,
    );
    session(&store, "odd", LOCAL, "--all", "2026-10-11T09:00:00Z", 2);
    assert_eq!(
        of_head(&store, &repo, 1, &Cancel::new()).await.unwrap(),
        None
    );
}
