//! The MR description of S-11 (F-27.2, docs/plans/M7.md F-27.2, decisions 15 and 16; docs/05 ›
//! Tasks: MR description, the "MR description and pipeline" group, `prompts/mr-description.md`,
//! `schemas/mr-description.schema.json`). **Write with Claude**, **Shorter version** and
//! **Longer version** ask for the title and the description of the current branch. Inputs are
//! three files in the task folder, readable through `--add-dir`: the branch's commits (subjects
//! and bodies) since the merge base with the target, the diff against that merge base and the
//! self-review notes the author kept. Claude's working directory is the repository root; the argv
//! comes only from `runner::read_only_args` (ADR-022, ADR-025 risk). The answer only fills the
//! fields, so nothing is cached: every click asks again.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::pipeline_explain_inputs::diff_file;
use super::plan::Context;
use crate::claude::error::ClaudeError;
use crate::claude::exec;
use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts;
use crate::claude::queue::Priority;
use crate::claude::result::clamp;
use crate::claude::runner::{self, OutputFormat, Task};
use crate::claude::task_dir::TaskDir;
use crate::git::branch_info::branch_range;
use crate::git::{Git, GitError, refs};
use crate::os::process::Cancel;
use crate::review::drafts::Draft;

/// The schema's limits; longer text is clamped with "…".
pub const TITLE_MAX: usize = 72;
pub const SECTION_MAX: usize = 800;
pub const STEP_MAX: usize = 200;
const TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// The run is refused before Claude starts when the branch has nothing to describe.
const NOTHING_TO_DESCRIBE: &str = "The branch has no commits to describe.";

/// Which text to write: `Normal` is the first **Write with Claude**, `Short` and `Long` are
/// **Shorter version** and **Longer version**.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "MrDescriptionVariant")]
pub enum Variant {
    Normal,
    Short,
    Long,
}

impl Variant {
    /// The word the prompt's `{{variant}}` gets.
    pub fn word(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Short => "short",
            Self::Long => "long",
        }
    }
}

/// One run: the repository, the target (a branch on `origin`, with or without `origin/`), the
/// variant and the text of the kept self-review notes (empty when there are none).
pub struct MrDescriptionRequest<'a> {
    pub git: &'a Git,
    pub target: &'a str,
    pub variant: Variant,
    pub notes: &'a str,
}

/// The IPC result of `claude_mr_description`: the title (trimmed, at most 72 characters) and the
/// description as Markdown: `## What`, `## Why` and `## How to test` with numbered steps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MrDescription {
    pub title: String,
    pub description: String,
}

/// What the task reads from git: the source branch's name, its commits and its diff.
struct Inputs {
    source: String,
    commits: String,
    diff: String,
}

fn git_error(error: GitError) -> ClaudeError {
    match error {
        GitError::Invalid(message) => ClaudeError::Invalid(message),
        other => ClaudeError::failed(other.to_string()),
    }
}

/// The commits of `merge-base(origin/<target>, HEAD)..HEAD` and their diff; `Invalid` for a
/// target that is no branch on `origin` or a branch with nothing to describe.
async fn inputs(git: &Git, target: &str, cancel: &Cancel) -> Result<Inputs, ClaudeError> {
    let (base, head) = branch_range(git, Some(target), cancel)
        .await
        .map_err(git_error)?
        .ok_or_else(|| ClaudeError::Invalid(NOTHING_TO_DESCRIBE.to_owned()))?;
    let range = format!("{base}..{head}");
    let log = git
        .run(
            ["log", "--no-color", "--format=commit %h%n%B", &range],
            cancel,
        )
        .await
        .map_err(git_error)?;
    if log.stdout.trim().is_empty() {
        return Err(ClaudeError::Invalid(NOTHING_TO_DESCRIBE.to_owned()));
    }
    let diff = git
        .run(
            ["diff", "--no-color", "--no-ext-diff", "-M", &base, &head],
            cancel,
        )
        .await
        .map_err(git_error)?;
    let source = refs::current_branch(git, cancel)
        .await
        .map_err(git_error)?
        .unwrap_or_else(|| "HEAD".to_owned());
    Ok(Inputs {
        source,
        commits: log.stdout,
        diff: diff_file(&diff.stdout),
    })
}

/// The notes file: each kept note with its place, or "none".
pub fn notes_file(drafts: &[Draft]) -> String {
    let mut out = String::new();
    for (index, draft) in drafts.iter().enumerate() {
        let place = draft.position.as_ref().map_or_else(
            || "on the change as a whole".to_owned(),
            |p| format!("{}:{}", p.file, p.line),
        );
        let body = draft.body.trim().replace('\n', "\n    ");
        out.push_str(&format!("Note {} · {place}\n    {body}\n", index + 1));
    }
    out
}

fn schema(detail: impl Into<String>) -> ClaudeError {
    ClaudeError::Schema(detail.into())
}

fn text<'a>(object: &'a Map<String, Value>, field: &str) -> Result<&'a str, ClaudeError> {
    let value = object
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| schema(format!("{field} is not a string")))?
        .trim();
    if value.is_empty() {
        return Err(schema(format!("{field} is empty")));
    }
    Ok(value)
}

/// A step without the number Claude may have put in front of it ("1. ", "2) ").
fn unnumbered(step: &str) -> &str {
    let digits = step.len() - step.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    let rest = &step[digits..];
    match rest.strip_prefix(['.', ')']) {
        Some(after)
            if digits > 0 && (after.is_empty() || after.starts_with(char::is_whitespace)) =>
        {
            after.trim_start()
        }
        _ => step,
    }
}

