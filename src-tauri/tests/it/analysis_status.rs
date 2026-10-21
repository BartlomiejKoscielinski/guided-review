//! F-08.8 the S-04 footer's Claude status below the Tauri layer (`review_analysis_status`, M4
//! decisions 9 and 10): the session's steps whose analysis is ready, running now or failed (from
//! `review/step_runs.rs` and the analysis cache), in the reader's order, and which code Claude
//! reads (`codeAt`): an MR's review worktree at its head, a self-review's repository at its head,
//! or the working tree of local changes. Fake `claude`, synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fake_claude;
use crate::fixture_repo;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

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
use guided_review_lib::review::analysis_status::{self, AnalysisStatus, CodeAt};
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::plan_cache;
use guided_review_lib::review::step_context::{self, StepContext};
use guided_review_lib::review::step_runs::{self, StepRuns};
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::source::model::LocalScope;
use guided_review_lib::store::{self, Store};
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
const QUEUE: &str = "src/Core/IQueue.cs";
const HEAD: &str = "a3f9c12b7e4d6f8091a2b3c4d5e6f708192a3b4c";

fn result(body: Value) -> Value {
    let mut base =
        json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": "s" });
    base.as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    base
}

/// The step task's answer: no notes, after `sleep_ms`.
fn no_findings(sleep_ms: u64) -> Value {
    json!({ "stdout": result(json!({ "structured_output": {
        "findings": [], "checklist": [], "files_read": [], "folds": []
    } })).to_string(), "sleepMs": sleep_ms })
}

/// `claude` fails: nothing on stdout, exit 1.
fn crash() -> Value {
    json!({ "stdout": "", "stderr": "something broke", "exit": 1 })
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

/// A fixture repository with a Polish name and spaces in a path, and a stored MR session `r1`
/// (!482) on it with its cached plan: s1 (the view model) then s2 (the contract) in
/// contract → UI, the other way round in tests first.
async fn setup() -> Setup {
    let repo = FixtureRepo::new("analysis status");
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
    let s = Setup {
        exe: ClaudeExecutable::Native(fake.exe.clone()),
        repo,
        fake,
        tmp: tempfile::tempdir().unwrap(),
        store,
        queue: Queue::new(2),
        settings: ClaudeSettings::default(),
        base,
        head,
    };
    s.plan().await;
    s
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

    async fn load(&self) -> StepContext {
        step_context::load(
            &self.ctx(),
            None,
            "r1",
            |_| async { Vec::new() },
            &Cancel::new(),
        )
        .await
        .unwrap()
    }

    /// Opens `step` of `session` the way `review_findings` does, with no notes dismissed.
    async fn analyze(&self, runs: &StepRuns, cx: &StepContext, session: &str, step: &str) -> bool {
        let order = cx.order(Strategy::ContractToUi);
        let req = cx.step_request(step, &order, &[]);
        step_runs::findings(
            runs,
            &self.ctx(),
            &req,
            session,
            Priority::CurrentStep,
            &Cancel::new(),
            &|_| {},
        )
        .await
        .is_ok()
    }

    fn status(&self, runs: &StepRuns, cx: &StepContext, order: &[String]) -> AnalysisStatus {
        analysis_status::status(&self.ctx(), runs, cx, order, &[]).unwrap()
    }
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

#[tokio::test]
async fn f08_8_a_session_nothing_was_analyzed_in_has_no_ready_running_or_failed_step() {
    let s = setup().await;
    let cx = s.load().await;
    let status = s.status(&StepRuns::default(), &cx, &cx.order(Strategy::ContractToUi));
    assert!(status.ready.is_empty(), "ready: {:?}", status.ready);
    assert!(status.running.is_empty(), "running: {:?}", status.running);
    assert!(status.failed.is_empty(), "failed: {:?}", status.failed);
    // Reading the status never starts `claude`.
    assert_eq!(s.fake.calls().len(), 0);
}

#[tokio::test]
async fn f08_8_an_analyzed_step_is_ready_and_one_never_analyzed_is_not() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [no_findings(0)] }));
    let cx = s.load().await;
    let runs = StepRuns::default();
    assert!(s.analyze(&runs, &cx, "r1", "s2").await);
    let status = s.status(&runs, &cx, &cx.order(Strategy::ContractToUi));
    assert_eq!(status.ready, ids(&["s2"]));
    assert!(status.running.is_empty());
    assert!(status.failed.is_empty());
    assert_eq!(s.fake.calls().len(), 1);
}

#[tokio::test]
async fn f08_8_ready_steps_come_in_the_readers_order() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [no_findings(0)] }));
    let cx = s.load().await;
    let runs = StepRuns::default();
    assert!(s.analyze(&runs, &cx, "r1", "s1").await);
    assert!(s.analyze(&runs, &cx, "r1", "s2").await);
    let contract_to_ui = cx.order(Strategy::ContractToUi);
    assert_eq!(
        s.status(&runs, &cx, &contract_to_ui).ready,
        ids(&["s1", "s2"])
    );
    let tests_first = cx.order(Strategy::TestsFirst);
    assert_eq!(s.status(&runs, &cx, &tests_first).ready, ids(&["s2", "s1"]));
}

