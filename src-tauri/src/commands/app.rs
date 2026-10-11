//! `app_*` commands. Health of the app itself; GitLab and Claude Code status join in M1/M2.

use serde::Serialize;
use ts_rs::TS;

use crate::error::AppResult;

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
