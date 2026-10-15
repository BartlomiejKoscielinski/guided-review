//! Self-review (F-17.1) of uncommitted changes whose untracked files sit in a dot directory
//! (an IDE's `.idea` folder; the live check of attempt 1 failed every step there): every step is
//! analyzed from the repository root, notes on the untracked files validate however Claude names
//! the step's file, and a failed step is logged with its reason. Fake `claude`, synthetic data
//! only (ADR-019). A test binary of its own: one test installs the global logger.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fake_claude.rs"]
mod fake_claude;
#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::path::Path;
use std::sync::Arc;

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::{Priority, Queue};
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::logging::{self, rotate::RotatingFile};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::finding_model::StepAnalysis;
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::plan_runs;
use guided_review_lib::review::step_context::{self, StepContext};
use guided_review_lib::review::step_runs::{self, RunError, StepRuns};
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::{self, Store};
use serde_json::{Value, json};

const SERVICE: &str = "src/Delivery.App/Services/Kurier Service.cs";
const IGNORE: &str = "src/Delivery.App/Services/.idea/.gitignore";
const ENCODINGS: &str = "src/Delivery.App/Services/.idea/encodings.xml";

struct Setup {
    repo: FixtureRepo,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

/// A tracked edit of the service and the two untracked files Rider writes into `.idea`
/// (CRLF line ends, the second without a final newline); a `uncommitted` session on HEAD.
fn setup() -> Setup {
    let repo = FixtureRepo::new("self review idea");
    repo.write(SERVICE, "class KurierService {\n    void Send() { }\n}\n");
    repo.commit_all("base");
    repo.write(
        SERVICE,
        "class KurierService {\n    void Send() { Log(); }\n}\n",
    );
    repo.write(
        IGNORE,
        "# Default ignored files\r\n/shelf/\r\n/workspace.xml\r\n",
    );
    repo.write(
        ENCODINGS,
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<project version=\"4\">\r\n  \
         <component name=\"Encoding\" addBOMForNewFiles=\"with BOM\" />\r\n</project>",
    );
    let store = Store::open_in_memory().unwrap();
    let path = repo.path.to_string_lossy().into_owned();
    store
        .with_conn(move |c| {
            store::repos::add(c, "app", &path, None)?;
            Ok(())
        })
        .unwrap();
    let head = repo.head();
    let source = json!({ "kind": "local", "scope": { "kind": "uncommitted" } }).to_string();
    store
        .with_conn(|c| {
            c.execute(
                "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, worktree)
                 VALUES ('u', 1, ?1, ?2, ?2, NULL)",
                rusqlite::params![source, head],
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
    }
}

fn result(output: &Value) -> Value {
    let line = json!({ "type": "result", "subtype": "success", "is_error": false,
        "session_id": "s", "structured_output": output });
    json!({ "stdout": line.to_string() })
}

fn path(file: &FileDiff) -> String {
    file.new_path
        .clone()
        .or(file.old_path.clone())
        .unwrap_or_default()
}

fn same_dir(a: &Path, b: &Path) -> bool {
    a.canonicalize().unwrap() == b.canonicalize().unwrap()
}

/// `rel` as Claude's Read tool names it: absolute, with backslashes.
fn absolute(repo: &Path, rel: &str) -> String {
    rel.split('/')
        .fold(repo.to_path_buf(), |p, part| p.join(part))
        .to_string_lossy()
        .replace('/', "\\")
}

/// One step per file, in diff order.
fn plan_output(files: &[FileDiff]) -> Value {
    let steps: Vec<Value> = files
        .iter()
        .enumerate()
        .map(|(i, f)| {
            json!({ "id": format!("s{}", i + 1), "title": path(f), "short_title": "File",
                "reason": "In file order.", "description": "One file.", "layer": "Core",
                "hunk_ids": f.hunks.iter().map(|h| h.id.clone()).collect::<Vec<_>>(),
                "builds_on": [] })
        })
        .collect();
    let ids: Vec<String> = (1..=files.len()).map(|i| format!("s{i}")).collect();
    json!({
        "intent": "Own changes.", "steps": steps,
        "orders": { "contract_to_ui": ids, "tests_first": ids },
        "skim": [], "risks": [], "description_check": [], "already_discussed": ""
    })
}

/// A note on line 1 of the step file `named`, citing that line (named the same way) and the
/// service by its repository path, with a fold on line 1.
fn note_on(named: &str) -> Value {
    json!({
        "findings": [{
            "severity": "q", "kind": "ide-settings", "title": "IDE settings in the change",
            "body": "NOTE-CANARY Is this folder meant to be shared?", "file": named,
            "side": "new", "line": 1,
            "evidence": [{ "file": named, "line": 1, "note": "the file" },
                         { "file": SERVICE, "line": 2, "note": "the service" }],
            "suggested_comment": "Should .idea be ignored?"
        }],
        "checklist": [], "files_read": [{ "file": named, "why": "the step" }],
        "folds": [{ "file": named, "new_start": 1, "new_end": 1, "title": "Header",
            "reason": "Generated." }]
    })
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

    fn respond(&self, outputs: &[Value]) {
        let mut all = vec![json!({}); self.fake.calls().len()];
        all.extend(outputs.iter().map(result));
        self.fake.set_scenario(&json!({ "responses": all }));
    }

    /// Plans the session (one step per file) and loads its step context the way S-03 does.
    async fn planned(&self) -> (Vec<FileDiff>, StepContext) {
        let none = |_| async { Vec::new() };
        let inputs = step_context::load_inputs(&self.store, None, "u", none, &Cancel::new())
            .await
            .unwrap();
        let mut planned: Vec<String> = inputs.files.iter().map(path).collect();
        planned.sort();
        assert_eq!(planned, [IGNORE, ENCODINGS, SERVICE]);
        self.respond(&[plan_output(&inputs.files)]);
        let plan = plan_runs::plan(&self.ctx(), &inputs, &Cancel::new(), &|_| {})
            .await
            .unwrap();
        assert!(plan.claude_error.is_none(), "{:?}", plan.claude_error);
        let cx = step_context::load(&self.ctx(), None, "u", none, &Cancel::new())
            .await
            .unwrap();
        (inputs.files, cx)
    }

    async fn findings(
        &self,
        runs: &StepRuns,
        cx: &StepContext,
        order: &[String],
        id: &str,
    ) -> Result<StepAnalysis, RunError> {
        let req = cx.step_request(id, order, &[]);
        step_runs::findings(
            runs,
            &self.ctx(),
            &req,
            "u",
            Priority::CurrentStep,
            &Cancel::new(),
            &|_| {},
        )
        .await
    }
}

#[tokio::test]
async fn f17_1_untracked_files_in_a_dot_directory_are_planned_and_analyzed() {
    let s = setup();
    let (files, cx) = s.planned().await;
    let order = cx.order(Strategy::ContractToUi);
    assert_eq!(order.len(), 3);
    let runs = StepRuns::default();
    for (i, id) in order.iter().enumerate() {
        let file = path(&files[i]);
        // The step's file as the diff names it, absolute with backslashes, and relative with
        // backslashes: each is the same step file.
        let named = match i {
            0 => file.clone(),
            1 => absolute(&s.repo.path, &file),
            _ => file.replace('/', "\\"),
        };
        s.respond(&[note_on(&named)]);
        let analysis = s
            .findings(&runs, &cx, &order, id)
            .await
            .unwrap_or_else(|e| panic!("step {id} on {named}: {e:?}"));
        assert_eq!(analysis.findings.len(), 1, "{named}");
        let note = &analysis.findings[0];
        assert_eq!(note.file, file);
        assert_eq!(note.evidence[0].file, file);
        assert_eq!(note.evidence[1].file, SERVICE);
        assert_eq!(analysis.folds[0].file, file);
        assert_eq!(analysis.files_read[0].file, file);
        let call = s.fake.calls().last().unwrap().clone();
        assert!(same_dir(
            Path::new(call["cwd"].as_str().unwrap()),
            &s.repo.path
        ));
        let diff = call["addDirFiles"]["step.diff"].as_str().unwrap();
        assert!(diff.contains(&format!("b/{file}")), "{diff}");
    }
    // Opening each step again is a cache hit: no further `claude` run.
    let before = s.fake.calls().len();
    for id in &order {
        s.findings(&runs, &cx, &order, id).await.unwrap();
    }
    assert_eq!(s.fake.calls().len(), before);
}

#[tokio::test]
async fn f17_1_a_note_on_a_file_outside_the_step_still_fails_the_step() {
    let s = setup();
    let (files, cx) = s.planned().await;
    let order = cx.order(Strategy::ContractToUi);
    // Step 1 is the service; a note on the `.idea` folder or on another step's file is rejected
    // however it is named.
    assert_eq!(path(&files[0]), SERVICE);
    let runs = StepRuns::default();
    for named in [
        "src/Delivery.App/Services/.idea".to_owned(),
        absolute(&s.repo.path, ENCODINGS),
    ] {
        s.respond(&[note_on(&named)]);
        let error = s.findings(&runs, &cx, &order, &order[0]).await.unwrap_err();
        let error = AppError::from(error);
        assert_eq!(error.code, ErrorCode::ClaudeSchema, "{named}");
        assert_eq!(
            error.detail.as_deref(),
            Some("a finding on a file outside the step")
        );
    }
}

#[tokio::test]
async fn f17_1_a_failed_step_is_logged_with_its_reason_and_no_claude_text() {
    let dir = tempfile::tempdir().unwrap();
    let log = Arc::new(RotatingFile::open(dir.path(), "test", 1 << 20, 2).unwrap());
    let subscriber = logging::subscriber(
        Some(Arc::clone(&log)),
        logging::filter_from(Some("info")),
        false,
    );
    tracing::subscriber::set_global_default(subscriber).unwrap();

    let s = setup();
    let (files, cx) = s.planned().await;
    let order = cx.order(Strategy::ContractToUi);
    let mut output = note_on(&path(&files[1]));
    // Evidence in a file that isn't in the working tree: CLAUDE_SCHEMA, never partial notes.
    output["findings"][0]["evidence"][1]["file"] = json!("src/Missing CANARY.cs");
    s.respond(&[output]);
    let runs = StepRuns::default();
    s.findings(&runs, &cx, &order, &order[1]).await.unwrap_err();

    let text = std::fs::read_to_string(log.path(0)).unwrap();
    let line = text
        .lines()
        .find(|l| l.contains("step analysis failed"))
        .unwrap_or_else(|| panic!("{text}"));
    assert!(line.contains(&format!("step={}", order[1])), "{line}");
    assert!(line.contains("ClaudeSchema"), "{line}");
    assert!(
        line.contains("evidence cites a line that isn't in the worktree"),
        "{line}"
    );
    assert!(!text.contains("CANARY"), "{text}");
}
