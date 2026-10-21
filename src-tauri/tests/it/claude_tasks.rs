//! Claude startup checks and the commit message task against the fake `claude` (docs/09 ›
//! Fake `claude`) on fixture repositories (F-16.4, F-18.1, F-18.3, F-18.7, F-30.5).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fake_claude;
use crate::fixture_repo;

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::ClaudeError;
use guided_review_lib::claude::commit_message::{self, Context};
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::status::{self, CheckInput, ClaudeState};
use guided_review_lib::git::Git;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::settings::{ClaudeSettings, Lang};
use serde_json::{Value, json};

fn fake() -> FakeClaude {
    FakeClaude::new(
        std::path::Path::new(env!("CARGO_BIN_EXE_fake-claude")),
        &json!({}),
    )
}

fn result(body: Value) -> Value {
    let mut base =
        json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": "s" });
    base.as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    json!({ "stdout": base.to_string() })
}

fn input(fake: &FakeClaude, probed: Option<&str>) -> CheckInput {
    CheckInput {
        configured: Some(fake.exe.clone()),
        probed_version: probed.map(str::to_owned),
        reprobe: false,
        cwd: fake.dir.path().to_path_buf(),
    }
}

#[tokio::test]
async fn f18_1_status_from_version_auth_status_and_probe() {
    let fake = fake();
    fake.set_scenario(&json!({ "responses": [result(json!({ "result": "OK" }))] }));
    let cancel = Cancel::new();
    let outcome = status::check(&input(&fake, None), &cancel).await;
    assert_eq!(outcome.status.state, ClaudeState::SignedIn);
    assert_eq!(outcome.status.version.as_deref(), Some("2.1.296"));
    assert_eq!(outcome.probed.as_deref(), Some("2.1.296"));
    let probe = &fake.calls()[0]["argv"];
    for flag in [
        "--restricted",
        "--strict-mcp-config",
        "--no-session-persistence",
    ] {
        assert!(
            probe.as_array().unwrap().iter().any(|a| a == flag),
            "{flag}"
        );
    }
    // Same version as the last successful probe: no new probe.
    let again = status::check(&input(&fake, Some("2.1.296")), &cancel).await;
    assert_eq!(again.status.state, ClaudeState::SignedIn);
    assert_eq!(fake.calls().len(), 1);

    fake.set_scenario(
        &json!({ "auth": { "loggedIn": false, "authMethod": "none" }, "authExit": 1 }),
    );
    let out = status::check(&input(&fake, Some("2.1.296")), &cancel).await;
    assert_eq!(out.status.state, ClaudeState::NotSignedIn);

    fake.set_scenario(&json!({ "version": "2.1.200 (Claude Code)" }));
    let old = status::check(&input(&fake, None), &cancel).await;
    assert_eq!(old.status.state, ClaudeState::TooOld);

    // auth status trusts stored credentials; only the probe catches an expired login (S1).
    fake.set_scenario(&json!({ "responses": [{ "stdout": json!({
        "type": "result", "is_error": true, "terminal_reason": "api_error",
        "result": "Failed to authenticate: OAuth session expired" }).to_string(), "exit": 1 }] }));
    let expired = status::check(&input(&fake, None), &cancel).await;
    assert_eq!(expired.status.state, ClaudeState::NotSignedIn);
    assert_eq!(expired.probed, None);
}

#[tokio::test]
async fn f18_1_missing_executable_is_not_found() {
    let input = CheckInput {
        configured: Some(std::env::temp_dir().join("no such claude ż.exe")),
        probed_version: None,
        reprobe: false,
        cwd: std::env::temp_dir(),
    };
    // Discovery falls through to the real install when one exists; only check the mapping
    // when nothing is found.
    let outcome = status::check(&input, &Cancel::new()).await;
    if outcome.executable.is_none() {
        assert_eq!(outcome.status.state, ClaudeState::NotFound);
    }
}

fn staged_repo() -> FixtureRepo {
    let repo = FixtureRepo::new("commit-msg");
    repo.write("src/Zażółć/A b.cs", "class A {}\n");
    repo.commit_all("Add A");
    repo.write("src/Zażółć/A b.cs", "class A { int x; }\n");
    repo.git(&["add", "-A"]);
    repo
}

