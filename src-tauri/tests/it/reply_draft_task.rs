//! The reply draft task against the fake `claude` (docs/09 › Fake `claude`; F-26.7, docs/plans/M7.md
//! F-26.7; ADR-022, ADR-025 risk: argv snapshot of the read-only profile). **Draft with Claude** on
//! an S-10 question thread asks for a proposed answer from the MR author: inputs are two files in
//! the task folder, readable through `--add-dir`, the thread (its notes in order) and the code at
//! the thread's line read from the author's own checkout; Claude's working directory is that
//! repository root. The answer is only filled into the text area, so it is not cached: every click
//! asks again. The "Questions" group (default model, low effort) decides the model. Synthetic data
//! only (ADR-019); paths carry spaces and Polish characters.
//!
//! The tests pin these names (the plan's `claude/tasks/reply_draft.rs`):
//! - `reply_draft::ReplyDraftRequest { cwd: &Path, thread: &Thread }`
//! - `reply_draft::run(&Context, &ReplyDraftRequest, &on_started, &Cancel) -> Result<ReplyDraft,
//!   ClaudeError>` with `ReplyDraft { reply: String }` (the IPC result of `claude_reply_draft`)
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
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::claude::tasks::reply_draft::{self, ReplyDraftRequest};
use guided_review_lib::gitlab::discussions::{self, Thread};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::settings::{ClaudeSettings, TaskEffort, TaskOverride};
use guided_review_lib::store::Store;
use serde_json::{Value, json};

const FILE: &str = "src/Zażółć/Upload Worker.cs";
const QUESTION: &str = "What happens if the app is killed in the middle of retrying?";
const FOLLOW_UP: &str = "And is the attempt count kept?";
const REPLY: &str = "The attempt count lives in memory, so a kill resets it. I will persist it with the queue item.";

fn result(body: Value) -> Value {
    let mut base =
        json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": "s" });
    base.as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    json!({ "stdout": base.to_string() })
}

fn answer(reply: &str) -> Value {
    result(json!({ "structured_output": { "reply": reply } }))
}

fn note(id: u64, user: &str, body: &str) -> Value {
    json!({ "id": id, "body": body, "author": { "username": user, "name": user },
        "created_at": "2026-10-12T10:00:00Z", "system": false, "resolvable": true,
        "resolved": false })
}

/// A question thread of Piotr's on `file:line` with a follow-up note.
fn thread_at(file: Option<&str>, line: u32) -> Thread {
    let mut first = note(1, "piotr.s", QUESTION);
    if let Some(file) = file {
        first["position"] = json!({ "old_path": file, "new_path": file, "new_line": line,
            "head_sha": "abc", "base_sha": "def" });
    }
    let raw = vec![json!({ "id": "disc-q", "notes": [first, note(2, "marta.k", FOLLOW_UP)] })];
    discussions::parse(raw).unwrap().remove(0)
}

