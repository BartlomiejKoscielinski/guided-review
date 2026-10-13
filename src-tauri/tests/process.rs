//! `os/process.rs` against a real child process (`gr-test-child`, see `tests/bin/`).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test helpers")]

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use guided_review_lib::os::process::{self, Cancel, ProcessError, ProcessSpec};

fn child() -> ProcessSpec {
    ProcessSpec::new(env!("CARGO_BIN_EXE_gr-test-child"))
}

/// Whether a process with this id is running (`tasklist` prints it as a CSV field).
fn is_running(pid: u32) -> bool {
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\""))
}

async fn wait_for_pids(pid_file: &Path) -> (u32, u32) {
    for _ in 0..200 {
        if let Ok(text) = std::fs::read_to_string(pid_file) {
            let pids: Vec<u32> = text
                .split_whitespace()
                .filter_map(|p| p.parse().ok())
                .collect();
            if pids.len() == 2 {
                return (pids[0], pids[1]);
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the child did not write its pid file");
}

async fn assert_gone(pids: &[u32]) {
    for _ in 0..100 {
        if pids.iter().all(|&pid| !is_running(pid)) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("still running: {pids:?}");
}

fn pid_file(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("zażółć pids.txt")
}

#[tokio::test]
async fn nfr02_cancel_kills_the_whole_process_tree() {
    let dir = tempfile::tempdir().unwrap();
    let pids_path = pid_file(&dir);
    let spec = child().arg("tree").arg(&pids_path);
    let cancel = Cancel::new();
    let run = tokio::spawn({
        let cancel = cancel.clone();
        async move { process::run(&spec, &cancel).await }
    });
    let (child_pid, grandchild_pid) = wait_for_pids(&pids_path).await;
    assert!(is_running(child_pid) && is_running(grandchild_pid));
    cancel.cancel();
    let result = tokio::time::timeout(Duration::from_secs(10), run)
        .await
        .unwrap()
        .unwrap();
    assert!(
        matches!(result, Err(ProcessError::Cancelled { .. })),
        "{result:?}"
    );
    assert_gone(&[child_pid, grandchild_pid]).await;
}

#[tokio::test]
async fn nfr02_timeout_kills_the_tree_and_reports_timed_out() {
    let dir = tempfile::tempdir().unwrap();
    let pids_path = pid_file(&dir);
    let spec = child()
        .arg("tree")
        .arg(&pids_path)
        .timeout(Duration::from_secs(3));
    let started = Instant::now();
    let result = process::run(&spec, &Cancel::new()).await;
    assert!(
        matches!(result, Err(ProcessError::TimedOut { .. })),
        "{result:?}"
    );
    assert!(started.elapsed() < Duration::from_secs(10));
    let (child_pid, grandchild_pid) = wait_for_pids(&pids_path).await;
    assert_gone(&[child_pid, grandchild_pid]).await;
}

#[tokio::test]
async fn nfr02_dropping_a_running_process_kills_the_tree() {
    let dir = tempfile::tempdir().unwrap();
    let pids_path = pid_file(&dir);
    let spec = child().arg("tree").arg(&pids_path);
    let run = tokio::spawn(async move { process::run(&spec, &Cancel::new()).await });
    let (child_pid, grandchild_pid) = wait_for_pids(&pids_path).await;
    run.abort();
    let _ = run.await;
    assert_gone(&[child_pid, grandchild_pid]).await;
}

#[tokio::test]
async fn a_finished_process_leaves_no_descendants_behind() {
    // The grandchild inherits stdout; without the job, reading stdout would wait for it.
    let dir = tempfile::tempdir().unwrap();
    let pids_path = pid_file(&dir);
    let spec = child()
        .arg("spawn-and-exit")
        .arg(&pids_path)
        .timeout(Duration::from_secs(20));
    let started = Instant::now();
    let output = process::run(&spec, &Cancel::new()).await.unwrap();
    assert!(output.success());
    assert!(started.elapsed() < Duration::from_secs(10));
    let (_, grandchild_pid) = wait_for_pids(&pids_path).await;
    assert_gone(&[grandchild_pid]).await;
}

#[tokio::test]
async fn nfr04_arguments_reach_the_child_verbatim_without_a_shell() {
    let args = [
        "",
        "two words",
        r#"{"type":"object","properties":{"a":{"type":"string"}}}"#,
        r#"quote " and backslash \ and \\" end"#,
        "& | > < ^ %PATH% !x! $(whoami) `id`",
        "zażółć gęślą jaźń",
        "C:\\Program Files\\Zażółć\\",
    ];
    let spec = child().arg("argv").args(args);
    let output = process::run(&spec, &Cancel::new()).await.unwrap();
    let received: Vec<String> = serde_json::from_str(&output.stdout).unwrap();
    assert_eq!(received, args);
}

#[tokio::test]
async fn process_writes_large_stdin_without_deadlock() {
    let input: Vec<u8> = (0..4 * 1024 * 1024)
        .map(|i| b'a' + (i % 26) as u8)
        .collect();
    let spec = child()
        .arg("echo-stdin")
        .stdin(input.clone())
        .timeout(Duration::from_secs(30));
    let output = process::run(&spec, &Cancel::new()).await.unwrap();
    assert_eq!(output.stdout.len(), input.len());
    assert!(output.stdout.as_bytes() == input.as_slice());
}

#[tokio::test]
async fn process_without_stdin_gets_an_empty_stdin() {
    let output = process::run(&child().arg("echo-stdin"), &Cancel::new())
        .await
        .unwrap();
    assert_eq!(output.stdout, "");
}

#[tokio::test]
async fn process_decodes_utf8_and_keeps_crlf() {
    let output = process::run(&child().arg("utf8"), &Cancel::new())
        .await
        .unwrap();
    assert_eq!(output.stdout, "zażółć gęślą jaźń\r\nZAŻÓŁĆ\n");
    assert!(!output.lossy);
}

#[tokio::test]
async fn process_streams_stdout_lines_and_keeps_the_whole_output() {
    let mut lines = Vec::new();
    let mut on_line = |line: &str| lines.push(line.to_owned());
    let output = process::run_streaming(&child().arg("utf8"), &Cancel::new(), &mut on_line)
        .await
        .unwrap();
    assert_eq!(lines, ["zażółć gęślą jaźń", "ZAŻÓŁĆ"]);
    assert_eq!(output.stdout, "zażółć gęślą jaźń\r\nZAŻÓŁĆ\n");
}

#[tokio::test]
async fn process_flags_invalid_utf8() {
    let output = process::run(&child().arg("invalid-utf8"), &Cancel::new())
        .await
        .unwrap();
    assert_eq!(output.stdout, "f\u{fffd}o");
    assert!(output.lossy);
}

#[tokio::test]
async fn process_reports_exit_code_and_stderr() {
    let output = process::run(&child().args(["exit", "7"]), &Cancel::new())
        .await
        .unwrap();
    assert_eq!(output.code, Some(7));
    assert!(!output.success());
    assert_eq!(output.stderr, "STDERR-CANARY");
}

#[tokio::test]
async fn process_missing_program_is_not_found() {
    let spec = ProcessSpec::new("C:\\Zażółć\\does-not-exist.exe");
    let result = process::run(&spec, &Cancel::new()).await;
    assert!(
        matches!(&result, Err(ProcessError::NotFound { program }) if program == "does-not-exist.exe"),
        "{result:?}"
    );
}

#[tokio::test]
async fn process_environment_changes_apply() {
    let removed = process::run(
        &child().args(["env", "PATH"]).env_remove("PATH"),
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert_eq!(removed.stdout, "<unset>");
    let set = process::run(
        &child()
            .args(["env", "GR_TEST_VALUE"])
            .env("GR_TEST_VALUE", "zażółć"),
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert_eq!(set.stdout, "zażółć");
}

#[tokio::test]
async fn process_runs_in_the_given_working_directory() {
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().join("Zażółć gęślą");
    std::fs::create_dir(&cwd).unwrap();
    let spec = child().args(["tree", "pids.txt"]).cwd(&cwd);
    let cancel = Cancel::new();
    let run = tokio::spawn({
        let cancel = cancel.clone();
        async move { process::run(&spec, &cancel).await }
    });
    // A relative pid file lands in the working directory.
    let (child_pid, grandchild_pid) = wait_for_pids(&cwd.join("pids.txt")).await;
    cancel.cancel();
    let _ = run.await;
    assert_gone(&[child_pid, grandchild_pid]).await;
}

#[test]
fn process_creation_flags_include_create_no_window() {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_SUSPENDED: u32 = 0x0000_0004;
    let flags = process::creation_flags();
    assert_eq!(flags & CREATE_NO_WINDOW, CREATE_NO_WINDOW);
    if cfg!(windows) {
        assert_eq!(flags & CREATE_SUSPENDED, CREATE_SUSPENDED);
    }
}

#[test]
fn a_cancelled_run_never_starts_the_program() {
    let cancel = Cancel::new();
    cancel.cancel();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let pids_path = pid_file(&dir);
    let result = runtime.block_on(process::run(&child().arg("tree").arg(&pids_path), &cancel));
    assert!(matches!(result, Err(ProcessError::Cancelled { .. })));
    std::thread::sleep(Duration::from_millis(500));
    assert!(!pids_path.exists());
}

#[tokio::test]
async fn detached_process_outlives_the_call() {
    let dir = tempfile::tempdir().unwrap();
    let pids_path = pid_file(&dir);
    let args: Vec<OsString> = vec!["tree".into(), pids_path.clone().into()];
    let program = PathBuf::from(env!("CARGO_BIN_EXE_gr-test-child"));
    let pid = process::spawn_detached(&program, &args, None).unwrap();
    let (child_pid, grandchild_pid) = wait_for_pids(&pids_path).await;
    assert_eq!(pid, child_pid);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(is_running(child_pid));
    for pid in [child_pid, grandchild_pid] {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
    }
}
