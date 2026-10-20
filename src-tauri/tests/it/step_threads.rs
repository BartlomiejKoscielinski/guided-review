//! F-09.5 below the Tauri layer: Claude gets the MR's existing threads as context in the step
//! task, so a note doesn't repeat a point a teammate already made on the same line (M3
//! decision 6: the prompt carries the rule, Rust doesn't judge topics). The threads travel the
//! production path: a stored MR session, its cached plan, `step_context::load` with the
//! threads fetcher, `step_request`, `step::run`. Fake `claude`, synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fake_claude;
use crate::fixture_repo;

use std::path::Path;

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::{Priority, Queue};
use guided_review_lib::claude::tasks::plan::{self, Context, PlanRequest};
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::claude::tasks::step::{self, StepOutcome};
use guided_review_lib::git::Git;
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::gitlab::discussions::{self, Thread};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::plan_cache;
use guided_review_lib::review::step_context::{self, StepContext};
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::{self, Store};
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
const QUEUE: &str = "src/Core/IQueue.cs";

fn filler(line: usize) -> String {
    format!("    int f{line};\n")
}

/// The ViewModel with `edits` (line, text) applied: 40 lines, so lines 2 and 30 are two hunks.
fn vm(edits: &[(usize, &str)]) -> String {
    let mut text = String::from("class Vm {\n    void Up() { Send(); }\n");
    for line in 3..40 {
        text.push_str(&filler(line));
    }
    text.push_str("}\n");
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    for (line, new) in edits {
        lines[line - 1] = (*new).to_owned();
    }
    lines.join("\n") + "\n"
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

/// A fixture repository (hunks: ViewModel line 2, ViewModel line 30, a removed line in the
/// queue contract) and a stored MR session `r1` (!482) with the three steps planned and cached.
async fn setup() -> Setup {
    let repo = FixtureRepo::new("step threads");
    repo.write(VM, &vm(&[]));
    repo.write(
        QUEUE,
        "interface IQueue {\n    void Old();\n    void Keep();\n}\n",
    );
    let base = repo.commit_all("base");
    repo.write(
        VM,
        &vm(&[
            (2, "    void Up() { queue.Enqueue(); }"),
            (30, "    int f30 = Compute();"),
        ]),
    );
    repo.write(QUEUE, "interface IQueue {\n    void Keep();\n}\n");
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

fn hunk(files: &[FileDiff], path: &str, index: usize) -> String {
    files
        .iter()
        .find(|f| f.new_path.as_deref() == Some(path))
        .unwrap()
        .hunks[index]
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

    /// S-02 planned the session: s1 = ViewModel line 2, s2 = ViewModel line 30, s3 = the queue.
    async fn plan(&self) {
        let git = Git::new(None, &self.repo.path);
        let files = step_context::files(&git, &self.base, &self.head, &Cancel::new())
            .await
            .unwrap();
        let step = |id: &str, hunk_id: String| {
            json!({ "id": id, "title": format!("Step {id}"), "short_title": id,
                "reason": "Order.", "description": format!("Step {id}."),
                "layer": "App", "hunk_ids": [hunk_id], "builds_on": [] })
        };
        let output = json!({
            "intent": "Uploads go through a queue.",
            "steps": [
                step("s1", hunk(&files, VM, 0)),
                step("s2", hunk(&files, VM, 1)),
                step("s3", hunk(&files, QUEUE, 0)),
            ],
            "orders": { "contract_to_ui": ["s1", "s2", "s3"], "tests_first": ["s1", "s2", "s3"] },
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

    /// The step context as the commands build it: the threads come from GitLab (here a stand-in
    /// fetcher), or none when GitLab can't be reached.
    async fn load(&self, threads: Vec<Thread>) -> StepContext {
        step_context::load(
            &self.ctx(),
            None,
            "r1",
            move |_| async move { threads },
            &Cancel::new(),
        )
        .await
        .unwrap()
    }

    /// Opens `step_id` of the loaded session and returns the run with the `threads.txt` the
    /// fake `claude` was given.
    async fn open(&self, cx: &StepContext, step_id: &str) -> (StepOutcome, String) {
        let order = cx.order(Strategy::ContractToUi);
        let req = cx.step_request(step_id, &order, &[]);
        let outcome = step::run(
            &self.ctx(),
            &req,
            Priority::CurrentStep,
            &|| {},
            &Cancel::new(),
        )
        .await
        .unwrap();
        let calls = self.fake.calls();
        let call = calls.last().expect("claude was not run");
        let threads = call["addDirFiles"]["threads.txt"].as_str().unwrap();
        (outcome, threads.to_owned())
    }
}

fn result(structured: Value) -> Value {
    json!({ "stdout": json!({ "type": "result", "subtype": "success", "is_error": false,
        "session_id": "s", "structured_output": structured }).to_string() })
}

fn nothing_stood_out() -> Value {
    result(json!({ "findings": [], "checklist": [], "files_read": [], "folds": [] }))
}

/// A note on the line of the thread d1, about something else than the thread.
fn other_point_on_line_2() -> Value {
    result(json!({
        "findings": [{
            "severity": "fix", "kind": "stale-state", "title": "Nothing refreshes the counter",
            "body": "The counter is only computed when adding.", "file": VM, "side": "new",
            "line": 2, "evidence": [{ "file": QUEUE, "line": 2, "note": "the contract" }],
            "suggested_comment": "Could the queue publish changes so the counter refreshes?"
        }],
        "checklist": [], "files_read": [], "folds": []
    }))
}

fn position(path: &str, new_line: Option<u32>, old_line: Option<u32>) -> Value {
    json!({ "old_path": path, "new_path": path, "new_line": new_line, "old_line": old_line,
        "head_sha": "abc" })
}

/// One GitLab discussion: the first message carries the position (when there is one).
fn discussion(
    id: &str,
    position: Option<Value>,
    messages: &[(&str, &str)],
    resolved: bool,
) -> Value {
    let notes: Vec<Value> = messages
        .iter()
        .enumerate()
        .map(|(i, (user, body))| {
            let mut note = json!({ "id": i + 1, "body": body,
                "author": { "username": user, "name": user },
                "created_at": format!("2026-10-12T1{i}:00:00Z"),
                "system": false, "resolvable": true, "resolved": resolved });
            if let (0, Some(p)) = (i, &position) {
                note["position"] = p.clone();
            }
            note
        })
        .collect();
    json!({ "id": id, "notes": notes })
}

/// The MR's threads: d1 open with a reply on ViewModel line 2 (step 1), d2 resolved on line 30
/// (step 2), d3 on the removed line 2 of the queue contract (step 3), d4 on the MR itself, d5 on
/// ViewModel line 20 (no step's hunk).
fn mr_threads() -> Vec<Thread> {
    discussions::parse(vec![
        discussion(
            "d1",
            Some(position(VM, Some(2), None)),
            &[
                ("alice", "Should Enqueue be awaited?"),
                ("bob", "Fire and forget on purpose, the worker retries."),
            ],
            false,
        ),
        discussion(
            "d2",
            Some(position(VM, Some(30), None)),
            &[("alice", "Compute() can throw here.")],
            true,
        ),
        discussion(
            "d3",
            Some(position(QUEUE, None, Some(2))),
            &[("carol", "Why is Old() going away?")],
            false,
        ),
        discussion(
            "d4",
            None,
            &[("dave", "General question about the MR.")],
            false,
        ),
        discussion(
            "d5",
            Some(position(VM, Some(20), None)),
            &[("erin", "Rename f20, please.")],
            false,
        ),
    ])
    .unwrap()
}

#[tokio::test]
async fn f09_5_claude_gets_the_open_thread_on_the_steps_line_with_its_replies() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [nothing_stood_out()] }));
    let cx = s.load(mr_threads()).await;
    let (_, threads) = s.open(&cx, "s1").await;
    assert!(
        threads.starts_with(&format!("Thread 1 · open · {VM}:2 (new)\n")),
        "{threads}"
    );
    // The whole conversation: the topic is what the first message and the replies say.
    assert!(threads.contains("alice") && threads.contains("Should Enqueue be awaited?"));
    assert!(threads.contains("bob") && threads.contains("Fire and forget on purpose"));
    // Only that thread: not the MR-level one, not the other steps' lines.
    for other in [
        "Compute() can throw here.",
        "Why is Old() going away?",
        "General question about the MR.",
        "Rename f20, please.",
    ] {
        assert!(!threads.contains(other), "{other} in {threads}");
    }
    assert_eq!(threads.matches("Thread ").count(), 1, "{threads}");
}

#[tokio::test]
async fn f09_5_a_resolved_thread_is_context_in_the_step_with_its_line_and_no_other_step() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [nothing_stood_out()] }));
    let cx = s.load(mr_threads()).await;
    // Step 2 is another hunk of the same file as step 1: it gets its own thread, resolved.
    let (_, threads) = s.open(&cx, "s2").await;
    assert!(
        threads.starts_with(&format!("Thread 1 · resolved · {VM}:30 (new)\n")),
        "{threads}"
    );
    assert!(threads.contains("Compute() can throw here."));
    assert!(!threads.contains("Should Enqueue be awaited?"), "{threads}");
    assert_eq!(threads.matches("Thread ").count(), 1, "{threads}");
}

