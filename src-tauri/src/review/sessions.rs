//! Unfinished review sessions for the Review dock tile (F-30.2) and where to resume them.

use serde::Serialize;
use ts_rs::TS;

use super::model::{Mode, SessionStatus};
use crate::route::Route;

/// A session the Review tile can open. Progress and titles for "Pick up where you left off"
/// (F-04.1) join in M3.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UnfinishedSession {
    pub id: String,
    pub status: SessionStatus,
    pub mode: Mode,
    pub updated_at: String,
    /// The screen the Review tile opens for this session.
    pub resume: Route,
}

/// The session's last screen: the saved last route if it belongs to the session, otherwise the
/// plan while it is being prepared, or step review in the session's mode.
pub fn resume_route(id: &str, status: SessionStatus, mode: Mode, last_route: &Route) -> Route {
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
                &Route::Changes
            ),
            Route::Detailed { session_id: id() }
        );
    }
}
