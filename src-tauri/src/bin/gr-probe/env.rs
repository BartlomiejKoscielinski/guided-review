//! `env`: what the app will find on this machine: Windows build, git, Claude Code (path per
//! ADR-021, version), WebView2, proxy settings. Rider paths are added with S9.

use std::time::Duration;

use guided_review_lib::claude::discover::{ClaudeExecutable, DiscoveryInput, discover};
use guided_review_lib::claude::runner;
use guided_review_lib::os::process::{self, Cancel, ProcessSpec};

use crate::report::{Check, Detail, Outcome};

/// Minimum Claude Code version (ADR-022, `--restricted`).
pub const CLAUDE_MINIMUM: (u32, u32, u32) = (2, 1, 248);
const TIMEOUT: Duration = Duration::from_secs(15);
const WINDOWS_KEY: &str = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion";
const WEBVIEW2_KEY: &str = r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
const INTERNET_SETTINGS_KEY: &str =
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";

pub async fn run() -> Vec<Check> {
    let mut checks = Vec::new();
    for (id, name) in [
        ("windows.product", "ProductName"),
        ("windows.display_version", "DisplayVersion"),
        ("windows.build", "CurrentBuild"),
    ] {
        checks.push(info_version(id, reg_value(WINDOWS_KEY, name).await));
    }
    // ProductName still says "Windows 10" on Windows 11; the build number tells them apart.
    let build: Option<u32> = reg_value(WINDOWS_KEY, "CurrentBuild")
        .await
        .and_then(|b| b.parse().ok());
    if let Some(build) = build {
        let generation = if build >= 22_000 {
            "windows_11"
        } else {
            "windows_10"
        };
        checks.push(
            Check::new("windows.generation", Outcome::Info).detail(Detail::Code(generation.into())),
        );
    }
    let git = output(ProcessSpec::new("git").arg("--version")).await;
    checks.push(info_version(
        "git.version",
        git.map(|text| text.trim().trim_start_matches("git version ").to_owned()),
    ));
    checks.extend(claude_checks().await);
    checks.push(info_version(
        "webview2.version",
        reg_value(WEBVIEW2_KEY, "pv").await,
    ));
    let proxy = reg_value(INTERNET_SETTINGS_KEY, "ProxyEnable").await;
    checks.push(
        Check::new("proxy.system_enabled", Outcome::Info)
            .detail(Detail::Bool(proxy.as_deref() == Some("0x1"))),
    );
    checks.push(
        Check::new("proxy.pac_configured", Outcome::Info).detail(Detail::Bool(
            reg_value(INTERNET_SETTINGS_KEY, "AutoConfigURL")
                .await
                .is_some(),
        )),
    );
    checks
}

async fn claude_checks() -> Vec<Check> {
    let Some(executable) = discover(&DiscoveryInput::from_env(None)) else {
        return vec![
            Check::new("claude.discovered", Outcome::Fail).detail(Detail::Code("none".into())),
        ];
    };
    let kind = match executable {
        ClaudeExecutable::Native(_) => "native",
        ClaudeExecutable::NodeScript { .. } => "npm",
    };
    let path = executable.display_path().to_string_lossy().into_owned();
    let mut checks = vec![
        Check::new("claude.discovered", Outcome::Pass).detail(Detail::Code(kind.into())),
        Check::new("claude.path", Outcome::Info).detail(Detail::Path(path)),
    ];
    let cwd = std::env::temp_dir();
    let spec = runner::process_spec(&executable, runner::version_args(), &cwd, None, TIMEOUT);
    let version = output(spec).await;
    let parsed = version.as_deref().and_then(parse_version);
    checks.push(info_version(
        "claude.version",
        version.map(|v| v.trim().to_owned()),
    ));
    let meets = parsed.is_some_and(|v| v >= CLAUDE_MINIMUM);
    checks.push(
        Check::new(
            "claude.meets_minimum_2_1_248",
            if meets { Outcome::Pass } else { Outcome::Fail },
        )
        .detail(Detail::Bool(meets)),
    );
    checks
}

/// `2.1.296 (Claude Code)` → (2, 1, 296).
pub fn parse_version(text: &str) -> Option<(u32, u32, u32)> {
    let mut parts = text.split_whitespace().next()?.split('.');
    let mut next = || parts.next().and_then(|p| p.parse().ok());
    Some((next()?, next()?, next()?))
}

fn info_version(id: &str, value: Option<String>) -> Check {
    match value {
        Some(value) => Check::new(id, Outcome::Info).detail(Detail::Version(value)),
        None => Check::new(id, Outcome::Skip),
    }
}

/// Stdout of a successful run, or `None`.
pub async fn output(spec: ProcessSpec) -> Option<String> {
    let output = process::run(&spec.timeout(TIMEOUT), &Cancel::new())
        .await
        .ok()?;
    output.success().then_some(output.stdout)
}

/// A registry value through `reg query` (an argument array, no shell); `None` when missing.
pub async fn reg_value(key: &str, name: &str) -> Option<String> {
    let text = output(ProcessSpec::new("reg").args(["query", key, "/v", name])).await?;
    parse_reg_value(&text, name)
}

/// `    CurrentBuild    REG_SZ    26200` → `26200`.
pub fn parse_reg_value(text: &str, name: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        if !parts.next()?.eq_ignore_ascii_case(name) {
            return None;
        }
        let kind = parts.next()?;
        if !kind.starts_with("REG_") {
            return None;
        }
        let value = parts.collect::<Vec<_>>().join(" ");
        (!value.is_empty()).then_some(value)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_reg_query_output() {
        let text = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\r\n    ProductName    REG_SZ    Windows 11 Pro\r\n\r\n";
        assert_eq!(
            parse_reg_value(text, "ProductName").as_deref(),
            Some("Windows 11 Pro")
        );
        assert_eq!(
            parse_reg_value("    ProxyEnable    REG_DWORD    0x1", "ProxyEnable").as_deref(),
            Some("0x1")
        );
        assert_eq!(parse_reg_value(text, "CurrentBuild"), None);
    }

    #[test]
    fn parses_claude_versions() {
        assert_eq!(parse_version("2.1.296 (Claude Code)\n"), Some((2, 1, 296)));
        assert!(parse_version("2.1.247 (Claude Code)").unwrap() < CLAUDE_MINIMUM);
        assert_eq!(parse_version("garbage"), None);
    }
}
