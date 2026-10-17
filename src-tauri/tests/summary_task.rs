//! The summary comment task against the fake `claude` (docs/09 › Fake `claude`; F-12.4, M5
//! decision 11; ADR-022, ADR-025 risk: argv snapshot of the read-only profile). The text that
//! prefills S-05's "Add a summary comment": inputs in the task folder, the clamp to 600 characters,
//! the schema check, the cache. Synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fake_claude.rs"]
mod fake_claude;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use fake_claude::FakeClaude;
use guided_review_lib::claude::ClaudeError;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::claude::tasks::summary_comment::{self, SummaryRequest};
use guided_review_lib::gitlab::discussions;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::drafts::Draft;
use guided_review_lib::review::finding_model::{Severity, Side};
use guided_review_lib::review::plan_cache;
use guided_review_lib::review::plan_model::{Coverage, Orders, Plan};
use guided_review_lib::review::position::DiffPosition;
use guided_review_lib::settings::{ClaudeSettings, TaskEffort, TaskOverride};
use guided_review_lib::store::Store;
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
const SUMMARY: &str = "Thanks, the queue approach looks good. Before merging: await Enqueue and cover the retry path.";

fn result(body: Value) -> Value {
    let mut base =
        json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": "s" });
    base.as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    json!({ "stdout": base.to_string() })
}

fn answer(summary: &str) -> Value {
    result(json!({ "structured_output": { "summary": summary } }))
}

fn plan() -> Plan {
    Plan {
        intent: "Uploads go through a queue.".into(),
        steps: Vec::new(),
        orders: Orders::default(),
        skim: Vec::new(),
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: String::new(),
        coverage: Coverage::default(),
    }
}

fn draft(id: &str, body: &str, position: Option<(&str, u32)>, include: bool) -> Draft {
    Draft {
        id: id.into(),
        session_id: "mr-482".into(),
        finding_id: None,
        body: body.into(),
        position: position.map(|(file, line)| DiffPosition {
            file: file.into(),
            side: Side::New,
            line,
        }),
        severity: Some(Severity::Q),
        include,
        published_note_id: None,
        error: None,
        step_id: None,
        outdated: false,
    }
}

/// Ticked and unpublished (they go into the summary's inputs), a general comment, one that is
/// not ticked and one that was published earlier.
fn drafts() -> Vec<Draft> {
    let mut published = draft("d4", "Already sent in the first round.", None, true);
    published.published_note_id = Some(77);
    vec![
        draft(
            "d1",
            "Enqueue isn't awaited, is that intended?",
            Some((VM, 2)),
            true,
        ),
        draft("d2", "Please add a test for the retry path.", None, true),
        draft("d3", "Rename Up to Upload.", Some(("README.md", 1)), false),
        published,
    ]
}

fn thread(id: &str, path: Option<(&str, u32)>, body: &str, resolved: bool) -> Value {
    let position = path.map(|(file, line)| {
        json!({ "old_path": file, "new_path": file, "new_line": line, "head_sha": "abc" })
    });
    let mut note = json!({ "id": 2, "body": body,
        "author": { "username": "alice", "name": "Alice" }, "created_at": "2026-10-12T10:00:00Z",
        "system": false, "resolvable": true, "resolved": resolved });
    if let Some(position) = position {
        note["position"] = position;
    }
    json!({ "id": id, "notes": [note] })
}

/// Two open threads and one resolved one.
fn threads() -> Vec<discussions::Thread> {
    discussions::parse(vec![
        thread("t1", None, "General question.", false),
        thread("t2", Some((VM, 2)), "Should Enqueue be awaited?", false),
        thread("t3", Some(("README.md", 1)), "Typo fixed already.", true),
    ])
    .unwrap()
}

