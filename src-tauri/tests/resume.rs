//! `session_resume` below the Tauri layer (F-04.3, F-30.4): S-03 restored on start from what is
//! stored - the session's row and step state, the files through git, Claude's cache - with no
//! `claude` run and no threads (GitLab). Fake `claude`, synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fake_claude.rs"]
mod fake_claude;
#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::path::Path;

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::{Priority, Queue};
use guided_review_lib::claude::tasks::plan::{self, Context, PlanRequest};
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::git::Git;
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::decisions::{self, FindingDecision};
use guided_review_lib::review::finding_model::Decision;
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::plan_cache;
use guided_review_lib::review::resume;
use guided_review_lib::review::step_context;
use guided_review_lib::review::step_runs::{self, StepRuns};
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::{self, Store, sessions, steps_state};
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
const QUEUE: &str = "src/Core/IQueue.cs";

fn vm_findings() -> Value {
    let result = json!({
        "type": "result", "subtype": "success", "is_error": false, "session_id": "s",
        "structured_output": {
            "findings": [{
                "severity": "fix", "kind": "unawaited-call", "title": "Enqueue isn't awaited",
                "body": "The task is dropped.", "file": VM, "side": "new", "line": 2,
                "evidence": [{ "file": QUEUE, "line": 2, "note": "the contract" }],
                "suggested_comment": "Should Enqueue be awaited?"
            }],
            "checklist": ["Is the queue drained on start?"], "files_read": [], "folds": []
        }
    });
    json!({ "stdout": result.to_string() })
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

/// A fixture repository with spaces and Polish characters and a stored MR session `r1` (!482).
fn setup() -> Setup {
    let repo = FixtureRepo::new("resume ąę");
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
                "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, mr_json, layout)
                 VALUES ('r1', ?1, '{\"kind\":\"mr\",\"project\":\"team/app\",\"iid\":482}', ?2, ?3,
                 '{\"iid\":482,\"title\":\"Offline queue\",\"author\":\"Alice\",\"sourceBranch\":\"feature/queue\",\"targetBranch\":\"develop\"}',
                 'A')",
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

    /// S-03 opened step s1 before the restart: Claude analyzed it, the reviewer dismissed the note.
    async fn analyze_s1_and_dismiss(&self) -> String {
        self.fake
            .set_scenario(&json!({ "responses": [vm_findings()] }));
        let cx = step_context::load(
            &self.ctx(),
            None,
            "r1",
            |_| async { Vec::new() },
            &Cancel::new(),
        )
        .await
        .unwrap();
        let order = cx.order(Strategy::ContractToUi);
        let req = cx.step_request("s1", &order, &[]);
        let analysis = step_runs::findings(
            &StepRuns::default(),
            &self.ctx(),
            &req,
            "r1",
            Priority::CurrentStep,
            &Cancel::new(),
            &|_| {},
        )
        .await
        .unwrap();
        let id = analysis.findings[0].id.clone();
        let note = id.clone();
        self.store
            .with_conn(move |c| {
                Ok(decisions::decide(
                    c,
                    &note,
                    &FindingDecision::Dismiss,
                    "mr:482",
                ))
            })
            .unwrap()
            .unwrap();
        id
    }

    async fn resume(&self) -> Option<resume::ResumedSession> {
        resume::resume(&self.ctx(), None, "r1", &Cancel::new())
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn f04_3_without_a_cached_plan_there_is_nothing_to_resume_and_claude_is_not_asked() {
    let s = setup();
    assert_eq!(s.resume().await, None);
    assert!(s.fake.calls().is_empty());
}

#[tokio::test]
async fn f04_3_resume_opens_the_step_the_session_was_on_with_its_cached_notes() {
    let s = setup();
    s.plan().await;
    let note = s.analyze_s1_and_dismiss().await;
    s.store
        .with_conn(|c| {
            steps_state::set_reviewed(c, "r1", "s2", true)?;
            sessions::set_current_step(c, "r1", "s1")?;
            Ok(())
        })
        .unwrap();
    let runs = s.fake.calls().len();

    let resumed = s.resume().await.unwrap();
    assert_eq!(s.fake.calls().len(), runs, "restoring runs no claude");
    assert!(resumed.plan.cached_at.is_some());
    assert_eq!(resumed.plan.order.order, ["s1", "s2"]);
    assert_eq!(resumed.plan.reviewed, ["s2"]);
    assert_eq!(resumed.step.step.id, "s1");
    assert_eq!((resumed.step.number, resumed.step.total), (1, 2));
    assert!(resumed.step.threads.is_empty());
    // The dismissed note is still on the step with its decision, so it can be undone.
    let findings = resumed.findings.unwrap();
    let seen: Vec<_> = findings
        .findings
        .iter()
        .map(|f| (f.id.as_str(), f.decision))
        .collect();
    assert_eq!(seen, [(note.as_str(), Decision::Dismissed)]);
    assert_eq!(findings.checklist, ["Is the queue drained on start?"]);
}

#[tokio::test]
async fn f04_3_a_step_never_analyzed_resumes_without_notes_and_without_a_run() {
    let s = setup();
    s.plan().await;
    s.store
        .with_conn(|c| {
            sessions::set_current_step(c, "r1", "s2")?;
            Ok(())
        })
        .unwrap();
    let resumed = s.resume().await.unwrap();
    assert_eq!(resumed.step.step.id, "s2");
    assert_eq!(resumed.step.number, 2);
    assert_eq!(resumed.findings, None);
    assert!(s.fake.calls().is_empty());

    // A step that is no longer in the plan resumes on step 1.
    s.store
        .with_conn(|c| {
            sessions::set_current_step(c, "r1", "gone")?;
            Ok(())
        })
        .unwrap();
    assert_eq!(s.resume().await.unwrap().step.step.id, "s1");
}
