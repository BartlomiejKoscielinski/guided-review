//! Finding JetBrains Rider (docs/05 › JetBrains Rider, F-24.4, S9). Order: the Settings value,
//! the Toolbox `rider.cmd` script (resolved to the real `rider64.exe`, never run), Toolbox and
//! per-user installs under `%LOCALAPPDATA%`, then `%ProgramFiles%\JetBrains\JetBrains Rider *`.
//! Each install's `product-info.json` gives the version and `dataDirectoryName`, the name of its
//! config folder under `%APPDATA%\JetBrains\` (where `tools\External Tools.xml` lives).

use std::path::{Path, PathBuf};

use serde::Deserialize;

const EXE: &str = "rider64.exe";

/// Where an install was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RiderSource {
    Settings,
    ToolboxScript,
    LocalPrograms,
    ToolboxApps,
    ProgramFiles,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiderInstall {
    pub exe: PathBuf,
    pub source: RiderSource,
    /// From `product-info.json`: `2026.2.3.1`.
    pub version: Option<String>,
    /// `262.10968.170`.
    pub build: Option<String>,
    /// `Rider2026.2`: the config folder name.
    pub data_directory_name: Option<String>,
}

impl RiderInstall {
    /// `%APPDATA%\JetBrains\<dataDirectoryName>`.
    pub fn config_dir(&self, app_data: &Path) -> Option<PathBuf> {
        self.data_directory_name
            .as_ref()
            .map(|name| app_data.join("JetBrains").join(name))
    }
}

/// Folders discovery looks at; [`RiderInput::from_env`] reads them from the process.
#[derive(Debug, Clone, Default)]
pub struct RiderInput {
    pub configured: Option<PathBuf>,
    pub local_app_data: Option<PathBuf>,
    pub program_files: Option<PathBuf>,
}

impl RiderInput {
    pub fn from_env(configured: Option<PathBuf>) -> Self {
        Self {
            configured,
            local_app_data: dirs::data_local_dir(),
            program_files: std::env::var_os("ProgramFiles").map(PathBuf::from),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductInfo {
    version: Option<String>,
    build_number: Option<String>,
    data_directory_name: Option<String>,
}

/// Every install found, in discovery order; within one source the newest version first.
pub fn discover_all(input: &RiderInput) -> Vec<RiderInstall> {
    let mut found: Vec<RiderInstall> = Vec::new();
    let mut add = |exe: PathBuf, source: RiderSource| {
        let same = |known: &RiderInstall| {
            known.exe.to_string_lossy().to_lowercase() == exe.to_string_lossy().to_lowercase()
        };
        if exe.is_file() && !found.iter().any(same) {
            found.push(with_product_info(exe, source));
        }
    };
    if let Some(configured) = &input.configured {
        add(configured.clone(), RiderSource::Settings);
    }
    if let Some(local) = &input.local_app_data {
        let script = local
            .join("JetBrains")
            .join("Toolbox")
            .join("scripts")
            .join("rider.cmd");
        if let Some(exe) = std::fs::read_to_string(script)
            .ok()
            .and_then(|text| exe_from_toolbox_script(&text))
        {
            add(exe, RiderSource::ToolboxScript);
        }
        for exe in newest_first(installs_in(&local.join("Programs"), "rider")) {
            add(exe, RiderSource::LocalPrograms);
        }
        let apps = local
            .join("JetBrains")
            .join("Toolbox")
            .join("apps")
            .join("Rider");
        let channels = subdirs(&apps);
        for exe in newest_first(
            channels
                .iter()
                .flat_map(|channel| installs_in(channel, ""))
                .collect(),
        ) {
            add(exe, RiderSource::ToolboxApps);
        }
    }
    if let Some(program_files) = &input.program_files {
        let jetbrains = program_files.join("JetBrains");
        for exe in newest_first(installs_in(&jetbrains, "jetbrains rider")) {
            add(exe, RiderSource::ProgramFiles);
        }
    }
    found
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default()
}

/// `<dir>\<name starting with prefix>\bin\rider64.exe` for every matching folder.
fn installs_in(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    subdirs(dir)
        .into_iter()
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().to_lowercase().starts_with(prefix))
        })
        .map(|p| p.join("bin").join(EXE))
        .filter(|exe| exe.is_file())
        .collect()
}

