//! New sessions from S-01 (F-01.3), unfinished sessions for the Review dock tile (F-30.2) and
//! "Pick up where you left off" (F-04.1), and where to resume them.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use super::model::{Layout, Mode, SessionStatus};
use crate::git::{Git, refs};
use crate::os::process::Cancel;
use crate::route::Route;
use crate::source::Source;
use crate::source::open::Resolved;
use crate::store::sessions::NewSession;

/// A session the Review tile and a "Pick up where you left off" card open (F-30.2, F-04.1).
/// The UI draws the card's progress line from the numbers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UnfinishedSession {
    pub id: String,
    pub status: SessionStatus,
    pub mode: Mode,
    /// ISO 8601 UTC; the card's "saved yesterday 18:40".
    pub updated_at: String,
    /// The screen the Review tile and **Continue** open for this session.
    pub resume: Route,
    /// The card's tag: `!iid` of an MR, `local` of a self-review.
    pub source: Source,
    /// The MR's title, the branch of a self-review, the commit or range of commits.
    pub title: String,
    /// Steps of the session's plan marked reviewed (F-07.2).
    pub reviewed_steps: usize,
    /// Steps of the session's plan; 0 while it has none.
    pub total_steps: usize,
    /// Drafts not published yet (F-09.2).
    pub drafts: usize,
}

/// The stored title of a card: the MR's title (`sessions.mr_json`; the project without one),
/// the repository's name for a self-review until [`name_self_reviews`] finds its branch, the
/// short SHA or range of commits.
pub fn card_title(source: &Source, mr_title: Option<String>, repo_name: Option<String>) -> String {
    let short = |sha: &str| sha.chars().take(7).collect::<String>();
    match source {
        Source::Mr { project, .. } => mr_title.unwrap_or_else(|| project.clone()),
        Source::Local { .. } => repo_name.unwrap_or_default(),
        Source::Commits { from: None, to } => short(to),
        Source::Commits {
            from: Some(from),
            to,
        } => format!("{}..{}", short(from), short(to)),
    }
}

/// Names self-review cards after the branch checked out in their repository (Start.dc.html:
/// `local` · `chore/compiled-bindings`); `checkouts` maps session IDs to repository folders.
/// Without a branch (detached HEAD, git failing) the stored title stays.
pub async fn name_self_reviews(
    sessions: &mut [UnfinishedSession],
    checkouts: &HashMap<String, PathBuf>,
    git_program: Option<&Path>,
    cancel: &Cancel,
) {
    let mut branches: HashMap<&Path, Option<String>> = HashMap::new();
    for session in sessions
        .iter_mut()
        .filter(|s| matches!(s.source, Source::Local { .. }))
    {
        let Some(checkout) = checkouts.get(&session.id) else {
            continue;
        };
        if !branches.contains_key(checkout.as_path()) {
            let git = Git::new(git_program, checkout);
            let branch = refs::current_branch(&git, cancel)
                .await
                .unwrap_or_else(|error| {
                    tracing::debug!(%error, "the branch of a self-review was not read");
                    None
                });
            branches.insert(checkout.as_path(), branch);
        }
        if let Some(Some(branch)) = branches.get(checkout.as_path()) {
            session.title.clone_from(branch);
        }
    }
}

/// A session just opened from S-01 and the screen to show (F-01.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OpenedSession {
    pub session_id: String,
    pub route: Route,
}

/// The row and route of a new session. Every source opens the review plan (S-02) while it is
/// planned: a prepared MR (F-05), local changes and commits alike (self-review, F-17.1, M3
/// decision 12). Set `worktree` on the row for an MR.
pub fn new_session(
    repo_id: i64,
    resolved: Resolved,
    mode: Mode,
    layout: Layout,
) -> Result<(NewSession, OpenedSession), serde_json::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let status = SessionStatus::Planning;
    let route = Route::Plan {
        session_id: id.clone(),
    };
    let row = NewSession {
        id: id.clone(),
        repo_id,
        source_json: serde_json::to_string(&resolved.source)?,
        base_sha: resolved.base_sha,
        head_sha: resolved.head_sha,
        mode,
        layout,
        status,
        worktree: None,
        mr_json: None,
    };
    Ok((
        row,
        OpenedSession {
            session_id: id,
            route,
        },
    ))
}

