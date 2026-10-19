//! F-12.5, M5 decision 10b below the Tauri layer: the MR got a newer version after the review, so
//! Publish moves each ticked line comment to it. A comment whose line text is still there (moved
//! by lines inserted above it) goes out on the latest version's `diff_refs` and line; a comment
//! whose line is gone is outdated (unticked, nothing sent, "the line is no longer in the MR"); an
//! outdated comment the user ticks goes out without a position, its `file:line` quoted. Versions
//! are commits of a fixture repository (synthetic data only, ADR-019); GitLab is wiremock.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::sync::atomic::{AtomicU64, Ordering};

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::draft_notes::{DiffRefs, NotePosition};
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::drafts::{self, NewDraft};
use guided_review_lib::review::finding_model::Side;
use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::review::position::DiffPosition;
use guided_review_lib::review::publish_remap::{self, Repo};
use guided_review_lib::review::publish_session;
use guided_review_lib::review::source_files;
use guided_review_lib::review::step_context::MrRef;
use guided_review_lib::source::model::Source;
use guided_review_lib::store::sessions::{self, NewSession};
use guided_review_lib::store::{Store, repos};
use rusqlite::params;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

/// Paths with spaces and Polish letters, as on the company PC.
const F: &str = "src/App/Zażółć/Upload ViewModel.cs";
const G: &str = "src/Core/Second file.cs";
const PROJECT: &str = "sandbox/gr-sandbox";
const MR: &str = "/api/v4/projects/sandbox%2Fgr-sandbox/merge_requests/6";
const SESSION: &str = "mr-6";
const LINE_GONE: &str = "the line is no longer in the MR";

fn fill(n: usize) -> Vec<String> {
    (1..=n).map(|i| format!("    int f{i};")).collect()
}

fn text(lines: &[String]) -> String {
    lines.join("\n") + "\n"
}

/// base → reviewed (F line 10 replaced, G gains line 5) → latest (12 lines inserted at the top
/// of F, G back to its base text, so it is no longer in the MR).
struct Versions {
    repo: FixtureRepo,
    reviewed: DiffRefs,
    latest: DiffRefs,
}

fn versions() -> Versions {
    let repo = FixtureRepo::new("publish remap");
    repo.write(F, &text(&fill(40)));
    repo.write(G, &text(&fill(10)));
    let base = repo.commit_all("base");
    let mut f = fill(40);
    f[9] = "    Reviewed();".to_owned();
    let mut g = fill(10);
    g.insert(4, "    Gone();".to_owned());
    repo.write(F, &text(&f));
    repo.write(G, &text(&g));
    let reviewed = repo.commit_all("reviewed");
    let mut moved: Vec<String> = (1..=12).map(|i| format!("    // new {i}")).collect();
    moved.extend(f);
    repo.write(F, &text(&moved));
    repo.write(G, &text(&fill(10)));
    let latest = repo.commit_all("latest");
    let refs = |head: &str| DiffRefs {
        base_sha: base.clone(),
        start_sha: base.clone(),
        head_sha: head.to_owned(),
    };
    Versions {
        reviewed: refs(&reviewed),
        latest: refs(&latest),
        repo,
    }
}

fn repo_of(v: &Versions) -> Repo {
    Repo {
        git: Git::new(None, v.repo.file("")),
        source: Source::Mr {
            project: PROJECT.into(),
            iid: 6,
        },
    }
}

fn at(file: &str, side: Side, line: u32) -> DiffPosition {
    DiffPosition {
        file: file.into(),
        side,
        line,
    }
}

fn store(v: &Versions) -> Store {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            let path = v.repo.file("");
            let repo = repos::add(c, "mobile ąę", path.to_str().unwrap(), Some(PROJECT)).unwrap();
            sessions::insert(
                c,
                &NewSession {
                    id: SESSION.into(),
                    repo_id: repo.id,
                    source_json: format!(r#"{{"kind":"mr","project":"{PROJECT}","iid":6}}"#),
                    base_sha: v.reviewed.base_sha.clone(),
                    head_sha: v.reviewed.head_sha.clone(),
                    mode: Mode::Focus,
                    layout: Layout::A,
                    status: SessionStatus::Reviewing,
                    worktree: None,
                    mr_json: None,
                },
            )
            .unwrap();
            Ok(())
        })
        .unwrap();
    store
}

