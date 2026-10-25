//! F-26.5 below the Tauri layer: **Push and reply** on S-10 (docs/plans/M7.md F-26.5, decisions 11
//! and 12). The reply "Fixed in <sha>. <one sentence>." is queued in `queued_replies` (ADR-014) and
//! reaches GitLab only after a successful push: reply first, then Resolve when the switch is on, both
//! through `gitlab/thread_actions.rs`, and only if the queued `after_sha` is on the remote branch.
//! A remote branch that isn't an ancestor of HEAD (`git ls-remote`, decision 11) is "Pull first":
//! nothing is pushed, nothing is sent. A failed push or reply keeps the reply queued; the retry
//! sends it once. Synthetic data only (ADR-019); paths carry spaces and Polish characters.
//!
//! The tests pin these names (the plan's `store/queued_replies.rs` and a core `review/author_push.rs`):
//! - `queued_replies::NewQueuedReply { project, iid, discussion, body, resolve, after_sha }`,
//!   `queued_replies::queue(conn, &NewQueuedReply) -> QueuedReply` (one open reply per discussion
//!   of an MR: queueing again replaces body, resolve and after_sha and keeps the id),
//!   `queued_replies::get(conn, id) -> Option<QueuedReply { id, project, iid, discussion, body,
//!   resolve, after_sha, state, error }>` with `state` `"queued"` or `"sent"` and `error` the last
//!   failure in plain words, `queued_replies::pending_discussions(conn, project, iid) ->
//!   HashSet<String>` (the discussions with a reply not yet sent: S-10's "Fixed locally · not
//!   pushed" tag).
//! - `author_push::push_and_reply(&PushReply { client, store, git, project, iid, reply_id }, &Cancel)
//!   -> Result<PushOutcome, _>`, `PushOutcome::Done { remote_branch, resolved }` or
//!   `PushOutcome::PullFirst`. A failure of the push, of the reply, of the resolve, or an `after_sha`
//!   that never reached the remote branch is an `Err`; the reply stays `"queued"` with `error` set.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::disallowed_methods,
    reason = "tests"
)]

use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::author_push::{self, PushOutcome, PushReply};
use guided_review_lib::store::Store;
use guided_review_lib::store::queued_replies::{self, NewQueuedReply};
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "sandbox/gr-sandbox";
const MR: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/6";
const DISCUSSION: &str = "6f1c0de9a2b4";
const BRANCH: &str = "feature/ąę";
const FILE: &str = "src/App Zażółć/Upload Worker.cs";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

fn notes_route() -> String {
    format!("{MR}/discussions/{DISCUSSION}/notes")
}

fn discussion_route() -> String {
    format!("{MR}/discussions/{DISCUSSION}")
}

fn note(body: &str) -> Value {
    json!({
        "id": 202, "type": "DiscussionNote", "body": body,
        "author": { "id": 2, "username": "dev", "name": "Dev Stand-in" },
        "created_at": "2026-10-16T09:00:00.000Z", "system": false,
        "resolvable": true, "resolved": false, "noteable_iid": 6
    })
}

fn discussion(resolved: bool) -> Value {
    json!({ "id": DISCUSSION, "individual_note": false, "notes": [
        { "id": 101, "type": "DiffNote", "body": "Retry?", "system": false,
          "author": { "id": 3, "username": "alice", "name": "Alice Stand-in" },
          "created_at": "2026-10-12T14:00:00.000Z", "resolvable": true, "resolved": resolved }
    ] })
}

/// Answers `ok` after `failures` refused requests with a 500.
struct FailFirst {
    failures: usize,
    seen: AtomicUsize,
    ok: Value,
}

impl Respond for FailFirst {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        if self.seen.fetch_add(1, Ordering::SeqCst) < self.failures {
            ResponseTemplate::new(500)
                .set_body_json(json!({ "message": "500 Internal Server Error" }))
        } else {
            ResponseTemplate::new(201).set_body_json(self.ok.clone())
        }
    }
}

