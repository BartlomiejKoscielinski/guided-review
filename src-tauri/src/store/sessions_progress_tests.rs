//! F-04.1 "Pick up where you left off": the unfinished sessions with their progress
//! ("5 of 9 steps · 3 drafts", "Self-review · 2 of 6 steps · …"). The labels are drawn by the UI
//! from these numbers, so the core is tested for the numbers, the order and what is hidden.

use super::*;
use crate::review::drafts::{self, NewDraft};
use crate::review::layer::Layer;
use crate::review::mr_summary::MrMeta;
use crate::review::plan_cache::{self, CacheKey, TaskSettings};
use crate::review::plan_model::{Coverage, Orders, Plan, Step};
use crate::review::progress;
use crate::settings::ClaudeSettings;
use crate::source::{LocalScope, Source};
use crate::store::{Store, repos, steps_state};

const PROJECT: &str = "mobile/mobile-app";

fn mr(iid: u64) -> Source {
    Source::Mr {
        project: PROJECT.into(),
        iid,
    }
}

fn local() -> Source {
    Source::Local {
        scope: LocalScope::Uncommitted,
    }
}

fn plan_of(steps: usize) -> Plan {
    Plan {
        intent: String::new(),
        steps: (1..=steps)
            .map(|n| Step {
                id: format!("s{n}"),
                title: format!("Step {n}"),
                short_title: format!("Step {n}"),
                reason: String::new(),
                description: String::new(),
                layer: Layer::Core,
                hunk_ids: Vec::new(),
                builds_on: Vec::new(),
            })
            .collect(),
        orders: Orders {
            contract_to_ui: Vec::new(),
            tests_first: Vec::new(),
        },
        skim: Vec::new(),
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: String::new(),
        coverage: Coverage::default(),
    }
}

/// A session to put in the store, with a plan of `steps` steps.
struct Seed<'a> {
    id: &'a str,
    status: SessionStatus,
    source: Source,
    steps: usize,
    /// ISO 8601 UTC, like the store writes it.
    updated: &'a str,
    /// The MR title kept with an MR session (`mr_json`).
    title: Option<&'a str>,
}

fn seed(c: &mut Connection, repo: i64, s: &Seed) {
    let mr_json = match (&s.source, s.title) {
        (Source::Mr { iid, .. }, Some(title)) => Some(
            serde_json::to_string(&MrMeta {
                iid: *iid,
                title: title.into(),
                author: "Paweł S.".into(),
                created_at: None,
                source_branch: "feature/signature".into(),
                target_branch: "develop".into(),
                pipeline: None,
                description: None,
            })
            .unwrap(),
        ),
        _ => None,
    };
    let (base, head) = ("base".to_owned(), format!("head-{}", s.id));
    insert(
        c,
        &NewSession {
            id: s.id.into(),
            repo_id: repo,
            source_json: serde_json::to_string(&s.source).unwrap(),
            base_sha: base.clone(),
            head_sha: head.clone(),
            mode: Mode::Focus,
            layout: Layout::A,
            status: s.status,
            worktree: None,
            mr_json,
        },
    )
    .unwrap();
    c.execute(
        "UPDATE sessions SET updated_at = ?2 WHERE id = ?1",
        params![s.id, s.updated],
    )
    .unwrap();
    // The plan, wherever the app keeps one: the plan cache (M3 decision 7) and `plans.plan_json`.
    let plan = serde_json::to_value(plan_of(s.steps)).unwrap();
    let key = CacheKey::new(
        plan_cache::TASK,
        repo,
        plan_cache::subject(&s.source),
        &base,
        &head,
        ["h1".to_owned()],
        None,
        TaskSettings::plan(&ClaudeSettings::default()),
    );
    plan_cache::put(c, &key, &plan).unwrap();
    c.execute(
        "INSERT INTO plans (session_id, plan_json) VALUES (?1, ?2)
         ON CONFLICT(session_id) DO UPDATE SET plan_json = excluded.plan_json",
        params![s.id, plan.to_string()],
    )
    .unwrap();
}

fn draft(c: &Connection, session: &str, body: &str) {
    drafts::create(
        c,
        &NewDraft {
            session_id: session.into(),
            finding_id: None,
            body: body.into(),
            position: None,
            severity: None,
        },
    )
    .unwrap();
}

fn reviewed(c: &Connection, session: &str, steps: &[&str]) {
    for step in steps {
        steps_state::set_reviewed(c, session, step, true).unwrap();
    }
}

/// A fresh store with the repository the sessions belong to; `f` gets its connection and ID.
fn with_repo<T>(f: impl FnOnce(&mut Connection, i64) -> T) -> T {
    let store = Store::open_in_memory().unwrap();
    store
        .with_conn(|c| {
            let repo = repos::add(c, "mobile-app", r"C:\src\mobile ąę", Some(PROJECT))?.id;
            Ok(f(c, repo))
        })
        .unwrap()
}

fn card(list: Vec<UnfinishedSession>, id: &str) -> UnfinishedSession {
    list.into_iter()
        .find(|s| s.id == id)
        .unwrap_or_else(|| panic!("session {id} is not listed"))
}

