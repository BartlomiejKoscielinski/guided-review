//! Rider part of `env` (S9, F-24.4): every install the app's discovery finds, its config folder
//! and External Tools file (existence only, never contents), and JetBrains registry keys.

use guided_review_lib::os::process::ProcessSpec;
use guided_review_lib::os::rider::{RiderInput, discover_all};

use crate::env::output;
use crate::report::{Check, Detail, Outcome};

pub async fn rider_checks() -> Vec<Check> {
    let installs = discover_all(&RiderInput::from_env(None));
    let mut checks = vec![
        Check::new(
            "rider.installs",
            if installs.is_empty() {
                Outcome::Fail
            } else {
                Outcome::Pass
            },
        )
        .detail(Detail::Number(i64::try_from(installs.len()).unwrap_or(-1))),
    ];
    let app_data = dirs::config_dir();
    for (index, install) in installs.iter().enumerate() {
        let id = |name: &str| format!("rider.{index}.{name}");
        let source = serde_json::to_value(install.source)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        checks.push(Check::new(&id("source"), Outcome::Info).detail(Detail::Code(source)));
        checks.push(
            Check::new(&id("exe"), Outcome::Info)
                .detail(Detail::Path(install.exe.to_string_lossy().into_owned())),
        );
        for (name, value) in [("version", &install.version), ("build", &install.build)] {
            if let Some(value) = value {
                checks.push(
                    Check::new(&id(name), Outcome::Info).detail(Detail::Version(value.clone())),
                );
            }
        }
        if let Some(name) = &install.data_directory_name {
            checks.push(
                Check::new(&id("data_directory_name"), Outcome::Info)
                    .detail(Detail::Code(name.clone())),
            );
        }
        if let Some(config) = app_data.as_ref().and_then(|data| install.config_dir(data)) {
            checks.push(
                Check::new(&id("config_dir_exists"), Outcome::Info)
                    .detail(Detail::Bool(config.is_dir())),
            );
            let tools = config.join("tools").join("External Tools.xml");
            checks.push(
                Check::new(&id("external_tools_xml_exists"), Outcome::Info)
                    .detail(Detail::Bool(tools.is_file())),
            );
        }
    }
    let toolbox = dirs::data_local_dir().map(|local| local.join("JetBrains").join("Toolbox"));
    checks.push(
        Check::new("rider.toolbox_installed", Outcome::Info)
            .detail(Detail::Bool(toolbox.is_some_and(|t| t.is_dir()))),
    );
    for (name, key) in [
        (
            "rider.registry_hklm",
            r"HKLM\SOFTWARE\JetBrains\JetBrains Rider",
        ),
        (
            "rider.registry_hkcu",
            r"HKCU\SOFTWARE\JetBrains\JetBrains Rider",
        ),
        (
            "rider.registry_app_paths",
            r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\rider64.exe",
        ),
    ] {
        let exists = output(ProcessSpec::new("reg").args(["query", key]))
            .await
            .is_some();
        checks.push(Check::new(name, Outcome::Info).detail(Detail::Bool(exists)));
    }
    checks
}
