//! F-26.5 review fixes below the Tauri layer: **Push and reply** pushes only the MR's source branch
//! (a checkout on another branch that also holds the fix pushes nothing and sends nothing), and a
//! reply still queued on reopen knows whether its commit is already on `origin/<source>` ("Pushed.
//! Reply not sent yet.", M7 decision 12). Synthetic data only (ADR-019); paths carry spaces and
//! Polish characters. Declared from `fixup_commit.rs` (`tests/it/main.rs` is locked for F-26.5).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::author_push::{self, PushReply};
use guided_review_lib::store::Store;
use guided_review_lib::store::queued_replies::{self, NewQueuedReply};
use wiremock::MockServer;

const PROJECT: &str = "sandbox/gr-sandbox";
const DISCUSSION: &str = "6f1c0de9a2b4";
const BRANCH: &str = "feature/ąę";
const OTHER: &str = "spike/inny-ąę";
const FILE: &str = "src/App Zażółć/Upload Worker.cs";

fn token() -> Token {
    Token::new(&["glpat", "-", "wiremock", "0000000"].concat()).unwrap()
}

/// `feature/ąę` on a bare origin, the fix committed on top locally; returns the fix SHA.
fn author_checkout(repo: &FixtureRepo) -> String {
    repo.write(FILE, "a\nb\nc\n");
    repo.commit_all("base");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", BRANCH]);
    repo.write(FILE, "a\nb2\nc\n");
    repo.commit_all("Add retry loop");
    repo.git(&["push", "-q", "-u", "origin", BRANCH]);
    repo.write(FILE, "a\nb3\nc\n");
    repo.commit_all("fixup! Add retry loop")
}

fn queue(store: &Store, after_sha: &str) -> String {
    store
        .with_conn(|conn| {
            queued_replies::queue(
                conn,
                &NewQueuedReply {
                    project: PROJECT.to_owned(),
                    iid: 6,
                    discussion: DISCUSSION.to_owned(),
                    body: "Fixed in 9e1d4b7. Backoff doubles.".to_owned(),
                    resolve: true,
                    after_sha: after_sha.to_owned(),
                },
            )
        })
        .unwrap()
        .id
}

#[tokio::test]
async fn f26_5_another_branch_holding_the_fix_pushes_nothing_and_sends_nothing() {
    let repo = FixtureRepo::new("f26-5-other-branch");
    let fix = author_checkout(&repo);
    repo.git(&["checkout", "-q", "-b", OTHER]);
    let store = Store::open_in_memory().unwrap();
    let id = queue(&store, &fix);
    let server = MockServer::start().await;
    let client = GitlabClient::new(&server.uri(), &token(), TlsBackend::Platform).unwrap();
    let cancel = Cancel::new();
    let git = Git::new(None, &repo.path);
    git.check_version(&cancel).await.unwrap();

    let result = author_push::push_and_reply_on(
        &PushReply {
            client: &client,
            store: &store,
            git: &git,
            project: PROJECT,
            iid: 6,
            reply_id: &id,
        },
        BRANCH,
        &cancel,
    )
    .await;

    let error = result.expect_err("another branch is refused");
    assert_eq!(error.message, format!("Check out {BRANCH} to push."));
    assert!(
        server.received_requests().await.unwrap().is_empty(),
        "nothing reached GitLab"
    );
    let remote = repo.git(&["ls-remote", "origin"]);
    assert!(
        !remote.contains(&fix),
        "the fix was not pushed anywhere: {remote}"
    );
    let row = store
        .with_conn(|conn| queued_replies::get(conn, &id))
        .unwrap()
        .unwrap();
    assert_eq!(row.state, "queued");
    assert_eq!(row.error.as_deref(), Some(error.message.as_str()));
}

#[tokio::test]
async fn f26_5_a_reply_found_on_reopen_knows_whether_its_commit_is_on_origin() {
    let repo = FixtureRepo::new("f26-5-waiting");
    let fix = author_checkout(&repo);
    let store = Store::open_in_memory().unwrap();
    queue(&store, &fix);
    let rows = || {
        store
            .with_conn(|conn| queued_replies::pending(conn, PROJECT, 6))
            .unwrap()
    };
    let cancel = Cancel::new();
    let git = Git::new(None, &repo.path);
    git.check_version(&cancel).await.unwrap();

    let before = author_push::waiting(&git, rows(), BRANCH, &cancel)
        .await
        .unwrap();
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].reply.after_sha, fix);
    assert!(!before[0].pushed, "the fix is only local");

    repo.git(&["push", "-q", "origin", BRANCH]);
    let after = author_push::waiting(&git, rows(), BRANCH, &cancel)
        .await
        .unwrap();
    assert!(
        after[0].pushed,
        "the fix is on origin, the reply still waits"
    );
    assert_eq!(after[0].reply.state, "queued");
}
