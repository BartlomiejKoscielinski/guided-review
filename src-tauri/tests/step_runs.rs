//! `review_findings` and `review_ask` below the Tauri layer (F-09.6, F-10.1, F-10.2): the step
//! context of a stored MR session with its cached plan, one `claude` run per step in flight,
//! and the channel events in order. Fake `claude`, synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fake_claude.rs"]
mod fake_claude;
#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::path::Path;
use std::sync::Mutex;

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::{Priority, Queue};
use guided_review_lib::claude::tasks::events::ClaudeTaskEvent;
use guided_review_lib::claude::tasks::plan::{self, Context, PlanRequest};
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::git::Git;
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::finding_model::Decision;
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::plan_cache;
use guided_review_lib::review::step_context::{self, StepContext, StepContextError};
use guided_review_lib::review::step_runs::{self, StepRuns};
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::{self, Store};
use serde::Serialize;
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
const QUEUE: &str = "src/Core/IQueue.cs";

fn result(body: Value) -> Value {
    let mut base =
        json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": "s" });
    base.as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    base
}

fn vm_findings() -> Value {
    json!({ "stdout": result(json!({ "structured_output": {
        "findings": [{
            "severity": "fix", "kind": "unawaited-call", "title": "Enqueue isn't awaited",
            "body": "The task is dropped.", "file": VM, "side": "new", "line": 2,
            "evidence": [{ "file": QUEUE, "line": 2, "note": "the contract" }],
            "suggested_comment": "Should Enqueue be awaited?"
        }],
        "checklist": [], "files_read": [], "folds": []
    } })).to_string(), "sleepMs": 300 })
}

fn delta(text: &str) -> String {
    json!({ "type": "stream_event", "event": { "type": "content_block_delta", "index": 0,
        "delta": { "type": "text_delta", "text": text } } })
    .to_string()
}

fn streamed(parts: &[&str]) -> Value {
    let mut lines =
        vec![json!({ "type": "system", "subtype": "init", "session_id": "a1" }).to_string()];
    lines.extend(parts.iter().map(|p| delta(p)));
    lines.push(result(json!({ "result": parts.concat(), "session_id": "a1" })).to_string());
    json!({ "stdout": lines.join("\n") + "\n" })
}

struct Setup {
    repo: FixtureRepo,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
    base: String,
    head: String,
}

/// A fixture repository and a stored MR session `r1` (!482) on it, without a plan yet.
fn setup() -> Setup {
    let repo = FixtureRepo::new("step runs");
    repo.write(VM, "class Vm {\n    void Up() { Send(); }\n}\n");
    repo.write(QUEUE, "interface IQueue {\n}\n");
    let base = repo.commit_all("base");
    repo.write(VM, "class Vm {\n    void Up() { queue.Enqueue(); }\n}\n");
    repo.write(QUEUE, "interface IQueue {\n    void Enqueue();\n}\n");
    let head = repo.commit_all("head");
    let store = Store::open_in_memory().unwrap();
    let path = repo.path.to_string_lossy().into_owned();
    let (base_c, head_c) = (base.clone(), head.clone());
    store
        .with_conn(move |c| {
            let row = store::repos::add(c, "app", &path, Some("team/app"))?;
            c.execute(
                "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, mr_json)
                 VALUES ('r1', ?1, '{\"kind\":\"mr\",\"project\":\"team/app\",\"iid\":482}', ?2, ?3,
                 '{\"iid\":482,\"title\":\"Offline queue\",\"author\":\"Alice\",\"sourceBranch\":\"feature/queue\",\"targetBranch\":\"develop\"}')",
                rusqlite::params![row.id, base_c, head_c],
            )?;
            Ok(())
        })
        .unwrap();
    let fake = FakeClaude::new(Path::new(env!("CARGO_BIN_EXE_fake-claude")), &json!({}));
    Setup {
        exe: ClaudeExecutable::Native(fake.exe.clone()),
        repo,
        fake,
        tmp: tempfile::tempdir().unwrap(),
        store,
        queue: Queue::new(2),
        settings: ClaudeSettings::default(),
        base,
        head,
    }
}

fn hunk_of(files: &[FileDiff], path: &str) -> String {
    files
        .iter()
        .find(|f| f.new_path.as_deref() == Some(path))
        .unwrap()
        .hunks[0]
        .id
        .clone()
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

    /// S-02 planned the session: the plan sits in `claude_cache`.
    async fn plan(&self) {
        let git = Git::new(None, &self.repo.path);
        let files = step_context::files(&git, &self.base, &self.head, &Cancel::new())
            .await
            .unwrap();
        let output = json!({
            "intent": "Uploads go through a queue.",
            "steps": [
                { "id": "s1", "title": "ViewModel enqueues", "short_title": "ViewModel",
                  "reason": "Uses the contract.", "description": "The ViewModel enqueues.",
                  "layer": "App", "hunk_ids": [hunk_of(&files, VM)], "builds_on": ["s2"] },
                { "id": "s2", "title": "Queue contract", "short_title": "Contract",
                  "reason": "The base.", "description": "IQueue gets Enqueue.",
                  "layer": "Core", "hunk_ids": [hunk_of(&files, QUEUE)], "builds_on": [] }
            ],
            "orders": { "contract_to_ui": ["s1", "s2"], "tests_first": ["s2", "s1"] },
            "skim": [], "risks": [], "description_check": [], "already_discussed": ""
        });
        let source = PlanSource::Mr {
            iid: 482,
            title: "Offline queue".into(),
            source_branch: "feature/queue".into(),
            target_branch: "develop".into(),
        };
        let key = plan::key(
            &self.ctx(),
            &PlanRequest {
                repo_id: 1,
                project: "team/app",
                source,
                base_sha: &self.base,
                head_sha: &self.head,
                cwd: &self.repo.path,
                description: None,
                files: &files,
                threads: &[],
                rules: None,
            },
        );
        self.store
            .with_conn(|c| plan_cache::put(c, &key, &output))
            .unwrap();
    }

    async fn load(&self) -> Result<StepContext, StepContextError> {
        step_context::load(
            &self.ctx(),
            None,
            "r1",
            |_| async { Vec::new() },
            &Cancel::new(),
        )
        .await
    }
}

