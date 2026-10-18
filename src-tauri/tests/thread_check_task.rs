//! The thread check task against the fake `claude` and a real git history (docs/09 › Fake
//! `claude`; F-13.3, M5 decision 12; ADR-022, ADR-025 risk: argv snapshot of the read-only
//! profile). On click S-05's Threads tab asks Claude which of the MR's open threads, written on an
//! older head, a later commit addressed: inputs are the candidate threads and the commits
//! `<thread head>..<reviewed head>` with their diffs (`git log -p`, size-capped) in the task
//! folder; the answer is validated again in Rust (an unknown discussion or a commit outside that
//! thread's range is `CLAUDE_SCHEMA`) and cached per head and thread set. Synthetic data only
//! (ADR-019).
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
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::claude::tasks::thread_check::{self, ThreadCheckRequest, ThreadHint};
use guided_review_lib::git::runner::Git;
use guided_review_lib::gitlab::discussions;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::settings::{ClaudeSettings, TaskEffort, TaskOverride};
use guided_review_lib::store::Store;
use serde_json::{Value, json};

const QUEUE: &str = "src/Zażółć/Upload Queue.cs";

fn result(body: Value) -> Value {
    let mut base =
        json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": "s" });
    base.as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    json!({ "stdout": base.to_string() })
}

/// Claude's answer: `(discussion_id, commit, hint)` for every thread a later commit addressed.
fn answer(items: &[(&str, &str, &str)]) -> Value {
    let addressed: Vec<Value> = items
        .iter()
        .map(|(discussion_id, commit, hint)| {
            json!({ "discussion_id": discussion_id, "commit": commit, "hint": hint })
        })
        .collect();
    result(json!({ "structured_output": { "addressed": addressed } }))
}

fn hint(discussion_id: &str, commit: &str, text: &str) -> ThreadHint {
    ThreadHint {
        discussion_id: discussion_id.into(),
        commit: commit.into(),
        hint: text.into(),
    }
}

/// A raw GitLab discussion; `head` is the head its position was written on.
fn raw_thread(id: &str, head: &str, body: &str, resolved: bool, resolvable: bool) -> Value {
    let mut note = json!({ "id": 2, "body": body,
        "author": { "username": "alice", "name": "Alice" }, "created_at": "2026-10-12T10:00:00Z",
        "system": false, "resolvable": resolvable, "resolved": resolved });
    if !head.is_empty() {
        note["position"] = json!({ "old_path": QUEUE, "new_path": QUEUE, "new_line": 2,
            "head_sha": head, "base_sha": "abc" });
    }
    json!({ "id": id, "notes": [note] })
}

/// The threads as the app holds them: `outdated` is set the way `review/thread_place.rs` does.
fn threads_of(raw: Vec<Value>, reviewed: &str) -> Vec<discussions::Thread> {
    let mut threads = discussions::parse(raw).unwrap();
    for thread in &mut threads {
        thread.outdated = thread
            .position
            .as_ref()
            .is_some_and(|p| p.head_sha != reviewed);
    }
    threads
}

