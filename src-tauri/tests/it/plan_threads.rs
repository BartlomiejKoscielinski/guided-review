//! The MR's threads through `review_plan` and S-03 below the Tauri layer (F-06.9, M3 decision 5):
//! the plan run asks GitLab's threads for the stored MR and hands them to Claude, the aside's
//! "Already discussed" is Claude's text or, without Claude, "N open threads."; a step opens
//! with the threads inside its hunks. Fake `claude`, synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fake_claude;
use crate::fixture_repo;

use std::path::Path;
use std::sync::Mutex;

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::tasks::events::ClaudeTaskEvent;
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::gitlab::discussions::{self, Thread};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::plan_runs::{self, PlanView};
use guided_review_lib::review::step_context::{self, MrRef, SessionInputs};
use guided_review_lib::review::step_view;
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::{self, Store};
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
const QUEUE: &str = "src/Core/IQueue.cs";
const CLAUDES_SUMMARY: &str = "Alice asked whether Enqueue retries; the queue contract is settled.";

struct Setup {
    _repo: FixtureRepo,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

/// A fixture repository and a stored MR session `r1` (team/app !482), not planned: the head
/// changes line 2 of the ViewModel and adds line 2 of the queue contract.
fn setup() -> Setup {
    let repo = FixtureRepo::new("plan threads");
    repo.write(VM, "class Vm {\n    void Up() { Send(); }\n}\n");
    repo.write(QUEUE, "interface IQueue {\n}\n");
    let base = repo.commit_all("base");
    repo.write(VM, "class Vm {\n    void Up() { queue.Enqueue(); }\n}\n");
    repo.write(QUEUE, "interface IQueue {\n    void Enqueue();\n}\n");
    let head = repo.commit_all("head");
    let store = Store::open_in_memory().unwrap();
    let path = repo.path.to_string_lossy().into_owned();
    store
        .with_conn(move |c| {
            let row = store::repos::add(c, "app", &path, Some("team/app"))?;
            c.execute(
                "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, mr_json)
                 VALUES ('r1', ?1, '{\"kind\":\"mr\",\"project\":\"team/app\",\"iid\":482}', ?2, ?3,
                 '{\"iid\":482,\"title\":\"Offline queue\",\"author\":\"Alice\",\"sourceBranch\":\"feature/queue\",\"targetBranch\":\"develop\",\"description\":\"Uploads wait in a queue.\"}')",
                rusqlite::params![row.id, base, head],
            )?;
            Ok(())
        })
        .unwrap();
    let fake = FakeClaude::new(Path::new(env!("CARGO_BIN_EXE_fake-claude")), &json!({}));
    Setup {
        exe: ClaudeExecutable::Native(fake.exe.clone()),
        _repo: repo,
        fake,
        tmp: tempfile::tempdir().unwrap(),
        store,
        queue: Queue::new(2),
        settings: ClaudeSettings::default(),
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

/// Claude's plan: s1 holds the queue contract's hunk, s2 the ViewModel's; `valid` false puts an
/// unknown hunk in s2, so the plan fails the app's validation (F-06.3) and the fallback runs.
fn plan_response(files: &[FileDiff], valid: bool) -> Value {
    let vm = if valid {
        hunk_of(files, VM)
    } else {
        "0000000000000000".to_owned()
    };
    let output = json!({
        "intent": "Uploads go through a queue.",
        "steps": [
            { "id": "s1", "title": "Queue contract", "short_title": "Contract",
              "reason": "Everything else builds on this.", "description": "IQueue gets Enqueue.",
              "layer": "Core", "hunk_ids": [hunk_of(files, QUEUE)], "builds_on": [] },
            { "id": "s2", "title": "ViewModel enqueues", "short_title": "ViewModel",
              "reason": "Uses the contract.", "description": "The ViewModel enqueues.",
              "layer": "App", "hunk_ids": [vm], "builds_on": ["s1"] }
        ],
        "orders": { "contract_to_ui": ["s1", "s2"], "tests_first": ["s2", "s1"] },
        "skim": [], "risks": [], "description_check": [],
        "already_discussed": CLAUDES_SUMMARY
    });
    let result = json!({ "type": "result", "subtype": "success", "is_error": false,
        "session_id": "p", "structured_output": output });
    json!({ "stdout": result.to_string() })
}

fn note(id: u64, body: &str, resolvable: bool, resolved: bool, position: Option<Value>) -> Value {
    let mut note = json!({ "id": id, "body": body,
        "author": { "username": "alice", "name": "Alice" }, "created_at": "2026-10-12T10:00:00Z",
        "system": false, "resolvable": resolvable, "resolved": resolved });
    if let Some(position) = position {
        note["position"] = position;
    }
    note
}

fn at(path: &str, new_line: u32) -> Option<Value> {
    Some(json!({ "old_path": path, "new_path": path, "new_line": new_line, "head_sha": "abc" }))
}

/// What GitLab reports for !482: an open thread on each step's line, a resolved one on the
/// ViewModel's line, an open discussion on the MR itself, and a plain comment.
fn mr_threads() -> Vec<Thread> {
    discussions::parse(vec![
        json!({ "id": "vm-open", "notes": [note(1, "Should Enqueue be awaited?", true, false, at(VM, 2))] }),
        json!({ "id": "queue-open", "notes": [note(2, "Does Enqueue retry?", true, false, at(QUEUE, 2))] }),
        json!({ "id": "vm-resolved", "notes": [note(3, "Typo in the name.", true, true, at(VM, 2))] }),
        json!({ "id": "mr-open", "notes": [note(4, "Is the migration safe?", true, false, None)] }),
        json!({ "id": "mr-comment", "notes": [note(5, "LGTM so far.", false, false, None)] }),
    ])
    .unwrap()
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

    /// The session's inputs with GitLab answering `threads`; the MR GitLab was asked about.
    async fn inputs(&self, threads: Vec<Thread>) -> (SessionInputs, Option<MrRef>) {
        let asked = Mutex::new(None);
        let inputs = step_context::load_inputs(
            &self.store,
            None,
            "r1",
            |mr| {
                *asked.lock().unwrap() = Some(mr);
                async { threads }
            },
            &Cancel::new(),
        )
        .await
        .unwrap();
        (inputs, asked.into_inner().unwrap())
    }

    async fn plan(&self, inputs: &SessionInputs) -> PlanView {
        let emit = |_: ClaudeTaskEvent<PlanView>| {};
        plan_runs::plan(&self.ctx(), inputs, &Cancel::new(), &emit)
            .await
            .unwrap()
            .view
    }
}

#[tokio::test]
async fn f06_9_the_plan_run_asks_gitlab_for_the_mr_threads_and_hands_them_to_claude() {
    let s = setup();
    let (inputs, asked) = s.inputs(mr_threads()).await;
    assert_eq!(
        asked,
        Some(MrRef {
            project: "team/app".to_owned(),
            iid: 482
        })
    );
    s.fake
        .set_scenario(&json!({ "responses": [plan_response(&inputs.files, true)] }));
    let view = s.plan(&inputs).await;

    // The threads file Claude reads: every thread with its state and place.
    let calls = s.fake.calls();
    assert_eq!(calls.len(), 1);
    let file = calls[0]["addDirFiles"]["threads.txt"].as_str().unwrap();
    assert!(
        file.contains(&format!("Thread 1 · open · {VM}:2 (new)\n")),
        "{file}"
    );
    assert!(file.contains("Should Enqueue be awaited?") && file.contains("Does Enqueue retry?"));
    assert!(file.contains("· resolved ·") && file.contains("Typo in the name."));
    assert!(file.contains("· open · on the merge request\n") && file.contains("LGTM so far."));
    let stdin = calls[0]["stdin"].as_str().unwrap();
    assert!(stdin.contains("threads.txt"), "{stdin}");
    // Claude is told to leave the discussed points out of its own text, and to summarize them
    // for the aside so the reviewer doesn't repeat them either.
    assert!(
        stdin.contains("already_discussed: one or two sentences about existing threads"),
        "{stdin}"
    );
    let system = calls[0]["addDirFiles"]["system-common.md"]
        .as_str()
        .unwrap();
    assert!(
        system.contains("Do not repeat points that existing discussion threads already make."),
        "{system}"
    );

    // The aside shows what Claude wrote, not the app's count.
    assert!(view.fallback.is_none());
    assert_eq!(view.plan.already_discussed, CLAUDES_SUMMARY);
}

#[tokio::test]
async fn f06_9_without_claude_the_aside_says_n_open_threads_from_the_discussions_count() {
    let s = setup();
    let (inputs, _) = s.inputs(mr_threads()).await;
    // Claude's plan fails the validation: the app's file-order plan comes instead.
    s.fake
        .set_scenario(&json!({ "responses": [plan_response(&inputs.files, false)] }));
    let view = s.plan(&inputs).await;
    assert!(view.fallback.is_some());
    // Three resolvable threads are open (two on lines, one on the MR); the resolved thread and
    // the plain comment don't count.
    assert_eq!(view.plan.already_discussed, "3 open threads.");

    // Claude Code isn't installed at all: the same summary.
    let unavailable = plan_runs::unavailable(
        &s.store,
        &inputs,
        guided_review_lib::claude::ClaudeError::NotFound,
        &|_| {},
    );
    assert_eq!(unavailable.view.plan.already_discussed, "3 open threads.");

    // No open thread: nothing to summarize.
    let (quiet, _) = s.inputs(Vec::new()).await;
    let unavailable = plan_runs::unavailable(
        &s.store,
        &quiet,
        guided_review_lib::claude::ClaudeError::NotFound,
        &|_| {},
    );
    assert_eq!(unavailable.view.plan.already_discussed, "");
}

#[tokio::test]
async fn f06_9_a_step_opens_with_the_threads_inside_its_hunks_as_context() {
    let s = setup();
    let (inputs, _) = s.inputs(mr_threads()).await;
    s.fake
        .set_scenario(&json!({ "responses": [plan_response(&inputs.files, true)] }));
    let planned = s.plan(&inputs).await;
    let order = planned.order.order.clone();
    assert_eq!(order, ["s1", "s2"]);

    // S-03 loads the session again from the cached plan, with GitLab's threads.
    let cx = step_context::load(
        &s.ctx(),
        None,
        "r1",
        |mr| async move {
            assert_eq!((mr.project.as_str(), mr.iid), ("team/app", 482));
            mr_threads()
        },
        &Cancel::new(),
    )
    .await
    .unwrap();
    let ids = |step: &str| -> Vec<String> {
        step_view::of(&cx, &order, step, false)
            .unwrap()
            .threads
            .iter()
            .map(|t| t.id.clone())
            .collect()
    };
    assert_eq!(ids("s1"), ["queue-open"]);
    // Resolved threads stay as context; the MR-level ones belong to no step.
    assert_eq!(ids("s2"), ["vm-open", "vm-resolved"]);
    assert_eq!(s.fake.calls().len(), 1, "opening a step runs no plan");
}

#[tokio::test]
async fn f06_9_a_step_opens_without_threads_when_gitlab_cannot_be_reached() {
    let s = setup();
    let (inputs, _) = s.inputs(Vec::new()).await;
    s.fake
        .set_scenario(&json!({ "responses": [plan_response(&inputs.files, true)] }));
    let planned = s.plan(&inputs).await;
    let cx = step_context::load(
        &s.ctx(),
        None,
        "r1",
        |_| async { Vec::new() },
        &Cancel::new(),
    )
    .await
    .unwrap();
    let view = step_view::of(&cx, &planned.order.order, "s2", false).unwrap();
    assert_eq!(view.step.title, "ViewModel enqueues");
    assert!(view.threads.is_empty());
}