/// Event kinds as the UI sees them, with the text of `partialText`.
fn kinds<T: Serialize>(events: &Mutex<Vec<ClaudeTaskEvent<T>>>) -> Vec<String> {
    events
        .lock()
        .unwrap()
        .iter()
        .map(|e| {
            let v = serde_json::to_value(e).unwrap();
            match v["text"].as_str() {
                Some(text) => format!("{}:{text}", v["kind"].as_str().unwrap()),
                None => v["kind"].as_str().unwrap().to_owned(),
            }
        })
        .collect()
}

#[tokio::test]
async fn f09_6_step_context_reads_the_cached_plan_and_never_plans() {
    let s = setup();
    let missing = s.load().await.unwrap_err();
    assert!(matches!(missing, StepContextError::PlanNotReady));

    s.plan().await;
    let cx = s.load().await.unwrap();
    assert_eq!(cx.subject(), "mr:482");
    assert_eq!(cx.plan.steps.len(), 2);
    assert_eq!(cx.order(Strategy::ContractToUi), ["s1", "s2"]);
    assert_eq!(cx.order(Strategy::TestsFirst), ["s2", "s1"]);
    assert_eq!(cx.files.len(), 2);
    assert!(s.fake.calls().is_empty());
}

#[tokio::test]
async fn f09_6_same_step_in_flight_runs_claude_once_with_events_in_order() {
    let s = setup();
    s.plan().await;
    s.fake
        .set_scenario(&json!({ "responses": [vm_findings()] }));
    let cx = s.load().await.unwrap();
    let order = cx.order(Strategy::ContractToUi);
    let req = cx.step_request("s1", &order, &[]);
    let runs = StepRuns::default();
    let (first, second) = (Mutex::new(Vec::new()), Mutex::new(Vec::new()));
    let ctx = s.ctx();
    let cancel = Cancel::new();
    let to_first = |e| first.lock().unwrap().push(e);
    let to_second = |e| second.lock().unwrap().push(e);
    // The prefetch of s1 and opening s1 overlap.
    let (prefetched, opened) = tokio::join!(
        step_runs::findings(
            &runs,
            &ctx,
            &req,
            "r1",
            Priority::Prefetch,
            &cancel,
            &to_first
        ),
        step_runs::findings(
            &runs,
            &ctx,
            &req,
            "r1",
            Priority::CurrentStep,
            &cancel,
            &to_second
        ),
    );
    assert_eq!(s.fake.calls().len(), 1);
    let (prefetched, opened) = (prefetched.unwrap(), opened.unwrap());
    assert_eq!(prefetched, opened);
    assert_eq!(opened.findings.len(), 1);
    assert_eq!(opened.findings[0].decision, Decision::Open);
    assert_eq!(kinds(&first), ["queued", "started", "done"]);
    assert_eq!(kinds(&second), ["queued", "started", "done"]);

    // Opened again: from the cache, no `started`, the stored decision comes back.
    let id = opened.findings[0].id.clone();
    s.store
        .with_conn(|c| {
            Ok(guided_review_lib::review::decisions::decide(
                c,
                &id,
                &guided_review_lib::review::decisions::FindingDecision::Dismiss,
                "mr:482",
            ))
        })
        .unwrap()
        .unwrap();
    let third = Mutex::new(Vec::new());
    let again = step_runs::findings(
        &runs,
        &ctx,
        &req,
        "r1",
        Priority::CurrentStep,
        &cancel,
        &|e| {
            third.lock().unwrap().push(e);
        },
    )
    .await
    .unwrap();
    assert_eq!(s.fake.calls().len(), 1);
    assert_eq!(kinds(&third), ["queued", "done"]);
    assert_eq!(again.findings[0].decision, Decision::Dismissed);
}

#[tokio::test]
async fn f10_2_ask_streams_partial_text_then_done_with_the_answer() {
    let s = setup();
    s.plan().await;
    s.fake
        .set_scenario(&json!({ "responses": [streamed(&["Because ", "the queue ", "retries."])] }));
    let cx = s.load().await.unwrap();
    let order = cx.order(Strategy::ContractToUi);
    let req = cx.ask_request("s1", &order, "Why a queue?", None);
    let events = Mutex::new(Vec::new());
    let answer = step_runs::ask(&s.ctx(), &req, &Cancel::new(), &|e| {
        events.lock().unwrap().push(e);
    })
    .await
    .unwrap();
    assert_eq!(answer.text, "Because the queue retries.");
    assert_eq!(
        kinds(&events),
        [
            "queued",
            "started",
            "partialText:Because ",
            "partialText:the queue ",
            "partialText:retries.",
            "done"
        ]
    );
    let done = serde_json::to_value(events.lock().unwrap().last().unwrap()).unwrap();
    assert_eq!(
        done,
        json!({ "kind": "done", "result": { "text": "Because the queue retries.", "followUp": false } })
    );
}
