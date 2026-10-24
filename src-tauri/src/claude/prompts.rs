//! Prompt templates and JSON Schemas (docs/claude/), copied to `src-tauri/resources/` and
//! compiled in. `{{name}}` placeholders are filled here; lists are rendered to text by the
//! caller. Every change to a prompt or schema bumps `PROMPT_VERSION` (part of the cache key).

use crate::settings::Lang;

/// Version of the prompts and schemas below.
pub const PROMPT_VERSION: u32 = 3;

pub const SYSTEM_COMMON: &str = include_str!("../../resources/prompts/system-common.md");
pub const COMMIT_MESSAGE: &str = include_str!("../../resources/prompts/commit-message.md");
pub const COMMIT_MESSAGE_SCHEMA: &str =
    include_str!("../../resources/schemas/commit-message.schema.json");
pub const PLAN: &str = include_str!("../../resources/prompts/plan.md");
pub const PLAN_SCHEMA: &str = include_str!("../../resources/schemas/plan.schema.json");
pub const ASK: &str = include_str!("../../resources/prompts/ask.md");
pub const STEP: &str = include_str!("../../resources/prompts/step.md");
pub const STEP_SCHEMA: &str = include_str!("../../resources/schemas/step-findings.schema.json");
pub const SUMMARY_COMMENT: &str = include_str!("../../resources/prompts/summary-comment.md");
pub const SUMMARY_COMMENT_SCHEMA: &str =
    include_str!("../../resources/schemas/summary-comment.schema.json");
pub const THREAD_CHECK: &str = include_str!("../../resources/prompts/thread-check.md");
pub const THREAD_CHECK_SCHEMA: &str =
    include_str!("../../resources/schemas/thread-check.schema.json");
pub const FIX: &str = include_str!("../../resources/prompts/fix.md");
pub const FIX_SCHEMA: &str = include_str!("../../resources/schemas/fix-result.schema.json");
pub const PIPELINE_EXPLAIN: &str = include_str!("../../resources/prompts/pipeline-explain.md");
pub const PIPELINE_EXPLAIN_SCHEMA: &str =
    include_str!("../../resources/schemas/pipeline-explain.schema.json");
pub const MR_DESCRIPTION: &str = include_str!("../../resources/prompts/mr-description.md");
pub const MR_DESCRIPTION_SCHEMA: &str =
    include_str!("../../resources/schemas/mr-description.schema.json");
pub const REPLY_DRAFT: &str = include_str!("../../resources/prompts/reply-draft.md");
pub const REPLY_DRAFT_SCHEMA: &str =
    include_str!("../../resources/schemas/reply-draft.schema.json");

/// Fills `{{name}}` placeholders; unknown placeholders stay as they are.
pub fn render(template: &str, values: &[(&str, &str)]) -> String {
    values
        .iter()
        .fold(template.to_owned(), |text, (name, value)| {
            text.replace(&format!("{{{{{name}}}}}"), value)
        })
}

/// The language Claude writes human-readable text in (F-18.2, F-30.5).
pub fn output_language(lang: Lang) -> &'static str {
    match lang {
        Lang::En => "English",
        Lang::Pl => "Polish",
    }
}

/// `system-common.md` for a task.
pub fn system_common(lang: Lang) -> String {
    render(SYSTEM_COMMON, &[("output_language", output_language(lang))])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f30_5_output_language_follows_writes_in() {
        let pl = system_common(Lang::Pl);
        assert!(pl.contains("Write human-readable text in Polish."));
        assert!(!pl.contains("{{output_language}}"));
        assert!(system_common(Lang::En).contains("in English."));
    }

    #[test]
    fn renders_placeholders() {
        assert_eq!(
            render("a {{x}} b {{y}} {{z}}", &[("x", "1"), ("y", "ż")]),
            "a 1 b ż {{z}}"
        );
    }

    #[test]
    fn schemas_are_json() {
        let schema: serde_json::Value = serde_json::from_str(COMMIT_MESSAGE_SCHEMA).unwrap();
        assert_eq!(schema["properties"]["summary"]["maxLength"], 72);
        let plan: serde_json::Value = serde_json::from_str(PLAN_SCHEMA).unwrap();
        assert_eq!(plan["title"], "ReviewPlan");
    }

    /// The compiled-in copies must equal docs/claude (the spec).
    #[test]
    fn resources_match_docs() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        for dir in ["prompts", "schemas"] {
            let docs = root.join("..").join("docs").join("claude").join(dir);
            for entry in std::fs::read_dir(&docs).unwrap() {
                let path = entry.unwrap().path();
                let copy = root
                    .join("resources")
                    .join(dir)
                    .join(path.file_name().unwrap());
                assert_eq!(
                    std::fs::read_to_string(&path)
                        .unwrap()
                        .replace("\r\n", "\n"),
                    std::fs::read_to_string(&copy)
                        .unwrap_or_default()
                        .replace("\r\n", "\n"),
                    "{} differs from docs/claude",
                    copy.display()
                );
            }
        }
    }
}
