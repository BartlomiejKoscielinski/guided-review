//! A self-review (F-17.1) session of uncommitted changes whose untracked files sit in a dot
//! directory (an IDE's `.idea` folder; the live check of attempt 1 failed every step there),
//! planned with the fake `claude`. Shared by `it/self_review_untracked.rs` and
//! `self_review_untracked_log.rs`, which declare `fake_claude` and `fixture_repo` at their root
//! (`it/main.rs` for the first).
//! Synthetic data only (ADR-019).
#![allow(
    dead_code,
    reason = "each test binary uses a different part of the helper"
)]
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test helper")]

use std::path::Path;

use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::{Priority, Queue};
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::finding_model::StepAnalysis;
use guided_review_lib::review::plan_runs;
use guided_review_lib::review::step_context::{self, StepContext};
use guided_review_lib::review::step_runs::{self, RunError, StepRuns};
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::{self, Store};
use serde_json::{Value, json};

use crate::fake_claude::FakeClaude;
use crate::fixture_repo::FixtureRepo;

pub const SERVICE: &str = "src/Delivery.App/Services/Kurier Service.cs";
pub const IGNORE: &str = "src/Delivery.App/Services/.idea/.gitignore";
pub const ENCODINGS: &str = "src/Delivery.App/Services/.idea/encodings.xml";

pub struct Setup {
    pub repo: FixtureRepo,
    pub fake: FakeClaude,
    pub tmp: tempfile::TempDir,
    pub store: Store,
    pub queue: Queue,
    pub exe: ClaudeExecutable,
    pub settings: ClaudeSettings,
}

/// A tracked edit of the service and the two untracked files Rider writes into `.idea`
/// (CRLF line ends, the second without a final newline); a `uncommitted` session on HEAD.
pub fn setup() -> Setup {
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

/// A successful run whose structured output is `output`.
pub fn result(output: &Value) -> Value {
    let line = json!({ "type": "result", "subtype": "success", "is_error": false,
        "session_id": "s", "structured_output": output });
    json!({ "stdout": line.to_string() })
}

pub fn path(file: &FileDiff) -> String {
    file.new_path
        .clone()
        .or(file.old_path.clone())
        .unwrap_or_default()
}

pub fn same_dir(a: &Path, b: &Path) -> bool {
    a.canonicalize().unwrap() == b.canonicalize().unwrap()
}

/// `rel` as Claude's Read tool names it: absolute, with backslashes.
pub fn absolute(repo: &Path, rel: &str) -> String {
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
pub fn note_on(named: &str) -> Value {
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
    pub fn ctx(&self) -> Context<'_> {
        Context {
            exe: &self.exe,
            settings: &self.settings,
            tmp_root: self.tmp.path(),
            queue: &self.queue,
            store: &self.store,
        }
    }

    /// The next `-p` runs answer with `responses` (`{ "stdout", "stderr", "exit" }` each).
    pub fn respond_raw(&self, responses: &[Value]) {
        let mut all = vec![json!({}); self.fake.calls().len()];
        all.extend(responses.iter().cloned());
        self.fake.set_scenario(&json!({ "responses": all }));
    }

    /// The next `-p` runs succeed with these structured outputs.
    pub fn respond(&self, outputs: &[Value]) {
        self.respond_raw(&outputs.iter().map(result).collect::<Vec<_>>());
    }

    /// Plans the session (one step per file) and loads its step context the way S-03 does.
    pub async fn planned(&self) -> (Vec<FileDiff>, StepContext) {
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

    pub async fn findings(
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
