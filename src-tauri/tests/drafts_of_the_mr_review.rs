//! Drafts belong to the MR (F-12.7, M5 decision 15): opening a review of an MR moves the
//! unpublished drafts of that MR's older sessions, drafts-only ones included, into the new session;
//! published drafts and the drafts of other MRs stay. wiremock stands in for GitLab and a fixture
//! bare origin holds the MR head, as in `open_mr.rs`. Synthetic data only.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::drafts::{self, Draft, DraftPatch, NewDraft, NewMrDraft};
use guided_review_lib::review::finding_model::{Severity, Side};
use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::review::open_mr::{OpenMr, OpenMrError, SessionDefaults, open_mr};
use guided_review_lib::review::position::DiffPosition;
use guided_review_lib::source::Source;
use guided_review_lib::store::repos::{self, RepoRow};
use guided_review_lib::store::sessions::{self, NewSession};
use guided_review_lib::store::{self, Store};
use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// A fake token built at run time (push protection blocks glpat- followed by 20 characters).
fn token_text() -> String {
    format!("{}-{}", "glpat", "wiremock0000000")
}
const PROJECT: &str = "mobile/mobile-app";
const OTHER_PROJECT: &str = "mobile/courier-app";
const DEFAULTS: SessionDefaults = SessionDefaults {
    mode: Mode::Focus,
    layout: Layout::A,
};

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(&token_text()).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

async fn mr_answer(server: &MockServer, iid: u64, status: u16, body: serde_json::Value) {
    Mock::given(method("GET"))
        .and(path(format!(
            "/api/v4/projects/mobile%2Fmobile-app/merge_requests/{iid}"
        )))
        .and(header("PRIVATE-TOKEN", token_text().as_str()))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .expect(1)
        .mount(server)
        .await;
}

fn repo_row(store: &Store, repo: &FixtureRepo) -> RepoRow {
    let path = repo.path.to_string_lossy().into_owned();
    let mut row = store
        .with_conn(|c| repos::add(c, "mobile-app", &path, Some(PROJECT)))
        .unwrap();
    row.worktree_root = Some(repo.root.join("wt ąę").to_string_lossy().into_owned());
    row
}

/// A review session saved earlier, dated `updated`.
fn earlier_session(
    store: &Store,
    repo: &RepoRow,
    id: &str,
    project: &str,
    iid: u64,
    updated: &str,
) {
    let source = Source::Mr {
        project: project.into(),
        iid,
    };
    store
        .with_conn(|c| {
            sessions::insert(
                c,
                &NewSession {
                    id: id.into(),
                    repo_id: repo.id,
                    source_json: serde_json::to_string(&source).unwrap(),
                    base_sha: "a".into(),
                    head_sha: "b".into(),
                    mode: Mode::Focus,
                    layout: Layout::A,
                    status: SessionStatus::Reviewing,
                    worktree: None,
                    mr_json: None,
                },
            )?;
            c.execute(
                "UPDATE sessions SET created_at = ?2, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![id, updated],
            )?;
            Ok(())
        })
        .unwrap();
}

fn draft_in(store: &Store, session: &str, body: &str, step: Option<&str>) -> Draft {
    let new = NewDraft {
        session_id: session.into(),
        finding_id: None,
        body: body.into(),
        position: step.map(|_| DiffPosition {
            file: "src/App/Zażółć/Upload ViewModel.cs".into(),
            side: Side::New,
            line: 41,
        }),
        severity: Some(Severity::Fix),
    };
    store
        .with_conn(|c| Ok(drafts::create_at(c, &new, step.map(str::to_owned))))
        .unwrap()
        .unwrap()
}

fn drafts_of(store: &Store, session: &str) -> Vec<Draft> {
    store
        .with_conn(|c| Ok(drafts::list(c, session)))
        .unwrap()
        .unwrap()
}

async fn open(
    store: &Store,
    row: &RepoRow,
    server: &MockServer,
    iid: u64,
) -> Result<String, OpenMrError> {
    let client = client(server);
    let ctx = OpenMr {
        client: &client,
        store,
        git_program: None,
        repo: row,
        project: PROJECT,
        iid,
        defaults: DEFAULTS,
    };
    open_mr(&ctx, &|_| {}, &Cancel::new())
        .await
        .map(|opened| opened.session_id)
}

/// A draft from outside a review (Explain failure, Add as a question) on !482.
fn attach(store: &Store, body: &str) -> Draft {
    let new = NewMrDraft {
        body: body.into(),
        position: None,
        severity: Some(Severity::Q),
    };
    store
        .with_conn(|c| Ok(drafts::attach_to_mr(c, PROJECT, 482, &new)))
        .unwrap()
        .unwrap()
}

async fn serve_mr(server: &MockServer, iid: u64, head: &str) {
    mr_answer(
        server,
        iid,
        200,
        json!({ "iid": iid, "title": "Torch ąę", "source_branch": "feature/torch",
                "target_branch": "main", "sha": head, "state": "opened" }),
    )
    .await;
}

