//! Opening a teammate's MR (F-01.3, F-01.5, M2 decision 7): wiremock stands in for GitLab,
//! a fixture bare origin holds the MR head. Synthetic data only.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::git::Git;
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::mrs::PipelineState;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::review::mr_summary::{MrMeta, session_mr};
use guided_review_lib::review::open_mr::{
    OpenMr, OpenMrError, SessionDefaults, open_mr, resolve_repo,
};
use guided_review_lib::review::prepare::worktree_path;
use guided_review_lib::route::Route;
use guided_review_lib::source::Source;
use guided_review_lib::store::repos::{self, RepoRow};
use guided_review_lib::store::{Store, sessions};
use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const PROJECT: &str = "mobile/mobile-app";
const DEFAULTS: SessionDefaults = SessionDefaults {
    mode: Mode::Focus,
    layout: Layout::A,
};

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

async fn mr_answer(server: &MockServer, iid: u64, status: u16, body: serde_json::Value) {
    Mock::given(method("GET"))
        .and(path(format!(
            "/api/v4/projects/mobile%2Fmobile-app/merge_requests/{iid}"
        )))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .expect(1)
        .mount(server)
        .await;
}

fn repo_row(store: &Store, repo: &FixtureRepo, name: &str, project: &str) -> RepoRow {
    let path = repo.path.to_string_lossy().into_owned();
    let mut row = store
        .with_conn(|c| repos::add(c, name, &path, Some(project)))
        .unwrap();
    row.worktree_root = Some(repo.root.join("wt ąę").to_string_lossy().into_owned());
    row
}

#[tokio::test]
async fn f01_3_session_mr_prepares_and_opens_a_planning_session_on_s02() {
    let repo = FixtureRepo::new("open mr");
    repo.write("src/App/MauiProgram.cs", "base\n");
    repo.commit_all("Base");
    let head = repo.add_mr_on_origin(482, &[("src/App/Views/Torch.xaml", "<Grid />\n")]);
    let store = Store::open_in_memory().unwrap();
    let row = repo_row(&store, &repo, "mobile-app", PROJECT);
    let server = MockServer::start().await;
    mr_answer(
        &server,
        482,
        200,
        json!({ "iid": 482, "title": "Torch ąę", "source_branch": "feature/torch",
                "target_branch": "main", "sha": head, "state": "opened" }),
    )
    .await;

    let client = client(&server);
    let ctx = OpenMr {
        client: &client,
        store: &store,
        git_program: None,
        repo: &row,
        project: PROJECT,
        iid: 482,
        defaults: DEFAULTS,
    };
    let opened = open_mr(&ctx, &|_| {}, &Cancel::new()).await.unwrap();

    assert_eq!(
        opened.route,
        Route::Plan {
            session_id: opened.session_id.clone()
        }
    );
    let saved = store
        .with_conn(|c| sessions::source_of(c, &opened.session_id))
        .unwrap()
        .unwrap();
    assert_eq!(saved.status, Some(SessionStatus::Planning));
    assert_eq!(saved.head_sha, head);
    assert_eq!(saved.base_sha, repo.git(&["rev-parse", "main"]).trim());
    let source: Source = serde_json::from_str(&saved.source_json).unwrap();
    assert_eq!(
        source,
        Source::Mr {
            project: PROJECT.into(),
            iid: 482
        }
    );
    assert_eq!(
        saved.worktree,
        Some(worktree_path(&row, 482).to_string_lossy().into_owned())
    );
}

#[tokio::test]
async fn f01_5_unknown_mr_gives_the_inline_copy_and_prepares_nothing() {
    let repo = FixtureRepo::new("open mr 404");
    repo.commit_all("Base");
    let store = Store::open_in_memory().unwrap();
    let row = repo_row(&store, &repo, "mobile-app", PROJECT);
    let server = MockServer::start().await;
    mr_answer(&server, 999, 404, json!({ "message": "404 Not found" })).await;

    let client = client(&server);
    let ctx = OpenMr {
        client: &client,
        store: &store,
        git_program: None,
        repo: &row,
        project: PROJECT,
        iid: 999,
        defaults: DEFAULTS,
    };
    let error = open_mr(&ctx, &|_| panic!("no preparation"), &Cancel::new())
        .await
        .unwrap_err();
    assert!(matches!(error, OpenMrError::NotFound { iid: 999, .. }));
    let app: AppError = error.into();
    assert_eq!(app.code, ErrorCode::GitlabNotFound);
    assert_eq!(app.message, "No merge request !999 in mobile/mobile-app");
    assert!(!worktree_path(&row, 999).exists());
}