fn newest_first(mut exes: Vec<PathBuf>) -> Vec<PathBuf> {
    let key = |exe: &PathBuf| {
        let info = product_info(exe);
        let text = info
            .and_then(|i| i.version.or(i.build_number))
            .or_else(|| {
                exe.parent()
                    .and_then(Path::parent)
                    .and_then(Path::file_name)
                    .map(|n| n.to_string_lossy().into_owned())
            })
            .unwrap_or_default();
        version_key(&text)
    };
    exes.sort_by_key(|exe| std::cmp::Reverse(key(exe)));
    exes
}

/// Numbers in a version text: `JetBrains Rider 2026.2.3.1` → [2026, 2, 3, 1].
fn version_key(text: &str) -> Vec<u64> {
    text.split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

/// `product-info.json` next to `bin\` of an install.
fn product_info(exe: &Path) -> Option<ProductInfo> {
    let home = exe.parent()?.parent()?;
    let text = std::fs::read_to_string(home.join("product-info.json")).ok()?;
    serde_json::from_str(&text).ok()
}

fn with_product_info(exe: PathBuf, source: RiderSource) -> RiderInstall {
    let info = product_info(&exe);
    RiderInstall {
        source,
        version: info.as_ref().and_then(|i| i.version.clone()),
        build: info.as_ref().and_then(|i| i.build_number.clone()),
        data_directory_name: info.and_then(|i| i.data_directory_name),
        exe,
    }
}

/// The install the app uses: the first of [`discover_all`].
pub fn discover(input: &RiderInput) -> Option<RiderInstall> {
    discover_all(input).into_iter().next()
}

/// The `rider64.exe` a Toolbox `rider.cmd` script starts (the first quoted path to it).
pub fn exe_from_toolbox_script(script: &str) -> Option<PathBuf> {
    script
        .split('"')
        .find(|part| part.to_lowercase().ends_with(EXE))
        .map(PathBuf::from)
}

/// Arguments to open a file at a line (and column): `--line N [--column C] <file>`.
pub fn open_args(file: &Path, line: u32, column: Option<u32>) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = vec!["--line".into(), line.to_string().into()];
    if let Some(column) = column {
        args.extend(["--column".into(), column.to_string().into()]);
    }
    args.push(file.as_os_str().to_owned());
    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn install(dir: &Path, version: &str, build: &str) -> PathBuf {
        let exe = dir.join("bin").join(EXE);
        fs::create_dir_all(exe.parent().unwrap()).unwrap();
        fs::write(&exe, b"").unwrap();
        let info = format!(
            r#"{{"name":"JetBrains Rider","version":"{version}","buildNumber":"{build}","productCode":"RD","dataDirectoryName":"Rider{}"}}"#,
            &version[..6]
        );
        fs::write(dir.join("product-info.json"), info).unwrap();
        exe
    }

    #[test]
    fn s9_program_files_newest_version_first_with_product_info() {
        let tmp = tempfile::tempdir().unwrap();
        let pf = tmp.path().join("Program Files");
        let old = install(
            &pf.join("JetBrains").join("JetBrains Rider 2025.3.1"),
            "2025.3.1",
            "253.1.1",
        );
        let new = install(
            &pf.join("JetBrains").join("JetBrains Rider 2026.2.3.1"),
            "2026.2.3.1",
            "262.10968.170",
        );
        fs::create_dir_all(pf.join("JetBrains").join("WebStorm 2025.3.2")).unwrap();
        let found = discover_all(&RiderInput {
            program_files: Some(pf),
            ..RiderInput::default()
        });
        assert_eq!(
            found.iter().map(|i| &i.exe).collect::<Vec<_>>(),
            [&new, &old]
        );
        assert_eq!(found[0].version.as_deref(), Some("2026.2.3.1"));
        assert_eq!(found[0].build.as_deref(), Some("262.10968.170"));
        assert_eq!(found[0].data_directory_name.as_deref(), Some("Rider2026.2"));
        assert_eq!(found[0].source, RiderSource::ProgramFiles);
        assert_eq!(
            found[0].config_dir(Path::new(r"C:\Users\Zażółć\AppData\Roaming")),
            Some(PathBuf::from(
                r"C:\Users\Zażółć\AppData\Roaming\JetBrains\Rider2026.2"
            ))
        );
    }

    #[test]
    fn f24_4_toolbox_script_resolves_to_the_real_exe_before_program_files() {
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path().join("Zażółć").join("AppData").join("Local");
        let toolbox_exe = install(&local.join("Programs").join("Rider"), "2026.2.1", "262.1.1");
        let script = local
            .join("JetBrains")
            .join("Toolbox")
            .join("scripts")
            .join("rider.cmd");
        fs::create_dir_all(script.parent().unwrap()).unwrap();
        fs::write(
            &script,
            format!(
                "@echo off\r\nstart \"\" \"{}\" %*\r\n",
                toolbox_exe.display()
            ),
        )
        .unwrap();
        let pf = tmp.path().join("Program Files");
        install(
            &pf.join("JetBrains").join("JetBrains Rider 2026.2.3.1"),
            "2026.2.3.1",
            "262.10968.170",
        );
        let found = discover_all(&RiderInput {
            local_app_data: Some(local),
            program_files: Some(pf),
            ..RiderInput::default()
        });
        assert_eq!(found[0].exe, toolbox_exe);
        assert_eq!(found[0].source, RiderSource::ToolboxScript);
        // The same exe isn't listed twice.
        assert_eq!(found.iter().filter(|i| i.exe == toolbox_exe).count(), 1);
        assert_eq!(found.last().unwrap().source, RiderSource::ProgramFiles);
    }

    #[test]
    fn f24_4_settings_value_wins_and_missing_files_are_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = install(&tmp.path().join("custom rider"), "2026.1", "261.1");
        let found = discover(&RiderInput {
            configured: Some(custom.clone()),
            ..RiderInput::default()
        });
        assert_eq!(
            found.map(|i| (i.exe, i.source)),
            Some((custom, RiderSource::Settings))
        );
        assert_eq!(
            discover(&RiderInput {
                configured: Some(tmp.path().join("gone").join(EXE)),
                ..RiderInput::default()
            }),
            None
        );
    }

    #[test]
    fn reads_toolbox_scripts() {
        assert_eq!(
            exe_from_toolbox_script(
                "@echo off\r\nstart \"\" \"C:\\Users\\Zażółć\\AppData\\Local\\Programs\\Rider\\bin\\rider64.exe\" %*\r\n"
            ),
            Some(PathBuf::from(
                r"C:\Users\Zażółć\AppData\Local\Programs\Rider\bin\rider64.exe"
            ))
        );
        assert_eq!(
            exe_from_toolbox_script("@echo off\r\necho nothing\r\n"),
            None
        );
    }

    #[test]
    fn f24_1_open_at_line_arguments() {
        let args = open_args(Path::new(r"C:\Repos\app\Zażółć gęślą\A.cs"), 42, Some(7));
        assert_eq!(
            args,
            [
                "--line",
                "42",
                "--column",
                "7",
                r"C:\Repos\app\Zażółć gęślą\A.cs"
            ]
            .map(std::ffi::OsString::from)
        );
        assert_eq!(open_args(Path::new("A.cs"), 1, None).len(), 3);
    }
}
