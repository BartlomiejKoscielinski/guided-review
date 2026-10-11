//! Claude settings (F-18.2, F-18.3, F-18.6) with full model IDs as in docs/05 › Models.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

const INHERIT: &str = "inherit";
const DEFAULT_MODEL: &str = "default";
const OPUS: &str = "claude-opus-5-5";
const SONNET: &str = "claude-sonnet-5-5";
const HAIKU: &str = "claude-haiku-5-5";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ClaudeSettings {
    /// Executable chosen in Settings; `null` = discovered (ADR-021, F-18.6).
    pub path: Option<String>,
    /// "Run at most N Claude tasks at once", 1–4 (F-18.6).
    pub max_concurrent: u8,
    /// "inherit" (Same as Claude Code) or a full model ID such as "claude-sonnet-5-5" (F-18.2).
    pub model: String,
    pub effort: Effort,
    /// "Writes in" (F-18.2).
    pub lang: Lang,
    pub tasks: ClaudeTasks,
}

impl Default for ClaudeSettings {
    fn default() -> Self {
        Self {
            path: None,
            max_concurrent: 2,
            model: INHERIT.to_owned(),
            effort: Effort::Medium,
            lang: Lang::En,
            tasks: ClaudeTasks::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

/// A task group's effort: "default" follows `claude.effort`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TaskEffort {
    Default,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Lang {
    En,
    Pl,
}

/// Per-task overrides (F-18.3), keyed like the Settings mock: plan, step, ask, fix, mr, commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ClaudeTasks {
    pub plan: TaskOverride,
    pub step: TaskOverride,
    pub ask: TaskOverride,
    pub fix: TaskOverride,
    pub mr: TaskOverride,
    pub commit: TaskOverride,
}

impl Default for ClaudeTasks {
    fn default() -> Self {
        Self {
            plan: TaskOverride::new(OPUS, TaskEffort::High),
            step: TaskOverride::new(SONNET, TaskEffort::Medium),
            ask: TaskOverride::new(DEFAULT_MODEL, TaskEffort::Low),
            fix: TaskOverride::new(SONNET, TaskEffort::Medium),
            mr: TaskOverride::new(SONNET, TaskEffort::Low),
            commit: TaskOverride::new(HAIKU, TaskEffort::Low),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskOverride {
    /// "default" (the global model) or a full model ID.
    pub model: String,
    pub effort: TaskEffort,
}

impl TaskOverride {
    fn new(model: &str, effort: TaskEffort) -> Self {
        Self {
            model: model.to_owned(),
            effort,
        }
    }
}

impl ClaudeSettings {
    /// "inherit" or a model ID globally; "default" or a model ID per task group.
    pub(super) fn models_are_valid(&self) -> bool {
        let t = &self.tasks;
        (self.model == INHERIT || is_model_id(&self.model))
            && [&t.plan, &t.step, &t.ask, &t.fix, &t.mr, &t.commit]
                .iter()
                .all(|task| task.model == DEFAULT_MODEL || is_model_id(&task.model))
    }
}

/// Full model IDs as stored in settings, e.g. "claude-opus-5-5".
fn is_model_id(model: &str) -> bool {
    model.strip_prefix("claude-").is_some_and(|rest| {
        !rest.is_empty()
            && rest
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_defaults_follow_f18_3() {
        let t = ClaudeTasks::default();
        let pairs = [
            (&t.plan, "claude-opus-5-5", TaskEffort::High),
            (&t.step, "claude-sonnet-5-5", TaskEffort::Medium),
            (&t.ask, "default", TaskEffort::Low),
            (&t.fix, "claude-sonnet-5-5", TaskEffort::Medium),
            (&t.mr, "claude-sonnet-5-5", TaskEffort::Low),
            (&t.commit, "claude-haiku-5-5", TaskEffort::Low),
        ];
        for (task, model, effort) in pairs {
            assert_eq!((task.model.as_str(), task.effort), (model, effort));
        }
    }

    #[test]
    fn model_ids() {
        assert!(is_model_id("claude-fable-5-1"));
        assert!(!is_model_id("claude-"));
        assert!(!is_model_id("claude-Opus"));
        assert!(!is_model_id("gpt-5"));
    }
}