#[test]
fn f04_1_an_mr_session_reports_reviewed_of_total_steps_and_its_drafts() {
    let card = with_repo(|c, repo| {
        seed(
            c,
            repo,
            &Seed {
                id: "mr-471",
                status: SessionStatus::Reviewing,
                source: mr(471),
                steps: 9,
                updated: "2026-10-13T16:40:00Z",
                title: Some("Signature screen: field validation"),
            },
        );
        seed(
            c,
            repo,
            &Seed {
                id: "mr-482",
                status: SessionStatus::Reviewing,
                source: mr(482),
                steps: 4,
                updated: "2026-10-13T15:00:00Z",
                title: Some("Offline queue for delivery photos"),
            },
        );
        reviewed(c, "mr-471", &["s1", "s2", "s3", "s4", "s5"]);
        // Un-marking a step takes it out of the count.
        reviewed(c, "mr-471", &["s6"]);
        steps_state::set_reviewed(c, "mr-471", "s6", false).unwrap();
        for body in ["Null check missing", "Rename Kick()", "Add a test"] {
            draft(c, "mr-471", body);
        }
        // Marks and drafts of another session never count.
        reviewed(c, "mr-482", &["s1", "s2"]);
        draft(c, "mr-482", "Unrelated");
        card(list_unfinished(c, &Route::Start).unwrap(), "mr-471")
    });
    assert_eq!(
        (card.reviewed_steps, card.total_steps, card.drafts),
        (5, 9, 3)
    );
}

#[test]
fn f04_1_an_mr_card_names_the_merge_request() {
    let card = with_repo(|c, repo| {
        seed(
            c,
            repo,
            &Seed {
                id: "mr-471",
                status: SessionStatus::Reviewing,
                source: mr(471),
                steps: 9,
                updated: "2026-10-13T16:40:00Z",
                title: Some("Signature screen: field validation"),
            },
        );
        card(list_unfinished(c, &Route::Start).unwrap(), "mr-471")
    });
    assert_eq!(card.title, "Signature screen: field validation");
    assert_eq!(card.source, mr(471));
}

#[test]
fn f04_1_a_self_review_session_reports_its_steps_and_is_a_local_source() {
    let card = with_repo(|c, repo| {
        seed(
            c,
            repo,
            &Seed {
                id: "self-1",
                status: SessionStatus::Reviewing,
                source: local(),
                steps: 6,
                updated: "2026-10-13T16:40:00Z",
                title: None,
            },
        );
        reviewed(c, "self-1", &["s1", "s2"]);
        card(list_unfinished(c, &Route::Start).unwrap(), "self-1")
    });
    assert_eq!(
        (card.reviewed_steps, card.total_steps, card.drafts),
        (2, 6, 0)
    );
    assert_eq!(card.source, local());
    assert_eq!(card.updated_at, "2026-10-13T16:40:00Z");
}

#[test]
fn f04_1_a_session_without_marks_or_drafts_has_zero_of_its_steps_reviewed() {
    let card = with_repo(|c, repo| {
        seed(
            c,
            repo,
            &Seed {
                id: "mr-482",
                status: SessionStatus::Planning,
                source: mr(482),
                steps: 4,
                updated: "2026-10-13T15:00:00Z",
                title: Some("Offline queue for delivery photos"),
            },
        );
        card(list_unfinished(c, &Route::Start).unwrap(), "mr-482")
    });
    assert_eq!(
        (card.reviewed_steps, card.total_steps, card.drafts),
        (0, 4, 0)
    );
}

#[test]
fn f04_1_cards_are_newest_first_and_a_session_used_now_moves_up() {
    let (before, after) = with_repo(|c, repo| {
        for (id, iid, updated) in [
            ("older", 471, "2026-10-11T09:00:00Z"),
            ("newest", 480, "2026-10-13T09:00:00Z"),
            ("middle", 482, "2026-10-12T09:00:00Z"),
        ] {
            seed(
                c,
                repo,
                &Seed {
                    id,
                    status: SessionStatus::Reviewing,
                    source: mr(iid),
                    steps: 6,
                    updated,
                    title: Some("An MR"),
                },
            );
        }
        let progress_of = |list: Vec<UnfinishedSession>| -> Vec<(String, u32)> {
            list.into_iter()
                .map(|s| (s.id, u32::try_from(s.reviewed_steps).unwrap()))
                .collect()
        };
        let before = progress_of(list_unfinished(c, &Route::Start).unwrap());
        // Marking a step reviewed uses the session now (F-07.2).
        progress::mark(c, "older", &plan_of(6), "s1", true).unwrap();
        let after = progress_of(list_unfinished(c, &Route::Start).unwrap());
        (before, after)
    });
    let ids = |list: &[(String, u32)]| list.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&before), ["newest", "middle", "older"]);
    assert_eq!(ids(&after), ["older", "newest", "middle"]);
    assert_eq!(after[0].1, 1);
}

#[test]
fn f04_1_finished_sessions_are_not_listed() {
    let listed = with_repo(|c, repo| {
        for (id, iid, status, updated) in [
            ("done", 470, SessionStatus::Done, "2026-10-13T12:00:00Z"),
            (
                "drafts",
                471,
                SessionStatus::DraftsOnly,
                "2026-10-13T11:00:00Z",
            ),
            (
                "reviewing",
                480,
                SessionStatus::Reviewing,
                "2026-10-13T10:00:00Z",
            ),
            (
                "planning",
                482,
                SessionStatus::Planning,
                "2026-10-13T09:00:00Z",
            ),
        ] {
            seed(
                c,
                repo,
                &Seed {
                    id,
                    status,
                    source: mr(iid),
                    steps: 3,
                    updated,
                    title: Some("An MR"),
                },
            );
        }
        reviewed(c, "done", &["s1", "s2", "s3"]);
        draft(c, "drafts", "Left to publish");
        list_unfinished(c, &Route::Start)
            .unwrap()
            .into_iter()
            .map(|s| (s.id, u32::try_from(s.total_steps).unwrap()))
            .collect::<Vec<_>>()
    });
    assert_eq!(
        listed,
        [("reviewing".to_owned(), 3), ("planning".to_owned(), 3)]
    );
}
