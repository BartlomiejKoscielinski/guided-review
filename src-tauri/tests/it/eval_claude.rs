//! `npm run eval:claude` (docs/09 › Claude quality): golden inputs on a synthetic fixture
//! repository, run through the production path with the real Claude Code. Manual only: it uses
//! the developer's own Claude login and usage (ADR-019 layer 2, synthetic data only), so every
//! golden case is `#[ignore]` and `npm run verify` never runs it. Their seed checks (no `claude`)
//! do run there, so a golden input the app rejects fails in verify and not in a manual run.
//!
//! The step task runs on Sonnet · low (the app's step model) unless `GR_EVAL_MODEL` (a full
//! model ID, e.g. `claude-opus-5-5`) and `GR_EVAL_EFFORT` (`low` … `max`) say
//! otherwise. Each case prints Claude's notes for a human look.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use std::path::Path;

use fixture_repo::FixtureRepo;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::{Priority, Queue};
use guided_review_lib::claude::status::{self, CheckInput, ClaudeState};
use guided_review_lib::claude::tasks::plan::{self, Context, PlanRequest};
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::claude::tasks::{step, step_inputs};
use guided_review_lib::git::Git;
use guided_review_lib::gitlab::discussions::{self, Thread};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::finding_model::{Decision, Finding, Severity, Side};
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::plan_cache;
use guided_review_lib::review::step_context::{self, StepContext};
use guided_review_lib::settings::{ClaudeSettings, TaskEffort, TaskOverride};
use guided_review_lib::store::{self, Store};
use serde_json::{Value, json};

const SERVICE: &str = "src/App/Usługi/Upload Service.cs";

const BASE: &str = "using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

namespace App.Services;

public class UploadService
{
    private readonly HttpClient _http;

    public UploadService(HttpClient http)
    {
        _http = http;
    }
}
";

/// The change: an upload method declared `async void`, a real issue on its first line (an
/// exception crashes the app and no caller can await or catch it).
const HEAD: &str = "using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

namespace App.Services;

public class UploadService
{
    private readonly HttpClient _http;

    public UploadService(HttpClient http)
    {
        _http = http;
    }

    public async void Upload(string path)
    {
        var bytes = await File.ReadAllBytesAsync(path);
        var response = await _http.PostAsync(\"upload\", new ByteArrayContent(bytes));
        response.EnsureSuccessStatusCode();
    }
}
";

/// The step task's model and effort for the eval (see the module doc).
fn settings() -> ClaudeSettings {
    let mut settings = ClaudeSettings::default();
    let model = std::env::var("GR_EVAL_MODEL").unwrap_or_else(|_| "claude-sonnet-5-5".into());
    let effort = std::env::var("GR_EVAL_EFFORT").unwrap_or_else(|_| "low".into());
    let effort: TaskEffort = serde_json::from_value(json!(effort)).expect("GR_EVAL_EFFORT");
    settings.tasks.step = TaskOverride { model, effort };
    settings
}

/// The signed-in real Claude Code, found as the app finds it (ADR-021).
async fn real_claude(tmp: &Path) -> ClaudeExecutable {
    let check = status::check(
        &CheckInput {
            configured: None,
            probed_version: None,
            reprobe: true,
            cwd: tmp.to_path_buf(),
        },
        &Cancel::new(),
    )
    .await;
    assert_eq!(
        check.status.state,
        ClaudeState::SignedIn,
        "sign in to Claude Code first"
    );
    check.executable.unwrap()
}

/// 1-based line of the first line of `text` that contains `needle`.
fn line_of(text: &str, needle: &str) -> u32 {
    let index = text.lines().position(|l| l.contains(needle)).unwrap();
    u32::try_from(index + 1).unwrap()
}

/// A GitLab discussion on the new side of `path:line` (the first message carries the position).
fn discussion(id: &str, path: &str, line: u32, messages: &[(&str, &str)]) -> Value {
    let notes: Vec<Value> = messages
        .iter()
        .enumerate()
        .map(|(i, (user, body))| {
            let mut note = json!({ "id": i + 1, "body": body,
                "author": { "username": user, "name": user },
                "created_at": format!("2026-10-12T1{i}:00:00Z"),
                "system": false, "resolvable": true, "resolved": false });
            if i == 0 {
                note["position"] = json!({ "old_path": path, "new_path": path,
                    "new_line": line, "old_line": null, "head_sha": "abc" });
            }
            note
        })
        .collect();
    json!({ "id": id, "notes": notes })
}

/// An in-memory store, queue and temp dir of its own per run, so no run reads another's cache.
struct Env {
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
}

impl Env {
    fn new() -> Self {
        Self {
            tmp: tempfile::tempdir().unwrap(),
            store: Store::open_in_memory().unwrap(),
            queue: Queue::new(1),
        }
    }

