//! The MR description task against the fake `claude` (docs/09 › Fake `claude`; F-27.2, docs/plans/M7.md
//! F-27.2 and decisions 15 and 16; ADR-022, ADR-025 risk: argv snapshot of the read-only profile).
//! **Write with Claude** (and Shorter / Longer version) on S-11 asks for the title and the
//! description of the current branch: inputs are three files in the task folder, readable through
//! `--add-dir`, the branch's commits (subjects and bodies) since the merge base with the target,
//! the diff of the branch against that merge base and the self-review notes the author kept;
//! Claude's working directory is the repository root. Nothing is cached: every click asks again.
//! The "MR description and pipeline" group decides the model. Synthetic data only (ADR-019);
//! paths and branch names carry spaces and Polish characters.
//!
//! The tests pin these names (the plan's `claude/tasks/mr_description.rs`):
//! - `mr_description::Variant::{Normal, Short, Long}` (the first Write is `Normal`)
//! - `mr_description::MrDescriptionRequest { git: &Git, target: &str, variant: Variant,
//!   notes: &str }` (`target` is a branch on origin, with or without `origin/`; `notes` is the
//!   text of the kept self-review notes, empty when there are none)
//! - `mr_description::run(&Context, &MrDescriptionRequest, &Cancel) -> Result<MrDescription,
//!   ClaudeError>` with `MrDescription { title: String, description: String }` (the IPC result
//!   of `claude_mr_description`; `description` is the rendered Markdown)
//! - `Context` is `claude::tasks::plan::Context`, as for the reply draft
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fake_claude;
use crate::fixture_repo;

use std::path::{Path, PathBuf};

use fake_claude::FakeClaude;
use fixture_repo::FixtureRepo;
use guided_review_lib::claude::ClaudeError;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::tasks::mr_description::{self, MrDescriptionRequest, Variant};
use guided_review_lib::claude::tasks::plan::Context;
use guided_review_lib::git::Git;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::settings::{ClaudeSettings, TaskEffort, TaskOverride};
use guided_review_lib::store::Store;
use serde_json::{Value, json};

const BRANCH: &str = "feature/zażółć";
const FILE: &str = "src/Zażółć/Upload Worker.cs";

fn result(body: Value) -> Value {
    let mut base =
        json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": "s" });
    base.as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    json!({ "stdout": base.to_string() })
}

fn answer(output: &Value) -> Value {
    result(json!({ "structured_output": output }))
}

fn good() -> Value {
    json!({
        "title": "Retry uploads with a cap",
        "what": "Uploads are retried up to 5 times.",
        "why": "A flaky network lost deliveries.",
        "how_to_test": ["Turn on airplane mode.", "Scan a parcel.", "Turn it off again."],
    })
}

struct Setup {
    repo: FixtureRepo,
    git: Git,
    fake: FakeClaude,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
}

