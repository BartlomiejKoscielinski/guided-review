//! Screen routes the UI can be on (S-01…S-11), stored as `ui.lastRoute` and restored on start
//! (F-30.4). The core owns the restore rules so they can be tested without the UI.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A screen and its parameters, serialized as `{ "screen": "S-03", "sessionId": "…" }`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "screen")]
#[ts(export)]
pub enum Route {
    #[default]
    #[serde(rename = "S-01")]
    Start,
    #[serde(rename = "S-02", rename_all = "camelCase")]
    Plan { session_id: String },
    #[serde(rename = "S-03", rename_all = "camelCase")]
    Step { session_id: String },
    #[serde(rename = "S-04", rename_all = "camelCase")]
    Detailed { session_id: String },
    #[serde(rename = "S-05", rename_all = "camelCase")]
    Summary { session_id: String },
    #[serde(rename = "S-06")]
    Changes,
    #[serde(rename = "S-07")]
    Settings { section: SettingsSection },
    #[serde(rename = "S-08")]
    Pipeline {
        #[ts(type = "number")]
        iid: u64,
    },
    #[serde(rename = "S-09", rename_all = "camelCase")]
    Rereview { session_id: String },
    #[serde(rename = "S-10")]
    Author {
        #[ts(type = "number")]
        iid: u64,
    },
    #[serde(rename = "S-11")]
    CreateMr,
}

/// Sections of S-07 Settings.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SettingsSection {
    #[default]
    General,
    Claude,
    Gitlab,
    Integrations,
    Notifications,
    Rules,
    Shortcuts,
}

impl Route {
    /// The review session a screen belongs to, if any.
    pub fn session_id(&self) -> Option<&str> {
        match self {
            Self::Plan { session_id }
            | Self::Step { session_id }
            | Self::Detailed { session_id }
            | Self::Summary { session_id }
            | Self::Rereview { session_id } => Some(session_id),
            _ => None,
        }
    }

    /// The screen to open on start for a saved last route (F-30.4).
    ///
    /// Session screens come back only if their session still exists. Screens that can only
    /// show live GitLab data (S-08, S-10) go to S-01, and S-11 goes to S-06 because opening it
    /// asks Claude for a description: restoring never starts Claude or GitLab work.
    pub fn restored(&self, session_exists: impl Fn(&str) -> bool) -> Self {
        match self {
            Self::Start | Self::Changes | Self::Settings { .. } => self.clone(),
            Self::Pipeline { .. } | Self::Author { .. } => Self::Start,
            Self::CreateMr => Self::Changes,
            Self::Plan { session_id }
            | Self::Step { session_id }
            | Self::Detailed { session_id }
            | Self::Summary { session_id }
            | Self::Rereview { session_id } => {
                if !session_id.is_empty() && session_exists(session_id) {
                    self.clone()
                } else {
                    Self::Start
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn step(id: &str) -> Route {
        Route::Step {
            session_id: id.to_owned(),
        }
    }

    #[test]
    fn serializes_with_the_screen_id_as_tag() {
        assert_eq!(
            serde_json::to_value(Route::Start).unwrap(),
            json!({ "screen": "S-01" })
        );
        assert_eq!(
            serde_json::to_value(step("s1")).unwrap(),
            json!({ "screen": "S-03", "sessionId": "s1" })
        );
        assert_eq!(
            serde_json::to_value(Route::Settings {
                section: SettingsSection::Gitlab
            })
            .unwrap(),
            json!({ "screen": "S-07", "section": "gitlab" })
        );
        assert_eq!(
            serde_json::to_value(Route::Author { iid: 480 }).unwrap(),
            json!({ "screen": "S-10", "iid": 480 })
        );
        let back: Route = serde_json::from_value(json!({ "screen": "S-11" })).unwrap();
        assert_eq!(back, Route::CreateMr);
    }

    #[test]
    fn f30_4_last_route_restored_when_session_exists() {
        for route in [
            Route::Plan {
                session_id: "s1".into(),
            },
            step("s1"),
            Route::Detailed {
                session_id: "s1".into(),
            },
            Route::Summary {
                session_id: "s1".into(),
            },
            Route::Rereview {
                session_id: "s1".into(),
            },
        ] {
            assert_eq!(route.restored(|id| id == "s1"), route);
        }
    }

    #[test]
    fn f30_4_last_route_falls_back_to_start_without_session() {
        assert_eq!(step("gone").restored(|_| false), Route::Start);
        assert_eq!(step("").restored(|_| true), Route::Start);
    }

    #[test]
    fn f30_4_gitlab_and_claude_screens_restore_to_start() {
        assert_eq!(
            Route::Pipeline { iid: 482 }.restored(|_| true),
            Route::Start
        );
        assert_eq!(Route::Author { iid: 480 }.restored(|_| true), Route::Start);
        assert_eq!(Route::CreateMr.restored(|_| true), Route::Changes);
    }

    #[test]
    fn f30_4_screens_without_a_session_are_restored_as_they_are() {
        let settings = Route::Settings {
            section: SettingsSection::Shortcuts,
        };
        assert_eq!(settings.restored(|_| false), settings);
        assert_eq!(Route::Changes.restored(|_| false), Route::Changes);
        assert_eq!(Route::Start.restored(|_| false), Route::Start);
    }

    #[test]
    fn session_id_only_for_session_screens() {
        assert_eq!(step("s1").session_id(), Some("s1"));
        assert_eq!(Route::Pipeline { iid: 1 }.session_id(), None);
        assert_eq!(Route::Start.session_id(), None);
    }
}