    fn ctx<'a>(&'a self, exe: &'a ClaudeExecutable, settings: &'a ClaudeSettings) -> Context<'a> {
        Context {
            exe,
            settings,
            tmp_root: self.tmp.path(),
            queue: &self.queue,
            store: &self.store,
        }
    }
}

/// The golden repository: `SERVICE` committed at `BASE`, then at `HEAD`; with (base, head).
fn golden_repo() -> (FixtureRepo, String, String) {
    let repo = FixtureRepo::new("eval threads");
    repo.write(SERVICE, BASE);
    let base = repo.commit_all("base");
    repo.write(SERVICE, HEAD);
    let head = repo.commit_all("head");
    (repo, base, head)
}

/// The line of the real issue: the `async void` method's declaration in `HEAD`.
fn issue_line() -> u32 {
    line_of(HEAD, "public async void Upload")
}

/// A teammate's open thread on [`issue_line`] that already makes the point, with a reply.
fn golden_thread() -> Vec<Thread> {
    discussions::parse(vec![discussion(
        "d1",
        SERVICE,
        issue_line(),
        &[
            (
                "alice",
                "This is async void: if the upload throws, the exception crashes the app and \
                 the caller can't await or catch it. Should Upload return Task?",
            ),
            ("bob", "Agreed, I'll make it return Task."),
        ],
    )])
    .unwrap()
}

/// Stores an MR session of `repo`, caches a plan of one step over every hunk for it and loads
/// its step context as the app does, with `threads` as the MR's discussions.
async fn session(
    ctx: &Context<'_>,
    repo: &FixtureRepo,
    (base, head): (&str, &str),
    threads: Vec<Thread>,
) -> StepContext {
    let path = repo.path.to_string_lossy().into_owned();
    let (b, h) = (base.to_owned(), head.to_owned());
    ctx.store
        .with_conn(move |c| {
            let row = store::repos::add(c, "app", &path, Some("team/app"))?;
            c.execute(
                "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, mr_json)
                 VALUES ('e1', ?1, '{\"kind\":\"mr\",\"project\":\"team/app\",\"iid\":7}', ?2, ?3,
                 '{\"iid\":7,\"title\":\"Upload files\",\"author\":\"Alice\",\"sourceBranch\":\"feature/upload\",\"targetBranch\":\"develop\"}')",
                rusqlite::params![row.id, b, h],
            )?;
            Ok(())
        })
        .unwrap();
    let git = Git::new(None, &repo.path);
    let files = step_context::files(&git, base, head, &Cancel::new())
        .await
        .unwrap();
    let hunk_ids: Vec<String> = files
        .iter()
        .flat_map(|f| f.hunks.iter().map(|h| h.id.clone()))
        .collect();
    // The layer is one of the plan schema's names (`review/plan.rs`), or the cached plan is
    // rejected and the session loads as PlanNotReady.
    let plan_output = json!({
        "intent": "Files can be uploaded to the server.",
        "steps": [{ "id": "s1", "title": "Upload a file", "short_title": "Upload",
            "reason": "The only change.", "description": "Adds an upload method to the service.",
            "layer": "Core", "hunk_ids": hunk_ids, "builds_on": [] }],
        "orders": { "contract_to_ui": ["s1"], "tests_first": ["s1"] },
        "skim": [], "risks": [], "description_check": [], "already_discussed": ""
    });
    let key = plan::key(
        ctx,
        &PlanRequest {
            repo_id: 1,
            project: "team/app",
            source: PlanSource::Mr {
                iid: 7,
                title: "Upload files".into(),
                source_branch: "feature/upload".into(),
                target_branch: "develop".into(),
            },
            base_sha: base,
            head_sha: head,
            cwd: &repo.path,
            description: None,
            files: &files,
            threads: &[],
            rules: None,
        },
    );
    ctx.store
        .with_conn(|c| plan_cache::put(c, &key, &plan_output))
        .unwrap();
    step_context::load(
        ctx,
        None,
        "e1",
        move |_| async move { threads },
        &Cancel::new(),
    )
    .await
    .unwrap()
}

