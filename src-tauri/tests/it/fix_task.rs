//! F-25.2 The fix task against the fake `claude` (docs/09 > Fake `claude`; docs/05 > Fix on own
//! code, ADR-018, ADR-022, M7 decision 3): Claude runs with the fix profile from `runner.rs`,
//! its working directory is the scratch copy, and only the one file may be edited. The user's
//! checkout is never the working directory. Synthetic data only (ADR-019).
//!
//! Contract the tests lock (the module is `claude::tasks::fix`):
//! `run(&Context, &FixRequest, on_started, &Cancel) -> Result<FixOutcome, ClaudeError>` with
//! `Context` from `claude::tasks::plan`; `FixRequest { scratch: &Scratch, origin: &str,
//! request: &str, context: &str }` (the prompt placeholders `{{file}}` = `scratch.file`,
//! `{{origin}}`, `{{request}}`, `{{context}}` of `prompts/fix.md`); `FixOutcome { changed: bool,
//! explanation: String }`; `NO_CHANGE: &str = "Claude made no change."` (the line the fix card
//! shows above Claude's sentence when `changed` is false; M7 decision 3). The model and effort
//! come from the "Fixes on your code" override group (`settings.tasks.fix`). A fix run is never
//! cached: the file differs each time.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fake_claude;
use crate::fixture_repo;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::ClaudeError;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::tasks::fix::{self, FixRequest, NO_CHANGE};
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::git::Git;
use guided_review_lib::git::scratch::{self, Scratch};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::settings::{ClaudeSettings, TaskEffort, TaskOverride};
use guided_review_lib::store::{Store, repos};
use serde_json::{Value, json};

const FILE: &str = "src/Zażółć gęślą/Upload Queue.cs";
const REQUEST: &str = "Guard Enqueue against a null item.";

fn answer(body: &Value) -> Value {
    let result = json!({ "type": "result", "subtype": "success", "is_error": false,
        "session_id": "s", "structured_output": body });
    json!({ "stdout": result.to_string() })
}

fn argv_of(call: &Value) -> Vec<String> {
    call["argv"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap().to_owned())
        .collect()
}

struct Setup {
    repo: FixtureRepo,
    scratch: Scratch,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

async fn setup() -> Setup {
    let repo = FixtureRepo::new("fix task");
    repo.write(FILE, "class Queue {\n    void Enqueue() { }\n}\n");
    repo.commit_all("Start the queue");
    // Work in progress, so the scratch is a copy of a dirty tree.
    repo.write(
        FILE,
        "class Queue {\n    void Enqueue() { }\n    // mine\n}\n",
    );
    let store = Store::open_in_memory().unwrap();
    let path = repo.path.to_string_lossy().into_owned();
    let row = store
        .with_conn(|c| repos::add(c, "mobile-app ąę", &path, None))
        .unwrap();
    let git = Git::new(None, &repo.path);
    let scratch = scratch::create(
        &git,
        &store,
        row.id,
        &repo.root.join("tmp zażółć").join("scratch"),
        "fix-1",
        Path::new(FILE),
        &Cancel::new(),
    )
    .await
    .unwrap();
    let fake = FakeClaude::new(Path::new(env!("CARGO_BIN_EXE_fake-claude")), &json!({}));
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    Setup {
        repo,
        scratch,
        fake,
        tmp: tempfile::tempdir().unwrap(),
        store,
        queue: Queue::new(2),
        exe,
        settings: ClaudeSettings::default(),
    }
}

impl Setup {
    fn ctx(&self) -> Context<'_> {
        Context {
            exe: &self.exe,
            settings: &self.settings,
            tmp_root: self.tmp.path(),
            queue: &self.queue,
            store: &self.store,
        }
    }

    fn request(&self) -> FixRequest<'_> {
        FixRequest {
            scratch: &self.scratch,
            origin: "a self-review note",
            request: REQUEST,
            context: "Upload Queue.cs line 2",
        }
    }

    async fn run(&self) -> Result<fix::FixOutcome, ClaudeError> {
        fix::run(&self.ctx(), &self.request(), &|| {}, &Cancel::new()).await
    }

    fn says(&self, bodies: &[Value]) {
        let responses: Vec<Value> = bodies.iter().map(answer).collect();
        self.fake.set_scenario(&json!({ "responses": responses }));
    }
}

