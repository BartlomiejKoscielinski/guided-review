//! F-12.7, M5 decision 15: Publish on S-05's "drafts only" state goes out through the session's
//! own path. A drafts-only session has no plan, no worktree, no reviewed head and often no repo on
//! this PC, so its Publish never reads a diff: its comments on the MR go out on the MR's latest
//! version, and a line comment is held with a reason naming the way out. The drafts are made
//! through `attach_to_mr`, the path S-08 and S-12 use; the diff is read by the loader `drafts_publish`
//! uses, so a Publish that asked for it would fail.

#![allow(clippy::unwrap_used, reason = "tests")]

#[path = "support/mr_drafts.rs"]
mod mr_drafts;

use std::cell::Cell;

use guided_review_lib::error::AppResult;
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::drafts::NewMrDraft;
use guided_review_lib::review::finding_model::Side;
use guided_review_lib::review::position::DiffPosition;
use guided_review_lib::review::publish::{NEEDS_REVIEW, PublishFailure, PublishOutcome};
use guided_review_lib::review::publish_session;
use guided_review_lib::review::step_context::{self, MrRef};
use guided_review_lib::store::Store;
use mr_drafts::{OTHER_PROJECT, PROJECT, attach, drafts_of, store_with_repo, try_attach};
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn client(uri: &str) -> GitlabClient {
    // Built at run time: a token-shaped literal would trip the push protection.
    let token = format!("{}-{}", "glpat", "wiremock-drafts");
    GitlabClient::new(uri, &Token::new(&token).unwrap(), TlsBackend::Platform).unwrap()
}

fn mr_path(project: &str) -> String {
    format!(
        "/api/v4/projects/{}/merge_requests/482",
        project.replace('/', "%2F")
    )
}

/// GitLab's side of the MR: two versions (the newest listed first, as GitLab does), draft notes
/// numbered from 700, and `bulk_publish`.
async fn serve(server: &MockServer, project: &str) {
    let mr = mr_path(project);
    Mock::given(method("GET"))
        .and(path(format!("{mr}/versions")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            { "id": 12, "head_commit_sha": "4ead02", "base_commit_sha": "ba5e00",
              "start_commit_sha": "57a400", "state": "collected" },
            { "id": 11, "head_commit_sha": "4ead01", "base_commit_sha": "ba5e00",
              "start_commit_sha": "57a400", "state": "collected" }
        ])))
        .mount(server)
        .await;
    let next = std::sync::atomic::AtomicU64::new(700);
    Mock::given(method("POST"))
        .and(path(format!("{mr}/draft_notes")))
        .respond_with(move |request: &Request| {
            let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
            let id = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            ResponseTemplate::new(201).set_body_json(json!({
                "id": id, "author_id": 2, "merge_request_id": 60, "note": body["note"],
                "commit_id": null, "line_code": null, "resolve_discussion": false,
                "discussion_id": null, "position": body.get("position").cloned().unwrap_or(Value::Null)
            }))
        })
        .mount(server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{mr}/draft_notes/bulk_publish")))
        .respond_with(ResponseTemplate::new(204))
        .mount(server)
        .await;
}

/// `drafts_publish` on `session`, with the diff loader the command uses (the session's diff read
/// from git); `asked` tells whether the diff was asked for.
async fn publish(
    store: &Store,
    server: &MockServer,
    session: &str,
    project: &str,
    ids: &[String],
    summary: Option<&str>,
    asked: &Cell<bool>,
) -> AppResult<PublishOutcome> {
    let mr = MrRef {
        project: project.into(),
        iid: 482,
    };
    let files = || {
        asked.set(true);
        async move {
            let no_threads = |_| async { Vec::new() };
            let inputs =
                step_context::load_inputs(store, None, session, no_threads, &Cancel::new()).await?;
            AppResult::<Vec<FileDiff>>::Ok(inputs.files)
        }
    };
    publish_session::publish(
        &client(&server.uri()),
        store,
        session,
        &mr,
        ids,
        summary,
        files,
    )
    .await
}

async fn received(server: &MockServer) -> Vec<(String, String, Value)> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| {
            let body = serde_json::from_slice(&r.body).unwrap_or(Value::Null);
            (r.method.to_string(), r.url.path().to_owned(), body)
        })
        .collect()
}