/// Runs the step task for the only step of a freshly stored MR session with `threads` as the
/// MR's discussions.
async fn analyze(
    repo: &FixtureRepo,
    exe: &ClaudeExecutable,
    settings: &ClaudeSettings,
    (base, head): (&str, &str),
    threads: Vec<Thread>,
) -> Vec<Finding> {
    let env = Env::new();
    let ctx = env.ctx(exe, settings);
    let cx = session(&ctx, repo, (base, head), threads).await;
    let order = cx.order(Strategy::ContractToUi);
    let req = cx.step_request("s1", &order, &[]);
    let outcome = step::run(&ctx, &req, Priority::CurrentStep, &|| {}, &Cancel::new())
        .await
        .unwrap();
    outcome.analysis.findings
}

fn print(label: &str, findings: &[Finding]) {
    println!("{label}: {} note(s)", findings.len());
    for f in findings {
        println!(
            "  {}:{} [{}] {} — {}",
            f.file, f.line, f.kind, f.title, f.body
        );
    }
}

/// Words of a sentence that points at the existing thread instead of making its point again
/// ("The async void concern is already in the open thread, so it is not repeated here."). Not a
/// bare "thread", which a repeat can use for the thread pool or the UI thread.
const POINTS_AT_THREAD: [&str; 5] = [
    "already",
    "open thread",
    "existing thread",
    "not repeat",
    "discussion",
];

/// Whether a note raises `topic` (lowercase). Its title (the note's topic) and its suggested
/// comment (the text that would go to GitLab) raise it by naming it at all, even next to a word
/// that cites the thread. Its body, the explanation to the reviewer, raises it in a sentence that
/// names it and does not point at the existing thread. Sentences end at `. `, `!`, `?`, `;` or a
/// line break, so `Upload Service.cs:16` stays whole.
fn mentions(finding: &Finding, topic: &str) -> bool {
    let names = |text: &str| text.to_lowercase().contains(topic);
    names(&finding.title)
        || names(&finding.suggested_comment)
        || finding
            .body
            .to_lowercase()
            .replace(". ", ".\n")
            .split(['\n', '!', '?', ';'])
            .any(|s| s.contains(topic) && !POINTS_AT_THREAD.iter().any(|w| s.contains(w)))
}

/// A note on the golden issue line with Claude's wording, for the topic check's own test.
fn note(kind: &str, title: &str, body: &str, suggested_comment: &str) -> Finding {
    Finding {
        id: "f1".into(),
        step_id: "s1".into(),
        severity: Severity::Fix,
        kind: kind.into(),
        title: title.into(),
        body: body.into(),
        file: SERVICE.into(),
        side: Side::New,
        line: issue_line(),
        evidence: Vec::new(),
        suggested_comment: suggested_comment.into(),
        fingerprint: "fp".into(),
        decision: Decision::Open,
    }
}

