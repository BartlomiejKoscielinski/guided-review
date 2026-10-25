//! Self-review (F-17.1): the plan, step and ask tasks of commits and the user's own local
//! changes (uncommitted, staged, branch vs target) read the repository root without a worktree,
//! get their own `{{source_label}}`/`{{source_block}}` and their own cache subject; a commits
//! session carries its commit messages as the description, local scopes none (M3 decisions 12
//! to 15). Fake `claude`, synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fake_claude;
use crate::fixture_repo;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::prompts::PROMPT_VERSION;
use guided_review_lib::claude::queue::{Priority, Queue};
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::git::Git;
use guided_review_lib::git::model::FileDiff;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::model::{Layout, Mode, SessionStatus, Strategy};
use guided_review_lib::review::plan_runs;
use guided_review_lib::review::sessions::new_session;
use guided_review_lib::review::step_context::{self, SessionInputs};
use guided_review_lib::review::step_runs::{self, StepRuns};
use guided_review_lib::route::Route;
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::source::{CommitRange, open};
use guided_review_lib::store::{self, Store};
use serde_json::{Value, json};

const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
const QUEUE: &str = "src/Core/IQueue.cs";
const NEW: &str = "src/Core/Nowy plik ż.cs";

struct Setup {
    repo: FixtureRepo,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

fn insert(store: &Store, id: &str, source: &Value, base: &str, head: &str, worktree: Option<&str>) {
    let source = source.to_string();
    store
        .with_conn(|c| {
            c.execute(
                "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, worktree)
                 VALUES (?1, 1, ?2, ?3, ?4, ?5)",
                rusqlite::params![id, source, base, head, worktree],
            )?;
            Ok(())
        })
        .unwrap();
}

/// `develop` at the base; `main` adds `Enqueue` to IQueue (the branch). On top: a staged edit
/// of the ViewModel, an unstaged edit of IQueue and an untracked file.
fn setup() -> Setup {
    setup_with("base")
}

/// [`setup`] with the message of the first (root) commit.
fn setup_with(root_message: &str) -> Setup {
    let repo = FixtureRepo::new("self review");
    repo.write(VM, "class Vm {\n    void Up() { Send(); }\n}\n");
    repo.write(QUEUE, "interface IQueue {\n}\n");
    repo.commit_all(root_message);
    repo.git(&["branch", "develop"]);
    repo.write(QUEUE, "interface IQueue {\n    void Enqueue();\n}\n");
    repo.commit_all("queue");
    repo.write(VM, "class Vm {\n    void Up() { queue.Enqueue(); }\n}\n");
    repo.git(&["add", "--", VM]);
    repo.write(
        QUEUE,
        "interface IQueue {\n    void Enqueue();\n    int Count { get; }\n}\n",
    );
    repo.write(NEW, "class Nowy {\n}\n");
    let store = Store::open_in_memory().unwrap();
    let path = repo.path.to_string_lossy().into_owned();
    store
        .with_conn(move |c| {
            store::repos::add(c, "app", &path, None)?;
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

fn result(body: Value) -> Value {
    let mut base =
        json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": "s" });
    base.as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    base
}

/// One step per file.
fn plan_response(files: &[FileDiff]) -> Value {
    let steps: Vec<Value> = files
        .iter()
        .enumerate()
        .map(|(i, f)| {
            json!({ "id": format!("s{}", i + 1), "title": format!("File {}", i + 1),
                "short_title": format!("File {}", i + 1), "reason": "In file order.",
                "description": "One file.", "layer": "Core",
                "hunk_ids": f.hunks.iter().map(|h| h.id.clone()).collect::<Vec<_>>(),
                "builds_on": [] })
        })
        .collect();
    let ids: Vec<String> = (1..=files.len()).map(|i| format!("s{i}")).collect();
    let output = json!({
        "intent": "Own changes.", "steps": steps,
        "orders": { "contract_to_ui": ids, "tests_first": ids },
        "skim": [], "risks": [], "description_check": [], "already_discussed": ""
    });
    json!({ "stdout": result(json!({ "structured_output": output })).to_string() })
}

fn no_findings() -> Value {
    let output = json!({ "findings": [], "checklist": [], "files_read": [], "folds": [] });
    json!({ "stdout": result(json!({ "structured_output": output })).to_string() })
}

fn answer(text: &str) -> Value {
    let lines = [
        json!({ "type": "system", "subtype": "init", "session_id": "a1" }).to_string(),
        result(json!({ "result": text, "session_id": "a1" })).to_string(),
    ];
    json!({ "stdout": lines.join("\n") + "\n" })
}

fn paths(files: &[FileDiff]) -> Vec<String> {
    let mut out: Vec<String> = files
        .iter()
        .map(|f| {
            f.new_path
                .clone()
                .or(f.old_path.clone())
                .unwrap_or_default()
        })
        .collect();
    out.sort();
    out
}

fn same_dir(a: &Path, b: &Path) -> bool {
    a.canonicalize().unwrap() == b.canonicalize().unwrap()
}

fn call_cwd(call: &Value) -> PathBuf {
    PathBuf::from(call["cwd"].as_str().unwrap())
}

impl Setup {
    /// A scenario whose `responses` start at the next run (the fake counts every run).
    fn next(&self, responses: Vec<Value>) -> Value {
        let mut all = vec![json!({}); self.fake.calls().len()];
        all.extend(responses);
        json!({ "responses": all })
    }

    fn ctx(&self) -> Context<'_> {
        Context {
            exe: &self.exe,
            settings: &self.settings,
            tmp_root: self.tmp.path(),
            queue: &self.queue,
            store: &self.store,
        }
    }

    /// The session's inputs; asserts no MR threads are fetched.
    async fn inputs(&self, id: &str) -> SessionInputs {
        let fetched = AtomicBool::new(false);
        let inputs = step_context::load_inputs(
            &self.store,
            None,
            id,
            |_| {
                fetched.store(true, Ordering::Relaxed);
                async { Vec::new() }
            },
            &Cancel::new(),
        )
        .await
        .unwrap();
        assert!(
            !fetched.load(Ordering::Relaxed),
            "threads of a non-MR session"
        );
        assert!(inputs.mr.is_none());
        if matches!(inputs.source, PlanSource::Local { .. }) {
            assert!(inputs.description.is_none());
        }
        inputs
    }

    /// Opens a commits session the way `session_open_commit` does (resolve, `new_session`, store
    /// row); returns its id and the route it opens.
    async fn open_commits(&self, from: Option<&str>, to: &str) -> (String, Route) {
        let git = Git::new(None, &self.repo.path);
        let range = CommitRange {
            from: from.map(str::to_owned),
            to: to.to_owned(),
        };
        let resolved = open::commits(&git, &range, &Cancel::new()).await.unwrap();
        let (row, opened) = new_session(1, resolved, Mode::Focus, Layout::A).unwrap();
        self.store
            .with_conn(|c| store::sessions::insert(c, &row))
            .unwrap();
        (opened.session_id, opened.route)
    }

    /// The plan call's `description.md` for a session's inputs.
    async fn description_file(&self, inputs: &SessionInputs) -> String {
        let call = self.plan(inputs).await;
        call["addDirFiles"]["description.md"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    /// Plans the session through `review_plan`'s core; returns the plan call.
    async fn plan(&self, inputs: &SessionInputs) -> Value {
        let before = self.fake.calls().len();
        self.fake
            .set_scenario(&self.next(vec![plan_response(&inputs.files)]));
        let planned = plan_runs::plan(&self.ctx(), inputs, &Cancel::new(), &|_| {})
            .await
            .unwrap();
        assert!(planned.claude_error.is_none());
        let calls = self.fake.calls();
        assert_eq!(calls.len(), before + 1);
        calls[before].clone()
    }

    /// Step s1 and a question on it; returns both calls.
    async fn step_and_ask(&self, id: &str, subject: &str) -> (Value, Value) {
        let cx = step_context::load(
            &self.ctx(),
            None,
            id,
            |_| async { Vec::new() },
            &Cancel::new(),
        )
        .await
        .unwrap();
        assert_eq!(cx.subject(), subject);
        assert!(same_dir(&cx.cwd, &self.repo.path));
        let order = cx.order(Strategy::ContractToUi);
        self.fake
            .set_scenario(&self.next(vec![no_findings(), answer("Because.")]));
        let req = cx.step_request("s1", &order, &[]);
        let runs = StepRuns::default();
        let analysis = step_runs::findings(
            &runs,
            &self.ctx(),
            &req,
            id,
            Priority::CurrentStep,
            &Cancel::new(),
            &|_| {},
        )
        .await
        .unwrap();
        assert!(analysis.findings.is_empty());
        let req = cx.ask_request("s1", &order, "Why?", None);
        let reply = step_runs::ask(&self.ctx(), &req, &Cancel::new(), &|_| {})
            .await
            .unwrap();
        assert_eq!(reply.text, "Because.");
        let calls = self.fake.calls();
        let n = calls.len();
        (calls[n - 2].clone(), calls[n - 1].clone())
    }
}

#[tokio::test]
async fn f17_1_uncommitted_plan_step_and_ask_read_the_repository_root() {
    let s = setup();
    let head = s.repo.head();
    // A stale worktree on the row is ignored: local changes never use one.
    let elsewhere = s.tmp.path().join("not a worktree");
    insert(
        &s.store,
        "u",
        &json!({ "kind": "local", "scope": { "kind": "uncommitted" } }),
        &head,
        &head,
        Some(&elsewhere.to_string_lossy()),
    );
    let inputs = s.inputs("u").await;
    assert!(same_dir(&inputs.cwd, &s.repo.path));
    assert_eq!(paths(&inputs.files), [VM, QUEUE, NEW]);
    let queue = inputs
        .files
        .iter()
        .find(|f| f.new_path.as_deref() == Some(QUEUE))
        .unwrap();
    // Only the unstaged edit on top of HEAD, not the committed Enqueue.
    assert_eq!((queue.additions, queue.deletions), (1, 0));

    let call = s.plan(&inputs).await;
    assert!(same_dir(&call_cwd(&call), &s.repo.path));
    let stdin = call["stdin"].as_str().unwrap();
    assert!(
        stdin.contains("the author's own uncommitted changes in app"),
        "{stdin}"
    );
    assert!(stdin.contains(&format!("HEAD ({head}) to the working tree")));
    let index = call["addDirFiles"]["hunk-index.tsv"].as_str().unwrap();
    assert!(index.contains(NEW) && index.contains(VM) && index.contains(QUEUE));
    assert_eq!(call["addDirFiles"]["threads.txt"], "none\n");

    let (step, ask) = s.step_and_ask("u", "local:uncommitted").await;
    for call in [&step, &ask] {
        assert!(same_dir(&call_cwd(call), &s.repo.path));
        let stdin = call["stdin"].as_str().unwrap();
        assert!(
            stdin.contains("the author's own uncommitted changes"),
            "{stdin}"
        );
    }
}

#[tokio::test]
async fn f17_1_staged_scope_reviews_the_index_only() {
    let s = setup();
    let head = s.repo.head();
    insert(
        &s.store,
        "s",
        &json!({ "kind": "local", "scope": { "kind": "staged" } }),
        &head,
        &head,
        None,
    );
    let inputs = s.inputs("s").await;
    assert_eq!(paths(&inputs.files), [VM]);
    let call = s.plan(&inputs).await;
    assert!(same_dir(&call_cwd(&call), &s.repo.path));
    let stdin = call["stdin"].as_str().unwrap();
    assert!(stdin.contains("the author's own staged changes"), "{stdin}");
    assert!(stdin.contains(&format!("HEAD ({head}) to the index")));
    s.step_and_ask("s", "local:staged").await;
}

#[tokio::test]
async fn f17_1_branch_vs_target_reviews_the_commits_since_the_merge_base() {
    let s = setup();
    let head = s.repo.head();
    let base = s
        .repo
        .git(&["merge-base", "develop", "HEAD"])
        .trim()
        .to_owned();
    insert(
        &s.store,
        "b",
        &json!({ "kind": "local", "scope": { "kind": "branchVsTarget", "target": "develop" } }),
        &base,
        &head,
        None,
    );
    let inputs = s.inputs("b").await;
    assert_eq!(paths(&inputs.files), [QUEUE]);
    let queue = &inputs.files[0];
    assert_eq!((queue.additions, queue.deletions), (1, 0));
    let call = s.plan(&inputs).await;
    assert!(same_dir(&call_cwd(&call), &s.repo.path));
    let stdin = call["stdin"].as_str().unwrap();
    assert!(
        stdin.contains("the author's own branch against develop"),
        "{stdin}"
    );
    assert!(stdin.contains(&format!(
        "merge base with develop ({base}) to HEAD ({head})"
    )));
    s.step_and_ask("b", "local:branch:develop").await;
}

#[tokio::test]
async fn f17_1_a_commit_is_planned_in_the_repository_root() {
    let s = setup();
    let head = s.repo.head();
    let parent = s.repo.git(&["rev-parse", "HEAD^"]).trim().to_owned();
    insert(
        &s.store,
        "c",
        &json!({ "kind": "commits", "to": head }),
        &parent,
        &head,
        None,
    );
    let inputs = s.inputs("c").await;
    assert_eq!(paths(&inputs.files), [QUEUE]);
    let call = s.plan(&inputs).await;
    assert!(same_dir(&call_cwd(&call), &s.repo.path));
    let stdin = call["stdin"].as_str().unwrap();
    assert!(stdin.contains(&format!("commit {}", &head[..7])), "{stdin}");
    assert!(stdin.contains(&format!("first parent ({parent})")));
    s.step_and_ask("c", &format!("commit:{head}")).await;
}

#[tokio::test]
async fn f17_1_plans_of_scopes_with_the_same_change_do_not_share_the_cache() {
    let s = setup();
    // Only the staged ViewModel edit is left: uncommitted and staged hold the same hunks.
    s.repo.git(&["checkout", "--", QUEUE]);
    std::fs::remove_file(s.repo.file(NEW)).unwrap();
    let head = s.repo.head();
    for (id, scope) in [("u", "uncommitted"), ("s", "staged")] {
        insert(
            &s.store,
            id,
            &json!({ "kind": "local", "scope": { "kind": scope } }),
            &head,
            &head,
            None,
        );
    }
    let uncommitted = s.inputs("u").await;
    let staged = s.inputs("s").await;
    assert_eq!(
        uncommitted.files[0].hunks[0].id,
        staged.files[0].hunks[0].id
    );
    s.plan(&uncommitted).await;
    // Planned again for the other scope (one more `claude` call), not a cache hit.
    s.plan(&staged).await;
}

/// The root commit of the fixture history.
fn root_commit(s: &Setup) -> String {
    s.repo
        .git(&["rev-list", "--max-parents=0", "HEAD"])
        .trim()
        .to_owned()
}

#[tokio::test]
async fn f17_1_commits_sessions_open_the_plan_like_local_changes() {
    let s = setup();
    let head = s.repo.head();
    let root = root_commit(&s);
    for from in [None, Some(root.as_str())] {
        let (id, route) = s.open_commits(from, &head).await;
        // M3 decision 12: no longer the step stub; the plan first, like MR and Local.
        assert_eq!(
            route,
            Route::Plan {
                session_id: id.clone()
            }
        );
        let stored = s
            .store
            .with_conn(|c| store::sessions::source_of(c, &id))
            .unwrap()
            .unwrap();
        assert_eq!(stored.status, Some(SessionStatus::Planning));
    }
}

#[tokio::test]
async fn f17_1_commit_messages_of_a_range_are_the_description_oldest_first() {
    let s = setup();
    s.repo.commit_all("Stan przed zakresem ZERO");
    let from = s.repo.head();
    s.repo.write(
        QUEUE,
        "interface IQueue {\n    void Enqueue();\n    int Count { get; }\n    void Clear();\n}\n",
    );
    s.repo
        .commit_all("Dodaj Clear do kolejki\n\nClear usuwa zadania ąęłń.\nDruga linia treści.");
    s.repo.write(
        VM,
        "class Vm {\n    void Up() { queue.Enqueue(); queue.Clear(); }\n}\n",
    );
    let to = s
        .repo
        .commit_all("Wyślij przez kolejkę\n\nUp dopisuje zadanie do kolejki.");

    let (id, _) = s.open_commits(Some(&from), &to).await;
    let inputs = s.inputs(&id).await;
    let description = inputs.description.as_deref().expect("the commit messages");
    let at = |text: &str| {
        description
            .find(text)
            .unwrap_or_else(|| panic!("{text:?} missing in {description}"))
    };
    let order = [
        at("Dodaj Clear do kolejki"),
        at("Clear usuwa zadania ąęłń."),
        at("Druga linia treści."),
        at("Wyślij przez kolejkę"),
        at("Up dopisuje zadanie do kolejki."),
    ];
    assert!(
        order.windows(2).all(|w| w[0] < w[1]),
        "subjects and bodies, oldest first: {description}"
    );
    assert!(
        !description.contains("ZERO"),
        "the commit the range starts from is not part of it"
    );

    // Claude gets the same text as `description.md`, so `description_check` can compare it.
    let file = s.description_file(&inputs).await;
    assert_ne!(file, "none\n");
    for text in [
        "Dodaj Clear do kolejki",
        "Druga linia treści.",
        "Wyślij przez kolejkę",
        "Up dopisuje zadanie do kolejki.",
    ] {
        assert!(file.contains(text), "{text:?} missing in {file}");
    }
    assert!(!file.contains("ZERO"));
}

#[tokio::test]
async fn f17_1_the_message_of_a_single_commit_is_its_description() {
    let s = setup();
    s.repo.commit_all("Poprzedni zapis POPRZEDNI");
    s.repo.write(
        VM,
        "class Vm {\n    void Up() { queue.Enqueue(); Log(); }\n}\n",
    );
    let to = s.repo.commit_all(
        "Zażółć gęślą jaźń: nowy temat\n\nTreść wyjaśnia powód zmiany.\n\n- punkt pierwszy\n- punkt drugi",
    );
    let (id, _) = s.open_commits(None, &to).await;
    let inputs = s.inputs(&id).await;
    assert_eq!(paths(&inputs.files), [VM]);
    let description = inputs.description.as_deref().expect("the commit message");
    for text in [
        "Zażółć gęślą jaźń: nowy temat",
        "Treść wyjaśnia powód zmiany.",
        "- punkt pierwszy",
        "- punkt drugi",
    ] {
        assert!(
            description.contains(text),
            "{text:?} missing: {description}"
        );
    }
    assert!(
        !description.contains("POPRZEDNI"),
        "the parent's message is not the commit's"
    );
    let file = s.description_file(&inputs).await;
    assert!(file.contains("Zażółć gęślą jaźń: nowy temat"), "{file}");
}

#[tokio::test]
async fn f17_1_the_root_commit_message_is_its_description() {
    let s = setup_with("Pierwszy zapis ŁĄKA\n\nTreść pierwszego zapisu.");
    let root = root_commit(&s);
    let (id, _) = s.open_commits(None, &root).await;
    let inputs = s.inputs(&id).await;
    let description = inputs.description.as_deref().expect("the commit message");
    assert!(description.contains("Pierwszy zapis ŁĄKA"), "{description}");
    assert!(description.contains("Treść pierwszego zapisu."));
    let file = s.description_file(&inputs).await;
    assert!(file.contains("Pierwszy zapis ŁĄKA"), "{file}");
}

#[tokio::test]
async fn f17_1_a_very_long_commit_message_is_capped() {
    let s = setup();
    s.repo
        .write(VM, "class Vm {\n    void Up() { Log(); }\n}\n");
    s.repo.git(&["add", "-A"]);
    // About 630 kB; the spec only says "size-capped", so the test pins that it is not sent whole.
    let line = "Linia długiej treści ż Linia długiej treści ż Linia długiej treści ż\n";
    let message = format!("Bardzo długi opis\n\n{}", line.repeat(9_000));
    s.repo
        .git_stdin(&["commit", "-q", "-F", "-"], Some(message.as_bytes()));
    let (id, _) = s.open_commits(None, &s.repo.head()).await;
    let inputs = s.inputs(&id).await;
    let description = inputs.description.as_deref().expect("the commit message");
    assert!(description.contains("Bardzo długi opis"));
    assert!(
        description.len() < 200_000,
        "{} bytes of commit message",
        description.len()
    );
    let file = s.description_file(&inputs).await;
    assert!(
        file.len() < 200_000,
        "{} bytes in description.md",
        file.len()
    );
    assert!(file.contains("Bardzo długi opis"));
}

#[tokio::test]
async fn f17_1_local_scopes_have_no_description_even_when_they_hold_commits() {
    let s = setup();
    let head = s.repo.head();
    let merge_base = s
        .repo
        .git(&["merge-base", "develop", "HEAD"])
        .trim()
        .to_owned();
    // The branch scope holds the commit "queue" since the merge base; its message stays out.
    let scopes = [
        ("u", json!({ "kind": "uncommitted" }), head.clone()),
        ("s", json!({ "kind": "staged" }), head.clone()),
        (
            "b",
            json!({ "kind": "branchVsTarget", "target": "develop" }),
            merge_base,
        ),
    ];
    for (id, scope, base) in scopes {
        insert(
            &s.store,
            id,
            &json!({ "kind": "local", "scope": scope }),
            &base,
            &head,
            None,
        );
        let inputs = s.inputs(id).await;
        assert!(inputs.description.is_none(), "{id}");
        assert_eq!(s.description_file(&inputs).await, "none\n", "{id}");
    }
}

#[tokio::test]
async fn f17_1_step_prompt_reads_the_repository_not_a_worktree() {
    let s = setup();
    let head = s.repo.head();
    insert(
        &s.store,
        "u",
        &json!({ "kind": "local", "scope": { "kind": "uncommitted" } }),
        &head,
        &head,
        None,
    );
    let inputs = s.inputs("u").await;
    s.plan(&inputs).await;
    let (step, _) = s.step_and_ask("u", "local:uncommitted").await;
    let stdin = step["stdin"].as_str().unwrap();
    // M3 decision 15: an MR worktree and the local root alike.
    assert!(
        stdin.contains("Read surrounding code in the repository when needed"),
        "{stdin}"
    );
    assert!(!stdin.contains("in the worktree"), "{stdin}");
}

#[test]
fn f17_1_docs_step_prompt_has_the_repository_wording_too() {
    let docs = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("docs")
        .join("claude")
        .join("prompts")
        .join("step.md");
    let text = std::fs::read_to_string(docs).unwrap();
    assert!(text.contains("Read surrounding code in the repository when needed"));
    assert!(!text.contains("in the worktree"));
}

#[test]
fn f17_1_the_changed_step_prompt_bumps_the_prompt_version() {
    // PROMPT_VERSION is part of the cache key; version 1 is the "worktree" wording.
    let version = std::hint::black_box(PROMPT_VERSION);
    assert!(version >= 2, "PROMPT_VERSION is {version}");
}
