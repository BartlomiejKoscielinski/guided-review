//! The pipeline explain task against the fake `claude` (docs/09 > Fake `claude`; F-20.7, M6
//! decisions 12 and 14; ADR-022, ADR-025 risk: argv of the read-only profile). Explain failure on
//! S-08 hands Claude the job's log tail, the job's test report, the MR diff and the MR's
//! pipelines as files in the task folder; the answer is validated again in Rust
//! (`fixed_in_version`, evidence files, `pipeline #N`) and cached per job, prompt version and
//! model. Synthetic data only (ADR-019).
//!
//! Contract the tests lock (the module is `claude::tasks::pipeline_explain`):
//! `run(&Context, &ExplainRequest, on_started, &Cancel) -> Result<ExplainOutcome, ClaudeError>`;
//! `ExplainRequest { repo_id, source, base_sha, head_sha, cwd, job_id, job_name, pipeline_number,
//! log_tail, test_report, diff, files, pipelines }` (Clone, so a test can override one field);
//! `PipelinePoint { number, version, status, job_status }`; `ExplainOutcome { explanation,
//! cached }`; `PipelineExplanation { verdict, fixed_in_version, title, explanation, evidence,
//! retry_recommended, suggested_comment }`; `Verdict { CausedByMr, AlreadyFixed, Unrelated,
//! Flaky, Unknown }`.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fake_claude.rs"]
mod fake_claude;
#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::ClaudeError;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::tasks::pipeline_explain::{
    self, ExplainRequest, PipelinePoint, Verdict,
};
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::Store;
use serde_json::{Value, json};

const QUEUE: &str = "src/Zażółć/Upload Queue.cs";
const LOG: &str =
    "$ dotnet test\nFailed QueueOrderTests.Newest_first\nERROR: Job failed: exit code 1\n";
const REPORT: &str = "Suite unit-tests: 2 failed, 212 passed";
const DIFF: &str = "diff --git a/x b/x\n+ sorted by CreatedAt\n";

fn result(output: &Value) -> Value {
    let body = json!({ "type": "result", "subtype": "success", "is_error": false,
        "session_id": "s", "structured_output": output });
    json!({ "stdout": body.to_string() })
}

/// Claude's answer with the fields a test changes.
fn answer(verdict: &str, fixed_in: Option<u32>, evidence: &[&str], comment: &str) -> Value {
    let mut out = json!({ "verdict": verdict, "title": "Queue order", "explanation": "Sorted by Id.",
        "evidence": evidence, "retry_recommended": false, "suggested_comment": comment });
    if let Some(version) = fixed_in {
        out["fixed_in_version"] = json!(version);
    }
    out
}

fn point(number: i64, version: u32, status: &str, job_status: &str) -> PipelinePoint {
    PipelinePoint {
        number,
        version,
        status: status.into(),
        job_status: job_status.into(),
    }
}