#[tokio::test]
async fn f12_7_opening_a_review_moves_the_drafts_of_the_mrs_drafts_only_session_into_it() {
    let repo = FixtureRepo::new("drafts mr only");
    repo.write("src/App/MauiProgram.cs", "base\n");
    repo.commit_all("Base");
    let head = repo.add_mr_on_origin(482, &[("src/App/Views/Torch.xaml", "<Grid />\n")]);
    let store = Store::open_in_memory().unwrap();
    let row = repo_row(&store, &repo);
    let server = MockServer::start().await;
    serve_mr(&server, 482, &head).await;
    // Two drafts from outside a review (Explain failure, Add as a question), nothing else of !482.
    let first = attach(&store, "Why did the build fail?");
    let second = attach(&store, "Is the keystore set?");
    let drafts_only = first.session_id.clone();
    assert_eq!(second.session_id, drafts_only);

    let opened = open(&store, &row, &server, 482).await.unwrap();

    assert_ne!(opened, drafts_only);
    assert_eq!(
        drafts_of(&store, &opened),
        [first, second],
        "the same drafts, same order, now in the new session"
    );
    assert!(drafts_of(&store, &drafts_only).is_empty());
    // "Pick up" lists the review, not the emptied drafts-only session; the card counts the drafts.
    let listed = store.with_conn(|c| store::unfinished_sessions(c)).unwrap();
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(
        (listed[0].id.as_str(), listed[0].drafts),
        (opened.as_str(), 2)
    );
    // A draft added from S-08 afterwards joins the new review: it is the latest session of the MR.
    let later = attach(&store, "Unrelated to this MR?");
    assert_eq!(later.session_id, opened);
}

#[tokio::test]
async fn f12_7_opening_a_review_moves_only_the_unpublished_drafts_of_older_sessions_of_the_same_mr()
{
    let repo = FixtureRepo::new("drafts mr move");
    repo.write("src/App/MauiProgram.cs", "base\n");
    repo.commit_all("Base");
    let head = repo.add_mr_on_origin(482, &[("src/App/Views/Torch.xaml", "<Grid />\n")]);
    let store = Store::open_in_memory().unwrap();
    let row = repo_row(&store, &repo);
    let server = MockServer::start().await;
    serve_mr(&server, 482, &head).await;
    // Sessions first, then their drafts: two earlier reviews of !482, one of !483, one of !482 in
    // another project.
    earlier_session(&store, &row, "r1", PROJECT, 482, "2026-10-01T09:00:00Z");
    earlier_session(&store, &row, "r2", PROJECT, 482, "2026-10-05T09:00:00Z");
    earlier_session(&store, &row, "o483", PROJECT, 483, "2026-10-06T09:00:00Z");
    earlier_session(
        &store,
        &row,
        "o-project",
        OTHER_PROJECT,
        482,
        "2026-10-07T09:00:00Z",
    );
    let unticked = draft_in(&store, "r1", "Should be awaited.", Some("s2"));
    store
        .with_conn(|c| {
            Ok(drafts::update(
                c,
                &unticked.id,
                &DraftPatch {
                    body: None,
                    include: Some(false),
                },
            ))
        })
        .unwrap()
        .unwrap();
    let published = draft_in(&store, "r1", "Already on GitLab.", None);
    store
        .with_conn(|c| {
            // What Publish records on a draft; the GitLab call is not needed for this rule.
            c.execute(
                "UPDATE drafts SET published_note_id = 9001 WHERE id = ?1",
                [&published.id],
            )?;
            Ok(())
        })
        .unwrap();
    let third = draft_in(&store, "r2", "A newer question.", None);
    let other_iid = draft_in(&store, "o483", "Belongs to !483.", None);
    let other_project = draft_in(&store, "o-project", "Belongs to the other project.", None);
    let moved_before = [
        store
            .with_conn(|c| Ok(drafts::get(c, &unticked.id)))
            .unwrap()
            .unwrap(),
        third.clone(),
    ];
    assert_eq!(
        moved_before[0].step_id.as_deref(),
        Some("s2"),
        "set up with a step"
    );
    assert!(!moved_before[0].include, "set up unticked");

    let opened = open(&store, &row, &server, 482).await.unwrap();

    // The unpublished drafts of both older sessions are in the new one: moved, not copied or
    // rewritten (ID, text, position, severity, tick and step stay), in the order they were made.
    assert_eq!(
        drafts_of(&store, &opened),
        moved_before.map(|d| Draft {
            session_id: opened.clone(),
            ..d
        })
    );
    assert!(drafts_of(&store, "r2").is_empty());
    // The published draft stays where it was published from; other MRs are untouched.
    let kept = drafts_of(&store, "r1");
    assert_eq!(kept.len(), 1);
    assert_eq!(
        (kept[0].id.as_str(), kept[0].published_note_id),
        (published.id.as_str(), Some(9001))
    );
    assert_eq!(drafts_of(&store, "o483"), [other_iid]);
    assert_eq!(drafts_of(&store, "o-project"), [other_project]);
}

#[tokio::test]
async fn f12_7_a_review_that_could_not_be_opened_moves_no_drafts() {
    // A guard: it holds before F-12.7 too. It fails when the move happens before the session exists.
    let repo = FixtureRepo::new("drafts mr 404");
    repo.commit_all("Base");
    let store = Store::open_in_memory().unwrap();
    let row = repo_row(&store, &repo);
    let server = MockServer::start().await;
    mr_answer(&server, 999, 404, json!({ "message": "404 Not found" })).await;
    earlier_session(&store, &row, "r1", PROJECT, 999, "2026-10-01T09:00:00Z");
    let draft = draft_in(&store, "r1", "Stays put.", None);

    let error = open(&store, &row, &server, 999).await.unwrap_err();

    assert!(matches!(error, OpenMrError::NotFound { iid: 999, .. }));
    let app: AppError = error.into();
    assert_eq!(app.code, ErrorCode::GitlabNotFound);
    assert_eq!(drafts_of(&store, "r1"), [draft]);
}
