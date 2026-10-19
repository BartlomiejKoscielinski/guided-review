//! Shared helpers of the F-12.7 tests: sessions of an MR saved the way S-01 saves them, drafts made
//! outside a review and what the stores report about them. Synthetic data only.
#![allow(
    dead_code,
    reason = "each test binary uses a different part of the helper"
)]
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test helper")]

use guided_review_lib::review::drafts::{self, Draft, DraftError, NewMrDraft};
use guided_review_lib::review::finding_model::Severity;
use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::source::{LocalScope, Source};
use guided_review_lib::store::sessions::{self, NewSession};
use guided_review_lib::store::{Store, repos};

pub const PROJECT: &str = "mobile/mobile-app";
pub const OTHER_PROJECT: &str = "mobile/courier-app";

pub fn mr_json(project: &str, iid: u64) -> String {
    serde_json::to_string(&Source::Mr {
        project: project.into(),
        iid,
    })
    .unwrap()
}

pub fn local_json() -> String {
    serde_json::to_string(&Source::Local {
        scope: LocalScope::Uncommitted,
    })
    .unwrap()
}

pub fn store_with_repo() -> (Store, i64) {
    let store = Store::open_in_memory().unwrap();
    let repo = store
        .with_conn(|c| repos::add(c, "mobile-app ąę", r"C:\src\mobile ąę", Some(PROJECT)))
        .unwrap();
    (store, repo.id)
}

/// A session saved the way S-01 saves one, then dated: `created` and `updated` are ISO 8601.
pub fn seed(
    (store, repo): (&Store, i64),
    id: &str,
    source_json: String,
    status: SessionStatus,
    (created, updated): (&str, &str),
) {
    store
        .with_conn(|c| {
            sessions::insert(
                c,
                &NewSession {
                    id: id.into(),
                    repo_id: repo,
                    source_json,
                    base_sha: "a".into(),
                    head_sha: "b".into(),
                    mode: Mode::Focus,
                    layout: Layout::A,
                    status,
                    worktree: None,
                    mr_json: None,
                },
            )?;
            c.execute(
                "UPDATE sessions SET created_at = ?2, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![id, created, updated],
            )?;
            Ok(())
        })
        .unwrap();
}

pub fn question(body: &str) -> NewMrDraft {
    NewMrDraft {
        body: body.into(),
        position: None,
        severity: Some(Severity::Q),
    }
}

pub fn try_attach(
    store: &Store,
    project: &str,
    iid: u64,
    new: &NewMrDraft,
) -> Result<Draft, DraftError> {
    let mut out = None;
    store
        .with_conn(|c| {
            out = Some(drafts::attach_to_mr(c, project, iid, new));
            Ok(())
        })
        .unwrap();
    out.unwrap()
}

pub fn attach(store: &Store, project: &str, iid: u64, body: &str) -> Draft {
    try_attach(store, project, iid, &question(body)).unwrap()
}

pub fn drafts_of(store: &Store, session: &str) -> Vec<Draft> {
    store
        .with_conn(|c| Ok(drafts::list(c, session)))
        .unwrap()
        .unwrap()
}

pub fn session_ids(store: &Store) -> Vec<String> {
    store
        .with_conn(|c| {
            let mut stmt = c.prepare("SELECT id FROM sessions ORDER BY id")?;
            Ok(stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?)
        })
        .unwrap()
}

pub fn count(store: &Store, sql: &str, session: &str) -> i64 {
    store
        .with_conn(|c| Ok(c.query_row(sql, [session], |row| row.get(0))?))
        .unwrap()
}
