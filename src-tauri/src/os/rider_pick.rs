//! Settings › Integrations › JetBrains Rider (F-24.4): what the section shows about the install
//! the app uses, and checking a file picked with **Change**. A Toolbox `rider.cmd` is resolved
//! to the real `rider64.exe` and never run (docs/05 › JetBrains Rider).

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::rider::{EXE, RiderInput, RiderInstall, discover_all, exe_from_toolbox_script};

/// The Rider install as Settings › Integrations shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RiderStatus {
    /// `rider64.exe` the app starts; `null` when Rider wasn't found.
    pub path: Option<String>,
    /// Major.minor from `product-info.json` ("Found 2026.2").
    pub version: Option<String>,
}

impl RiderStatus {
    pub fn from_install(install: Option<&RiderInstall>) -> Self {
        Self {
            path: install.map(|i| i.exe.to_string_lossy().into_owned()),
            version: install
                .and_then(|i| i.version.as_deref())
                .map(short_version),
        }
    }
}

/// `2026.2.3.1` → `2026.2`.
fn short_version(version: &str) -> String {
    version.split('.').take(2).collect::<Vec<_>>().join(".")
}

/// The install behind a picked file: `rider64.exe` itself, or the one a Toolbox `rider.cmd`
/// script starts. `None` for anything else or a file that doesn't exist.
pub fn pick_install(picked: &Path) -> Option<RiderInstall> {
    let is_cmd = picked
        .extension()
        .is_some_and(|x| x.eq_ignore_ascii_case("cmd"));
    let exe = if is_cmd {
        exe_from_toolbox_script(&std::fs::read_to_string(picked).ok()?)?
    } else {
        picked.to_path_buf()
    };
    let named_rider = exe
        .file_name()
        .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(EXE));
    if !named_rider {
        return None;
    }
    discover_all(&RiderInput {
        configured: Some(exe),
        ..RiderInput::default()
    })
    .into_iter()
    .next()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::os::rider::RiderSource;
    use std::fs;
    use std::path::PathBuf;

    fn install(home: &Path, version: &str) -> PathBuf {
        let exe = home.join("bin").join(EXE);
        fs::create_dir_all(exe.parent().unwrap()).unwrap();
        fs::write(&exe, b"").unwrap();
        fs::write(
            home.join("product-info.json"),
            format!(r#"{{"version":"{version}","dataDirectoryName":"Rider2026.2"}}"#),
        )
        .unwrap();
        exe
    }

    #[test]
    fn f24_4_pick_accepts_rider64_and_reports_major_minor() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = install(&tmp.path().join("JetBrains Rider ąę 2026.2"), "2026.2.3.1");
        let found = pick_install(&exe).unwrap();
        assert_eq!(found.exe, exe);
        assert_eq!(found.source, RiderSource::Settings);
        assert_eq!(
            RiderStatus::from_install(Some(&found)),
            RiderStatus {
                path: Some(exe.to_string_lossy().into_owned()),
                version: Some("2026.2".into()),
            }
        );
    }

    #[test]
    fn f24_4_pick_resolves_a_toolbox_script_without_running_it() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = install(&tmp.path().join("Rider"), "2026.2.1");
        let script = tmp.path().join("Zażółć scripts").join("rider.cmd");
        fs::create_dir_all(script.parent().unwrap()).unwrap();
        fs::write(
            &script,
            format!("@echo off\r\nstart \"\" \"{}\" %*\r\n", exe.display()),
        )
        .unwrap();
        assert_eq!(pick_install(&script).map(|i| i.exe), Some(exe));
    }

    #[test]
    fn f24_4_pick_rejects_other_files() {
        let tmp = tempfile::tempdir().unwrap();
        let other = tmp.path().join("notepad.exe");
        fs::write(&other, b"").unwrap();
        assert!(pick_install(&other).is_none());
        assert!(pick_install(&tmp.path().join("bin").join(EXE)).is_none());
        let script = tmp.path().join("rider.cmd");
        fs::write(&script, "@echo off\r\necho hi\r\n").unwrap();
        assert!(pick_install(&script).is_none());
    }

    #[test]
    fn f24_4_status_without_rider_or_version() {
        assert_eq!(
            RiderStatus::from_install(None),
            RiderStatus {
                path: None,
                version: None
            }
        );
        assert_eq!(short_version("2026"), "2026");
    }
}
