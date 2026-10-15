//! The inputs of the step task (`prompts/step.md`) that the plan task doesn't share: the threads
//! on the step's lines (F-09.5; rendered by `gitlab::discussions::render`), the steps it builds
//! on and the kinds of notes the reviewer dismissed (F-09.4). The step diff and the hunk index
//! are `plan_inputs::diff_text` and `plan_inputs::hunk_index`.

use std::collections::BTreeSet;

use crate::git::model::{FileDiff, LineKind};
use crate::gitlab::discussions::Thread;
use crate::review::plan_model::Plan;

/// A dismissed note (`dismissals`): not raised again for the same head (F-09.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dismissal {
    pub fingerprint: String,
    pub kind: String,
}

/// The diff threads on lines of the step's hunks (and file threads on its files), in GitLab's
/// order. Threads on the merge request itself or on other lines are left out.
pub fn threads_on_step(threads: &[Thread], step_files: &[FileDiff]) -> Vec<Thread> {
    threads
        .iter()
        .filter(|t| {
            let Some(p) = &t.position else {
                return false;
            };
            step_files.iter().any(|f| {
                let same_file = [&f.new_path, &f.old_path]
                    .into_iter()
                    .flatten()
                    .any(|path| *path == p.new_path || *path == p.old_path);
                let on_line = |l: &crate::git::model::Line| match (p.new_line, p.old_line) {
                    (Some(n), _) => l.kind != LineKind::Del && l.new_no == Some(n),
                    (None, Some(o)) => l.kind != LineKind::Add && l.old_no == Some(o),
                    (None, None) => true,
                };
                same_file && f.hunks.iter().any(|h| h.lines.iter().any(on_line))
            })
        })
        .cloned()
        .collect()
}

/// `{{builds_on_summary}}`: `step 1 "Title"; step 3 "Title"` in the reader's numbering, or "none".
pub fn builds_on_summary(plan: &Plan, step_id: &str, order: &[String]) -> String {
    let Some(step) = plan.steps.iter().find(|s| s.id == step_id) else {
        return "none".to_owned();
    };
    let parts: Vec<String> = step
        .builds_on
        .iter()
        .filter_map(|id| {
            let earlier = plan.steps.iter().find(|s| s.id == *id)?;
            let number = order.iter().position(|o| o == id)? + 1;
            Some(format!("step {number} \"{}\"", earlier.title))
        })
        .collect();
    if parts.is_empty() {
        "none".to_owned()
    } else {
        parts.join("; ")
    }
}

/// `{{dismissed_kinds}}`: the distinct kinds, sorted, or "none".
pub fn dismissed_kinds(dismissed: &[Dismissal]) -> String {
    let kinds: BTreeSet<&str> = dismissed.iter().map(|d| d.kind.as_str()).collect();
    if kinds.is_empty() {
        "none".to_owned()
    } else {
        kinds.into_iter().collect::<Vec<_>>().join(", ")
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::review::layer::Layer;
    use crate::review::plan_model::{Coverage, Orders, Step};

    fn step(id: &str, title: &str, builds_on: &[&str]) -> Step {
        Step {
            id: id.into(),
            title: title.into(),
            short_title: title.into(),
            reason: String::new(),
            description: String::new(),
            layer: Layer::App,
            hunk_ids: vec![format!("h-{id}")],
            builds_on: builds_on.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    #[test]
    fn f09_6_builds_on_in_the_readers_numbering() {
        let plan = Plan {
            intent: String::new(),
            steps: vec![
                step("s1", "Contract", &[]),
                step("s2", "ViewModel", &["s1", "s9"]),
            ],
            orders: Orders::default(),
            skim: Vec::new(),
            risks: Vec::new(),
            description_check: Vec::new(),
            already_discussed: String::new(),
            coverage: Coverage::default(),
        };
        let order = ["s2".to_owned(), "s1".to_owned()];
        assert_eq!(
            builds_on_summary(&plan, "s2", &order),
            "step 2 \"Contract\""
        );
        assert_eq!(builds_on_summary(&plan, "s1", &order), "none");
        assert_eq!(builds_on_summary(&plan, "s7", &order), "none");
    }

    #[test]
    fn f09_4_dismissed_kinds_go_into_the_prompt() {
        let d = |kind: &str| Dismissal {
            fingerprint: "f".into(),
            kind: kind.into(),
        };
        assert_eq!(dismissed_kinds(&[]), "none");
        assert_eq!(
            dismissed_kinds(&[d("null-check"), d("magic-number"), d("null-check")]),
            "magic-number, null-check"
        );
    }
}
