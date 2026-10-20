//! The step task against the fake `claude` (docs/09 › Fake `claude`) on a fixture repository
//! (F-09.6, F-09.5, F-09.4, F-09.1; ADR-022, ADR-025 risk: argv snapshot of the read-only
//! profile). Synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fake_claude;
use crate::fixture_repo;

use std::path::{Path, PathBuf};

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::ClaudeError;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::tasks::plan::{self, Context};
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::claude::tasks::step::{self, StepRequest};
use guided_review_lib::claude::tasks::step_inputs::Dismissal;
use guided_review_lib::git::Git;
use guided_review_lib::git::diff;
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::gitlab::discussions;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::layer::Layer;
use guided_review_lib::review::plan_model::{Coverage, Orders, Plan, Step};
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::Store;
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
const QUEUE: &str = "src/Core/IQueue.cs";

fn result(body: Value) -> Value {
    let mut base =
        json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": "s" });
    base.as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    json!({ "stdout": base.to_string() })
}

fn empty() -> Value {
    result(json!({ "structured_output":
        { "findings": [], "checklist": [], "files_read": [], "folds": [] } }))
}

/// Base: a ViewModel, a queue contract, a readme and team rules. Head: the ViewModel enqueues,
/// the contract gets `Enqueue`, the readme changes.
fn mr_repo() -> (FixtureRepo, String, String) {
    let repo = FixtureRepo::new("step");
    repo.write(VM, "class Vm {\n    void Up() { Send(); }\n}\n");
    repo.write(QUEUE, "interface IQueue {\n}\n");
    repo.write("README.md", "Old\n");
    repo.write(".review/rules.md", "Prefer async.\n");
    let base = repo.commit_all("base");
    repo.write(VM, "class Vm {\n    void Up() { queue.Enqueue(); }\n}\n");
    repo.write(QUEUE, "interface IQueue {\n    void Enqueue();\n}\n");
    repo.write("README.md", "New\n");
    let head = repo.commit_all("head");
    (repo, base, head)
}