fn draft(store: &Store, body: &str, position: Option<DiffPosition>) -> String {
    store
        .with_conn(|c| {
            Ok(drafts::create(
                c,
                &NewDraft {
                    session_id: SESSION.into(),
                    finding_id: None,
                    body: body.into(),
                    position,
                    severity: None,
                },
            )
            .unwrap()
            .id)
        })
        .unwrap()
}

/// (outdated, include, error) of a draft.
fn row(store: &Store, id: &str) -> (bool, bool, Option<String>) {
    store
        .with_conn(|c| {
            Ok(c.query_row(
                "SELECT outdated, include, error FROM drafts WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?)
        })
        .unwrap()
}

async fn reviewed_files(v: &Versions) -> Vec<guided_review_lib::git::model::FileDiff> {
    source_files::range(
        &repo_of(v).git,
        &v.reviewed.base_sha,
        &v.reviewed.head_sha,
        &Cancel::new(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn f12_5_remap_moves_a_line_with_its_text_and_outdates_a_line_that_is_gone() {
    let v = versions();
    let store = store(&v);
    let added = draft(&store, "Why here?", Some(at(F, Side::New, 10)));
    let removed = draft(&store, "Was this needed?", Some(at(F, Side::Old, 10)));
    let gone = draft(&store, "Gone?", Some(at(G, Side::New, 5)));
    let general = draft(&store, "Thanks.", None);
    let all = store
        .with_conn(|c| Ok(drafts::list(c, SESSION)))
        .unwrap()
        .unwrap();
    let ids = vec![gone.clone(), added.clone(), removed.clone(), general];

    let files = reviewed_files(&v).await;
    let out = publish_remap::remap(
        &repo_of(&v),
        &all,
        &ids,
        &files,
        &v.reviewed,
        &v.latest,
        &Cancel::new(),
    )
    .await
    .expect("both versions are in the repository");

    assert_eq!(out.outdated, vec![gone]);
    assert_eq!(
        out.moved.positions.get(&added),
        Some(&NotePosition {
            old_path: F.into(),
            new_path: F.into(),
            old_line: None,
            new_line: Some(22),
        }),
        "the added line moved down by the 12 lines inserted above it"
    );
    assert_eq!(
        out.moved.positions.get(&removed),
        Some(&NotePosition {
            old_path: F.into(),
            new_path: F.into(),
            old_line: Some(10),
            new_line: None,
        }),
        "the removed line is still removed in the latest version"
    );
    assert_eq!(
        out.moved.positions.len(),
        2,
        "a comment on the MR has no line"
    );
}

#[tokio::test]
async fn f12_5_remap_without_a_readable_version_leaves_the_comments_on_the_reviewed_one() {
    let v = versions();
    let store = store(&v);
    let id = draft(&store, "Why here?", Some(at(F, Side::New, 10)));
    let all = store
        .with_conn(|c| Ok(drafts::list(c, SESSION)))
        .unwrap()
        .unwrap();
    let mut missing = v.latest.clone();
    missing.head_sha = "0123456789abcdef0123456789abcdef01234567".into();

    let out = publish_remap::remap(
        &repo_of(&v),
        &all,
        &[id],
        &reviewed_files(&v).await,
        &v.reviewed,
        &missing,
        &Cancel::new(),
    )
    .await;

    assert_eq!(
        out, None,
        "no remote to fetch it from: no re-map, nothing outdated"
    );
}

/// GitLab's draft notes: numbered from 700.
struct Notes(AtomicU64);

impl Respond for Notes {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
        let id = self.0.fetch_add(1, Ordering::SeqCst);
        ResponseTemplate::new(201).set_body_json(json!({
            "id": id, "author_id": 2, "merge_request_id": 60, "note": body["note"],
            "commit_id": null, "line_code": null, "resolve_discussion": false,
            "discussion_id": null, "position": body.get("position").cloned().unwrap_or(Value::Null)
        }))
    }
}

async fn gitlab(v: &Versions) -> MockServer {
    let server = MockServer::start().await;
    let version = |id: u64, refs: &DiffRefs| {
        json!({ "id": id, "head_commit_sha": refs.head_sha, "base_commit_sha": refs.base_sha,
                "start_commit_sha": refs.start_sha, "created_at": "2026-10-01T10:00:00Z",
                "merge_request_id": 60, "state": "collected", "real_size": "2" })
    };
    Mock::given(method("GET"))
        .and(path(format!("{MR}/versions")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!([version(2, &v.latest), version(1, &v.reviewed)])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes")))
        .respond_with(Notes(AtomicU64::new(700)))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{MR}/draft_notes/bulk_publish")))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    server
}

async fn created(server: &MockServer) -> Vec<Value> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.method.as_str() == "POST" && r.url.path() == format!("{MR}/draft_notes"))
        .map(|r| serde_json::from_slice(&r.body).unwrap())
        .collect()
}

fn client(uri: &str) -> GitlabClient {
    let token = ["glpat", "remap0000"].join("-");
    GitlabClient::new(uri, &Token::new(&token).unwrap(), TlsBackend::Platform).unwrap()
}

#[tokio::test]
async fn f12_5_publish_on_a_newer_version_moves_lines_holds_the_outdated_and_quotes_a_ticked_one() {
    let v = versions();
    let store = store(&v);
    let added = draft(&store, "Why here?", Some(at(F, Side::New, 10)));
    let gone = draft(&store, "Gone?", Some(at(G, Side::New, 5)));
    // Outdated by an earlier Publish and ticked again by the user.
    let ticked = draft(&store, "Still unclear.", Some(at(G, Side::New, 5)));
    store
        .with_conn(|c| {
            c.execute(
                "UPDATE drafts SET outdated = 1 WHERE id = ?1",
                params![ticked],
            )?;
            Ok(())
        })
        .unwrap();
    let server = gitlab(&v).await;
    let mr = MrRef {
        project: PROJECT.into(),
        iid: 6,
    };
    let files = reviewed_files(&v).await;
    let ids = vec![added.clone(), gone.clone(), ticked.clone()];
    let repo = repo_of(&v);

    let outcome = publish_session::publish_in(
        &client(&server.uri()),
        &store,
        SESSION,
        &mr,
        &ids,
        None,
        || async { Ok(files) },
        Some(&repo),
    )
    .await
    .unwrap();

    assert_eq!(outcome.published, vec![added.clone(), ticked.clone()]);
    assert_eq!(outcome.failed.len(), 1);
    assert_eq!(outcome.failed[0].id, gone);
    assert_eq!(outcome.failed[0].reason, LINE_GONE);
    assert_eq!(
        row(&store, &gone),
        (true, false, Some(LINE_GONE.to_owned())),
        "outdated and unticked"
    );

    let made = created(&server).await;
    assert_eq!(made.len(), 2, "nothing is sent for the outdated draft");
    let position = &made[0]["position"];
    assert_eq!(made[0]["note"], "Why here?");
    assert_eq!(position["head_sha"], v.latest.head_sha.as_str());
    assert_eq!(position["base_sha"], v.latest.base_sha.as_str());
    assert_eq!(position["new_line"], 22);
    assert_eq!(made[1]["note"], format!("`{G}:5`\n\nStill unclear."));
    assert!(made[1].get("position").is_none_or(Value::is_null));
}

#[tokio::test]
async fn f12_5_publish_without_the_repository_keeps_the_reviewed_version() {
    let v = versions();
    let store = store(&v);
    let added = draft(&store, "Why here?", Some(at(F, Side::New, 10)));
    let server = gitlab(&v).await;
    let mr = MrRef {
        project: PROJECT.into(),
        iid: 6,
    };
    let files = reviewed_files(&v).await;

    let outcome = publish_session::publish(
        &client(&server.uri()),
        &store,
        SESSION,
        &mr,
        std::slice::from_ref(&added),
        None,
        || async { Ok(files) },
    )
    .await
    .unwrap();

    assert_eq!(outcome.published, vec![added]);
    let made = created(&server).await;
    assert_eq!(
        made[0]["position"]["head_sha"],
        v.reviewed.head_sha.as_str()
    );
    assert_eq!(made[0]["position"]["new_line"], 10);
}
