//! Step order per strategy (F-06.4): Contract to UI and Tests first come from Claude's
//! `orders`, File order is computed (GitLab's diff path order). No Claude call.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use super::coverage::HunkRef;
use super::model::Strategy;
use super::plan_model::{Plan, Step};

/// The step IDs in the order of `strategy`; every step exactly once.
pub fn step_order(plan: &Plan, strategy: Strategy, hunks: &[HunkRef]) -> Vec<String> {
    let mut order = match strategy {
        Strategy::ContractToUi => plan.orders.contract_to_ui.clone(),
        Strategy::TestsFirst => plan.orders.tests_first.clone(),
        Strategy::FileOrder => return file_order(&plan.steps, hunks),
    };
    complete_order(&mut order, &plan.steps);
    order
}

/// Keeps known step IDs once, in their order, and appends the missing ones in plan order.
pub fn complete_order(order: &mut Vec<String>, steps: &[Step]) {
    let known: HashSet<&str> = steps.iter().map(|s| s.id.as_str()).collect();
    let mut seen: HashSet<String> = HashSet::new();
    order.retain(|id| known.contains(id.as_str()) && seen.insert(id.clone()));
    order.extend(
        steps
            .iter()
            .filter(|s| !seen.contains(&s.id))
            .map(|s| s.id.clone()),
    );
}

/// GitLab's diff order (`Gitlab::Diff::FileCollectionSorter`, 17.11): segment by segment,
/// byte-wise and case-sensitive, a directory before a file at the same depth; `\` counts as `/`.
fn gitlab_path_cmp(a: &str, b: &str) -> Ordering {
    let a: Vec<&str> = a.split(['/', '\\']).collect();
    let b: Vec<&str> = b.split(['/', '\\']).collect();
    for (i, (x, y)) in a.iter().zip(&b).enumerate() {
        let (a_file, b_file) = (i + 1 == a.len(), i + 1 == b.len());
        if a_file != b_file {
            return if a_file {
                Ordering::Greater
            } else {
                Ordering::Less
            };
        }
        match x.cmp(y) {
            Ordering::Equal => {}
            other => return other,
        }
    }
    a.len().cmp(&b.len())
}