struct Setup {
    repo: FixtureRepo,
    head: String,
    source: PlanSource,
    pipelines: Vec<PipelinePoint>,
    files: Vec<String>,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

fn setup() -> Setup {
    let repo = FixtureRepo::new("pipeline explain");
    repo.write(QUEUE, "class Queue {\n    void Enqueue() { }\n}\n");
    repo.write("src/App/Helper.cs", "class Helper { }\n");
    repo.write("tests/Helper.cs", "class HelperTests { }\n");
    let head = repo.commit_all("Start the queue");
    let fake = FakeClaude::new(Path::new(env!("CARGO_BIN_EXE_fake-claude")), &json!({}));
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    Setup {
        repo,
        head,
        source: PlanSource::Mr {
            iid: 482,
            title: "Torch".into(),
            source_branch: "feature/torch".into(),
            target_branch: "develop".into(),
        },
        // The failing run is #200 on version 2; #300 on version 3 is the latest and passed.
        pipelines: vec![
            point(300, 3, "passed", "passed"),
            point(200, 2, "failed", "failed"),
            point(100, 1, "failed", "failed"),
        ],
        files: vec![
            QUEUE.into(),
            "src/App/Helper.cs".into(),
            "tests/Helper.cs".into(),
        ],
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

    fn request(&self, job_id: i64) -> ExplainRequest<'_> {
        ExplainRequest {
            repo_id: 1,
            source: &self.source,
            base_sha: "abc",
            head_sha: &self.head,
            cwd: &self.repo.path,
            job_id,
            job_name: "unit-tests",
            pipeline_number: 200,
            log_tail: LOG,
            test_report: REPORT,
            diff: DIFF,
            files: &self.files,
            pipelines: &self.pipelines,
        }
    }

    async fn run(&self, job_id: i64) -> Result<pipeline_explain::ExplainOutcome, ClaudeError> {
        pipeline_explain::run(&self.ctx(), &self.request(job_id), &|| {}, &Cancel::new()).await
    }

    fn says(&self, outputs: &[Value]) {
        let responses: Vec<Value> = outputs.iter().map(result).collect();
        self.fake.set_scenario(&json!({ "responses": responses }));
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
async fn f20_7_explain_argv_inputs_and_result() {
    let s = setup();
    s.says(&[answer(
        "caused_by_mr",
        None,
        &["Upload Queue.cs:2", "pipeline #100"],
        "Please sort by CreatedAt.",
    )]);
    let started = AtomicUsize::new(0);
    let outcome = pipeline_explain::run(
        &s.ctx(),
        &s.request(20_004),
        &|| {
            started.fetch_add(1, Ordering::SeqCst);
        },
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert_eq!(outcome.explanation.verdict, Verdict::CausedByMr);
    assert_eq!(outcome.explanation.fixed_in_version, None);
    assert_eq!(
        outcome.explanation.suggested_comment,
        "Please sort by CreatedAt."
    );
    assert_eq!(
        outcome.explanation.evidence,
        vec!["Upload Queue.cs:2".to_owned(), "pipeline #100".to_owned()]
    );
    assert!(!outcome.cached);
    assert_eq!(started.load(Ordering::SeqCst), 1);

    let calls = s.fake.calls();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    let argv = argv_of(call);
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();
    let task_dir = PathBuf::from(at("--add-dir"));
    assert_eq!(task_dir.parent(), Some(s.tmp.path()));
    let schema: Value = serde_json::from_str(&at("--json-schema")).unwrap();
    assert_eq!(schema["title"], "PipelineExplanation");
    // The read-only profile of ADR-022; Claude runs in the MR's worktree; no kept session.
    for flag in [
        "--restricted",
        "--strict-mcp-config",
        "--no-session-persistence",
    ] {
        assert!(argv.iter().any(|a| a == flag), "{flag} missing: {argv:?}");
    }
    assert_eq!(at("--tools"), "Read,Grep,Glob");
    assert_eq!(at("--permission-mode"), "dontAsk");
    assert_eq!(at("--disallowedTools"), "mcp__*");
    for banned in ["--bare", "--dangerously-skip-permissions"] {
        assert!(!argv.iter().any(|a| a == banned), "{banned}");
    }
    assert_eq!(
        call["cwd"].as_str().map(PathBuf::from),
        Some(s.repo.path.clone())
    );

    // The inputs: log tail, test report, diff, and each pipeline of the MR.
    let stdin = call["stdin"].as_str().unwrap();
    assert!(!stdin.contains("{{"), "{stdin}");
    let files = call["addDirFiles"].as_object().unwrap();
    for name in files.keys().filter(|n| n.as_str() != "system-common.md") {
        let path = task_dir.join(name);
        assert!(
            stdin.contains(&*path.to_string_lossy()),
            "{name} not in the prompt"
        );
    }
    let inputs = inputs_of(call);
    assert!(
        inputs.contains("Failed QueueOrderTests.Newest_first"),
        "{inputs}"
    );
    assert!(inputs.contains(REPORT), "{inputs}");
    assert!(inputs.contains("+ sorted by CreatedAt"), "{inputs}");
    for number in ["300", "200", "100"] {
        assert!(inputs.contains(number), "pipeline {number}: {inputs}");
    }
}

#[tokio::test]
async fn f20_7_already_fixed_needs_a_version_later_than_the_pipelines_and_not_above_the_latest() {
    for fixed_in in [None, Some(2), Some(1), Some(4), Some(99)] {
        let s = setup();
        s.says(&[
            answer("already_fixed", fixed_in, &["pipeline #300"], ""),
            answer("already_fixed", fixed_in, &["pipeline #300"], ""),
        ]);
        let error = s.run(20_004).await.unwrap_err();
        assert!(
            matches!(error, ClaudeError::Schema(_)),
            "fixed_in_version {fixed_in:?} must be CLAUDE_SCHEMA: {error:?}"
        );
        // A rejected answer is not cached: the second run asks Claude again.
        assert!(s.run(20_004).await.is_err());
        assert_eq!(s.fake.calls().len(), 2, "a rejected answer is not cached");
    }
    let s = setup();
    s.says(&[answer("already_fixed", Some(3), &["pipeline #300"], "")]);
    let outcome = s.run(20_004).await.unwrap();
    assert_eq!(outcome.explanation.verdict, Verdict::AlreadyFixed);
    assert_eq!(outcome.explanation.fixed_in_version, Some(3));
}

#[tokio::test]
async fn f20_7_evidence_file_line_must_exist_in_the_worktree() {
    let s = setup();
    // A path, and a file name unique among the MR's files, are fine.
    s.says(&[answer(
        "caused_by_mr",
        None,
        &["src/App/Helper.cs:1", "Upload Queue.cs:3"],
        "",
    )]);
    assert!(s.run(20_004).await.is_ok());

    for evidence in [
        "src/App/Missing.cs:1",
        "Missing.cs:4",
        // Two MR files share this name: not unique.
        "Helper.cs:1",
        // The file exists but not that line.
        "src/App/Helper.cs:50",
    ] {
        let s = setup();
        s.says(&[answer("caused_by_mr", None, &[evidence], "")]);
        let error = s.run(20_004).await.unwrap_err();
        assert!(
            matches!(error, ClaudeError::Schema(_)),
            "{evidence} must be CLAUDE_SCHEMA: {error:?}"
        );
    }
}

#[tokio::test]
async fn f20_7_a_pipeline_of_another_mr_is_rejected() {
    let s = setup();
    s.says(&[answer(
        "flaky",
        None,
        &["pipeline #200", "pipeline #999"],
        "",
    )]);
    let error = s.run(20_004).await.unwrap_err();
    assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");

    let s = setup();
    s.says(&[answer(
        "flaky",
        None,
        &["pipeline #200", "pipeline #100"],
        "",
    )]);
    assert!(s.run(20_004).await.is_ok());
}

#[tokio::test]
async fn f20_7_a_wrong_shape_is_claude_schema() {
    let s = setup();
    s.says(&[json!({ "verdict": "maybe", "title": "x" })]);
    let error = s.run(20_004).await.unwrap_err();
    assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");
}

#[tokio::test]
async fn f20_7_the_second_run_for_the_same_job_comes_from_the_cache_and_another_job_asks_again() {
    let s = setup();
    s.says(&[
        answer("unrelated", None, &[], ""),
        answer("flaky", None, &[], ""),
    ]);
    let first = s.run(20_004).await.unwrap();
    assert!(!first.cached);
    let again = s.run(20_004).await.unwrap();
    assert!(again.cached);
    assert_eq!(again.explanation, first.explanation);
    assert_eq!(
        s.fake.calls().len(),
        1,
        "a cache hit starts no claude process"
    );

    let other = s.run(20_005).await.unwrap();
    assert!(!other.cached);
    assert_eq!(other.explanation.verdict, Verdict::Flaky);
    assert_eq!(s.fake.calls().len(), 2);
}

#[tokio::test]
async fn f20_7_the_log_tail_is_capped_at_200_kb_and_keeps_its_end() {
    let s = setup();
    s.says(&[answer("unknown", None, &[], "")]);
    let big = format!("{}LAST-LINE-MARKER\n", "x".repeat(400 * 1024));
    let mut request = s.request(20_004);
    request.log_tail = &big;
    pipeline_explain::run(&s.ctx(), &request, &|| {}, &Cancel::new())
        .await
        .unwrap();
    let calls = s.fake.calls();
    let inputs = inputs_of(&calls[0]);
    assert!(
        inputs.contains("LAST-LINE-MARKER"),
        "the end of the log is kept"
    );
    assert!(inputs.len() < 300 * 1024, "{} bytes", inputs.len());
}
