//! `review_plan` below the Tauri layer (F-06.2, F-06.4, F-06.5, F-06.12): the inputs of a
//! stored MR session, the channel events in order, the cache hit without `claude`, and the
//! session's step order in the result; the file-order fallback when Claude fails (02 › S-02).
//! Fake `claude`, synthetic data only (ADR-019).
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
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::tasks::events::ClaudeTaskEvent;
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::plan_runs::{self, PlanView};
use guided_review_lib::review::step_context::{self, SessionInputs, StepContext};
use guided_review_lib::review::step_order::{self, StepOrderError};
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::{self, Store};
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
const QUEUE: &str = "src/Core/IQueue.cs";

struct Setup {
    _repo: FixtureRepo,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

/// A fixture repository and a stored MR session `r1` (!482, with a description), not planned.
fn setup() -> Setup {
    let repo = FixtureRepo::new("plan runs");
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
        "skim": [], "risks": [], "description_check": [], "already_discussed": ""
    });
    let result = json!({ "type": "result", "subtype": "success", "is_error": false,
        "session_id": "p", "structured_output": output });
    json!({ "stdout": result.to_string() })
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

    async fn inputs(&self) -> SessionInputs {
        step_context::load_inputs(
            &self.store,
            None,
            "r1",
            |_| async { Vec::new() },
            &Cancel::new(),
        )
        .await
        .unwrap()
    }

    /// The events and the result of one `review_plan`.
    async fn plan(&self, inputs: &SessionInputs) -> (Vec<String>, Result<PlanView, AppError>) {
        let events = Mutex::new(Vec::new());
        let emit = |e: ClaudeTaskEvent<PlanView>| events.lock().unwrap().push(e);
        let result = plan_runs::plan(&self.ctx(), inputs, &Cancel::new(), &emit)
            .await
            .map(|planned| planned.view)
            .map_err(AppError::from);
        let kinds = events
            .into_inner()
            .unwrap()
            .iter()
            .map(|e| {
                serde_json::to_value(e).unwrap()["kind"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        (kinds, result)
    }
}

#[tokio::test]
async fn f06_2_review_plan_runs_claude_with_the_session_inputs() {
    let s = setup();
    let inputs = s.inputs().await;
    assert_eq!(
        inputs.description.as_deref(),
        Some("Uploads wait in a queue.")
    );
    s.fake
        .set_scenario(&json!({ "responses": [plan_response(&inputs.files, true)] }));
    let (events, view) = s.plan(&inputs).await;
    assert_eq!(events, ["queued", "started", "done"]);
    let view = view.unwrap();
    assert_eq!(view.plan.intent, "Uploads go through a queue.");
    assert_eq!(view.cached_at, None);
    assert_eq!(view.order.order, ["s1", "s2"]);
    // F-06.3: s1 adds a line to IQueue, s2 replaces one in the ViewModel.
    let stats: Vec<_> = view
        .step_stats
        .iter()
        .map(|s| (s.files, s.additions, s.deletions))
        .collect();
    assert_eq!(stats, [(1, 1, 0), (1, 1, 1)]);
    assert!(view.skim_stats.is_empty());
    let calls = s.fake.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0]["addDirFiles"]["description.md"],
        "Uploads wait in a queue.\n"
    );
    // S-03 opens on the cached plan without planning again.
    let cx = step_context::load(
        &s.ctx(),
        None,
        "r1",
        |_| async { Vec::new() },
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert_eq!(cx.plan, view.plan);
}

#[tokio::test]
async fn f06_12_cached_plan_goes_from_queued_to_done_with_its_age() {
    let s = setup();
    let inputs = s.inputs().await;
    s.fake
        .set_scenario(&json!({ "responses": [plan_response(&inputs.files, true)] }));
    let (_, first) = s.plan(&inputs).await;
    let (events, again) = s.plan(&inputs).await;
    assert_eq!(events, ["queued", "done"]);
    let again = again.unwrap();
    let age = again.cached_at.as_deref().unwrap();
    assert!(age.contains('T') && age.ends_with('Z'), "{age}");
    assert_eq!(again.plan, first.unwrap().plan);
    assert_eq!(s.fake.calls().len(), 1);
}

#[tokio::test]
async fn f06_4_fallback_when_claudes_plan_is_invalid_done_in_file_order() {
    let s = setup();
    let inputs = s.inputs().await;
    s.fake
        .set_scenario(&json!({ "responses": [plan_response(&inputs.files, false)] }));
    let (events, view) = s.plan(&inputs).await;
    assert_eq!(events, ["queued", "started", "done"]);
    let view = view.unwrap();
    assert_eq!(view.fallback.unwrap().code, ErrorCode::ClaudeSchema);
    let rows: Vec<_> = view
        .plan
        .steps
        .iter()
        .map(|s| (s.id.as_str(), s.title.as_str(), s.reason.as_str()))
        .collect();
    assert_eq!(
        rows,
        [
            ("f1", "App", "Upload ViewModel.cs"),
            ("f2", "Core", "IQueue.cs")
        ]
    );
    assert_eq!(view.order.strategy, Strategy::FileOrder);
    assert!(!view.order.custom);
    assert_eq!(view.order.order, ["f1", "f2"]);
    assert!(view.plan.intent.is_empty());
    assert_eq!(view.plan.coverage.hunks, view.plan.coverage.hunks_total);
    assert_eq!(view.step_stats.len(), 2);
    assert_eq!(view.cached_at, None);
}

#[tokio::test]
async fn f06_12_fallback_when_not_signed_in_is_never_cached() {
    let s = setup();
    let inputs = s.inputs().await;
    let signed_out = json!({ "stdout": json!({ "type": "result", "is_error": true,
        "terminal_reason": "api_error", "result": "Not logged in · Please run /login" })
        .to_string(), "exit": 1 });
    s.fake
        .set_scenario(&json!({ "responses": [signed_out, plan_response(&inputs.files, true)] }));
    let (events, first) = s.plan(&inputs).await;
    assert_eq!(events, ["queued", "started", "done"]);
    assert_eq!(
        first.unwrap().fallback.unwrap().code,
        ErrorCode::ClaudeNotSignedIn
    );
    // Signed in again: Claude plans; the fallback wasn't cached.
    let (events, again) = s.plan(&inputs).await;
    assert_eq!(events, ["queued", "started", "done"]);
    let again = again.unwrap();
    assert!(again.fallback.is_none());
    assert_eq!(again.plan.intent, "Uploads go through a queue.");
    assert_eq!(s.fake.calls().len(), 2);
}

#[tokio::test]
async fn f06_4_fallback_refuses_strategy_and_drag_and_keeps_the_stored_order() {
    let s = setup();
    let inputs = s.inputs().await;
    s.fake
        .set_scenario(&json!({ "responses": [plan_response(&inputs.files, false)] }));
    let (_, view) = s.plan(&inputs).await;
    let plan = view.unwrap().plan;
    s.store
        .with_conn(|c| {
            store::sessions::set_strategy(c, "r1", Strategy::TestsFirst)?;
            Ok(())
        })
        .unwrap();
    let cx = StepContext::fallback(inputs, plan);
    s.store
        .with_conn(|c| {
            let order = cx.step_order(c).unwrap();
            assert_eq!(order.strategy, Strategy::FileOrder);
            assert_eq!(order.order, ["f1", "f2"]);
            assert!(matches!(
                cx.set_strategy(c, Strategy::ContractToUi),
                Err(StepOrderError::Fallback)
            ));
            let dragged = ["f2".to_owned(), "f1".to_owned()];
            assert!(matches!(
                cx.reorder(c, &dragged),
                Err(StepOrderError::Fallback)
            ));
            // The reader's own choice survives for when Claude plans again.
            assert_eq!(
                store::sessions::strategy(c, "r1").unwrap(),
                Strategy::TestsFirst
            );
            Ok(())
        })
        .unwrap();
}

#[tokio::test]
async fn f06_5_review_plan_returns_the_stored_order() {
    let s = setup();
    let inputs = s.inputs().await;
    s.fake
        .set_scenario(&json!({ "responses": [plan_response(&inputs.files, true)] }));
    let (_, view) = s.plan(&inputs).await;
    let plan = view.unwrap().plan;
    let hunks = guided_review_lib::review::coverage::hunk_refs(&inputs.files);
    s.store
        .with_conn(|c| {
            let tests =
                step_order::set_strategy(c, "r1", Strategy::TestsFirst, &plan, &hunks).unwrap();
            assert_eq!(tests.order, ["s2", "s1"]);
            Ok(())
        })
        .unwrap();
    let (_, view) = s.plan(&inputs).await;
    let order = view.unwrap().order;
    assert_eq!(order.strategy, Strategy::TestsFirst);
    assert!(!order.custom);
    assert_eq!(order.order, ["s2", "s1"]);
}