struct Setup {
    repo: FixtureRepo,
    git: Git,
    /// History: base, T1 (head 1 of the older threads), C1 (adds the index), T2 (head 2), C2 (the
    /// reviewed head).
    base: String,
    t1: String,
    c1: String,
    t2: String,
    c2: String,
    threads: Vec<discussions::Thread>,
    source: PlanSource,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

fn setup() -> Setup {
    let repo = FixtureRepo::new("thread check");
    repo.write(QUEUE, "class Queue {\n    void Enqueue() { }\n}\n");
    repo.write("README.md", "# Torch\n");
    let base = repo.commit_all("Start the queue");
    repo.write("README.md", "# Torch\n\nUploads.\n");
    let t1 = repo.commit_all("Docs round");
    repo.write(
        QUEUE,
        "class Queue {\n    void Enqueue() { }\n    // CREATE INDEX IX_CreatedAt ON Uploads(CreatedAt)\n}\n",
    );
    let c1 = repo.commit_all("Add an index on CreatedAt");
    repo.write("src/App/Settings.cs", "class Settings { }\n");
    let t2 = repo.commit_all("Tune settings");
    repo.write("src/App/Helper.cs", "class Helper { }\n");
    let c2 = repo.commit_all("Rename the helper");

    let threads = threads_of(
        vec![
            // Candidates: open, resolvable, written on an older head.
            raw_thread(
                "disc-index",
                &t1,
                "No index on CreatedAt, but every read sorts by it.",
                false,
                true,
            ),
            raw_thread(
                "disc-late",
                &t2,
                "Should Settings be read once?",
                false,
                true,
            ),
            // Not candidates: written on the reviewed head, resolved, a comment on the MR itself.
            raw_thread("disc-current", &c2, "Is Helper needed at all?", false, true),
            raw_thread("disc-resolved", &t1, "Typo in the readme.", true, true),
            raw_thread(
                "disc-general",
                "",
                "Thanks for the quick turnaround.",
                false,
                false,
            ),
        ],
        &c2,
    );
    let fake = FakeClaude::new(Path::new(env!("CARGO_BIN_EXE_fake-claude")), &json!({}));
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    let git = Git::new(None, &repo.path);
    Setup {
        repo,
        git,
        base,
        t1,
        c1,
        t2,
        c2,
        threads,
        source: PlanSource::Mr {
            iid: 482,
            title: "Torch".into(),
            source_branch: "feature/torch".into(),
            target_branch: "develop".into(),
        },
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

    fn request(&self) -> ThreadCheckRequest<'_> {
        ThreadCheckRequest {
            repo_id: 1,
            source: &self.source,
            base_sha: &self.base,
            head_sha: &self.c2,
            cwd: &self.repo.path,
            git: &self.git,
            threads: &self.threads,
        }
    }

    async fn run(&self) -> Result<thread_check::ThreadCheckOutcome, ClaudeError> {
        thread_check::run(&self.ctx(), &self.request(), &|| {}, &Cancel::new()).await
    }

    /// Claude answers once with exactly this.
    fn says(&self, items: &[(&str, &str, &str)]) {
        self.fake
            .set_scenario(&json!({ "responses": [answer(items)] }));
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

/// Every file of the task folder as Claude can read it, joined (the inputs' file names are the
/// task's own business; what they hold is not).
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
async fn f13_3_thread_check_argv_inputs_and_result() {
    let s = setup();
    s.says(&[("disc-index", s.c1.as_str(), "index added")]);
    let started = AtomicUsize::new(0);
    let outcome = thread_check::run(
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
        outcome.hints,
        vec![hint("disc-index", s.c1.as_str(), "index added")]
    );
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
    assert_eq!(schema["title"], "ThreadCheck");
    let snapshot: Vec<String> = argv
        .iter()
        .map(|a| {
            if a.starts_with('{') {
                "<thread-check.schema.json>".to_owned()
            } else {
                a.replace(&task_dir.to_string_lossy().into_owned(), "<task>")
            }
        })
        .collect();
    // The read-only profile of ADR-022 and the "Step analysis" group's default (Sonnet, medium),
    // no kept session.
    assert_eq!(
        snapshot,
        [
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            "<thread-check.schema.json>",
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
    assert_eq!(
        call["cwd"].as_str().map(PathBuf::from),
        Some(s.repo.path.clone())
    );

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

    // The candidates (open, written on an older head) with their discussion ids, and nothing of
    // the threads that are not: one on the reviewed head, a resolved one, a comment on the MR.
    let inputs = inputs_of(call);
    for kept in [
        "disc-index",
        "No index on CreatedAt, but every read sorts by it.",
        "disc-late",
        "Should Settings be read once?",
    ] {
        assert!(inputs.contains(kept), "{kept} is not an input");
    }
    for left_out in [
        "disc-current",
        "Is Helper needed at all?",
        "disc-resolved",
        "Typo in the readme.",
        "disc-general",
        "Thanks for the quick turnaround.",
    ] {
        assert!(!inputs.contains(left_out), "{left_out} is an input");
    }
    // The commits after the oldest thread head with their diffs, `git log -p`; not the thread
    // head itself nor anything before it.
    for kept in [
        s.c1.as_str(),
        s.t2.as_str(),
        s.c2.as_str(),
        "Add an index on CreatedAt",
        "Tune settings",
        "Rename the helper",
        "CREATE INDEX IX_CreatedAt",
    ] {
        assert!(inputs.contains(kept), "{kept} is not an input");
    }
    for left_out in [
        s.base.as_str(),
        s.t1.as_str(),
        "Start the queue",
        "Docs round",
    ] {
        assert!(!inputs.contains(left_out), "{left_out} is an input");
    }
    // Nothing is left in the temp folder once the run is over.
    assert_eq!(std::fs::read_dir(s.tmp.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn f13_3_each_thread_is_judged_against_the_commits_since_its_own_head() {
    let s = setup();
    // C1 came before disc-late was written (on T2): it can't have addressed it. T2 and C2 can.
    s.says(&[
        ("disc-late", s.c2.as_str(), "settings read once"),
        ("disc-index", s.t2.as_str(), "unrelated but later"),
    ]);
    let outcome = s.run().await.unwrap();
    assert_eq!(
        outcome.hints,
        vec![
            hint("disc-late", s.c2.as_str(), "settings read once"),
            hint("disc-index", s.t2.as_str(), "unrelated but later"),
        ]
    );
}

#[tokio::test]
async fn f13_3_a_commit_outside_the_threads_range_is_claude_schema_and_not_cached() {
    let s = setup();
    let unknown = "f".repeat(40);
    let cases: Vec<(&str, String)> = vec![
        // Before the thread was written.
        ("disc-index", s.base.clone()),
        // The thread's own head is not "later".
        ("disc-index", s.t1.clone()),
        // C1 is older than disc-late's head T2.
        ("disc-late", s.c1.clone()),
        ("disc-late", s.t2.clone()),
        // Not a commit of the repository at all.
        ("disc-index", unknown),
        ("disc-index", "not a commit".to_owned()),
        ("disc-index", String::new()),
    ];
    for (discussion, commit) in &cases {
        s.says(&[(*discussion, commit.as_str(), "index added")]);
        let error = s.run().await.unwrap_err();
        assert!(
            matches!(error, ClaudeError::Schema(_)),
            "{discussion} {commit:?}: {error:?}"
        );
    }
    assert_eq!(
        s.fake.calls().len(),
        cases.len(),
        "a rejected answer is not cached: every run asks Claude"
    );
}

#[tokio::test]
async fn f13_3_an_unknown_discussion_or_one_that_is_not_a_candidate_is_claude_schema_and_not_cached()
 {
    let s = setup();
    for discussion in [
        "disc-nope",
        "disc-current",
        "disc-resolved",
        "disc-general",
        "",
    ] {
        s.says(&[(discussion, s.c1.as_str(), "index added")]);
        let error = s.run().await.unwrap_err();
        assert!(
            matches!(error, ClaudeError::Schema(_)),
            "{discussion:?}: {error:?}"
        );
    }
    // The same discussion twice is not a valid answer either.
    s.says(&[
        ("disc-index", s.c1.as_str(), "index added"),
        ("disc-index", s.c2.as_str(), "again"),
    ]);
    assert!(matches!(s.run().await, Err(ClaudeError::Schema(_))));
    assert_eq!(s.fake.calls().len(), 6);
}

#[tokio::test]
async fn f13_3_a_wrong_shape_is_claude_schema_and_not_cached() {
    let s = setup();
    for output in [
        json!({ "addressed": "disc-index" }),
        json!({ "addressed": [{ "discussion_id": "disc-index", "commit": s.c1 }] }),
        json!({ "addressed": [{ "discussion_id": 5, "commit": s.c1, "hint": "x" }] }),
        json!({ "addressed": [{ "discussion_id": "disc-index", "commit": s.c1, "hint": "  " }] }),
        json!({ "threads": [] }),
    ] {
        s.fake.set_scenario(
            &json!({ "responses": [result(json!({ "structured_output": output }))] }),
        );
        let error = s.run().await.unwrap_err();
        assert!(
            matches!(error, ClaudeError::Schema(_)),
            "{output}: {error:?}"
        );
    }
    // No structured output at all is the same failure.
    s.fake
        .set_scenario(&json!({ "responses": [result(json!({ "result": "free text" }))] }));
    let error = s.run().await.unwrap_err();
    assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");
    assert_eq!(s.fake.calls().len(), 6);
}

#[tokio::test]
async fn f13_3_a_run_with_nothing_addressed_is_an_empty_result_and_is_cached_like_any_other() {
    let s = setup();
    s.says(&[]);
    let first = s.run().await.unwrap();
    assert_eq!((first.hints.len(), first.cached), (0, false));

    // Same head and threads: no second run (the reviewer clicked again; M5 decision 12).
    let started = AtomicUsize::new(0);
    let again = thread_check::run(
        &s.ctx(),
        &s.request(),
        &|| {
            started.fetch_add(1, Ordering::SeqCst);
        },
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert_eq!((again.hints.len(), again.cached), (0, true));
    assert_eq!(started.load(Ordering::SeqCst), 0);
    assert_eq!(s.fake.calls().len(), 1);
}

#[tokio::test]
async fn f13_3_hints_come_from_the_cache_until_the_head_or_the_thread_set_changes() {
    let mut s = setup();
    s.fake.set_scenario(&json!({ "responses": [
        answer(&[("disc-index", s.c1.as_str(), "first")]),
        answer(&[("disc-index", s.c1.as_str(), "second")]),
        answer(&[("disc-index", s.c1.as_str(), "third")]),
        answer(&[("disc-index", s.c1.as_str(), "fourth")]),
    ] }));
    let first = s.run().await.unwrap();
    assert_eq!(
        first.hints,
        vec![hint("disc-index", s.c1.as_str(), "first")]
    );
    let again = s.run().await.unwrap();
    assert_eq!(
        again.hints,
        vec![hint("disc-index", s.c1.as_str(), "first")]
    );
    assert!(again.cached);
    assert_eq!(s.fake.calls().len(), 1);

    // A thread leaves the set (resolved by the reviewer): Claude is asked again.
    s.threads[1].resolved = true;
    let changed = s.run().await.unwrap();
    assert_eq!(
        (changed.hints[0].hint.as_str(), changed.cached),
        ("second", false)
    );
    assert_eq!(s.fake.calls().len(), 2);

    // A new reply on a candidate is new input: asked again.
    let mut reply = s.threads[0].notes[0].clone();
    reply.id = 9;
    reply.body = "Fixed, I think.".into();
    s.threads[0].notes.push(reply);
    let replied = s.run().await.unwrap();
    assert_eq!(
        (replied.hints[0].hint.as_str(), replied.cached),
        ("third", false)
    );
    assert_eq!(s.fake.calls().len(), 3);

    // Another reviewed head: asked again for the new range.
    s.repo.write("src/App/Later.cs", "class Later { }\n");
    let c3 = s.repo.commit_all("A later commit");
    let mut req = s.request();
    req.head_sha = &c3;
    let moved = thread_check::run(&s.ctx(), &req, &|| {}, &Cancel::new())
        .await
        .unwrap();
    assert_eq!(
        (moved.hints[0].hint.as_str(), moved.cached),
        ("fourth", false)
    );
    assert_eq!(s.fake.calls().len(), 4);
}

#[tokio::test]
async fn f13_3_without_a_candidate_thread_nothing_runs() {
    let mut s = setup();
    // Only threads on the reviewed head, a resolved one and a comment on the MR itself.
    s.threads
        .retain(|t| ["disc-current", "disc-resolved", "disc-general"].contains(&t.id.as_str()));
    s.fake.set_scenario(&json!({ "responses": [answer(&[])] }));
    let started = AtomicUsize::new(0);
    let outcome = thread_check::run(
        &s.ctx(),
        &s.request(),
        &|| {
            started.fetch_add(1, Ordering::SeqCst);
        },
        &Cancel::new(),
    )
    .await
    .unwrap();
    assert!(outcome.hints.is_empty());
    assert_eq!(started.load(Ordering::SeqCst), 0);
    assert!(s.fake.calls().is_empty(), "no candidate, no Claude run");
}

#[tokio::test]
async fn f13_3_a_thread_whose_head_is_gone_from_the_repository_is_left_out_not_an_error() {
    let mut s = setup();
    // A force-push removed the commit the thread was written on.
    let gone = "e".repeat(40);
    s.threads = threads_of(
        vec![
            raw_thread(
                "disc-gone",
                &gone,
                "Is this still here after the rebase?",
                false,
                true,
            ),
            raw_thread(
                "disc-index",
                &s.t1,
                "No index on CreatedAt, but every read sorts by it.",
                false,
                true,
            ),
        ],
        &s.c2,
    );
    s.says(&[("disc-index", s.c1.as_str(), "index added")]);
    let outcome = s.run().await.unwrap();
    assert_eq!(
        outcome.hints,
        vec![hint("disc-index", s.c1.as_str(), "index added")]
    );
    let inputs = inputs_of(&s.fake.calls()[0]);
    assert!(!inputs.contains("disc-gone"));

    // Alone, it leaves nothing to check: no run.
    let alone = threads_of(
        vec![raw_thread(
            "disc-gone",
            &gone,
            "Is this still here after the rebase?",
            false,
            true,
        )],
        &s.c2,
    );
    s.threads = alone;
    let outcome = s.run().await.unwrap();
    assert!(outcome.hints.is_empty());
    assert_eq!(s.fake.calls().len(), 1);
}

#[tokio::test]
async fn f13_3_the_commits_are_size_capped_and_keep_the_latest_commit_nameable() {
    let s = setup();
    let line = "// padding to make the diff of this commit large enough to need a cap\n";
    s.repo.write("src/App/Big.cs", &line.repeat(20_000));
    let big = s.repo.commit_all("Generate the big file");
    let mut req = s.request();
    req.head_sha = &big;
    s.says(&[("disc-index", big.as_str(), "generated")]);
    let outcome = thread_check::run(&s.ctx(), &req, &|| {}, &Cancel::new())
        .await
        .unwrap();
    assert_eq!(
        outcome.hints,
        vec![hint("disc-index", big.as_str(), "generated")]
    );
    let inputs = inputs_of(&s.fake.calls()[0]);
    assert!(
        inputs.len() < 600_000,
        "{} bytes of input for a 1.4 MB diff",
        inputs.len()
    );
    assert!(
        inputs.contains(&big),
        "a commit that was cut stays nameable"
    );
    assert!(inputs.contains("Generate the big file"));
}

#[tokio::test]
async fn f13_3_the_model_follows_the_step_analysis_group() {
    let mut s = setup();
    s.settings.tasks.step = TaskOverride {
        model: "claude-opus-5-5".into(),
        effort: TaskEffort::High,
    };
    s.says(&[("disc-index", s.c1.as_str(), "index added")]);
    s.run().await.unwrap();
    let argv = argv_of(&s.fake.calls()[0]);
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(at("--model"), "claude-opus-5-5");
    assert_eq!(at("--effort"), "high");
}