#[tokio::test]
async fn f08_8_a_step_whose_claude_run_is_going_is_running_until_it_ends() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [no_findings(1500)] }));
    let cx = s.load().await;
    let runs = StepRuns::default();
    let order = cx.order(Strategy::ContractToUi);
    let req = cx.step_request("s1", &order, &[]);
    let ctx = s.ctx();
    let cancel = Cancel::new();
    let started = AtomicBool::new(false);
    let on_event = |e: ClaudeTaskEvent<_>| {
        if matches!(e, ClaudeTaskEvent::Started) {
            started.store(true, Ordering::SeqCst);
        }
    };
    let run = step_runs::findings(
        &runs,
        &ctx,
        &req,
        "r1",
        Priority::CurrentStep,
        &cancel,
        &on_event,
    );
    let probe = async {
        while !started.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        s.status(&runs, &cx, &order)
    };
    let (finished, during) = tokio::join!(run, probe);
    assert!(finished.is_ok());
    assert_eq!(during.running, ids(&["s1"]));
    assert!(during.ready.is_empty(), "ready: {:?}", during.ready);
    assert!(during.failed.is_empty());

    let after = s.status(&runs, &cx, &order);
    assert!(after.running.is_empty(), "running: {:?}", after.running);
    assert_eq!(after.ready, ids(&["s1"]));
}

#[tokio::test]
async fn f08_8_another_sessions_run_is_not_running_in_this_one() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [no_findings(1500)] }));
    let cx = s.load().await;
    let runs = StepRuns::default();
    let order = cx.order(Strategy::ContractToUi);
    let req = cx.step_request("s1", &order, &[]);
    let ctx = s.ctx();
    let cancel = Cancel::new();
    let started = AtomicBool::new(false);
    let on_event = |e: ClaudeTaskEvent<_>| {
        if matches!(e, ClaudeTaskEvent::Started) {
            started.store(true, Ordering::SeqCst);
        }
    };
    let run = step_runs::findings(
        &runs,
        &ctx,
        &req,
        "other",
        Priority::CurrentStep,
        &cancel,
        &on_event,
    );
    let probe = async {
        while !started.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        s.status(&runs, &cx, &order)
    };
    let (_, during) = tokio::join!(run, probe);
    assert!(during.running.is_empty(), "running: {:?}", during.running);
}

#[tokio::test]
async fn f08_8_a_step_whose_run_failed_is_failed_until_a_run_of_it_succeeds() {
    let s = setup().await;
    s.fake.set_scenario(&json!({ "responses": [crash()] }));
    let cx = s.load().await;
    let runs = StepRuns::default();
    let order = cx.order(Strategy::ContractToUi);
    assert!(!s.analyze(&runs, &cx, "r1", "s2").await);
    let failed = s.status(&runs, &cx, &order);
    assert_eq!(failed.failed, ids(&["s2"]));
    assert!(failed.ready.is_empty());
    assert!(failed.running.is_empty());

    // Retry (or opening the step again) succeeds: ready, no longer failed.
    s.fake
        .set_scenario(&json!({ "responses": [no_findings(0)] }));
    assert!(s.analyze(&runs, &cx, "r1", "s2").await);
    let retried = s.status(&runs, &cx, &order);
    assert!(retried.failed.is_empty(), "failed: {:?}", retried.failed);
    assert_eq!(retried.ready, ids(&["s2"]));
}

#[tokio::test]
async fn f08_8_an_mr_session_reads_the_review_worktree_at_its_head() {
    let s = setup().await;
    let cx = s.load().await;
    let status = s.status(&StepRuns::default(), &cx, &cx.order(Strategy::ContractToUi));
    assert_eq!(
        status.code_at,
        CodeAt::Worktree {
            sha: s.head.clone()
        }
    );
}

#[test]
fn f08_8_code_at_per_source_worktree_repository_or_working_tree() {
    let mr = PlanSource::Mr {
        iid: 482,
        title: "Offline queue".into(),
        source_branch: "feature/queue".into(),
        target_branch: "develop".into(),
    };
    assert_eq!(
        analysis_status::code_at(&mr, HEAD),
        CodeAt::Worktree { sha: HEAD.into() }
    );
    // Self-review of a commit, a range or a branch: the user's repository, no worktree.
    let commit = PlanSource::Commits {
        from: None,
        to: HEAD.into(),
    };
    assert_eq!(
        analysis_status::code_at(&commit, HEAD),
        CodeAt::Repository { sha: HEAD.into() }
    );
    let range = PlanSource::Commits {
        from: Some("1b2c3d4e5f60718293a4b5c6d7e8f90112233445".into()),
        to: HEAD.into(),
    };
    assert_eq!(
        analysis_status::code_at(&range, HEAD),
        CodeAt::Repository { sha: HEAD.into() }
    );
    // Local changes: whatever is in the working tree, at no commit.
    for scope in [
        LocalScope::Uncommitted,
        LocalScope::Staged,
        LocalScope::BranchVsTarget {
            target: "origin/develop".into(),
        },
    ] {
        assert_eq!(
            analysis_status::code_at(&PlanSource::Local { scope }, HEAD),
            CodeAt::WorkingTree
        );
    }
}

#[test]
fn f08_8_the_status_reaches_the_ui_as_camel_case_with_a_tagged_code_at() {
    let status = AnalysisStatus {
        ready: ids(&["s5", "s6"]),
        running: ids(&["s7"]),
        failed: Vec::new(),
        code_at: CodeAt::Worktree { sha: HEAD.into() },
    };
    assert_eq!(
        serde_json::to_value(&status).unwrap(),
        json!({
            "ready": ["s5", "s6"], "running": ["s7"], "failed": [],
            "codeAt": { "kind": "worktree", "sha": HEAD }
        })
    );
    assert_eq!(
        serde_json::to_value(CodeAt::Repository { sha: HEAD.into() }).unwrap(),
        json!({ "kind": "repository", "sha": HEAD })
    );
    assert_eq!(
        serde_json::to_value(CodeAt::WorkingTree).unwrap(),
        json!({ "kind": "workingTree" })
    );
}
