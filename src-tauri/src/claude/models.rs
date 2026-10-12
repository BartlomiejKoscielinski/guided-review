//! Models and effort levels (docs/05 › Models and effort levels, F-18.2–F-18.5) and which model
//! and effort a task runs with (F-18.3: the task group's override, "Default" = the global value).

use serde::Serialize;
use ts_rs::TS;

use crate::settings::{ClaudeSettings, Effort, TaskEffort, TaskOverride};

/// A model the user can pick.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ModelInfo {
    /// Full model ID as stored in settings.
    pub id: String,
    pub label: String,
    /// Effort levels the model supports (F-18.4).
    pub efforts: Vec<Effort>,
}

const ALL: [Effort; 5] = [
    Effort::Low,
    Effort::Medium,
    Effort::High,
    Effort::Xhigh,
    Effort::Max,
];

/// The models of docs/05, in menu order.
pub fn models() -> Vec<ModelInfo> {
    [
        ("claude-opus-5-5", "Opus 5.5"),
        ("claude-sonnet-5-5", "Sonnet 5.5"),
        ("claude-haiku-5-5", "Haiku 5.5"),
        ("claude-fable-5-1", "Fable 5.1"),
    ]
    .into_iter()
    .map(|(id, label)| ModelInfo {
        id: id.to_owned(),
        label: label.to_owned(),
        efforts: ALL.to_vec(),
    })
    .collect()
}

/// The override groups of F-18.3 (Settings › Claude › Per task).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskGroup {
    Plan,
    Step,
    Ask,
    Fix,
    Mr,
    Commit,
}

/// `--model` and `--effort` for a task; `None` omits the flag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// `None` = "Same as Claude Code" (flag omitted, ADR-022).
    pub model: Option<String>,
    pub effort: Option<Effort>,
}

fn group(settings: &ClaudeSettings, group: TaskGroup) -> &TaskOverride {
    let t = &settings.tasks;
    match group {
        TaskGroup::Plan => &t.plan,
        TaskGroup::Step => &t.step,
        TaskGroup::Ask => &t.ask,
        TaskGroup::Fix => &t.fix,
        TaskGroup::Mr => &t.mr,
        TaskGroup::Commit => &t.commit,
    }
}

/// The model and effort a task of `group` runs with (F-18.3).
pub fn resolve(settings: &ClaudeSettings, task: TaskGroup) -> Resolved {
    let o = group(settings, task);
    let model = if o.model == "default" {
        (settings.model != "inherit").then(|| settings.model.clone())
    } else {
        Some(o.model.clone())
    };
    let effort = match o.effort {
        TaskEffort::Default => settings.effort,
        TaskEffort::Low => Effort::Low,
        TaskEffort::Medium => Effort::Medium,
        TaskEffort::High => Effort::High,
        TaskEffort::Xhigh => Effort::Xhigh,
        TaskEffort::Max => Effort::Max,
    };
    Resolved {
        model,
        effort: Some(effort),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f18_3_commit_task_uses_its_override_or_defaults() {
        let mut s = ClaudeSettings::default();
        assert_eq!(
            resolve(&s, TaskGroup::Commit),
            Resolved {
                model: Some("claude-haiku-5-5".into()),
                effort: Some(Effort::Low)
            }
        );
        // "Default" follows the global model and effort; "Same as Claude Code" omits --model.
        s.tasks.commit = TaskOverride {
            model: "default".into(),
            effort: TaskEffort::Default,
        };
        assert_eq!(
            resolve(&s, TaskGroup::Commit),
            Resolved {
                model: None,
                effort: Some(Effort::Medium)
            }
        );
        s.model = "claude-sonnet-5-5".into();
        s.effort = Effort::High;
        assert_eq!(
            resolve(&s, TaskGroup::Commit),
            Resolved {
                model: Some("claude-sonnet-5-5".into()),
                effort: Some(Effort::High)
            }
        );
    }

    #[test]
    fn f18_2_models_of_docs_05() {
        let labels: Vec<_> = models().into_iter().map(|m| m.label).collect();
        assert_eq!(labels, ["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "Fable 5.1"]);
        assert!(models().iter().all(|m| m.efforts.len() == 5));
    }
}