struct Setup {
    cwd: tempfile::TempDir,
    plan: Plan,
    source: PlanSource,
    drafts: Vec<Draft>,
    threads: Vec<discussions::Thread>,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

fn setup() -> Setup {
    let fake = FakeClaude::new(Path::new(env!("CARGO_BIN_EXE_fake-claude")), &json!({}));
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    Setup {
        cwd: tempfile::tempdir().unwrap(),
        plan: plan(),
        source: PlanSource::Mr {
            iid: 482,
            title: "Torch".into(),
            source_branch: "feature/torch".into(),
            target_branch: "develop".into(),
        },
        drafts: drafts(),
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

    fn request(&self) -> SummaryRequest<'_> {
        SummaryRequest {
            repo_id: 1,
            source: &self.source,
            base_sha: "base111",
            head_sha: "head222",
            cwd: self.cwd.path(),
            plan: &self.plan,
            drafts: &self.drafts,
            threads: &self.threads,
        }
    }

    async fn run(&self) -> Result<summary_comment::SummaryOutcome, ClaudeError> {
        summary_comment::run(&self.ctx(), &self.request(), &|| {}, &Cancel::new()).await
    }
}

fn argv_of(call: &Value) -> Vec<String> {
    call["argv"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn f12_4_summary_task_argv_inputs_and_result() {
    let s = setup();
    s.fake
        .set_scenario(&json!({ "responses": [answer(SUMMARY)] }));
    let started = AtomicUsize::new(0);
    let outcome = summary_comment::run(
        &s.ctx(),
        &s.request(),
        &|| {
            started.fetch_add(1, Ordering::SeqCst);
        },
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert_eq!(outcome.summary, SUMMARY);
    assert!(!outcome.cached);
    assert_eq!(
        started.load(Ordering::SeqCst),
        1,
        "on_started runs once the queue lets the run start"
    );

    let calls = s.fake.calls();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    let argv = argv_of(call);
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();
    let task_dir = PathBuf::from(at("--add-dir"));
    assert_eq!(task_dir.parent(), Some(s.tmp.path()));
    let schema: Value = serde_json::from_str(&at("--json-schema")).unwrap();
    assert_eq!(schema["title"], "SummaryComment");
    let snapshot: Vec<String> = argv
        .iter()
        .map(|a| {
            if a.starts_with('{') {
                "<summary-comment.schema.json>".to_owned()
            } else {
                a.replace(&task_dir.to_string_lossy().into_owned(), "<task>")
            }
        })
        .collect();
    // The read-only profile of ADR-022, the "MR description and pipeline" group's default
    // (Sonnet, low) and no kept session.
    assert_eq!(
        snapshot,
        [
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            "<summary-comment.schema.json>",
            "--model",
            "claude-sonnet-5-5",
            "--effort",
            "low",
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
    assert_eq!(
        call["cwd"].as_str().map(PathBuf::from),
        Some(s.cwd.path().to_path_buf())
    );

    let stdin = call["stdin"].as_str().unwrap();
    assert!(
        stdin.starts_with(
            "Write the reviewer's overall comment for merge request !482 \"Torch\". It is published together with the reviewer's drafts.\n"
        ),
        "{stdin}"
    );
    assert!(stdin.contains("What the change does (from the plan): Uploads go through a queue.\n"));
    assert!(!stdin.contains("{{"), "{stdin}");
    let inputs = &call["addDirFiles"];
    for name in ["drafts.txt", "threads.txt"] {
        let path = task_dir.join(name);
        assert!(
            stdin.contains(&*path.to_string_lossy()),
            "{name} not in the prompt"
        );
        assert!(inputs[name].is_string(), "{name} not in --add-dir");
    }
    // Nothing is left in the temp folder once the run is over.
    assert_eq!(std::fs::read_dir(s.tmp.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn f12_4_drafts_file_lists_the_ticked_unpublished_drafts_with_their_place() {
    let s = setup();
    s.fake
        .set_scenario(&json!({ "responses": [answer(SUMMARY)] }));
    s.run().await.unwrap();
    let calls = s.fake.calls();
    let drafts = calls[0]["addDirFiles"]["drafts.txt"].as_str().unwrap();
    // The drafts that will be published with the summary: their text and file:line.
    assert!(
        drafts.contains("Enqueue isn't awaited, is that intended?"),
        "{drafts}"
    );
    assert!(drafts.contains(&format!("{VM}:2")), "{drafts}");
    assert!(
        drafts.contains("Please add a test for the retry path."),
        "{drafts}"
    );
    // Not ticked, and already published: neither goes out with this summary.
    assert!(!drafts.contains("Rename Up to Upload."), "{drafts}");
    assert!(
        !drafts.contains("Already sent in the first round."),
        "{drafts}"
    );
}

#[tokio::test]
async fn f12_4_threads_file_holds_the_open_threads_or_none() {
    let mut s = setup();
    s.fake
        .set_scenario(&json!({ "responses": [answer(SUMMARY)] }));
    s.run().await.unwrap();
    let calls = s.fake.calls();
    let threads = calls[0]["addDirFiles"]["threads.txt"].as_str().unwrap();
    assert!(threads.contains("General question."), "{threads}");
    assert!(threads.contains("Should Enqueue be awaited?"), "{threads}");
    assert!(!threads.contains("Typo fixed already."), "{threads}");

    // A review without threads: "none", as the plan and step tasks write it.
    s.threads = Vec::new();
    s.drafts = vec![draft("d9", "A single remark.", None, true)];
    s.run().await.unwrap();
    let calls = s.fake.calls();
    assert_eq!(calls[1]["addDirFiles"]["threads.txt"], "none\n");
}

#[tokio::test]
async fn f12_4_a_601_character_summary_is_clamped_to_600_with_an_ellipsis() {
    let s = setup();
    // 601 characters of two bytes each: the clamp counts characters, not bytes.
    let long = "ż".repeat(601);
    s.fake
        .set_scenario(&json!({ "responses": [answer(&long)] }));
    let outcome = s.run().await.unwrap();
    assert_eq!(outcome.summary.chars().count(), 600);
    assert!(outcome.summary.ends_with('…'));
    assert_eq!(outcome.summary, format!("{}…", "ż".repeat(599)));
}

#[tokio::test]
async fn f12_4_a_600_character_summary_is_kept_whole() {
    let s = setup();
    let exact = "ą".repeat(600);
    s.fake
        .set_scenario(&json!({ "responses": [answer(&exact)] }));
    let outcome = s.run().await.unwrap();
    assert_eq!(outcome.summary, exact);
}

#[tokio::test]
async fn f12_4_wrong_type_is_claude_schema_and_not_cached() {
    let s = setup();
    for output in [json!({ "summary": 5 }), json!({ "text": "wrong field" })] {
        s.fake.set_scenario(
            &json!({ "responses": [result(json!({ "structured_output": output }))] }),
        );
        let error = s.run().await.unwrap_err();
        assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");
    }
    // No structured output at all is the same failure.
    s.fake
        .set_scenario(&json!({ "responses": [result(json!({ "result": "free text" }))] }));
    let error = s.run().await.unwrap_err();
    assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");

    let key = summary_comment::key(&s.ctx(), &s.request());
    let cached = s.store.with_conn(|c| plan_cache::get(c, &key)).unwrap();
    assert_eq!(cached, None);
}

#[tokio::test]
async fn f12_4_the_same_drafts_come_from_the_cache_and_changed_text_runs_claude_again() {
    let mut s = setup();
    s.fake.set_scenario(
        &json!({ "responses": [answer("First version."), answer("Second version.")] }),
    );
    let first = s.run().await.unwrap();
    assert_eq!(
        (first.summary.as_str(), first.cached),
        ("First version.", false)
    );

    // Same drafts and head: no second run, and on_started never fires.
    let started = AtomicUsize::new(0);
    let again = summary_comment::run(
        &s.ctx(),
        &s.request(),
        &|| {
            started.fetch_add(1, Ordering::SeqCst);
        },
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert_eq!(
        (again.summary.as_str(), again.cached),
        ("First version.", true)
    );
    assert_eq!(started.load(Ordering::SeqCst), 0);
    assert_eq!(s.fake.calls().len(), 1);

    // The reviewer edits a draft: the summary is written again for the new text.
    s.drafts[0].body = "Enqueue isn't awaited; please make it async.".into();
    let changed = s.run().await.unwrap();
    assert_eq!(
        (changed.summary.as_str(), changed.cached),
        ("Second version.", false)
    );
    assert_eq!(s.fake.calls().len(), 2);
}

#[tokio::test]
async fn f12_4_another_head_runs_claude_again() {
    let s = setup();
    s.fake
        .set_scenario(&json!({ "responses": [answer("For head 222."), answer("For head 333.")] }));
    s.run().await.unwrap();
    let mut req = s.request();
    req.head_sha = "head333";
    let outcome = summary_comment::run(&s.ctx(), &req, &|| {}, &Cancel::new())
        .await
        .unwrap();
    assert_eq!(
        (outcome.summary.as_str(), outcome.cached),
        ("For head 333.", false)
    );
    assert_eq!(s.fake.calls().len(), 2);
}

#[tokio::test]
async fn f12_4_the_model_follows_the_mr_description_and_pipeline_group() {
    let mut s = setup();
    s.settings.tasks.mr = TaskOverride {
        model: "claude-opus-5-5".into(),
        effort: TaskEffort::High,
    };
    s.fake
        .set_scenario(&json!({ "responses": [answer(SUMMARY)] }));
    s.run().await.unwrap();
    let argv = argv_of(&s.fake.calls()[0]);
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(at("--model"), "claude-opus-5-5");
    assert_eq!(at("--effort"), "high");
}
