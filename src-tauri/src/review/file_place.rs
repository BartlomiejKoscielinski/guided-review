//! Where a file sits in the review (F-08.7 Analysis context, M4 decision 8): the step that shows
//! it in the reader's order, the skim list, or outside the change.

use serde::Serialize;
use ts_rs::TS;

use super::coverage::HunkRef;
use super::plan_model::Plan;

/// A file's place for the step being read. S-04 shows it after the file Claude read: "step N",
/// "skim", "outside MR" ("outside the change" in a self-review).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", content = "number", rename_all = "camelCase")]
#[ts(export)]
pub enum FilePlace {
    /// N in the reader's order: the current step when its hunks touch the file, otherwise the
    /// first step in the order that touches it.
    Step(u32),
    /// Only skim hunks touch the file.
    Skim,
    /// The file is not in the diff.
    Outside,
}

/// A diff file with its place for one step (`StepView.places`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlacedFile {
    /// The path as the diff names it (new path, or old path of a deleted file).
    pub file: String,
    pub place: FilePlace,
}

/// The place of `file` while the reader is on step `current` of `order` (step ids in the
/// reader's order). Paths match whole, as the diff names them.
pub fn place(
    plan: &Plan,
    hunks: &[HunkRef<'_>],
    order: &[String],
    current: &str,
    file: &str,
) -> FilePlace {
    let ids: Vec<&str> = hunks
        .iter()
        .filter(|h| h.file == file)
        .map(|h| h.id)
        .collect();
    if ids.is_empty() {
        return FilePlace::Outside;
    }
    let touches = |step_id: &str| {
        plan.steps
            .iter()
            .find(|s| s.id == step_id)
            .is_some_and(|s| s.hunk_ids.iter().any(|h| ids.contains(&h.as_str())))
    };
    let number = |index: usize| FilePlace::Step(u32::try_from(index + 1).unwrap_or(u32::MAX));
    if let Some(index) = order.iter().position(|id| id == current)
        && touches(current)
    {
        return number(index);
    }
    if let Some(index) = order.iter().position(|id| touches(id)) {
        return number(index);
    }
    let in_skim = plan
        .skim
        .iter()
        .any(|g| g.hunk_ids.iter().any(|h| ids.contains(&h.as_str())));
    if in_skim {
        FilePlace::Skim
    } else {
        // The coverage invariant puts every hunk in a step or a skim group; a file whose hunks
        // are in neither is shown as not part of the review rather than given a made-up step.
        FilePlace::Outside
    }
}

/// Every file of the diff with its place for step `current` (`hunks` in diff order, each file
/// once).
pub fn places(
    plan: &Plan,
    hunks: &[HunkRef<'_>],
    order: &[String],
    current: &str,
) -> Vec<PlacedFile> {
    let mut files: Vec<&str> = Vec::new();
    for h in hunks {
        if !files.contains(&h.file) {
            files.push(h.file);
        }
    }
    files
        .into_iter()
        .map(|file| PlacedFile {
            file: file.to_owned(),
            place: place(plan, hunks, order, current, file),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::layer::Layer;
    use crate::review::plan_model::{Coverage, Orders, SkimGroup, Step};

    fn step(id: &str, hunk_ids: &[&str]) -> Step {
        Step {
            id: id.into(),
            title: id.into(),
            short_title: id.into(),
            reason: String::new(),
            description: String::new(),
            layer: Layer::App,
            hunk_ids: hunk_ids.iter().map(|&h| h.into()).collect(),
            builds_on: Vec::new(),
        }
    }

    #[test]
    fn f08_7_places_lists_each_diff_file_once_in_diff_order_for_the_current_step() {
        let plan = Plan {
            intent: String::new(),
            steps: vec![step("s1", &["h1"]), step("s2", &["h2", "h3"])],
            orders: Orders::default(),
            skim: vec![SkimGroup {
                hunk_ids: vec!["h4".into()],
                reason: String::new(),
            }],
            risks: Vec::new(),
            description_check: Vec::new(),
            already_discussed: String::new(),
            coverage: Coverage::default(),
        };
        let hunks = [
            HunkRef {
                id: "h1",
                file: "b.cs",
            },
            HunkRef {
                id: "h2",
                file: "b.cs",
            },
            HunkRef {
                id: "h3",
                file: "a.cs",
            },
            HunkRef {
                id: "h4",
                file: "c.resx",
            },
        ];
        let order = vec!["s2".to_owned(), "s1".to_owned()];
        let placed = |file: &str, place| PlacedFile {
            file: file.into(),
            place,
        };
        assert_eq!(
            places(&plan, &hunks, &order, "s1"),
            vec![
                placed("b.cs", FilePlace::Step(2)),
                placed("a.cs", FilePlace::Step(1)),
                placed("c.resx", FilePlace::Skim),
            ]
        );
        assert_eq!(
            places(&plan, &hunks, &order, "s2")[0],
            placed("b.cs", FilePlace::Step(1))
        );
    }

    #[test]
    fn f08_7_a_place_serializes_as_kind_and_number() {
        let json = |p: FilePlace| serde_json::to_string(&p).unwrap_or_default();
        assert_eq!(json(FilePlace::Step(3)), r#"{"kind":"step","number":3}"#);
        assert_eq!(json(FilePlace::Skim), r#"{"kind":"skim"}"#);
        assert_eq!(json(FilePlace::Outside), r#"{"kind":"outside"}"#);
    }
}