/// By each step's first file in GitLab's diff order; steps without known files go last, ties
/// keep plan order.
fn file_order(steps: &[Step], hunks: &[HunkRef]) -> Vec<String> {
    let file_of: HashMap<&str, &str> = hunks.iter().map(|h| (h.id, h.file)).collect();
    let mut keyed: Vec<(Option<&str>, &str)> = steps
        .iter()
        .map(|s| {
            let first = s
                .hunk_ids
                .iter()
                .filter_map(|id| file_of.get(id.as_str()).copied())
                .min_by(|a, b| gitlab_path_cmp(a, b));
            (first, s.id.as_str())
        })
        .collect();
    keyed.sort_by(|a, b| match (a.0, b.0) {
        (Some(x), Some(y)) => gitlab_path_cmp(x, y),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    });
    keyed.into_iter().map(|(_, id)| id.to_owned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::layer::Layer;
    use crate::review::plan_model::{Coverage, Orders};

    fn step(id: &str, layer: Layer, hunk_ids: &[&str]) -> Step {
        Step {
            id: id.into(),
            title: id.into(),
            short_title: id.into(),
            reason: String::new(),
            description: String::new(),
            layer,
            hunk_ids: hunk_ids.iter().map(|&h| h.into()).collect(),
            builds_on: Vec::new(),
        }
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|&s| s.into()).collect()
    }

    fn plan(steps: Vec<Step>, contract: &[&str], tests: &[&str]) -> Plan {
        Plan {
            intent: String::new(),
            steps,
            orders: Orders {
                contract_to_ui: ids(contract),
                tests_first: ids(tests),
            },
            skim: Vec::new(),
            risks: Vec::new(),
            description_check: Vec::new(),
            already_discussed: String::new(),
            coverage: Coverage::default(),
        }
    }

    const HUNKS: [HunkRef; 6] = [
        HunkRef {
            id: "h1",
            file: "src/App/Views/QueuePage.xaml",
        },
        HunkRef {
            id: "h2",
            file: "src/Mobile.Core/Upload/IUploadQueue.cs",
        },
        HunkRef {
            id: "h3",
            file: "tests/Mobile.Core.Tests/UploadQueueTests.cs",
        },
        HunkRef {
            id: "h4",
            file: "src/App/ViewModels/QueueViewModel.cs",
        },
        HunkRef {
            id: "h5",
            file: "src\\App\\ViewModels\\AuthViewModel.cs",
        },
        HunkRef {
            id: "h6",
            file: "src/Mobile.Core/Upload/UploadQueue.cs",
        },
    ];

    fn sample() -> Plan {
        plan(
            vec![
                step("s1", Layer::Xaml, &["h1"]),
                step("s2", Layer::Core, &["h6", "h2"]),
                step("s3", Layer::Tests, &["h3"]),
                step("s4", Layer::App, &["h4"]),
                step("s5", Layer::App, &["h5"]),
            ],
            &["s2", "s4", "s5", "s1", "s3"],
            &["s3", "s2", "s4", "s5", "s1"],
        )
    }

    #[test]
    fn f06_4_contract_to_ui_and_tests_first_follow_claude() {
        let p = sample();
        assert_eq!(
            step_order(&p, Strategy::ContractToUi, &HUNKS),
            ids(&["s2", "s4", "s5", "s1", "s3"])
        );
        assert_eq!(
            step_order(&p, Strategy::TestsFirst, &HUNKS),
            ids(&["s3", "s2", "s4", "s5", "s1"])
        );
    }

    #[test]
    fn f06_4_file_order_is_gitlab_path_order_ignoring_layers() {
        // src/App: AuthViewModel (s5), QueueViewModel (s4), Views (s1); src/Mobile.Core; tests.
        assert_eq!(
            step_order(&sample(), Strategy::FileOrder, &HUNKS),
            ids(&["s5", "s4", "s1", "s2", "s3"])
        );
    }

    #[test]
    fn f06_4_gitlab_path_order_puts_directories_first_and_is_case_sensitive() {
        let mut paths = vec![
            "src/App/app.json",
            "README.md",
            "src/App/MauiProgram.cs",
            "src/App/Views/Page.xaml",
            "src/App/Platforms/Android/AndroidManifest.xml",
        ];
        paths.sort_by(|a, b| gitlab_path_cmp(a, b));
        assert_eq!(
            paths,
            [
                "src/App/Platforms/Android/AndroidManifest.xml",
                "src/App/Views/Page.xaml",
                "src/App/MauiProgram.cs",
                "src/App/app.json",
                "README.md",
            ]
        );
    }

    #[test]
    fn f06_4_file_order_puts_steps_without_known_files_last() {
        let p = plan(
            vec![
                step("s1", Layer::Other, &["unknown"]),
                step("s2", Layer::Core, &["h2"]),
            ],
            &[],
            &[],
        );
        assert_eq!(
            step_order(&p, Strategy::FileOrder, &HUNKS),
            ids(&["s2", "s1"])
        );
    }

    #[test]
    fn f06_4_file_order_ties_keep_plan_order() {
        let p = plan(
            vec![
                step("s1", Layer::Other, &["x"]),
                step("s2", Layer::Other, &["y"]),
            ],
            &[],
            &[],
        );
        assert_eq!(step_order(&p, Strategy::FileOrder, &[]), ids(&["s1", "s2"]));
    }

    #[test]
    fn f06_4_orders_drop_unknown_and_duplicate_ids_and_append_missing() {
        let p = plan(
            vec![
                step("s1", Layer::Core, &["h2"]),
                step("s2", Layer::App, &["h4"]),
                step("s3", Layer::Tests, &["h3"]),
            ],
            &["s3", "s9", "s3", "s1"],
            &[],
        );
        assert_eq!(
            step_order(&p, Strategy::ContractToUi, &HUNKS),
            ids(&["s3", "s1", "s2"])
        );
        assert_eq!(
            step_order(&p, Strategy::TestsFirst, &HUNKS),
            ids(&["s1", "s2", "s3"])
        );
    }

    #[test]
    fn f06_4_strategies_serialize_as_stored() {
        assert_eq!(
            serde_json::to_value(Strategy::ContractToUi).unwrap(),
            "contractToUi"
        );
        assert_eq!(
            serde_json::to_value(Strategy::FileOrder).unwrap(),
            "fileOrder"
        );
    }
}