/// A GitLab that takes the reply (after `reply_failures` refusals) and the resolve (after
/// `resolve_failures`).
async fn gitlab(reply_failures: usize, resolve_failures: usize) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(notes_route()))
        .respond_with(FailFirst {
            failures: reply_failures,
            seen: AtomicUsize::new(0),
            ok: note("Fixed in 9e1d4b7. Backoff doubles."),
        })
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path(discussion_route()))
        .respond_with(FailFirst {
            failures: resolve_failures,
            seen: AtomicUsize::new(0),
            ok: discussion(true),
        })
        .mount(&server)
        .await;
    server
}

/// What reached GitLab, in order: "reply <body>" and "resolve <resolved>".
async fn sent(server: &MockServer) -> Vec<String> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| {
            if r.method.as_str() == "POST" {
                let body: Value = serde_json::from_slice(&r.body).unwrap_or(Value::Null);
                let text = body["body"]
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| {
                        r.url
                            .query_pairs()
                            .find(|(k, _)| k == "body")
                            .map(|(_, v)| v.into_owned())
                    })
                    .unwrap_or_default();
                format!("reply {text}")
            } else {
                let resolved = r
                    .url
                    .query_pairs()
                    .find(|(k, _)| k == "resolved")
                    .map(|(_, v)| v.into_owned())
                    .unwrap_or_default();
                format!("resolve {resolved}")
            }
        })
        .collect()
}

struct Checkout {
    repo: FixtureRepo,
    origin: std::path::PathBuf,
    store: Store,
    /// The fix commit, only local until the push.
    fix: String,
}

fn git(repo: &FixtureRepo) -> Git {
    Git::new(None, &repo.path)
}

/// `main` and `feature/ąę` (one commit) are on a bare origin; the fix is committed on top, locally.
fn author_checkout(label: &str) -> Checkout {
    let repo = FixtureRepo::new(label);
    repo.write(FILE, "a\nb\nc\n");
    repo.commit_all("base");
    let origin = repo.add_bare_origin();
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", BRANCH]);
    repo.write(FILE, "a\nb2\nc\n");
    repo.commit_all("Add retry loop");
    repo.git(&["push", "-q", "-u", "origin", BRANCH]);
    repo.write(FILE, "a\nb3\nc\n");
    let fix = repo.commit_all("fixup! Add retry loop");
    Checkout {
        repo,
        origin,
        store: Store::open_in_memory().unwrap(),
        fix,
    }
}

fn queue(c: &Checkout, body: &str, resolve: bool) -> String {
    queue_for(c, &c.fix, body, resolve)
}

fn queue_for(c: &Checkout, after_sha: &str, body: &str, resolve: bool) -> String {
    c.store
        .with_conn(|conn| {
            queued_replies::queue(
                conn,
                &NewQueuedReply {
                    project: PROJECT.to_owned(),
                    iid: 6,
                    discussion: DISCUSSION.to_owned(),
                    body: body.to_owned(),
                    resolve,
                    after_sha: after_sha.to_owned(),
                },
            )
        })
        .unwrap()
        .id
}

fn row(c: &Checkout, id: &str) -> queued_replies::QueuedReply {
    c.store
        .with_conn(|conn| queued_replies::get(conn, id))
        .unwrap()
        .expect("the queued reply stays in the store")
}

async fn run(c: &Checkout, server: &MockServer, id: &str) -> Result<PushOutcome, String> {
    let cancel = Cancel::new();
    let git = git(&c.repo);
    git.check_version(&cancel).await.unwrap();
    let client = client(server);
    author_push::push_and_reply(
        &PushReply {
            client: &client,
            store: &c.store,
            git: &git,
            project: PROJECT,
            iid: 6,
            reply_id: id,
        },
        &cancel,
    )
    .await
    .map_err(|e| e.to_string())
}

/// The tip of `BRANCH` on the bare origin.
fn remote_tip(c: &Checkout) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(&c.origin)
        .args(["rev-parse", "--verify", &format!("refs/heads/{BRANCH}")])
        .output()
        .unwrap();
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