#[tokio::test]
async fn f12_7_publish_on_a_drafts_only_session_sends_its_comments_on_the_mr_without_a_diff() {
    let (store, _) = store_with_repo();
    let server = MockServer::start().await;
    serve(&server, PROJECT).await;
    // Explain failure (a comment on the MR), Add as a question on a line, another comment.
    let failure = attach(
        &store,
        PROJECT,
        482,
        "The build fails in the keystore step.",
    );
    let on_line = try_attach(
        &store,
        PROJECT,
        482,
        &NewMrDraft {
            body: "Is this awaited?".into(),
            position: Some(DiffPosition {
                file: "src/App/Zażółć/Upload ViewModel.cs".into(),
                side: Side::New,
                line: 41,
            }),
            severity: None,
        },
    )
    .unwrap();
    let question = attach(&store, PROJECT, 482, "Do other callers rely on this?");
    let session = failure.session_id.clone();
    assert_eq!(
        (on_line.session_id.as_str(), question.session_id.as_str()),
        (session.as_str(), session.as_str()),
        "set up: one drafts-only session"
    );
    let ids = [&failure, &on_line, &question].map(|d| d.id.clone());
    let asked = Cell::new(false);

    let outcome = publish(
        &store,
        &server,
        &session,
        PROJECT,
        &ids,
        Some("Thanks, two questions."),
        &asked,
    )
    .await
    .unwrap();

    assert!(!asked.get(), "a drafts-only session has no diff to read");
    assert_eq!(
        outcome,
        PublishOutcome {
            published: vec![failure.id.clone(), question.id.clone()],
            summary: true,
            failed: vec![PublishFailure {
                id: on_line.id.clone(),
                reason: NEEDS_REVIEW.into(),
            }],
            summary_failed: None,
        }
    );
    let mr = mr_path(PROJECT);
    let notes: Vec<Value> = received(&server)
        .await
        .into_iter()
        .filter(|(m, p, _)| m == "POST" && *p == format!("{mr}/draft_notes"))
        .map(|(_, _, body)| body)
        .collect();
    assert_eq!(
        notes
            .iter()
            .map(|n| (n["note"].as_str().unwrap(), n.get("position").is_some()))
            .collect::<Vec<_>>(),
        [
            ("The build fails in the keystore step.", false),
            ("Do other callers rely on this?", false),
            ("Thanks, two questions.", false),
        ],
        "the comments and the summary, on the MR, in the list's order; the line comment held"
    );
    let kept = drafts_of(&store, &session);
    let held = kept.iter().find(|d| d.id == on_line.id).unwrap();
    assert_eq!(
        (held.published_note_id, held.error.as_deref()),
        (None, Some(NEEDS_REVIEW)),
        "the line comment stays unpublished with its reason, for Retry or a review"
    );
    assert!(
        kept.iter()
            .filter(|d| d.id != on_line.id)
            .all(|d| d.published_note_id.is_some()),
        "the comments are published"
    );
}

#[tokio::test]
async fn f12_7_publish_on_a_drafts_only_session_of_a_project_without_a_repo_on_this_pc() {
    let (store, _) = store_with_repo();
    let server = MockServer::start().await;
    serve(&server, OTHER_PROJECT).await;
    let draft = attach(&store, OTHER_PROJECT, 482, "The deploy job is flaky.");
    let asked = Cell::new(false);

    let outcome = publish(
        &store,
        &server,
        &draft.session_id,
        OTHER_PROJECT,
        std::slice::from_ref(&draft.id),
        None,
        &asked,
    )
    .await
    .unwrap();

    assert!(!asked.get());
    assert_eq!(outcome.published, std::slice::from_ref(&draft.id));
    assert!(outcome.failed.is_empty(), "{:?}", outcome.failed);
    let bulk = format!("{}/draft_notes/bulk_publish", mr_path(OTHER_PROJECT));
    assert_eq!(
        received(&server)
            .await
            .iter()
            .filter(|(m, p, _)| m == "POST" && *p == bulk)
            .count(),
        1,
        "one batch, one notification for the author"
    );
}
