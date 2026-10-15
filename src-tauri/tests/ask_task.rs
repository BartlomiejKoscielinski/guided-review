//! Questions against the fake `claude` (docs/09 › Fake `claude`) on a fixture repository
//! (F-10.1, F-10.2; ADR-022: argv of the read-only profile with stream-json and a kept
//! session). Synthetic data only (ADR-019).

#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fake_claude.rs"]
mod fake_claude;
#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::path::Path;
use std::sync::{Arc, Mutex};

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::ClaudeError;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::tasks::ask::{self, AskAnswer, AskRequest};
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::git::Git;
use guided_review_lib::git::diff;
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::finding_model::Side;
use guided_review_lib::review::layer::Layer;
use guided_review_lib::review::plan_model::{Coverage, Orders, Plan, Step};
use guided_review_lib::review::position::LineSelection;
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::{Store, claude_sessions};
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";

fn delta(text: &str) -> String {
    json!({ "type": "stream_event", "event": { "type": "content_block_delta", "index": 0,
        "delta": { "type": "text_delta", "text": text } } })
    .to_string()
}

/// A stream-json run: init, the deltas, an assistant message and the result.
fn streamed(parts: &[&str], session: &str) -> Value {
    let mut lines =
        vec![json!({ "type": "system", "subtype": "init", "session_id": session }).to_string()];
    lines.extend(parts.iter().map(|p| delta(p)));
    lines.push(json!({ "type": "assistant", "message": { "content": [] } }).to_string());
    lines.push(
        json!({ "type": "result", "subtype": "success", "is_error": false,
            "result": parts.concat(), "session_id": session })
        .to_string(),
    );
    json!({ "stdout": lines.join("\n") + "\n" })
}