async fn files(git: &Git, base: &str, head: &str) -> Vec<FileDiff> {
    let cancel = Cancel::new();
    let mut out = Vec::new();
    for file in diff::range_files(git, base, head, &cancel).await.unwrap() {
        out.push(
            diff::range_file_diff(git, base, head, &file, &cancel)
                .await
                .unwrap(),
        );
    }
    out
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

fn plan(files: &[FileDiff]) -> Plan {
    let step = |id: &str, title: &str, path: &str, builds_on: &[&str]| Step {
        id: id.into(),
        title: title.into(),
        short_title: title.into(),
        reason: "Order.".into(),
        description: format!("{title}."),
        layer: Layer::App,
        hunk_ids: vec![hunk_of(files, path)],
        builds_on: builds_on.iter().map(|s| (*s).to_owned()).collect(),
    };
    Plan {
        intent: "Uploads go through a queue.".into(),
        steps: vec![
            step("s1", "ViewModel enqueues", VM, &["s2"]),
            step("s2", "Queue contract", QUEUE, &[]),
            step("s3", "Readme", "README.md", &[]),
        ],
        orders: Orders::default(),
        skim: Vec::new(),
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: String::new(),
        coverage: Coverage::default(),
    }
}

fn diff_thread(id: &str, path: &str, line: u32, body: &str) -> Value {
    json!({
        "id": id, "notes": [{ "id": 2, "body": body,
            "author": { "username": "alice", "name": "Alice" }, "created_at": "2026-10-12T10:00:00Z",
            "system": false, "resolvable": true, "resolved": false,
            "position": { "old_path": path, "new_path": path, "new_line": line, "head_sha": "abc" } }]
    })
}

/// One thread on the MR, one on the step's line, one on another step's file.
fn threads() -> Vec<discussions::Thread> {
    discussions::parse(vec![
        json!({ "id": "d1", "notes": [{ "id": 1, "body": "General question.",
            "author": { "username": "bob" }, "created_at": "2026-10-12T09:00:00Z",
            "system": false, "resolvable": true, "resolved": false }] }),
        diff_thread("d2", VM, 2, "Should Enqueue be awaited?"),
        diff_thread("d3", "README.md", 1, "Typo?"),
    ])
    .unwrap()
}

struct Setup {
    repo: FixtureRepo,
    base: String,
    head: String,
    files: Vec<FileDiff>,
    plan: Plan,
    order: Vec<String>,
    source: PlanSource,
    rules: Option<String>,
    threads: Vec<discussions::Thread>,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

async fn setup() -> Setup {
    let (repo, base, head) = mr_repo();
    let git = Git::new(None, &repo.path);
    let files = files(&git, &base, &head).await;
    let rules = plan::team_rules(&git, &base, &Cancel::new()).await.unwrap();
    let fake = FakeClaude::new(Path::new(env!("CARGO_BIN_EXE_fake-claude")), &json!({}));
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    Setup {
        plan: plan(&files),
        order: ["s2", "s1", "s3"].map(str::to_owned).to_vec(),
        source: PlanSource::Mr {
            iid: 482,
            title: "Torch".into(),
            source_branch: "feature/torch".into(),
            target_branch: "develop".into(),
        },
        repo,
        base,
        head,
        files,
        rules,
        threads: threads(),
        fake,
        tmp: tempfile::tempdir().unwrap(),
        store: Store::open_in_memory().unwrap(),
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

    fn request<'a>(&'a self, step_id: &'a str, dismissed: &'a [Dismissal]) -> StepRequest<'a> {
        StepRequest {
            repo_id: 1,
            source: &self.source,
            base_sha: &self.base,
            head_sha: &self.head,
            cwd: &self.repo.path,
            files: &self.files,
            plan: &self.plan,
            step_id,
            order: &self.order,
            threads: &self.threads,
            rules: self.rules.as_deref(),
            dismissed,
        }
    }

    async fn open(&self, step_id: &str) -> Vec<step::StepOutcome> {
        let mut out = Vec::new();
        for (id, priority) in step::schedule(&self.order, step_id) {
            let req = self.request(&id, &[]);
            out.push(
                step::run(&self.ctx(), &req, priority, &|| {}, &Cancel::new())
                    .await
                    .unwrap(),
            );
        }
        out
    }
}

fn vm_findings() -> Value {
    json!({
        "findings": [{
            "severity": "q", "kind": "unawaited-call", "title": "Enqueue isn't awaited",
            "body": "IQueue.Enqueue is synchronous here.", "file": VM, "side": "new", "line": 2,
            "evidence": [{ "file": VM, "line": 2, "note": "the call" },
                         { "file": QUEUE, "line": 2, "note": "the contract" }],
            "suggested_comment": "Should Enqueue be async?"
        }],
        "checklist": ["Is a synchronous enqueue intended?"],
        "files_read": [{ "file": QUEUE, "why": "the contract" }],
        "folds": []
    })
}

#[tokio::test]
async fn f09_6_step_task_argv_inputs_and_result() {
    let s = setup().await;
    s.fake.set_scenario(
        &json!({ "responses": [result(json!({ "structured_output": vm_findings() }))] }),
    );
    let dismissed = [Dismissal {
        fingerprint: "0000000000000000".into(),
        kind: "magic-number".into(),
    }];
    let req = s.request("s1", &dismissed);
    let outcome = step::run(
        &s.ctx(),
        &req,
        step::schedule(&s.order, "s1")[0].1,
        &|| {},
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert!(!outcome.cached);
    let finding = &outcome.analysis.findings[0];
    assert_eq!((finding.file.as_str(), finding.line), (VM, 2));
    assert_eq!(finding.evidence[1].file, QUEUE);
    assert_eq!(outcome.analysis.checklist.len(), 1);

    let calls = s.fake.calls();
    let call = &calls[0];
    let argv: Vec<String> = call["argv"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap().to_owned())
        .collect();
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();
    let task_dir = PathBuf::from(at("--add-dir"));
    assert_eq!(task_dir.parent(), Some(s.tmp.path()));
    let schema: Value = serde_json::from_str(&at("--json-schema")).unwrap();
    assert_eq!(schema["title"], "StepFindings");
    let snapshot: Vec<String> = argv
        .iter()
        .map(|a| {
            if a.starts_with('{') {
                "<step-findings.schema.json>".to_owned()
            } else {
                a.replace(&task_dir.to_string_lossy().into_owned(), "<task>")
            }
        })
        .collect();
    assert_eq!(
        snapshot,
        [
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            "<step-findings.schema.json>",
            "--model",
            "claude-sonnet-5-5",
            "--effort",
            "medium",
            "--tools",
            "Read,Grep,Glob",
            "--permission-mode",
            "dontAsk",
            "--restricted",
            "--strict-mcp-config",
            "--disallowedTools",
            "mcp__*",
            "--append-system-prompt-file",
            &format!("<task>{}system-common.md", std::path::MAIN_SEPARATOR),
            "--add-dir",
            "<task>",
            "--no-session-persistence",
        ]
    );
    // The worktree is Claude's working directory.
    assert_eq!(
        call["cwd"].as_str().map(PathBuf::from),
        Some(s.repo.path.clone())
    );

    let stdin = call["stdin"].as_str().unwrap();
    assert!(stdin.starts_with(
        "Analyze step 2 of 3 in the review of merge request !482 \"Torch\" (feature/torch → develop): \"ViewModel enqueues\".\n"
    ));
    assert!(stdin.contains("Earlier steps the reader already knows: step 1 \"Queue contract\"\n"));
    assert!(stdin.contains("(do not raise them again): magic-number\n"));
    assert!(!stdin.contains("{{"), "{stdin}");
    let inputs = &call["addDirFiles"];
    for name in ["step.diff", "hunk-index.tsv", "threads.txt", "rules.md"] {
        let path = task_dir.join(name);
        assert!(
            stdin.contains(&*path.to_string_lossy()),
            "{name} not in the prompt"
        );
        assert!(inputs[name].is_string(), "{name} not in --add-dir");
    }
    let text = |name: &str| inputs[name].as_str().unwrap().to_owned();
    // Only the step's hunks are in the step diff; the index has the whole change.
    let diff = text("step.diff");
    assert!(diff.contains("+    void Up() { queue.Enqueue(); }"));
    assert!(!diff.contains("IQueue.cs") && !diff.contains("README.md"));
    assert_eq!(text("hunk-index.tsv").lines().count(), 4);
    assert_eq!(text("rules.md"), "Prefer async.\n");
    assert_eq!(std::fs::read_dir(s.tmp.path()).unwrap().count(), 0);

    // Cached: the next run starts no claude and validates again.
    let again = step::run(
        &s.ctx(),
        &req,
        step::schedule(&s.order, "s1")[0].1,
        &|| {},
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert!(again.cached);
    assert_eq!(again.analysis, outcome.analysis);
    // F-09.4: a dismissed note is not raised again for the same head.
    let dismissed = [Dismissal {
        fingerprint: finding.fingerprint.clone(),
        kind: finding.kind.clone(),
    }];
    let after = step::run(
        &s.ctx(),
        &s.request("s1", &dismissed),
        step::schedule(&s.order, "s1")[0].1,
        &|| {},
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert!(after.cached && after.analysis.findings.is_empty());
    assert_eq!(s.fake.calls().len(), 1);
}

#[tokio::test]
async fn f09_5_threads_file_holds_the_threads_on_the_step() {
    let s = setup().await;
    s.fake.set_scenario(&json!({ "responses": [empty()] }));
    // Step 1 is the queue contract (no threads), step 2 the ViewModel.
    s.open("s2").await;
    let calls = s.fake.calls();
    // A step without threads gets "none".
    assert_eq!(calls[0]["addDirFiles"]["threads.txt"], "none\n");
    let threads = calls[1]["addDirFiles"]["threads.txt"].as_str().unwrap();
    assert!(
        threads.starts_with(&format!("Thread 1 · open · {VM}:2 (new)\n")),
        "{threads}"
    );
    assert!(threads.contains("Should Enqueue be awaited?"));
    // Not the MR-level thread, not the thread on another step's file.
    assert!(!threads.contains("General question.") && !threads.contains("Typo?"));
    // The prompt rule that keeps Claude off discussed topics (decision 6).
    assert!(
        calls[1]["stdin"]
            .as_str()
            .unwrap()
            .contains("Existing threads on lines of this step")
    );
}

#[tokio::test]
async fn f09_6_opening_a_step_prefetches_the_next_only_and_reuses_the_cache() {
    let s = setup().await;
    s.fake.set_scenario(&json!({ "responses": [empty()] }));
    // Step 1 (s2) and the prefetch of step 2 (s1); step 3 waits until it's opened.
    let opened = s.open("s2").await;
    assert_eq!(opened.len(), 2);
    let stdins = |calls: &[Value]| -> Vec<String> {
        calls
            .iter()
            .map(|c| {
                c["stdin"]
                    .as_str()
                    .unwrap()
                    .lines()
                    .next()
                    .unwrap()
                    .to_owned()
            })
            .collect()
    };
    let first = stdins(&s.fake.calls());
    assert_eq!(first.len(), 2);
    assert!(first[0].starts_with("Analyze step 1 of 3"));
    assert!(first[1].starts_with("Analyze step 2 of 3"));
    // Opening step 2 finds it cached and prefetches step 3.
    let opened = s.open("s1").await;
    assert!(opened[0].cached && !opened[1].cached);
    let calls = stdins(&s.fake.calls());
    assert_eq!(calls.len(), 3);
    assert!(calls[2].starts_with("Analyze step 3 of 3"));
    // Opening the last step prefetches nothing and runs nothing.
    let opened = s.open("s3").await;
    assert_eq!(opened.len(), 1);
    assert!(opened[0].cached);
    assert_eq!(s.fake.calls().len(), 3);
}

#[tokio::test]
async fn f09_1_invalid_output_is_claude_schema_and_not_cached() {
    let s = setup().await;
    let mut output = vm_findings();
    output["findings"][0]["evidence"][1]["line"] = json!(99);
    s.fake
        .set_scenario(&json!({ "responses": [result(json!({ "structured_output": output }))] }));
    let req = s.request("s1", &[]);
    let error = step::run(
        &s.ctx(),
        &req,
        step::schedule(&s.order, "s1")[0].1,
        &|| {},
        &Cancel::new(),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");
    let key = step::key(&s.ctx(), &req).unwrap();
    let cached = s
        .store
        .with_conn(|c| guided_review_lib::review::plan_cache::get(c, &key))
        .unwrap();
    assert_eq!(cached, None);
}

#[tokio::test]
async fn f09_4_a_dismissed_note_is_not_raised_again_when_its_code_moved_on_a_new_head() {
    let mut s = setup().await;
    s.fake.set_scenario(
        &json!({ "responses": [result(json!({ "structured_output": vm_findings() }))] }),
    );
    let priority = step::schedule(&s.order, "s1")[0].1;
    let first = step::run(
        &s.ctx(),
        &s.request("s1", &[]),
        priority,
        &|| {},
        &Cancel::new(),
    )
    .await
    .unwrap();
    let note = &first.analysis.findings[0];
    let dismissed = [Dismissal {
        fingerprint: note.fingerprint.clone(),
        kind: note.kind.clone(),
    }];

    // A new head: the same call is two lines further down and re-indented; the lines around it
    // are the same.
    s.repo.write(
        VM,
        "using System;\n\nclass Vm {\n\tvoid Up()  { queue.Enqueue(); }\n}\n",
    );
    let head = s.repo.commit_all("head 2");
    s.files = files(&Git::new(None, &s.repo.path), &s.base, &head).await;
    s.head = head;
    s.plan = plan(&s.files);
    // Claude words the same note differently and also raises another kind on the same line.
    let mut again = vm_findings();
    again["findings"][0]["title"] = json!("Enqueue result is dropped");
    again["findings"][0]["body"] = json!("The call returns before the upload is queued.");
    again["findings"][0]["line"] = json!(4);
    again["findings"][0]["evidence"][0]["line"] = json!(4);
    let mut other = again["findings"][0].clone();
    other["kind"] = json!("swallowed-error");
    other["title"] = json!("Failures are lost");
    again["findings"].as_array_mut().unwrap().push(other);
    s.fake
        .set_scenario(&json!({ "responses": [result(json!({ "structured_output": again }))] }));

    let calls_before = s.fake.calls().len();
    let after = step::run(
        &s.ctx(),
        &s.request("s1", &dismissed),
        priority,
        &|| {},
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert!(!after.cached, "a new head is a new run");
    let calls = s.fake.calls();
    assert_eq!(calls.len(), calls_before + 1);
    let kinds: Vec<(&str, u32)> = after
        .analysis
        .findings
        .iter()
        .map(|f| (f.kind.as_str(), f.line))
        .collect();
    assert_eq!(kinds, [("swallowed-error", 4)]);
    // Claude is also told which kinds the reviewer dismissed.
    assert!(
        calls[calls_before]["stdin"]
            .as_str()
            .unwrap()
            .contains("(do not raise them again): unawaited-call\n")
    );

    // Control: the same result without the dismissal raises both notes.
    let both = step::run(
        &s.ctx(),
        &s.request("s1", &[]),
        priority,
        &|| {},
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert!(both.cached);
    assert_eq!(both.analysis.findings.len(), 2);
}
