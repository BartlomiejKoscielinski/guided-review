//! A stand-in for `claude.exe` in tests (docs/09 › Fake `claude`). It reads its scenario from
//! `fake-claude.json` next to its own executable (each test copies it into its own folder, so
//! tests can run in parallel) and records every run to `calls.jsonl` in the same folder.
//!
//! Scenario keys (all optional):
//! - `version`: printed for `--version` (default "2.1.296 (Claude Code)").
//! - `auth`: JSON printed for `auth status` (default signed in); `authExit`: its exit code.
//! - `responses`: list of `{ "stdout", "stderr", "exit", "sleepMs" }`, one per `-p` run in
//!   order (the last one repeats).
//!
//! A `-p` run records `argv`, `stdin`, `cwd` and the files in its `--add-dir` folder
//! (`addDirFiles`, name → content), because the app deletes that folder after the task.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use serde_json::{Value, json};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
    else {
        return ExitCode::from(90);
    };
    let scenario: Value = std::fs::read(dir.join("fake-claude.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| json!({}));
    let mut out = std::io::stdout();

    if args.iter().any(|a| a == "--version") {
        let version = scenario["version"]
            .as_str()
            .unwrap_or("2.1.296 (Claude Code)");
        let _ = writeln!(out, "{version}");
        return ExitCode::SUCCESS;
    }
    if args.first().map(String::as_str) == Some("auth") {
        if args.get(1).map(String::as_str) == Some("status") {
            let auth = scenario.get("auth").cloned().unwrap_or_else(
                || json!({ "loggedIn": true, "authMethod": "claude.ai", "email": "x@example.invalid" }),
            );
            let _ = writeln!(out, "{auth}");
            let code = scenario["authExit"].as_u64().unwrap_or(0);
            return ExitCode::from(u8::try_from(code).unwrap_or(1));
        }
        return ExitCode::SUCCESS;
    }

    let mut stdin = String::new();
    let _ = std::io::stdin().read_to_string(&mut stdin);
    let add_dir = args
        .iter()
        .position(|a| a == "--add-dir")
        .and_then(|i| args.get(i + 1));
    let mut files = BTreeMap::new();
    if let Some(entries) = add_dir.and_then(|dir| std::fs::read_dir(dir).ok()) {
        for entry in entries.flatten() {
            let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
            files.insert(entry.file_name().to_string_lossy().into_owned(), content);
        }
    }
    let log = dir.join("calls.jsonl");
    let previous = std::fs::read_to_string(&log)
        .map(|t| t.lines().count())
        .unwrap_or(0);
    let record = json!({
        "argv": args,
        "stdin": stdin,
        "cwd": std::env::current_dir().ok(),
        "addDirFiles": files,
    });
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)
    {
        let _ = writeln!(file, "{record}");
    }

    let responses = scenario["responses"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let response = responses
        .get(previous)
        .or_else(|| responses.last())
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Some(ms) = response["sleepMs"].as_u64() {
        std::thread::sleep(Duration::from_millis(ms));
    }
    if let Some(text) = response["stdout"].as_str() {
        let _ = out.write_all(text.as_bytes());
    } else if !response["stdout"].is_null() {
        let _ = writeln!(out, "{}", response["stdout"]);
    }
    if let Some(text) = response["stderr"].as_str() {
        let _ = std::io::stderr().write_all(text.as_bytes());
    }
    let code = response["exit"].as_u64().unwrap_or(0);
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}