/// The answer in `structured_output` rendered: the title trimmed and clamped, the description as
/// `## What`, `## Why` and `## How to test` with numbered steps, each part clamped to the schema.
pub fn description_of(output: &Value) -> Result<MrDescription, ClaudeError> {
    let object = output.as_object().ok_or_else(|| schema("not an object"))?;
    let known = ["title", "what", "why", "how_to_test"];
    if let Some(other) = object.keys().find(|k| !known.contains(&k.as_str())) {
        return Err(schema(format!("unexpected field {other}")));
    }
    let title = clamp(text(object, "title")?, TITLE_MAX);
    let what = clamp(text(object, "what")?, SECTION_MAX);
    let why = clamp(text(object, "why")?, SECTION_MAX);
    let steps: Vec<String> = object
        .get("how_to_test")
        .and_then(Value::as_array)
        .ok_or_else(|| schema("how_to_test is not a list"))?
        .iter()
        .map(|s| s.as_str().ok_or_else(|| schema("a step is not a string")))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|s| unnumbered(s.trim()))
        .filter(|s| !s.is_empty())
        .map(|s| clamp(s, STEP_MAX))
        .collect();
    if steps.is_empty() {
        return Err(schema("how_to_test has no steps"));
    }
    let numbered: Vec<String> = steps
        .iter()
        .enumerate()
        .map(|(n, step)| format!("{}. {step}", n + 1))
        .collect();
    Ok(MrDescription {
        title,
        description: format!(
            "## What\n{what}\n\n## Why\n{why}\n\n## How to test\n{}",
            numbered.join("\n")
        ),
    })
}

/// Runs `claude` in the repository root (`Priority::Interactive`: the author clicked and waits).
/// The target is checked and the inputs are read before the run waits in the queue.
pub async fn run(
    ctx: &Context<'_>,
    req: &MrDescriptionRequest<'_>,
    cancel: &Cancel,
) -> Result<MrDescription, ClaudeError> {
    let inputs = inputs(req.git, req.target, cancel).await?;
    let _permit = ctx.queue.acquire(Priority::Interactive, cancel).await?;

    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let file = |name: &str, content: &str| {
        dir.write(name, content)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io)
    };
    let notes = if req.notes.trim().is_empty() {
        "none\n"
    } else {
        req.notes
    };
    let target = req.target.strip_prefix("origin/").unwrap_or(req.target);
    let prompt = prompts::render(
        prompts::MR_DESCRIPTION,
        &[
            ("source_branch", &inputs.source),
            ("target_branch", target),
            ("commits_file", &file("commits.txt", &inputs.commits)?),
            ("diff_file", &file("branch.diff", &inputs.diff)?),
            ("notes_file", &file("notes.txt", notes)?),
            ("variant", req.variant.word()),
        ],
    );
    let system = dir
        .write(
            "system-common.md",
            &prompts::system_common(ctx.settings.lang),
        )
        .map_err(io)?;
    let resolved = models::resolve(ctx.settings, TaskGroup::Mr);
    let task = Task {
        output: OutputFormat::Json,
        json_schema: Some(prompts::MR_DESCRIPTION_SCHEMA.trim().to_owned()),
        model: resolved.model,
        effort: resolved.effort,
        system_prompt_file: system,
        task_dir: dir.path().to_path_buf(),
        persist_session: false,
        resume: None,
    };
    let result = exec::run_task(
        ctx.exe,
        runner::read_only_args(&task),
        req.git.repo(),
        &prompt,
        dir.path(),
        TIMEOUT,
        cancel,
    )
    .await?;
    let output = result
        .structured_output
        .ok_or_else(|| schema("no structured output"))?;
    description_of(&output)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use serde_json::json;

    #[test]
    fn f27_2_the_prompt_fills_every_placeholder() {
        let prompt = prompts::render(
            prompts::MR_DESCRIPTION,
            &[
                ("source_branch", "s"),
                ("target_branch", "t"),
                ("commits_file", "c"),
                ("diff_file", "d"),
                ("notes_file", "n"),
                ("variant", "short"),
            ],
        );
        assert!(!prompt.contains("{{"), "{prompt}");
    }

    #[test]
    fn f27_2_the_schema_limits_are_the_clamps() {
        let schema: Value = serde_json::from_str(prompts::MR_DESCRIPTION_SCHEMA).unwrap();
        assert_eq!(schema["title"], "MrDescription");
        let props = &schema["properties"];
        assert_eq!(props["title"]["maxLength"], TITLE_MAX);
        assert_eq!(props["what"]["maxLength"], SECTION_MAX);
        assert_eq!(props["why"]["maxLength"], SECTION_MAX);
        assert_eq!(props["how_to_test"]["items"]["maxLength"], STEP_MAX);
    }

    #[test]
    fn f27_2_render_strips_only_a_leading_step_number() {
        assert_eq!(unnumbered("1. Open"), "Open");
        assert_eq!(unnumbered("12) Open"), "Open");
        assert_eq!(unnumbered("1.5 s is the wait"), "1.5 s is the wait");
        assert_eq!(unnumbered("Open 2. tab"), "Open 2. tab");
    }

    #[test]
    fn f27_2_render_rejects_an_unknown_field_and_drops_blank_steps() {
        let mut good = json!({ "title": "T", "what": "W", "why": "Y", "how_to_test": ["A", " "] });
        assert!(
            description_of(&good)
                .unwrap()
                .description
                .ends_with("## How to test\n1. A")
        );
        good["extra"] = json!(1);
        assert!(matches!(description_of(&good), Err(ClaudeError::Schema(_))));
    }
}