#[tokio::test]
async fn f25_2_fix_argv() {
    let s = setup().await;
    s.says(&[json!({ "changed": true, "explanation": "Guarded Enqueue against null." })]);
    let started = AtomicUsize::new(0);
    let outcome = fix::run(
        &s.ctx(),
        &s.request(),
        &|| {
            started.fetch_add(1, Ordering::SeqCst);
        },
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert!(outcome.changed);
    assert_eq!(outcome.explanation, "Guarded Enqueue against null.");
    assert_eq!(started.load(Ordering::SeqCst), 1);

    let calls = s.fake.calls();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    let argv = argv_of(call);
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();

    // The fix profile of docs/05: read-only plus Edit for exactly one anchored file.
    assert_eq!(at("--tools"), "Read,Grep,Glob,Edit");
    assert_eq!(
        at("--allowedTools"),
        "Edit(/src/Zażółć gęślą/Upload Queue.cs)"
    );
    assert_eq!(
        argv.iter().filter(|a| a.contains("Edit(")).count(),
        1,
        "{argv:?}"
    );
    assert_eq!(at("--permission-mode"), "dontAsk");
    assert_eq!(at("--disallowedTools"), "mcp__*");
    for flag in [
        "-p",
        "--restricted",
        "--strict-mcp-config",
        "--no-session-persistence",
    ] {
        assert!(argv.iter().any(|a| a == flag), "{flag} missing: {argv:?}");
    }
    for banned in [
        "--bare",
        "--dangerously-skip-permissions",
        "--setting-sources",
    ] {
        assert!(!argv.iter().any(|a| a == banned), "{banned}");
    }
    assert!(!argv.iter().any(|a| a.contains("Bash")), "{argv:?}");
    let schema: Value = serde_json::from_str(&at("--json-schema")).unwrap();
    assert_eq!(schema["title"], "FixResult");
    assert_eq!(PathBuf::from(at("--add-dir")).parent(), Some(s.tmp.path()));

    // Claude works in the scratch copy; the user's checkout is not named anywhere.
    assert_eq!(
        call["cwd"].as_str().map(PathBuf::from),
        Some(s.scratch.path.clone())
    );
    let repo_path = s.repo.path.to_string_lossy().into_owned();
    assert!(
        !argv.iter().any(|a| a.contains(&repo_path)),
        "the user's checkout in argv: {argv:?}"
    );

    // The prompt names the file, the request, where it came from and the context.
    let stdin = call["stdin"].as_str().unwrap();
    assert!(!stdin.contains("{{"), "{stdin}");
    for wanted in [
        FILE,
        REQUEST,
        "a self-review note",
        "Upload Queue.cs line 2",
    ] {
        assert!(
            stdin.contains(wanted),
            "{wanted} not in the prompt: {stdin}"
        );
    }
    // Nothing was written to the user's checkout.
    assert_eq!(
        s.repo.read(FILE),
        "class Queue {\n    void Enqueue() { }\n    // mine\n}\n"
    );
}

#[tokio::test]
async fn f25_2_the_model_follows_the_fixes_on_your_code_group() {
    let mut s = setup().await;
    s.settings.tasks.step = TaskOverride {
        model: "claude-haiku-5-5".into(),
        effort: TaskEffort::Low,
    };
    s.settings.tasks.fix = TaskOverride {
        model: "claude-opus-5-5".into(),
        effort: TaskEffort::High,
    };
    s.says(&[json!({ "changed": true, "explanation": "Done." })]);
    s.run().await.unwrap();
    let argv = argv_of(&s.fake.calls()[0]);
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(at("--model"), "claude-opus-5-5");
    assert_eq!(at("--effort"), "high");
}

#[tokio::test]
async fn f25_2_no_change_carries_claudes_explanation() {
    let s = setup().await;
    s.says(&[json!({ "changed": false, "explanation": "Enqueue already rejects null items." })]);
    let outcome = s.run().await.unwrap();
    assert!(!outcome.changed);
    assert_eq!(outcome.explanation, "Enqueue already rejects null items.");
    assert_eq!(NO_CHANGE, "Claude made no change.");
}

#[tokio::test]
async fn f25_2_a_fix_run_is_never_cached() {
    let s = setup().await;
    s.says(&[
        json!({ "changed": true, "explanation": "First." }),
        json!({ "changed": true, "explanation": "Second." }),
    ]);
    assert_eq!(s.run().await.unwrap().explanation, "First.");
    assert_eq!(s.run().await.unwrap().explanation, "Second.");
    assert_eq!(s.fake.calls().len(), 2);
}

#[tokio::test]
async fn f25_2_an_answer_without_changed_does_not_fit_the_schema() {
    let s = setup().await;
    s.says(&[json!({ "explanation": "I did something." })]);
    let error = s.run().await.unwrap_err();
    assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");

    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [{ "stdout": json!({
        "type": "result", "subtype": "success", "is_error": false, "session_id": "s"
    }).to_string() }] }));
    let error = s.run().await.unwrap_err();
    assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");
}
