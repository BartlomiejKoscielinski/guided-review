//! Typed app settings with the defaults of docs/04 › Settings (keys and defaults).
//!
//! The UI reads the whole struct and writes partial patches; `store::settings` keeps one row
//! per key (`ui.startIn`, `claude.tasks.plan`, …) with a JSON value.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::error::{AppError, ErrorCode};
use crate::review::model::{Layout, Mode};
use crate::route::Route;

mod claude;

pub use claude::{ClaudeSettings, ClaudeTasks, Effort, Lang, TaskEffort, TaskOverride};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Settings {
    pub ui: UiSettings,
    pub os: OsSettings,
    pub claude: ClaudeSettings,
    pub git: GitSettings,
    pub gitlab: GitlabSettings,
    pub rider: RiderSettings,
    pub nav: NavSettings,
    pub notify: NotifySettings,
    pub poll: PollSettings,
    pub quiet: QuietSettings,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct UiSettings {
    /// F-19.1
    pub start_in: Mode,
    /// F-19.1, F-07.9
    pub focus_layout: Layout,
    /// F-19.1
    pub diff_colors: DiffColors,
    /// F-30.4: the screen to restore on start.
    pub last_route: Route,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum DiffColors {
    #[default]
    BlueOrange,
    GreenRed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct OsSettings {
    /// F-19.1
    pub start_with_windows: bool,
    /// F-28.1
    pub close_to_tray: bool,
}

impl Default for OsSettings {
    fn default() -> Self {
        Self {
            start_with_windows: false,
            close_to_tray: true,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GitSettings {
    /// `null` = git from PATH (docs/04 › Processes).
    pub path: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GitlabSettings {
    /// Server URL; `null` until GitLab is set up (F-19.2, F-19.5).
    pub server: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct RiderSettings {
    /// `null` = detected automatically (F-24.4).
    pub path: Option<String>,
    /// Where a teammate's MR files open from (F-24.1).
    pub open_from: RiderOpenFrom,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum RiderOpenFrom {
    #[default]
    Worktree,
    Checkout,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct NavSettings {
    /// Code index engine (F-23.5).
    pub engine: NavEngine,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum NavEngine {
    #[default]
    CsharpLs,
    Roslyn,
    Symbols,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct NotifySettings {
    pub review_requests: bool,
    pub new_commits: bool,
    pub comments: bool,
    pub pipelines: bool,
    pub approvals: bool,
}

impl Default for NotifySettings {
    fn default() -> Self {
        Self {
            review_requests: true,
            new_commits: true,
            comments: true,
            pipelines: true,
            approvals: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct PollSettings {
    /// GitLab polling interval: 1, 3, 5, 10 or 15 minutes (F-28.2).
    pub minutes: u8,
}

impl Default for PollSettings {
    fn default() -> Self {
        Self { minutes: 3 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct QuietSettings {
    pub enabled: bool,
    /// "HH:MM", 24-hour clock (F-28.5).
    pub from: String,
    pub to: String,
    pub weekends: bool,
}

impl Default for QuietSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            from: "18:00".to_owned(),
            to: "08:00".to_owned(),
            weekends: true,
        }
    }
}

const POLL_MINUTES: [u8; 5] = [1, 3, 5, 10, 15];

/// Keys whose value is a JSON object stored in one row; the patch replaces them whole.
pub(crate) const REPLACED_WHOLE: [&str; 1] = ["ui.lastRoute"];

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SettingsError {
    #[error("{0}")]
    Invalid(String),
}

impl From<SettingsError> for AppError {
    fn from(error: SettingsError) -> Self {
        match error {
            SettingsError::Invalid(reason) => AppError::new(ErrorCode::InvalidInput, reason),
        }
    }
}

impl Settings {
    /// Checks ranges and formats that the types alone don't express.
    pub fn validate(&self) -> Result<(), SettingsError> {
        let invalid = |reason: &str| Err(SettingsError::Invalid(reason.to_owned()));
        if !(1..=4).contains(&self.claude.max_concurrent) {
            return invalid("Run at most 1 to 4 Claude tasks at once.");
        }
        if !self.claude.models_are_valid() {
            return invalid("Unknown Claude model.");
        }
        if !POLL_MINUTES.contains(&self.poll.minutes) {
            return invalid("Check GitLab every 1, 3, 5, 10 or 15 minutes.");
        }
        if !is_clock_time(&self.quiet.from) || !is_clock_time(&self.quiet.to) {
            return invalid("Quiet hours need a time like 18:00.");
        }
        for path in [&self.claude.path, &self.git.path, &self.rider.path] {
            if path.as_deref().is_some_and(|p| p.trim().is_empty()) {
                return invalid("The path is empty.");
            }
        }
        if self
            .gitlab
            .server
            .as_deref()
            .is_some_and(|s| s.trim().is_empty())
        {
            return invalid("The server URL is empty.");
        }
        if self
            .ui
            .last_route
            .session_id()
            .is_some_and(|id| id.trim().is_empty())
        {
            return invalid("The last screen has no session.");
        }
        Ok(())
    }

    /// Applies a partial patch (`{ "ui": { "startIn": "detailed" } }`) and validates the result.
    /// Nested objects merge, except keys in [`REPLACED_WHOLE`]; unknown keys are rejected.
    pub fn patched(&self, patch: &Value) -> Result<Self, SettingsError> {
        if !patch.is_object() {
            return Err(SettingsError::Invalid(
                "Settings changes must be an object.".to_owned(),
            ));
        }
        let mut tree = serde_json::to_value(self)
            .map_err(|e| SettingsError::Invalid(format!("Settings can't be read: {e}.")))?;
        merge(&mut tree, patch, "");
        let next: Self = serde_json::from_value(tree)
            .map_err(|e| SettingsError::Invalid(format!("Invalid setting: {e}.")))?;
        next.validate()?;
        Ok(next)
    }
}

fn merge(target: &mut Value, patch: &Value, path: &str) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) if !REPLACED_WHOLE.contains(&path) => {
            for (key, value) in patch {
                let child = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                match target.get_mut(key) {
                    Some(existing) => merge(existing, value, &child),
                    None => {
                        target.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (target, patch) => *target = patch.clone(),
    }
}

fn is_clock_time(value: &str) -> bool {
    let Some((h, m)) = value.split_once(':') else {
        return false;
    };
    h.len() == 2
        && m.len() == 2
        && h.parse::<u8>().is_ok_and(|h| h < 24)
        && m.parse::<u8>().is_ok_and(|m| m < 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_follow_the_settings_table() {
        let s = Settings::default();
        assert_eq!(s.ui.start_in, Mode::Focus);
        assert_eq!(s.ui.focus_layout, Layout::A);
        assert_eq!(s.ui.diff_colors, DiffColors::BlueOrange);
        assert_eq!(s.ui.last_route, Route::Start);
        assert!(!s.os.start_with_windows);
        assert!(s.os.close_to_tray);
        assert_eq!(s.claude.path, None);
        assert_eq!(s.claude.max_concurrent, 2);
        assert_eq!(
            (s.claude.model.as_str(), s.claude.effort, s.claude.lang),
            ("inherit", Effort::Medium, Lang::En)
        );
        assert_eq!(s.git.path, None);
        assert_eq!(s.gitlab.server, None);
        assert_eq!(
            (s.rider.path.as_deref(), s.rider.open_from),
            (None, RiderOpenFrom::Worktree)
        );
        assert_eq!(s.nav.engine, NavEngine::CsharpLs);
        assert_eq!(
            s.notify,
            NotifySettings {
                review_requests: true,
                new_commits: true,
                comments: true,
                pipelines: true,
                approvals: false
            }
        );
        assert_eq!(s.poll.minutes, 3);
        assert_eq!(
            s.quiet,
            QuietSettings {
                enabled: true,
                from: "18:00".into(),
                to: "08:00".into(),
                weekends: true
            }
        );
        s.validate().unwrap();
    }

    #[test]
    fn mock_backend_defaults_match_the_core() {
        // The mock backend (ADR-016) serves these defaults; keep them identical.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/ipc/mock/fixtures/default-settings.json");
        let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(
            fixture,
            serde_json::to_value(Settings::default()).unwrap(),
            "update src/ipc/mock/fixtures/default-settings.json"
        );
    }

    #[test]
    fn serializes_with_the_documented_names() {
        let v = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(v["ui"]["startIn"], json!("focus"));
        assert_eq!(v["ui"]["diffColors"], json!("blue-orange"));
        assert_eq!(v["ui"]["lastRoute"], json!({ "screen": "S-01" }));
        assert_eq!(v["claude"]["maxConcurrent"], json!(2));
        assert_eq!(
            v["claude"]["tasks"]["ask"],
            json!({ "model": "default", "effort": "low" })
        );
        assert_eq!(v["nav"]["engine"], json!("csharp-ls"));
        assert_eq!(v["gitlab"]["server"], json!(null));
    }

    #[test]
    fn patch_changes_only_the_given_keys() {
        let s = Settings::default();
        let next = s
            .patched(&json!({ "ui": { "startIn": "detailed" }, "claude": { "tasks": { "plan": { "effort": "max" } } } }))
            .unwrap();
        assert_eq!(next.ui.start_in, Mode::Detailed);
        assert_eq!(next.ui.focus_layout, Layout::A);
        assert_eq!(next.claude.tasks.plan.effort, TaskEffort::Max);
        assert_eq!(next.claude.tasks.plan.model, "claude-opus-5-5");
    }

    #[test]
    fn patch_replaces_the_last_route_whole() {
        let s = Settings::default()
            .patched(&json!({ "ui": { "lastRoute": { "screen": "S-03", "sessionId": "s1" } } }))
            .unwrap();
        let next = s
            .patched(&json!({ "ui": { "lastRoute": { "screen": "S-06" } } }))
            .unwrap();
        assert_eq!(
            next.ui.last_route,
            Route::Changes {
                commit: None,
                session_id: None
            }
        );
    }

    #[test]
    fn patch_null_resets_an_optional_value() {
        let s = Settings::default()
            .patched(&json!({ "git": { "path": "C:\\Program Files\\Git\\cmd\\git.exe" } }))
            .unwrap();
        assert!(s.git.path.is_some());
        let next = s.patched(&json!({ "git": { "path": null } })).unwrap();
        assert_eq!(next.git.path, None);
    }

    #[test]
    fn patch_rejects_unknown_keys_wrong_types_and_out_of_range_values() {
        let s = Settings::default();
        for patch in [
            json!({ "ui": { "theme": "light" } }),
            json!({ "ui": { "startIn": "sideways" } }),
            json!({ "claude": { "maxConcurrent": 5 } }),
            json!({ "claude": { "maxConcurrent": 0 } }),
            json!({ "claude": { "model": "gpt-5" } }),
            json!({ "claude": { "tasks": { "fix": { "model": "Claude Opus" } } } }),
            json!({ "poll": { "minutes": 2 } }),
            json!({ "quiet": { "from": "6 pm" } }),
            json!({ "quiet": { "to": "24:00" } }),
            json!({ "rider": { "path": "  " } }),
            json!({ "ui": { "lastRoute": { "screen": "S-03", "sessionId": "" } } }),
            json!({ "ui": { "startIn": null } }),
            json!("not an object"),
        ] {
            assert!(s.patched(&patch).is_err(), "accepted {patch}");
        }
    }

    #[test]
    fn invalid_patch_maps_to_invalid_input() {
        let err = Settings::default()
            .patched(&json!({ "claude": { "maxConcurrent": 9 } }))
            .unwrap_err();
        let app: AppError = err.into();
        assert_eq!(app.code, ErrorCode::InvalidInput);
        assert_eq!(app.message, "Run at most 1 to 4 Claude tasks at once.");
    }

    #[test]
    fn clock_times() {
        assert!(is_clock_time("00:00") && is_clock_time("23:59"));
        assert!(!is_clock_time("8:00") && !is_clock_time("12:60"));
    }
}