/// The session's last screen: the saved last route if it belongs to the session, otherwise the
/// plan while it is being prepared, or step review in the session's mode. A "drafts only" session
/// has no steps, so it always opens the summary (F-12.7, M5 decision 15).
pub fn resume_route(id: &str, status: SessionStatus, mode: Mode, last_route: &Route) -> Route {
    if status == SessionStatus::DraftsOnly {
        return Route::Summary {
            session_id: id.to_owned(),
        };
    }
    if last_route.session_id() == Some(id) {
        return last_route.clone();
    }
    let session_id = id.to_owned();
    match (status, mode) {
        (SessionStatus::Preparing | SessionStatus::Planning, _) => Route::Plan { session_id },
        (_, Mode::Focus) => Route::Step { session_id },
        (_, Mode::Detailed) => Route::Detailed { session_id },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f30_2_review_resumes_at_the_last_screen_of_the_session() {
        let last = Route::Summary {
            session_id: "s1".into(),
        };
        assert_eq!(
            resume_route("s1", SessionStatus::Reviewing, Mode::Focus, &last),
            last
        );
    }

    #[test]
    fn f12_7_a_drafts_only_session_resumes_at_the_summary_whatever_was_open_last() {
        let summary = || Route::Summary {
            session_id: "d1".into(),
        };
        let own_step = Route::Step {
            session_id: "d1".into(),
        };
        for last in [Route::Start, own_step] {
            assert_eq!(
                resume_route("d1", SessionStatus::DraftsOnly, Mode::Detailed, &last),
                summary()
            );
        }
    }

    #[test]
    fn f30_2_resume_screen_follows_status_and_mode() {
        let elsewhere = Route::Step {
            session_id: "other".into(),
        };
        let id = || "s1".to_owned();
        assert_eq!(
            resume_route("s1", SessionStatus::Planning, Mode::Detailed, &elsewhere),
            Route::Plan { session_id: id() }
        );
        assert_eq!(
            resume_route("s1", SessionStatus::Preparing, Mode::Focus, &Route::Start),
            Route::Plan { session_id: id() }
        );
        assert_eq!(
            resume_route("s1", SessionStatus::Reviewing, Mode::Focus, &elsewhere),
            Route::Step { session_id: id() }
        );
        assert_eq!(
            resume_route(
                "s1",
                SessionStatus::Reviewing,
                Mode::Detailed,
                &Route::Changes {
                    commit: None,
                    session_id: None
                }
            ),
            Route::Detailed { session_id: id() }
        );
    }

    #[test]
    fn f04_1_card_titles_by_source() {
        let mr = Source::Mr {
            project: "mobile/mobile-app".into(),
            iid: 471,
        };
        let title = |source: &Source, mr: Option<&str>| {
            card_title(source, mr.map(str::to_owned), Some("mobile ąę".into()))
        };
        assert_eq!(
            title(&mr, Some("Signature screen: field validation")),
            "Signature screen: field validation"
        );
        assert_eq!(title(&mr, None), "mobile/mobile-app");
        let local = Source::Local {
            scope: crate::source::LocalScope::Staged,
        };
        assert_eq!(title(&local, None), "mobile ąę");
        let commit = Source::Commits {
            from: None,
            to: "a3f9c12d4e5f60718293a4b5c6d7e8f901234567".into(),
        };
        assert_eq!(title(&commit, None), "a3f9c12");
        let range = Source::Commits {
            from: Some("e07d3f1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()),
            to: "9be0d47bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into(),
        };
        assert_eq!(title(&range, None), "e07d3f1..9be0d47");
    }

    /// F-19.1 A new session opens in Settings › General's Start in and Focus layout, as the
    /// open commands pass them: the saved settings are read, the row is stored and the session's
    /// state reads back the mode and layout.
    fn opened_with_saved_settings(patch: serde_json::Value) -> (Mode, Layout) {
        use crate::review::session_state;
        use crate::store::{Store, repos, sessions, settings};

        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                settings::update(c, &patch)?;
                let saved = settings::load(c)?;
                let repo = repos::add(c, "mobile ąę", r"C:\src\mobile ąę", None)?;
                let resolved = Resolved {
                    source: Source::Local {
                        scope: crate::source::LocalScope::Staged,
                    },
                    base_sha: "a".into(),
                    head_sha: "b".into(),
                };
                let (row, opened) =
                    new_session(repo.id, resolved, saved.ui.start_in, saved.ui.focus_layout)
                        .unwrap();
                sessions::insert(c, &row)?;
                let state = session_state::load(c, &opened.session_id)?.unwrap();
                Ok((state.mode, state.layout))
            })
            .unwrap()
    }

    #[test]
    fn f19_1_new_sessions_open_in_the_default_start_in_and_focus_layout() {
        assert_eq!(
            opened_with_saved_settings(serde_json::json!({})),
            (Mode::Focus, Layout::A)
        );
    }

    #[test]
    fn f19_1_new_sessions_take_start_in_and_focus_layout_from_settings() {
        assert_eq!(
            opened_with_saved_settings(serde_json::json!({
                "ui": { "startIn": "detailed", "focusLayout": "C" }
            })),
            (Mode::Detailed, Layout::C)
        );
        assert_eq!(
            opened_with_saved_settings(serde_json::json!({ "ui": { "focusLayout": "B" } })),
            (Mode::Focus, Layout::B)
        );
    }
}