/// The topic check of the golden case without Claude (so `npm run verify` runs it), on notes
/// worded as in a live run. A different-topic note that says the async void point is already
/// in the open thread once failed `npm run eval:claude` as a repeat (ap-20261015-1438). Only the
/// body gets that exemption: a title or suggested comment that states the topic is a repeat.
#[test]
fn eval_f09_5_topic_check_skips_a_sentence_that_points_at_the_open_thread() {
    let topic = "async void";
    let control = note(
        "async-void-method",
        "Upload is async void",
        "An exception thrown in Upload cannot be awaited or caught by the caller and crashes \
         the app.",
        "Could Upload return Task instead of async void, so the caller can await it?",
    );
    assert!(mentions(&control, topic), "the control note raises it");

    let acknowledging = note(
        "missing-cancellation",
        "No cancellation token for file read and POST",
        "Upload reads the whole file and posts it with no CancellationToken, so a closed page \
         cannot stop it. The async void concern is already in the open thread, so it is not \
         repeated here.",
        "Could Upload take a CancellationToken and pass it to ReadAllBytesAsync and PostAsync?",
    );
    assert!(
        !mentions(&acknowledging, topic),
        "a sentence that points at the thread is not a repeat"
    );

    let repeat = note(
        "unobserved-exception",
        "Upload exceptions crash the app",
        "Upload (Upload Service.cs:16) is async void. An exception on the thread pool is never \
         observed; the open thread is about this too.",
        "Upload should return Task.",
    );
    assert!(
        mentions(&repeat, topic),
        "a note that makes the point again is a repeat, whatever else it says"
    );

    let cited_in_title = note(
        "async-void-method",
        "Upload is async void, already raised in the open thread",
        "If it throws, the exception crashes the app.",
        "Could Upload log what went wrong?",
    );
    assert!(
        mentions(&cited_in_title, topic),
        "a title that states the topic is a repeat even when it cites the thread"
    );

    let cited_in_comment = note(
        "unobserved-exception",
        "Upload exceptions crash the app",
        "If it throws, the exception crashes the app.",
        "As already discussed in the open thread, async void should be Task.",
    );
    assert!(
        mentions(&cited_in_comment, topic),
        "a suggested comment that states the topic would post it to GitLab again"
    );
}

/// The golden case's seed without Claude (so `npm run verify` runs it): the session loads its
/// cached plan, one step over every hunk, and the thread is on a line of that step. A plan the
/// app rejects (a layer name outside the schema) once made every eval run panic with
/// PlanNotReady before Claude ran.
#[tokio::test]
async fn eval_f09_5_the_golden_session_loads_one_step_with_the_thread_on_its_line() {
    let (repo, base, head) = golden_repo();
    let env = Env::new();
    let exe = ClaudeExecutable::Native(env.tmp.path().join("claude is not run.exe"));
    let settings = ClaudeSettings::default();
    let cx = session(
        &env.ctx(&exe, &settings),
        &repo,
        (&base, &head),
        golden_thread(),
    )
    .await;

    assert!(!cx.fallback, "the cached plan was replaced by the fallback");
    let hunks: Vec<&str> = cx
        .files
        .iter()
        .flat_map(|f| f.hunks.iter().map(|h| h.id.as_str()))
        .collect();
    let steps: Vec<(&str, Vec<&str>)> = cx
        .plan
        .steps
        .iter()
        .map(|s| {
            (
                s.id.as_str(),
                s.hunk_ids.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    assert_eq!(steps, vec![("s1", hunks)]);
    let on_step = step_inputs::threads_on_step(&cx.threads, &cx.files);
    let lines: Vec<Option<u32>> = on_step
        .iter()
        .map(|t| t.position.as_ref().and_then(|p| p.new_line))
        .collect();
    assert_eq!(lines, vec![Some(issue_line())]);
}

/// F-09.5 golden case (M3 decision 6): a teammate's open thread already makes the point about
/// the real issue on a line of the step. Without the thread Claude raises it (so the issue is
/// real and found); with the thread in its context no note repeats it.
#[tokio::test]
#[ignore = "runs the real claude (uses the developer's Claude usage): npm run eval:claude"]
async fn eval_f09_5_no_note_repeats_an_existing_thread_on_a_line_with_a_real_issue() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = real_claude(tmp.path()).await;
    let settings = settings();
    let (repo, base, head) = golden_repo();
    let line = issue_line();
    let topic = "async void";

    let control = analyze(&repo, &exe, &settings, (&base, &head), Vec::new()).await;
    print("without threads", &control);
    assert!(
        control.iter().any(|f| mentions(f, topic)),
        "the golden input lost its real issue: no note about {topic}"
    );

    let with_thread = analyze(&repo, &exe, &settings, (&base, &head), golden_thread()).await;
    print(&format!("with the thread on line {line}"), &with_thread);
    let repeats: Vec<&Finding> = with_thread.iter().filter(|f| mentions(f, topic)).collect();
    assert!(
        repeats.is_empty(),
        "notes repeat the thread on {SERVICE}:{line}: {:?}",
        repeats
            .iter()
            .map(|f| (&f.title, f.line))
            .collect::<Vec<_>>()
    );
}
