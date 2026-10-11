//! `app_*` commands. Health of the app itself; GitLab and Claude Code status join in M1/M2.

use serde::Serialize;
use serde_json::Value;
use tauri::State;
use ts_rs::TS;

use super::with_store;
use crate::error::AppResult;
use crate::route::Route;
use crate::settings::Settings;
use crate::store::{self, Store};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppHealth {
    /// Version of Guided Review (Cargo package version).
    pub version: String,
    /// Operating system family, e.g. "windows".
    pub platform: String,
}

pub fn health() -> AppHealth {
    AppHealth {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        platform: std::env::consts::OS.to_owned(),
    }
}

#[tauri::command]
pub fn app_health() -> AppResult<AppHealth> {
    Ok(health())
}

/// All settings with defaults for keys that aren't stored (docs/04 › Settings).
#[tauri::command]
pub async fn app_settings_get(store: State<'_, Store>) -> AppResult<Settings> {
    with_store(&store, |conn| store::settings::load(conn)).await
}

/// Applies a partial patch (`{ "ui": { "startIn": "detailed" } }`); invalid values are
/// rejected with `INVALID_INPUT` and nothing is stored.
#[tauri::command]
pub async fn app_settings_set(store: State<'_, Store>, patch: Value) -> AppResult<Settings> {
    with_store(&store, move |conn| store::settings::update(conn, &patch)).await
}

/// The screen to open on start (F-30.4).
#[tauri::command]
pub async fn app_start_route(store: State<'_, Store>) -> AppResult<Route> {
    with_store(&store, |conn| store::start_route(conn)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_reports_package_version_and_platform() {
        let h = health();
        assert_eq!(h.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(h.platform, std::env::consts::OS);
        let v = serde_json::to_value(&h).unwrap();
        assert!(v.get("version").is_some() && v.get("platform").is_some());
    }
}