#[tokio::test]
async fn f09_5_a_thread_on_a_removed_line_belongs_to_the_step_that_holds_the_deletion() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [nothing_stood_out()] }));
    let cx = s.load(mr_threads()).await;
    let (_, threads) = s.open(&cx, "s3").await;
    assert!(
        threads.starts_with(&format!(
            "Thread 1 · open · {QUEUE}:2 (old, removed line)\n"
        )),
        "{threads}"
    );
    assert!(threads.contains("Why is Old() going away?"));
    assert_eq!(threads.matches("Thread ").count(), 1, "{threads}");
}

#[tokio::test]
async fn f09_5_without_threads_claude_is_told_there_are_none_and_the_step_still_runs() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [other_point_on_line_2()] }));
    // GitLab unreachable: the fetcher gives an empty list (the threads are a hint, not a need).
    let cx = s.load(Vec::new()).await;
    let (outcome, threads) = s.open(&cx, "s1").await;
    assert_eq!(threads, "none\n");
    assert_eq!(outcome.analysis.findings.len(), 1);
}

#[tokio::test]
async fn f09_5_a_note_with_another_point_on_a_discussed_line_is_kept() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [other_point_on_line_2()] }));
    let cx = s.load(mr_threads()).await;
    let (outcome, threads) = s.open(&cx, "s1").await;
    // Claude saw the thread on ViewModel line 2 ...
    assert!(threads.contains("Should Enqueue be awaited?"));
    // ... and its note on that same line, about something else, is not dropped by Rust: the
    // topic is Claude's call (M3 decision 6).
    let finding = &outcome.analysis.findings[0];
    assert_eq!((finding.file.as_str(), finding.line), (VM, 2));
    assert_eq!(finding.title, "Nothing refreshes the counter");
}

#[tokio::test]
async fn f09_5_the_rule_not_to_repeat_existing_threads_is_in_what_claude_is_given() {
    let s = setup().await;
    s.fake
        .set_scenario(&json!({ "responses": [nothing_stood_out()] }));
    let cx = s.load(mr_threads()).await;
    s.open(&cx, "s1").await;
    let calls = s.fake.calls();
    let call = calls.last().unwrap();
    // docs/claude/prompts/system-common.md, passed with --append-system-prompt-file.
    let system = call["addDirFiles"]["system-common.md"].as_str().unwrap();
    assert!(
        system.contains("Do not repeat points that existing discussion threads already make."),
        "{system}"
    );
    // The step prompt names the thread list as an input, with the file it is in.
    let stdin = call["stdin"].as_str().unwrap();
    let line = stdin
        .lines()
        .find(|l| l.starts_with("- Existing threads on lines of this step: "))
        .unwrap();
    assert!(line.trim_end().ends_with("threads.txt"), "{line}");
}