struct Setup {
    repo: FixtureRepo,
    files: Vec<FileDiff>,
    plan: Plan,
    order: Vec<String>,
    source: PlanSource,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

async fn setup(responses: Vec<Value>) -> Setup {
    let repo = FixtureRepo::new("ask");
    repo.write(VM, "class Vm {\n    void Up() { Send(); }\n}\n");
    repo.write("README.md", "Old\n");
    let base = repo.commit_all("base");
    repo.write(VM, "class Vm {\n    void Up() { queue.Enqueue(); }\n}\n");
    repo.write("README.md", "New\n");
    let head = repo.commit_all("head");
    let git = Git::new(None, &repo.path);
    let cancel = Cancel::new();
    let mut files = Vec::new();
    for file in diff::range_files(&git, &base, &head, &cancel)
        .await
        .unwrap()
    {
        files.push(
            diff::range_file_diff(&git, &base, &head, &file, &cancel)
                .await
                .unwrap(),
        );
    }
    let hunk = |path: &str| {
        files
            .iter()
            .find(|f| f.new_path.as_deref() == Some(path))
            .unwrap()
            .hunks[0]
            .id
            .clone()
    };
    let step = |id: &str, title: &str, path: &str| Step {
        id: id.into(),
        title: title.into(),
        short_title: title.into(),
        reason: "Order.".into(),
        description: format!("{title}."),
        layer: Layer::App,
        hunk_ids: vec![hunk(path)],
        builds_on: Vec::new(),
    };
    let plan = Plan {
        intent: "Uploads go through a queue.".into(),
        steps: vec![
            step("s1", "ViewModel enqueues", VM),
            step("s2", "Readme", "README.md"),
        ],
        orders: Orders::default(),
        skim: Vec::new(),
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: String::new(),
        coverage: Coverage::default(),
    };
    let fake = FakeClaude::new(
        Path::new(env!("CARGO_BIN_EXE_fake-claude")),
        &json!({ "responses": responses }),
    );
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    Setup {
        repo,
        files,
        plan,
        order: ["s2", "s1"].map(str::to_owned).to_vec(),
        source: PlanSource::Mr {
            iid: 482,
            title: "Torch".into(),
            source_branch: "feature/torch".into(),
            target_branch: "develop".into(),
        },
        fake,
        tmp: tempfile::tempdir().unwrap(),
        store: Store::open_in_memory().unwrap(),
        queue: Queue::new(1),
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

    async fn ask(
        &self,
        question: &str,
        selection: Option<&LineSelection>,
    ) -> (Result<AskAnswer, ClaudeError>, Vec<String>) {
        let req = AskRequest {
            session_id: "review-1",
            source: &self.source,
            cwd: &self.repo.path,
            files: &self.files,
            plan: &self.plan,
            step_id: "s1",
            order: &self.order,
            question,
            selection,
        };
        let parts = Arc::new(Mutex::new(Vec::new()));
        let sink = parts.clone();
        let mut on_text = move |t: &str| sink.lock().unwrap().push(t.to_owned());
        let answer = ask::run(&self.ctx(), &req, &|| {}, &mut on_text, &Cancel::new()).await;
        let parts = parts.lock().unwrap().clone();
        (answer, parts)
    }

    fn stored_session(&self) -> Option<String> {
        self.store
            .with_conn(|c| claude_sessions::get(c, "review-1", "s1"))
            .unwrap()
    }
}

fn argv(call: &Value) -> Vec<String> {
    call["argv"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap().to_owned())
        .collect()
}

/// The argv with the per-run task folder and system prompt path replaced.
fn argv_shape(call: &Value) -> Vec<String> {
    let args = argv(call);
    args.iter()
        .enumerate()
        .map(
            |(i, a)| match args.get(i.wrapping_sub(1)).map(String::as_str) {
                Some("--add-dir") => "<task dir>".to_owned(),
                Some("--append-system-prompt-file") => "<system prompt>".to_owned(),
                _ => a.clone(),
            },
        )
        .collect()
}

#[tokio::test]
async fn f10_1_question_with_selection_streams_text_in_the_step_context() {
    let s = setup(vec![streamed(
        &["It is ", "fire-and-forget ", "(Upload ViewModel.cs:2)."],
        "c-1",
    )])
    .await;
    let selection = LineSelection {
        file: VM.into(),
        side: Side::New,
        start: 2,
        end: 2,
    };
    let (answer, parts) = s.ask("Is Enqueue awaited?", Some(&selection)).await;
    let answer = answer.unwrap();
    assert_eq!(
        parts,
        ["It is ", "fire-and-forget ", "(Upload ViewModel.cs:2)."]
    );
    assert_eq!(
        answer.text,
        "It is fire-and-forget (Upload ViewModel.cs:2)."
    );
    assert!(!answer.follow_up);

    let calls = s.fake.calls();
    assert_eq!(calls.len(), 1);
    let stdin = calls[0]["stdin"].as_str().unwrap();
    // Step 2 in the reader's order (s2, s1), its title, the source, the selection, the question.
    assert!(stdin.contains("step 2 (\"ViewModel enqueues\")"), "{stdin}");
    assert!(stdin.contains("merge request !482 \"Torch\""), "{stdin}");
    assert!(
        stdin.contains(&format!("selected lines 2-2 of {VM} (new side)")),
        "{stdin}"
    );
    assert!(
        stdin.contains("+    void Up() { queue.Enqueue(); }"),
        "{stdin}"
    );
    assert!(
        !stdin.contains("Send();"),
        "only the selected lines: {stdin}"
    );
    assert!(stdin.contains("Question: Is Enqueue awaited?"), "{stdin}");
    assert_eq!(
        Path::new(calls[0]["cwd"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        s.repo.path.canonicalize().unwrap()
    );
}

#[tokio::test]
async fn f10_1_question_without_selection_has_no_selection_block() {
    let s = setup(vec![streamed(&["Fine."], "c-1")]).await;
    let (answer, _) = s.ask("What changed?", None).await;
    assert_eq!(answer.unwrap().text, "Fine.");
    let stdin = s.fake.calls()[0]["stdin"].as_str().unwrap().to_owned();
    assert!(!stdin.contains("selected lines"), "{stdin}");
    assert!(
        !stdin.contains("{{"),
        "every placeholder is filled: {stdin}"
    );
}

#[tokio::test]
async fn f10_1_selection_outside_the_step_starts_no_claude() {
    let s = setup(vec![streamed(&["x"], "c-1")]).await;
    let readme = LineSelection {
        file: "README.md".into(),
        side: Side::New,
        start: 1,
        end: 1,
    };
    let (answer, _) = s.ask("Why?", Some(&readme)).await;
    assert!(matches!(answer, Err(ClaudeError::Invalid(_))), "{answer:?}");
    assert!(s.fake.calls().is_empty());
}

/// The lines of the selection block in the prompt, with their diff markers.
fn selection_lines(stdin: &str, header: &str) -> Vec<String> {
    let mut lines = stdin.lines().skip_while(|l| !l.contains(header));
    assert!(lines.next().is_some(), "{header} is in the prompt: {stdin}");
    lines
        .skip(1)
        .take_while(|l| *l != "```")
        .map(str::to_owned)
        .collect()
}

#[tokio::test]
async fn f10_1_selection_on_the_old_side_shows_the_deleted_line_and_no_new_line() {
    let s = setup(vec![streamed(&["Yes."], "c-1")]).await;
    let old = LineSelection {
        file: VM.into(),
        side: Side::Old,
        start: 1,
        end: 3,
    };
    let (answer, _) = s.ask("Why was Send removed?", Some(&old)).await;
    answer.unwrap();
    let stdin = s.fake.calls()[0]["stdin"].as_str().unwrap().to_owned();
    assert_eq!(
        selection_lines(&stdin, &format!("selected lines 1-3 of {VM} (old side)")),
        [" class Vm {", "-    void Up() { Send(); }", " }"],
        "{stdin}"
    );
}

#[tokio::test]
async fn f10_1_a_range_selected_upwards_reads_from_the_lower_line_to_the_higher() {
    let s = setup(vec![streamed(&["Yes."], "c-1")]).await;
    let upwards = LineSelection {
        file: VM.into(),
        side: Side::New,
        start: 3,
        end: 1,
    };
    let (answer, _) = s.ask("What changed?", Some(&upwards)).await;
    answer.unwrap();
    let stdin = s.fake.calls()[0]["stdin"].as_str().unwrap().to_owned();
    assert_eq!(
        selection_lines(&stdin, &format!("selected lines 1-3 of {VM} (new side)")),
        [" class Vm {", "+    void Up() { queue.Enqueue(); }", " }"],
        "{stdin}"
    );
}

#[tokio::test]
async fn f10_2_first_question_keeps_the_session_and_follow_ups_resume_it() {
    let s = setup(vec![
        streamed(&["First."], "c-1"),
        streamed(&["Second."], "c-1"),
    ])
    .await;
    s.ask("Is Enqueue awaited?", None).await.0.unwrap();
    assert_eq!(s.stored_session().as_deref(), Some("c-1"));
    let follow = s.ask("And if the queue is full?", None).await.0.unwrap();
    assert!(follow.follow_up);
    assert_eq!(follow.text, "Second.");

    let calls = s.fake.calls();
    let first = argv_shape(&calls[0]);
    let second = argv_shape(&calls[1]);
    let expected: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
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
        "<system prompt>",
        "--add-dir",
        "<task dir>",
    ]
    .map(str::to_owned)
    .to_vec();
    assert_eq!(first, expected);
    let mut resumed = expected.clone();
    resumed.extend(["--resume".to_owned(), "c-1".to_owned()]);
    assert_eq!(second, resumed);
    for call in [&first, &second] {
        assert!(!call.iter().any(|a| a == "--no-session-persistence"));
        assert!(
            !call
                .iter()
                .any(|a| a == "--bare" || a.contains("dangerously"))
        );
    }
}

#[tokio::test]
async fn f10_2_a_session_claude_no_longer_has_starts_a_new_one() {
    let gone = json!({ "stdout": json!({ "type": "result", "is_error": true,
        "terminal_reason": "error", "result": "No conversation found with session ID: c-old" })
        .to_string(), "exit": 1 });
    let s = setup(vec![gone, streamed(&["Fresh."], "c-2")]).await;
    s.store
        .with_conn(|c| claude_sessions::put(c, "review-1", "s1", "c-old"))
        .unwrap();
    let answer = s.ask("Still there?", None).await.0.unwrap();
    assert_eq!(answer.text, "Fresh.");
    assert!(!answer.follow_up);
    assert_eq!(s.stored_session().as_deref(), Some("c-2"));
    let calls = s.fake.calls();
    assert_eq!(calls.len(), 2);
    assert!(argv(&calls[0]).contains(&"--resume".to_owned()));
    assert!(!argv(&calls[1]).contains(&"--resume".to_owned()));
}