struct Setup {
    repo: FixtureRepo,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

/// The author's checkout: a 200-line file whose lines read `// marker-NNN`.
fn setup() -> Setup {
    let repo = FixtureRepo::new("reply draft");
    let body: String = (1..=200).map(|n| format!("// marker-{n:03}\n")).collect();
    repo.write(FILE, &body);
    repo.commit_all("Add the worker");
    let fake = FakeClaude::new(Path::new(env!("CARGO_BIN_EXE_fake-claude")), &json!({}));
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    Setup {
        repo,
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

    async fn draft(&self, thread: &Thread) -> Result<reply_draft::ReplyDraft, ClaudeError> {
        let req = ReplyDraftRequest {
            cwd: &self.repo.path,
            thread,
        };
        reply_draft::run(&self.ctx(), &req, &|| {}, &Cancel::new()).await
    }

    /// Claude answers once with exactly this.
    fn says(&self, reply: &str) {
        self.fake
            .set_scenario(&json!({ "responses": [answer(reply)] }));
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

/// Every file of the task folder as Claude can read it, joined.
fn inputs_of(call: &Value) -> String {
    call["addDirFiles"]
        .as_object()
        .unwrap()
        .iter()
        .filter(|(name, _)| name.as_str() != "system-common.md")
        .filter_map(|(_, content)| content.as_str())
        .collect::<Vec<_>>()
        .join("\n=====\n")
}

#[tokio::test]
async fn f26_7_reply_draft_argv_inputs_and_result() {
    let s = setup();
    let thread = thread_at(Some(FILE), 100);
    s.says(&format!("  {REPLY}\n"));
    let started = AtomicUsize::new(0);
    let req = ReplyDraftRequest {
        cwd: &s.repo.path,
        thread: &thread,
    };
    let draft = reply_draft::run(
        &s.ctx(),
        &req,
        &|| {
            started.fetch_add(1, Ordering::SeqCst);
        },
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert_eq!(draft.reply, REPLY, "the proposed answer is trimmed");
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
    assert_eq!(schema["title"], "ReplyDraft");
    let snapshot: Vec<String> = argv
        .iter()
        .map(|a| {
            if a.starts_with('{') {
                "<reply-draft.schema.json>".to_owned()
            } else {
                a.replace(&task_dir.to_string_lossy().into_owned(), "<task>")
            }
        })
        .collect();
    // The read-only profile of ADR-022 and the "Questions" group's default (the global model,
    // low effort), no kept session: the draft is one call, not a conversation.
    assert_eq!(
        snapshot,
        [
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            "<reply-draft.schema.json>",
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
        Some(s.repo.path.clone()),
        "Claude works in the repository root"
    );

    let stdin = call["stdin"].as_str().unwrap();
    assert!(!stdin.contains("{{"), "{stdin}");
    let files = call["addDirFiles"].as_object().unwrap();
    let input_files: Vec<&String> = files.keys().filter(|n| *n != "system-common.md").collect();
    assert_eq!(input_files.len(), 2, "the thread file and the code excerpt");
    for name in input_files {
        let path = task_dir.join(name);
        assert!(
            stdin.contains(&*path.to_string_lossy()),
            "{name} not in the prompt"
        );
    }

    // The thread in order, with who wrote what, and the code at its line.
    let inputs = inputs_of(call);
    assert!(inputs.contains(QUESTION), "{inputs}");
    assert!(inputs.contains(FOLLOW_UP), "{inputs}");
    assert!(inputs.contains("piotr.s"), "{inputs}");
    assert!(inputs.find(QUESTION) < inputs.find(FOLLOW_UP));
    for near in ["marker-100", "marker-098", "marker-102"] {
        assert!(inputs.contains(near), "{near} is not in the excerpt");
    }
    for far in ["marker-001", "marker-200"] {
        assert!(!inputs.contains(far), "{far} is in the excerpt");
    }
    // Nothing is left in the temp folder once the run is over.
    assert_eq!(std::fs::read_dir(s.tmp.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn f26_7_the_code_at_a_line_near_the_file_start_and_end_is_cut_to_the_file() {
    let s = setup();
    for (line, expect, other) in [
        (1, "marker-001", "marker-200"),
        (200, "marker-200", "marker-001"),
    ] {
        s.says(REPLY);
        s.draft(&thread_at(Some(FILE), line)).await.unwrap();
        let inputs = inputs_of(s.fake.calls().last().unwrap());
        assert!(inputs.contains(expect), "{line}: {expect}");
        assert!(!inputs.contains(other), "{line}: {other}");
    }
}

#[tokio::test]
async fn f26_7_every_click_asks_claude_again_nothing_is_cached() {
    let s = setup();
    let thread = thread_at(Some(FILE), 100);
    s.fake
        .set_scenario(&json!({ "responses": [answer("First."), answer("Second.")] }));
    assert_eq!(s.draft(&thread).await.unwrap().reply, "First.");
    assert_eq!(s.draft(&thread).await.unwrap().reply, "Second.");
    assert_eq!(s.fake.calls().len(), 2);
}

#[tokio::test]
async fn f26_7_a_thread_on_the_mr_itself_has_no_code_but_is_drafted() {
    let s = setup();
    s.says(REPLY);
    let draft = s.draft(&thread_at(None, 0)).await.unwrap();
    assert_eq!(draft.reply, REPLY);
    let inputs = inputs_of(&s.fake.calls()[0]);
    assert!(inputs.contains(QUESTION));
    assert!(!inputs.contains("marker-"), "{inputs}");
}

#[tokio::test]
async fn f26_7_a_file_that_is_gone_from_the_checkout_is_drafted_without_code() {
    let s = setup();
    s.says(REPLY);
    let draft = s
        .draft(&thread_at(Some("src/Deleted File.cs"), 12))
        .await
        .unwrap();
    assert_eq!(draft.reply, REPLY);
    assert!(inputs_of(&s.fake.calls()[0]).contains(QUESTION));
}

#[tokio::test]
async fn f26_7_a_position_outside_the_checkout_is_never_read_into_the_inputs() {
    let s = setup();
    // The position comes from GitLab, i.e. from teammates: it must not walk out of the repository.
    let outside = s.repo.path.parent().unwrap().join("outside-secret.txt");
    std::fs::write(&outside, "OUTSIDE-SECRET\n").unwrap();
    s.says(REPLY);
    let up = format!("../{}", outside.file_name().unwrap().to_string_lossy());
    let _ = s.draft(&thread_at(Some(&up), 1)).await;
    s.says(REPLY);
    let _ = s
        .draft(&thread_at(Some(&outside.to_string_lossy()), 1))
        .await;
    std::fs::remove_file(&outside).unwrap();
    let calls = s.fake.calls();
    assert!(!calls.is_empty(), "the thread is still drafted");
    for call in calls {
        assert!(!inputs_of(&call).contains("OUTSIDE-SECRET"));
    }
}

#[tokio::test]
async fn f26_7_a_long_answer_is_clamped_to_the_schemas_800_characters() {
    let s = setup();
    s.says(&"Zażółć gęślą jaźń. ".repeat(60));
    let draft = s.draft(&thread_at(Some(FILE), 100)).await.unwrap();
    assert!(draft.reply.chars().count() <= 800, "{}", draft.reply.len());
    assert!(draft.reply.starts_with("Zażółć gęślą jaźń."));
}

#[tokio::test]
async fn f26_7_a_wrong_shape_is_claude_schema() {
    let s = setup();
    let thread = thread_at(Some(FILE), 100);
    for output in [
        json!({ "reply": "   " }),
        json!({ "reply": "" }),
        json!({ "reply": 5 }),
        json!({ "answer": "text" }),
        json!({}),
    ] {
        s.fake.set_scenario(
            &json!({ "responses": [result(json!({ "structured_output": output }))] }),
        );
        let error = s.draft(&thread).await.unwrap_err();
        assert!(
            matches!(error, ClaudeError::Schema(_)),
            "{output}: {error:?}"
        );
    }
    // No structured output at all is the same failure.
    s.fake
        .set_scenario(&json!({ "responses": [result(json!({ "result": "free text" }))] }));
    let error = s.draft(&thread).await.unwrap_err();
    assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");
}

#[tokio::test]
async fn f26_7_the_model_follows_the_questions_group() {
    let mut s = setup();
    s.settings.tasks.ask = TaskOverride {
        model: "claude-opus-5-5".into(),
        effort: TaskEffort::High,
    };
    s.says(REPLY);
    s.draft(&thread_at(Some(FILE), 100)).await.unwrap();
    let argv = argv_of(&s.fake.calls()[0]);
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(at("--model"), "claude-opus-5-5");
    assert_eq!(at("--effort"), "high");
}