#[tokio::test]
async fn f16_4_commit_message_task_reads_the_staged_diff_with_the_read_only_profile() {
    let repo = staged_repo();
    let fake = fake();
    fake.set_scenario(&json!({ "responses": [result(json!({
        "structured_output": { "summary": "Add a field to A", "body": "" }
    }))] }));
    let tmp = tempfile::tempdir().unwrap();
    let settings = ClaudeSettings {
        lang: Lang::Pl,
        ..ClaudeSettings::default()
    };
    let git = Git::new(None, &repo.path);
    let queue = Queue::new(2);
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    let ctx = Context {
        exe: &exe,
        settings: &settings,
        git: &git,
        tmp_root: tmp.path(),
        queue: &queue,
    };
    let message = commit_message::run(&ctx, &Cancel::new()).await.unwrap();
    assert_eq!(message, "Add a field to A");

    let call = &fake.calls()[0];
    let argv: Vec<&str> = call["argv"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap())
        .collect();
    let has = |pair: [&str; 2]| argv.windows(2).any(|w| w == pair);
    assert!(has(["--tools", "Read,Grep,Glob"]));
    assert!(has(["--permission-mode", "dontAsk"]));
    assert!(has(["--disallowedTools", "mcp__*"]));
    assert!(
        has(["--model", "claude-haiku-5-5"]),
        "F-18.3 commit group: haiku"
    );
    assert!(has(["--effort", "low"]));
    assert!(argv.contains(&"--restricted"));
    assert!(argv.contains(&"--no-session-persistence"));
    assert!(argv.contains(&"--json-schema"));
    assert!(
        !argv
            .iter()
            .any(|a| a.contains("bare") || a.contains("dangerously"))
    );
    // The prompt is on stdin and points at the diff in the task folder.
    let stdin = call["stdin"].as_str().unwrap();
    assert!(stdin.contains("staged.diff"));
    assert!(stdin.contains("- Add A"));
    let files = &call["addDirFiles"];
    assert!(
        files["staged.diff"]
            .as_str()
            .unwrap()
            .contains("+class A { int x; }")
    );
    // F-30.5: Claude writes in the "Writes in" language.
    assert!(
        files["system-common.md"]
            .as_str()
            .unwrap()
            .contains("text in Polish.")
    );
    assert_eq!(
        call["cwd"].as_str().map(std::path::PathBuf::from),
        Some(repo.path.clone())
    );
    // The task folder is gone.
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn f18_7_usage_limit_is_reported_and_nothing_is_lost() {
    let repo = staged_repo();
    let fake = fake();
    fake.set_scenario(&json!({ "responses": [{ "exit": 1, "stdout": json!({
        "type": "result", "subtype": "success", "is_error": true, "api_error_status": 429,
        "terminal_reason": "api_error", "result": "Claude usage limit reached" }).to_string() }] }));
    let tmp = tempfile::tempdir().unwrap();
    let settings = ClaudeSettings::default();
    let git = Git::new(None, &repo.path);
    let queue = Queue::new(2);
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    let ctx = Context {
        exe: &exe,
        settings: &settings,
        git: &git,
        tmp_root: tmp.path(),
        queue: &queue,
    };
    let err = commit_message::run(&ctx, &Cancel::new()).await.unwrap_err();
    assert!(matches!(err, ClaudeError::Limited { .. }), "{err:?}");
    // The staged changes are still staged.
    assert!(repo.staged().contains("+class A { int x; }"));
}

#[tokio::test]
async fn f16_4_nothing_staged_asks_to_stage_first() {
    let repo = FixtureRepo::new("nothing-staged");
    repo.write("a.txt", "a\n");
    repo.commit_all("base");
    let fake = fake();
    let tmp = tempfile::tempdir().unwrap();
    let settings = ClaudeSettings::default();
    let git = Git::new(None, &repo.path);
    let queue = Queue::new(1);
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    let ctx = Context {
        exe: &exe,
        settings: &settings,
        git: &git,
        tmp_root: tmp.path(),
        queue: &queue,
    };
    let err = commit_message::run(&ctx, &Cancel::new()).await.unwrap_err();
    assert!(matches!(err, ClaudeError::Invalid(_)));
    assert!(fake.calls().is_empty(), "claude never runs");
}

/// S-10's Suggest describes the fixed file as the fix commit takes it (`git diff HEAD -- <file>`):
/// its unstaged edit is in, another file that is staged stays out (M7 decision 10).
#[tokio::test]
async fn f26_4_suggest_on_s10_describes_the_fixed_file_not_the_staged_changes() {
    let repo = FixtureRepo::new("commit-msg-only");
    repo.write(
        "src/Zażółć/Upload Worker.cs",
        "class W { int delay = 1; }\n",
    );
    repo.write("src/Other.cs", "class O {}\n");
    repo.commit_all("Add worker");
    repo.write("src/Other.cs", "class O { int staged; }\n");
    repo.git(&["add", "src/Other.cs"]);
    repo.write(
        "src/Zażółć/Upload Worker.cs",
        "class W { int delay = 60; }\n",
    );
    let fake = fake();
    fake.set_scenario(&json!({ "responses": [result(json!({
        "structured_output": { "summary": "UploadWorker: cap the delay", "body": "" }
    }))] }));
    let tmp = tempfile::tempdir().unwrap();
    let settings = ClaudeSettings::default();
    let git = Git::new(None, &repo.path);
    let queue = Queue::new(1);
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    let ctx = Context {
        exe: &exe,
        settings: &settings,
        git: &git,
        tmp_root: tmp.path(),
        queue: &queue,
    };
    let only = vec!["src/Zażółć/Upload Worker.cs".to_owned()];
    let message = commit_message::run_for(&ctx, &only, &Cancel::new())
        .await
        .unwrap();
    assert_eq!(message, "UploadWorker: cap the delay");
    let diff = fake.calls()[0]["addDirFiles"]["staged.diff"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(diff.contains("+class W { int delay = 60; }"), "{diff}");
    assert!(!diff.contains("Other.cs"), "{diff}");
    // Nothing moved: the other file is still staged, the fixed file still unstaged.
    assert!(repo.staged().contains("+class O { int staged; }"));
    assert!(!repo.staged().contains("delay = 60"));

    // The fixed file without changes: nothing to describe, and claude never runs.
    repo.git(&["checkout", "--", "src/Zażółć/Upload Worker.cs"]);
    let err = commit_message::run_for(&ctx, &only, &Cancel::new())
        .await
        .unwrap_err();
    assert!(
        matches!(&err, ClaudeError::Invalid(m) if m == "The file has no changes to describe."),
        "{err:?}"
    );
    assert_eq!(fake.calls().len(), 1);
}

/// Layer 2 (docs/09 › Environments): the real Claude Code on a synthetic fixture repository.
/// Uses the developer's own login; run by hand:
/// `cargo test --test it claude_tasks::real_claude -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "runs the real claude (uses the developer's Claude usage)"]
async fn real_claude_checks_and_commit_message_on_a_fixture_repo() {
    let tmp = tempfile::tempdir().unwrap();
    let check = status::check(
        &CheckInput {
            configured: None,
            probed_version: None,
            reprobe: true,
            cwd: tmp.path().to_path_buf(),
        },
        &Cancel::new(),
    )
    .await;
    println!("status: {:?}", check.status);
    assert_eq!(check.status.state, ClaudeState::SignedIn);
    let repo = staged_repo();
    let settings = ClaudeSettings::default();
    let git = Git::new(None, &repo.path);
    let queue = Queue::new(2);
    let exe = check.executable.unwrap();
    let ctx = Context {
        exe: &exe,
        settings: &settings,
        git: &git,
        tmp_root: tmp.path(),
        queue: &queue,
    };
    let message = commit_message::run(&ctx, &Cancel::new()).await.unwrap();
    println!("message: {message}");
    assert!(!message.is_empty() && message.lines().next().unwrap().chars().count() <= 72);
}
