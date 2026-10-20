//! docs/06 › Tauri configuration: capabilities grant only what the UI uses, and the release CSP
//! loads nothing remote and allows no inline or eval'd script (T10). Reads the shipped config
//! files; a new permission or CSP source is a reviewed change to this allowlist.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use std::path::PathBuf;

use serde_json::Value;

/// Permissions the main window may hold (`src/ipc/tauri.ts`, `src/ipc/tauri-window.ts`).
const ALLOWED: &[&str] = &[
    "core:event:default",
    "core:window:default",
    "core:window:allow-start-dragging",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
];

fn read_json(relative: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    let text = std::fs::read_to_string(&path).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn capability_files() -> Vec<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    files
}

#[test]
fn security_06_capabilities_grant_only_the_allowlisted_permissions() {
    let files = capability_files();
    assert!(!files.is_empty(), "no capability files found");
    for file in files {
        let capability: Value =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        let permissions = capability["permissions"].as_array().unwrap();
        for permission in permissions {
            // A scoped permission is an object with an `identifier`.
            let id = permission
                .as_str()
                .or_else(|| permission["identifier"].as_str())
                .unwrap();
            assert_ne!(
                id,
                "core:default",
                "{}: core:default grants menu, tray, image and path",
                file.display()
            );
            assert!(
                ALLOWED.contains(&id),
                "{}: {id} is not in the allowlist",
                file.display()
            );
        }
    }
}

#[test]
fn security_06_release_csp_has_no_unsafe_or_remote_sources() {
    let config = read_json("tauri.conf.json");
    let csp = config["app"]["security"]["csp"]
        .as_object()
        .expect("a release CSP is set");
    assert_eq!(csp["default-src"], "'self'");
    for (directive, sources) in csp {
        let sources = sources.as_str().unwrap();
        for source in sources.split_whitespace() {
            assert!(
                !source.contains("unsafe-"),
                "{directive}: {source} is not allowed in the release CSP"
            );
            let remote = (source.starts_with("http://") || source.starts_with("https://"))
                && !source.ends_with(".localhost");
            assert!(!remote, "{directive}: {source} loads remote content");
        }
    }
    assert_eq!(config["app"]["security"]["freezePrototype"], true);
}