#[test]
fn f01_5_mr_of_a_project_without_a_repository_is_rejected() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| repos::add(c, "mobile-app", r"C:\src\mobile-app", Some(PROJECT)))
        .unwrap();
    let error = store
        .with_conn(|c| Ok(resolve_repo(c, Some("mobile/x")).unwrap_err()))
        .unwrap();
    let app: AppError = error.into();
    assert_eq!(app.code, ErrorCode::InvalidInput);
    assert_eq!(
        app.message,
        "mobile/x is not one of your repositories. Add it in Settings › GitLab."
    );
}

#[test]
fn f01_3_session_mr_of_another_repository_switches_the_active_one() {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            let first = repos::add(c, "mobile-app", r"C:\src\mobile-app", Some(PROJECT))?;
            let other = repos::add(
                c,
                "backend ąę",
                r"C:\src\backend ąę",
                Some("mobile/backend"),
            )?;
            assert_eq!(repos::active(c)?.unwrap().id, first.id);

            let (repo, project) = resolve_repo(c, Some("Mobile/Backend")).unwrap();
            assert_eq!(repo.id, other.id);
            assert_eq!(project, "mobile/backend");
            assert_eq!(repos::active(c)?.unwrap().id, other.id);

            let (repo, project) = resolve_repo(c, None).unwrap();
            assert_eq!((repo.id, project.as_str()), (other.id, "mobile/backend"));
            Ok(())
        })
        .unwrap();
}

#[tokio::test]
async fn f24_1_mr_session_keeps_the_header_and_lists_the_mr_files() {
    let repo = FixtureRepo::new("open mr browse");
    repo.write("src/App/MauiProgram.cs", "base\n");
    repo.commit_all("Base");
    let head = repo.add_mr_on_origin(
        483,
        &[
            ("src/App/Views/Torch ąę.xaml", "<Grid />\n"),
            ("src/App/MauiProgram.cs", "base\nmore\n"),
        ],
    );
    let store = Store::open_in_memory().unwrap();
    let row = repo_row(&store, &repo, "mobile-app", PROJECT);
    let server = MockServer::start().await;
    mr_answer(
        &server,
        483,
        200,
        json!({ "iid": 483, "title": "Torch browse", "source_branch": "feature/torch",
                "target_branch": "main", "sha": head, "state": "opened",
                "author": { "name": "Marta K." }, "created_at": "2026-10-12T08:00:00Z",
                "head_pipeline": { "status": "failed" } }),
    )
    .await;
    let client = client(&server);
    let ctx = OpenMr {
        client: &client,
        store: &store,
        git_program: None,
        repo: &row,
        project: PROJECT,
        iid: 483,
        defaults: DEFAULTS,
    };
    let opened = open_mr(&ctx, &|_| {}, &Cancel::new()).await.unwrap();

    let saved = store
        .with_conn(|c| sessions::source_of(c, &opened.session_id))
        .unwrap()
        .unwrap();
    let mr: MrMeta = serde_json::from_str(saved.mr_json.as_deref().unwrap()).unwrap();
    assert_eq!(mr.title, "Torch browse");
    assert_eq!(mr.author, "Marta K.");
    assert_eq!(mr.pipeline, Some(PipelineState::Failed));
    let git = Git::new(None, &repo.path);
    let summary = session_mr(&git, mr, &saved.base_sha, &saved.head_sha, &Cancel::new())
        .await
        .unwrap();
    assert_eq!(summary.total_files, 2);
    assert_eq!(summary.additions, 2);
    assert_eq!(summary.deletions, 0);
    assert!(summary.commits >= 1);
    let paths: Vec<&str> = summary
        .groups
        .iter()
        .flat_map(|g| g.files.iter().map(|f| f.path.as_str()))
        .collect();
    assert!(paths.contains(&"src/App/Views/Torch ąę.xaml"), "{paths:?}");
}