/// `main` is on origin; the checkout is on `feature/zażółć`, two commits (the first with a body)
/// on top of it; `main` then moves on by one commit that is not part of the branch.
fn setup() -> Setup {
    let repo = FixtureRepo::new("mr description ż");
    repo.write(FILE, "class Upload {\n}\n");
    repo.commit_all("Base commit");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["remote", "set-head", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", BRANCH]);
    repo.write(FILE, "class Upload {\n    int Retries = 5;\n}\n");
    repo.commit_all("Cap the upload retries\n\nA flaky network used to retry forever.");
    repo.write("Plik ż ć.txt", "branch-only-file\n");
    repo.commit_all("Add a notes file");
    repo.git(&["checkout", "-q", "main"]);
    repo.write("Main.txt", "main-only-file\n");
    repo.commit_all("Main moves ahead");
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["checkout", "-q", BRANCH]);
    let fake = FakeClaude::new(Path::new(env!("CARGO_BIN_EXE_fake-claude")), &json!({}));
    let exe = ClaudeExecutable::Native(fake.exe.clone());
    let git = Git::new(None, &repo.path);
    Setup {
        repo,
        git,
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

    async fn write(
        &self,
        variant: Variant,
        notes: &str,
    ) -> Result<mr_description::MrDescription, ClaudeError> {
        let req = MrDescriptionRequest {
            git: &self.git,
            target: "main",
            variant,
            notes,
        };
        mr_description::run(&self.ctx(), &req, &Cancel::new()).await
    }

    /// Claude answers once with exactly this.
    fn says(&self, output: &Value) {
        self.fake
            .set_scenario(&json!({ "responses": [answer(output)] }));
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
async fn f27_2_argv_inputs_and_result() {
    let s = setup();
    s.says(&good());
    let written = s
        .write(Variant::Normal, "Check the retry cap.")
        .await
        .unwrap();
    assert_eq!(written.title, "Retry uploads with a cap");
    assert_eq!(
        written.description,
        "## What\nUploads are retried up to 5 times.\n\n## Why\nA flaky network lost deliveries.\n\n## How to test\n1. Turn on airplane mode.\n2. Scan a parcel.\n3. Turn it off again."
    );

    let calls = s.fake.calls();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    let argv = argv_of(call);
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();
    let task_dir = PathBuf::from(at("--add-dir"));
    assert_eq!(task_dir.parent(), Some(s.tmp.path()));
    let schema: Value = serde_json::from_str(&at("--json-schema")).unwrap();
    assert_eq!(schema["title"], "MrDescription");
    let snapshot: Vec<String> = argv
        .iter()
        .map(|a| {
            if a.starts_with('{') {
                "<mr-description.schema.json>".to_owned()
            } else {
                a.replace(&task_dir.to_string_lossy().into_owned(), "<task>")
            }
        })
        .collect();
    // The read-only profile of ADR-022 and the "MR description and pipeline" group's default
    // (Sonnet, low effort), no kept session: the description is one call, not a conversation.
    assert_eq!(
        snapshot,
        [
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            "<mr-description.schema.json>",
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
        Some(s.repo.path.clone()),
        "Claude works in the repository root"
    );

    // Three input files, each named in the prompt; the prompt has no placeholder left.
    let stdin = call["stdin"].as_str().unwrap();
    assert!(!stdin.contains("{{"), "{stdin}");
    assert!(stdin.contains(BRANCH), "the branch is named: {stdin}");
    let files = call["addDirFiles"].as_object().unwrap();
    let input_files: Vec<&String> = files.keys().filter(|n| *n != "system-common.md").collect();
    assert_eq!(input_files.len(), 3, "commits, diff and notes");
    for name in input_files {
        let path = task_dir.join(name);
        assert!(
            stdin.contains(&*path.to_string_lossy()),
            "{name} not in the prompt"
        );
    }

    let inputs = inputs_of(call);
    // The commits of the branch since the merge base, subjects and bodies.
    for text in [
        "Cap the upload retries",
        "A flaky network used to retry forever.",
        "Add a notes file",
    ] {
        assert!(inputs.contains(text), "{text} is not in the inputs");
    }
    // The diff of the branch against the merge base: its own changes, not what main did since.
    assert!(inputs.contains("int Retries = 5;"), "{inputs}");
    assert!(inputs.contains("branch-only-file"), "{inputs}");
    for foreign in ["Main moves ahead", "main-only-file", "Base commit"] {
        assert!(!inputs.contains(foreign), "{foreign} is in the inputs");
    }
    // The notes the author kept.
    assert!(inputs.contains("Check the retry cap."), "{inputs}");
    // Nothing is left in the temp folder once the run is over.
    assert_eq!(std::fs::read_dir(s.tmp.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn f27_2_without_kept_notes_the_run_has_the_same_three_inputs() {
    let s = setup();
    s.says(&good());
    s.write(Variant::Normal, "").await.unwrap();
    let call = &s.fake.calls()[0];
    let files = call["addDirFiles"].as_object().unwrap();
    assert_eq!(files.keys().filter(|n| *n != "system-common.md").count(), 3);
    assert!(!call["stdin"].as_str().unwrap().contains("{{"));
}

#[tokio::test]
async fn f27_2_the_variant_reaches_the_prompt() {
    let s = setup();
    for (variant, word) in [
        (Variant::Normal, "Variant: normal"),
        (Variant::Short, "Variant: short"),
        (Variant::Long, "Variant: long"),
    ] {
        s.says(&good());
        s.write(variant, "").await.unwrap();
        let stdin = s.fake.calls().last().unwrap()["stdin"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(stdin.contains(word), "{word}: {stdin}");
    }
    let stdins: Vec<String> = s
        .fake
        .calls()
        .iter()
        .map(|c| c["stdin"].as_str().unwrap().to_owned())
        .collect();
    assert!(!stdins[0].contains("Variant: short") && !stdins[0].contains("Variant: long"));
    assert!(!stdins[1].contains("Variant: long") && !stdins[2].contains("Variant: short"));
}

#[tokio::test]
async fn f27_2_every_click_asks_claude_again_nothing_is_cached() {
    let s = setup();
    let mut second = good();
    second["title"] = json!("Second title");
    s.fake
        .set_scenario(&json!({ "responses": [answer(&good()), answer(&second)] }));
    assert_eq!(
        s.write(Variant::Normal, "").await.unwrap().title,
        "Retry uploads with a cap"
    );
    assert_eq!(
        s.write(Variant::Normal, "").await.unwrap().title,
        "Second title"
    );
    assert_eq!(s.fake.calls().len(), 2);
}

#[tokio::test]
async fn f27_2_render_the_description_is_what_why_and_a_numbered_how_to_test() {
    let s = setup();
    s.says(&json!({
        "title": "  Zażółć gęślą jaźń  ",
        "what": "  Line one.\nLine two.  ",
        "why": "Because.",
        "how_to_test": ["One step."],
    }));
    let written = s.write(Variant::Normal, "").await.unwrap();
    assert_eq!(written.title, "Zażółć gęślą jaźń", "the title is trimmed");
    assert_eq!(
        written.description,
        "## What\nLine one.\nLine two.\n\n## Why\nBecause.\n\n## How to test\n1. One step."
    );
}

#[tokio::test]
async fn f27_2_render_steps_that_already_carry_a_number_are_not_numbered_twice() {
    let s = setup();
    let mut output = good();
    output["how_to_test"] = json!(["1. Open the app.", "2) Scan a parcel.", "Close the app."]);
    s.says(&output);
    let written = s.write(Variant::Normal, "").await.unwrap();
    assert!(
        written
            .description
            .ends_with("## How to test\n1. Open the app.\n2. Scan a parcel.\n3. Close the app."),
        "{}",
        written.description
    );
}

#[tokio::test]
async fn f27_2_render_clamps_the_title_and_the_sections_to_the_schemas_limits() {
    let s = setup();
    let mut output = good();
    output["title"] = json!("x".repeat(80));
    output["what"] = json!("Zażółć gęślą jaźń. ".repeat(60));
    output["why"] = json!("y".repeat(900));
    output["how_to_test"] = json!(["z".repeat(300)]);
    s.says(&output);
    let written = s.write(Variant::Normal, "").await.unwrap();
    assert_eq!(written.title.chars().count(), 72);
    assert!(written.title.ends_with('…'));
    let sections: Vec<&str> = written.description.split("\n\n## ").collect();
    assert_eq!(sections.len(), 3, "{}", written.description);
    let what = sections[0].strip_prefix("## What\n").unwrap();
    assert!(what.chars().count() <= 800, "{}", what.chars().count());
    assert!(what.starts_with("Zażółć gęślą jaźń."));
    assert!(what.ends_with('…'));
    let why = sections[1].strip_prefix("Why\n").unwrap();
    assert!(why.chars().count() <= 800 && why.ends_with('…'));
    let step = sections[2].strip_prefix("How to test\n1. ").unwrap();
    assert!(step.chars().count() <= 200 && step.ends_with('…'));
}

#[tokio::test]
async fn f27_2_a_wrong_shape_is_claude_schema() {
    let s = setup();
    let without = |field: &str| {
        let mut output = good();
        output.as_object_mut().unwrap().remove(field);
        output
    };
    let mut empty_title = good();
    empty_title["title"] = json!("   ");
    let mut steps_text = good();
    steps_text["how_to_test"] = json!("1. Do it.");
    let mut no_steps = good();
    no_steps["how_to_test"] = json!([]);
    let mut what_number = good();
    what_number["what"] = json!(5);
    for output in [
        without("title"),
        without("what"),
        without("why"),
        without("how_to_test"),
        empty_title,
        steps_text,
        no_steps,
        what_number,
        json!({}),
    ] {
        s.says(&output);
        let error = s.write(Variant::Normal, "").await.unwrap_err();
        assert!(
            matches!(error, ClaudeError::Schema(_)),
            "{output}: {error:?}"
        );
    }
    // No structured output at all is the same failure.
    s.fake
        .set_scenario(&json!({ "responses": [result(json!({ "result": "free text" }))] }));
    let error = s.write(Variant::Normal, "").await.unwrap_err();
    assert!(matches!(error, ClaudeError::Schema(_)), "{error:?}");
}

#[tokio::test]
async fn f27_2_the_model_follows_the_mr_description_and_pipeline_group() {
    let mut s = setup();
    s.settings.tasks.mr = TaskOverride {
        model: "claude-opus-5-5".into(),
        effort: TaskEffort::High,
    };
    s.says(&good());
    s.write(Variant::Normal, "").await.unwrap();
    let argv = argv_of(&s.fake.calls()[0]);
    let at = |flag: &str| argv[argv.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(at("--model"), "claude-opus-5-5");
    assert_eq!(at("--effort"), "high");
}

#[tokio::test]
async fn f27_2_a_target_that_is_not_on_origin_starts_no_claude_run() {
    let s = setup();
    s.says(&good());
    let req = MrDescriptionRequest {
        git: &s.git,
        target: "nie-ma-takiej",
        variant: Variant::Normal,
        notes: "",
    };
    let error = mr_description::run(&s.ctx(), &req, &Cancel::new())
        .await
        .unwrap_err();
    assert!(
        matches!(error, ClaudeError::Invalid(_) | ClaudeError::Failed { .. }),
        "{error:?}"
    );
    assert!(s.fake.calls().is_empty());
}