/// A teammate pushes a commit to the same branch from a second clone.
fn teammate_pushes(c: &Checkout) {
    let clone = c.repo.root.join("teammate clone");
    let run = |dir: &std::path::Path, args: &[&str]| {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args([
                "-c",
                "user.name=Team Mate",
                "-c",
                "user.email=mate@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=.no-hooks",
            ])
            .args(args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    };
    let status = Command::new("git")
        .args(["clone", "-q"])
        .arg(&c.origin)
        .arg(&clone)
        .status()
        .unwrap();
    assert!(status.success());
    run(&clone, &["checkout", "-q", BRANCH]);
    std::fs::write(clone.join("mate.txt"), "from the teammate\n").unwrap();
    run(&clone, &["add", "mate.txt"]);
    run(&clone, &["commit", "-q", "-m", "Teammate commit"]);
    run(&clone, &["push", "-q", "origin", BRANCH]);
}

#[tokio::test]
async fn f26_5_the_reply_is_sent_after_the_push_and_then_the_thread_is_resolved() {
    let c = author_checkout("f26-5-ok");
    let server = gitlab(0, 0).await;
    let id = queue(&c, "Fixed in 9e1d4b7. Backoff doubles.", true);
    assert_ne!(remote_tip(&c), c.fix, "the fix is not on the remote yet");

    let outcome = run(&c, &server, &id).await.unwrap();

    assert_eq!(remote_tip(&c), c.fix, "the fix reached origin");
    assert_eq!(
        outcome,
        PushOutcome::Done {
            remote_branch: format!("origin/{BRANCH}"),
            resolved: true,
            pushed_sha: Some(c.fix.clone()),
        }
    );
    assert_eq!(
        sent(&server).await,
        ["reply Fixed in 9e1d4b7. Backoff doubles.", "resolve true"],
        "reply first, then resolve, nothing else"
    );
    let done = row(&c, &id);
    assert_eq!(done.state, "sent");
    assert_eq!(done.error, None);
}

#[tokio::test]
async fn f26_5_with_resolve_off_the_reply_is_sent_and_the_thread_stays_open() {
    let c = author_checkout("f26-5-no-resolve");
    let server = gitlab(0, 0).await;
    let id = queue(&c, "Fixed in 9e1d4b7. Backoff doubles.", false);

    let outcome = run(&c, &server, &id).await.unwrap();

    assert_eq!(
        outcome,
        PushOutcome::Done {
            remote_branch: format!("origin/{BRANCH}"),
            resolved: false,
            pushed_sha: Some(c.fix.clone()),
        }
    );
    assert_eq!(
        sent(&server).await,
        ["reply Fixed in 9e1d4b7. Backoff doubles."]
    );
    assert_eq!(row(&c, &id).state, "sent");
}

#[tokio::test]
async fn f26_5_a_rejected_push_sends_no_reply_and_keeps_it_queued() {
    let c = author_checkout("f26-5-push-fails");
    // The remote refuses every update (a protected branch, a server hook).
    let hook = c.origin.join("hooks").join("pre-receive");
    std::fs::write(
        &hook,
        "#!/bin/sh\necho 'refused by the server' >&2\nexit 1\n",
    )
    .unwrap();
    let server = gitlab(0, 0).await;
    let id = queue(&c, "Fixed in 9e1d4b7. Backoff doubles.", true);

    let failed = run(&c, &server, &id).await;

    assert!(failed.is_err(), "{failed:?}");
    assert!(sent(&server).await.is_empty(), "nothing reaches GitLab");
    let queued = row(&c, &id);
    assert_eq!(queued.state, "queued");
    assert!(
        queued.error.as_deref().is_some_and(|e| !e.is_empty()),
        "the failure is kept for the Retry state: {:?}",
        queued.error
    );
}

#[tokio::test]
async fn f26_5_a_remote_with_commits_you_dont_have_is_pull_first_and_nothing_is_pushed() {
    let c = author_checkout("f26-5-behind");
    teammate_pushes(&c);
    let tip = remote_tip(&c);
    let server = gitlab(0, 0).await;
    let id = queue(&c, "Fixed in 9e1d4b7. Backoff doubles.", true);

    let outcome = run(&c, &server, &id).await.unwrap();

    assert_eq!(outcome, PushOutcome::PullFirst);
    assert_eq!(remote_tip(&c), tip, "the remote branch is untouched");
    assert!(sent(&server).await.is_empty(), "no reply, no resolve");
    assert_eq!(row(&c, &id).state, "queued");
}

#[tokio::test]
async fn f26_5_a_failed_reply_keeps_it_queued_and_the_retry_sends_it_once() {
    let c = author_checkout("f26-5-reply-fails");
    let server = gitlab(1, 0).await;
    let id = queue(&c, "Fixed in 9e1d4b7. Backoff doubles.", true);

    let first = run(&c, &server, &id).await;

    assert!(first.is_err(), "{first:?}");
    assert_eq!(remote_tip(&c), c.fix, "the push itself went through");
    let queued = row(&c, &id);
    assert_eq!(queued.state, "queued");
    assert!(queued.error.is_some());
    assert!(
        !sent(&server).await.iter().any(|s| s.starts_with("resolve")),
        "a thread is not resolved when the reply failed"
    );

    let retried = run(&c, &server, &id).await.unwrap();
    assert!(matches!(retried, PushOutcome::Done { resolved: true, .. }));
    let requests = sent(&server).await;
    assert_eq!(
        requests.iter().filter(|s| s.starts_with("reply")).count(),
        2,
        "one refused attempt and one that was taken: {requests:?}"
    );
    assert_eq!(
        requests.iter().filter(|s| s.starts_with("resolve")).count(),
        1,
        "{requests:?}"
    );
    assert_eq!(row(&c, &id).state, "sent");
    assert_eq!(row(&c, &id).error, None);
    // A third call has nothing left to send.
    let _ = run(&c, &server, &id).await;
    assert_eq!(sent(&server).await, requests);
}

#[tokio::test]
async fn f26_5_when_only_the_resolve_failed_the_retry_does_not_reply_a_second_time() {
    let c = author_checkout("f26-5-resolve-fails");
    let server = gitlab(0, 1).await;
    let id = queue(&c, "Fixed in 9e1d4b7. Backoff doubles.", true);

    let first = run(&c, &server, &id).await;
    assert!(first.is_err(), "{first:?}");
    assert_eq!(row(&c, &id).state, "queued");

    let retried = run(&c, &server, &id).await.unwrap();

    assert!(matches!(retried, PushOutcome::Done { resolved: true, .. }));
    let requests = sent(&server).await;
    assert_eq!(
        requests.iter().filter(|s| s.starts_with("reply")).count(),
        1,
        "the reply GitLab already took is not sent again: {requests:?}"
    );
    assert_eq!(row(&c, &id).state, "sent");
}

#[tokio::test]
async fn f26_5_a_commit_that_is_not_on_the_remote_branch_is_never_replied_to() {
    let c = author_checkout("f26-5-not-on-remote");
    let server = gitlab(0, 0).await;
    // The queued commit is not in the branch that gets pushed (amended away, reset in Rider).
    let id = queue_for(
        &c,
        "0123456789abcdef0123456789abcdef01234567",
        "Fixed in 0123456. Backoff doubles.",
        true,
    );

    let result = run(&c, &server, &id).await;

    assert!(result.is_err(), "{result:?}");
    assert!(sent(&server).await.is_empty());
    assert_eq!(row(&c, &id).state, "queued");
}

#[tokio::test]
async fn f26_5_a_reply_already_on_the_remote_is_sent_without_a_second_push() {
    let c = author_checkout("f26-5-already-pushed");
    c.repo.git(&["push", "-q", "origin", BRANCH]);
    let tip = remote_tip(&c);
    let server = gitlab(0, 0).await;
    let id = queue(&c, "Fixed in 9e1d4b7. Backoff doubles.", false);

    let outcome = run(&c, &server, &id).await.unwrap();

    assert!(matches!(
        outcome,
        PushOutcome::Done {
            resolved: false,
            ..
        }
    ));
    assert_eq!(remote_tip(&c), tip);
    assert_eq!(
        sent(&server).await,
        ["reply Fixed in 9e1d4b7. Backoff doubles."]
    );
}

/// The pipeline lookup after the push (F-26.6, M7 decision 13) asks for the sha GitLab runs the
/// MR pipeline for: the pushed tip, which is a later commit when one sits on top of the fix.
#[tokio::test]
async fn f26_6_a_later_commit_on_top_of_the_fix_is_the_pushed_sha() {
    let c = author_checkout("f26-6-later-commit");
    c.repo.write(
        "notes.txt",
        "another thread's fixup
",
    );
    let later = c.repo.commit_all("fixup! Add retry loop (another thread)");
    let server = gitlab(0, 0).await;
    let id = queue(&c, "Fixed in 9e1d4b7. Backoff doubles.", true);

    let outcome = run(&c, &server, &id).await.unwrap();

    assert_eq!(remote_tip(&c), later, "HEAD reached origin");
    assert_eq!(
        outcome,
        PushOutcome::Done {
            remote_branch: format!("origin/{BRANCH}"),
            resolved: true,
            pushed_sha: Some(later),
        },
        "the pushed tip, not the thread's own commit"
    );
}

#[tokio::test]
async fn f26_6_a_remote_tip_already_past_the_fix_is_the_pushed_sha_without_a_push() {
    let c = author_checkout("f26-6-already-past");
    c.repo.write(
        "notes.txt",
        "another thread's fixup
",
    );
    let later = c.repo.commit_all("fixup! Add retry loop (another thread)");
    c.repo.git(&["push", "-q", "origin", BRANCH]);
    let server = gitlab(0, 0).await;
    let id = queue(&c, "Fixed in 9e1d4b7. Backoff doubles.", false);

    let outcome = run(&c, &server, &id).await.unwrap();

    assert_ne!(later, c.fix);
    assert!(
        matches!(&outcome, PushOutcome::Done { pushed_sha: Some(sha), .. } if *sha == later),
        "{outcome:?}"
    );
}

#[test]
fn f26_5_queueing_again_replaces_the_open_reply_of_the_thread_and_keeps_its_id() {
    let store = Store::open_in_memory().unwrap();
    let new = |body: &str, resolve: bool| NewQueuedReply {
        project: PROJECT.to_owned(),
        iid: 6,
        discussion: DISCUSSION.to_owned(),
        body: body.to_owned(),
        resolve,
        after_sha: "9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40".to_owned(),
    };

    let first = store
        .with_conn(|conn| queued_replies::queue(conn, &new("Fixed in 9e1d4b7. Draft.", true)))
        .unwrap();
    let second = store
        .with_conn(|conn| queued_replies::queue(conn, &new("Fixed in 9e1d4b7. Final.", false)))
        .unwrap();

    assert_eq!(first.id, second.id);
    let kept = store
        .with_conn(|conn| queued_replies::get(conn, &first.id))
        .unwrap()
        .unwrap();
    assert_eq!(kept.body, "Fixed in 9e1d4b7. Final.");
    assert!(!kept.resolve);
    assert_eq!(kept.state, "queued");
    let pending = store
        .with_conn(|conn| queued_replies::pending_discussions(conn, PROJECT, 6))
        .unwrap();
    assert_eq!(pending.len(), 1);
    assert!(pending.contains(DISCUSSION));
    let other_mr = store
        .with_conn(|conn| queued_replies::pending_discussions(conn, PROJECT, 7))
        .unwrap();
    assert!(other_mr.is_empty());
}

#[tokio::test]
async fn f26_5_a_queued_reply_found_after_a_restart_is_still_queued_and_nothing_sends_it() {
    let c = author_checkout("f26-5-reopen");
    let server = gitlab(0, 0).await;
    let file = c.repo.root.join("gr state ąę.db");
    let id = {
        let store = Store::open(&file).unwrap();
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
                        after_sha: c.fix.clone(),
                    },
                )
            })
            .unwrap()
            .id
    };

    let reopened = Store::open(&file).unwrap();
    let again = reopened
        .with_conn(|conn| queued_replies::get(conn, &id))
        .unwrap()
        .unwrap();
    let pending = reopened
        .with_conn(|conn| queued_replies::pending_discussions(conn, PROJECT, 6))
        .unwrap();

    assert_eq!(again.state, "queued");
    assert_eq!(again.body, "Fixed in 9e1d4b7. Backoff doubles.");
    assert!(pending.contains(DISCUSSION));
    assert!(
        sent(&server).await.is_empty(),
        "reading it back sends nothing (decision 12)"
    );
}
