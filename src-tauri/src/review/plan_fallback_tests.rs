use super::*;
use crate::git::model::{FileStatus, Hunk};
use crate::review::layer::layer_of;
use crate::review::plan_model::RiskSeverity;

fn hunk(id: &str) -> Hunk {
    Hunk {
        id: id.into(),
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        header: String::new(),
        lines: Vec::new(),
        file_level: false,
        staged_differs: false,
        mechanical: None,
    }
}

fn file(path: &str, ids: &[&str]) -> FileDiff {
    FileDiff {
        old_path: Some(path.into()),
        new_path: Some(path.into()),
        status: FileStatus::Modified,
        binary: false,
        mode_change: None,
        additions: 0,
        deletions: 0,
        layer: layer_of(path),
        hunks: ids.iter().map(|id| hunk(id)).collect(),
        line_staging: true,
    }
}

fn thread(id: &str, resolvable: bool, resolved: bool) -> Thread {
    Thread {
        id: id.into(),
        resolvable,
        resolved,
        position: None,
        notes: Vec::new(),
        outdated: false,
        placed_line: None,
    }
}

fn mr_files() -> Vec<FileDiff> {
    vec![
        file("src/App/ViewModels/Upload ViewModel.cs", &["a1", "a2"]),
        file("tests/Mobile.Core.Tests/UploadQueueTests.cs", &["t1"]),
        file("src/Mobile.Core/IUploadQueue.cs", &["c1"]),
        file("src/App/Views/Zażółć.xaml", &["x1"]),
        file("src/App/MauiProgram.cs", &["a3"]),
        file("src/Mobile.Core/Upload/Queue.cs", &["c2"]),
    ]
}

#[test]
fn f06_4_fallback_one_step_per_layer_group_in_gitlab_file_order() {
    let plan = plan(&mr_files(), &[]);
    let rows: Vec<(&str, &str, &str, Vec<&str>)> = plan
        .steps
        .iter()
        .map(|s| {
            (
                s.id.as_str(),
                s.title.as_str(),
                s.reason.as_str(),
                s.hunk_ids.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    // GitLab order: src/App/ViewModels/…, src/App/Views/…, src/App/MauiProgram.cs,
    // src/Mobile.Core/Upload/Queue.cs, src/Mobile.Core/IUploadQueue.cs, tests/….
    assert_eq!(
        rows,
        [
            (
                "f1",
                "App",
                "Upload ViewModel.cs, MauiProgram.cs",
                vec!["a1", "a2", "a3"]
            ),
            ("f2", "XAML", "Zażółć.xaml", vec!["x1"]),
            ("f3", "Core", "Queue.cs, IUploadQueue.cs", vec!["c2", "c1"]),
            ("f4", "Tests", "UploadQueueTests.cs", vec!["t1"]),
        ]
    );
    assert_eq!(plan.orders.contract_to_ui, ["f1", "f2", "f3", "f4"]);
    assert_eq!(plan.orders.tests_first, plan.orders.contract_to_ui);
    assert!(plan.intent.is_empty());
    assert!(plan.skim.is_empty());
    assert!(plan.description_check.is_empty());
    assert!(plan.steps.iter().all(|s| s.builds_on.is_empty()));
}

#[test]
fn f06_4_fallback_coverage_invariant_holds() {
    let files = mr_files();
    let plan = plan(&files, &[]);
    let hunks = coverage::hunk_refs(&files);
    assert!(coverage::holds(&plan, &hunks));
    assert_eq!(plan.coverage.files, 6);
    assert_eq!(plan.coverage.files_total, 6);
    assert_eq!(plan.coverage.hunks, 7);
    assert_eq!(plan.coverage.hunks_total, 7);
}

#[test]
fn f06_9_fallback_counts_open_threads_only() {
    let threads = [
        thread("d1", true, false),
        thread("d2", true, true),
        thread("d3", false, false),
        thread("d4", true, false),
    ];
    assert_eq!(
        plan(&mr_files(), &threads).already_discussed,
        "2 open threads."
    );
    assert_eq!(plan(&mr_files(), &threads[1..3]).already_discussed, "");
    assert_eq!(plan(&mr_files(), &[]).already_discussed, "");
}

#[test]
fn f06_13_fallback_keeps_config_risk() {
    let mut files = mr_files();
    files.push(file("CLAUDE.md", &["o1"]));
    files.push(file(".claude/settings.json", &["o2"]));
    let plan = plan(&files, &[]);
    assert_eq!(plan.risks.len(), 1);
    let risk = &plan.risks[0];
    assert!(risk.app);
    assert_eq!(risk.severity, RiskSeverity::Fix);
    assert_eq!(
        risk.text,
        "This MR changes review or Claude configuration: CLAUDE.md, .claude/settings.json"
    );
    let other = plan.steps.iter().find(|s| s.title == "Other").unwrap();
    assert_eq!(other.hunk_ids, ["o2", "o1"]);
    assert_eq!(risk.steps, std::slice::from_ref(&other.id));
    assert!(super::plan(&mr_files(), &[]).risks.is_empty());
}

#[test]
fn f06_4_fallback_of_an_empty_change_has_no_steps() {
    let plan = plan(&[], &[]);
    assert!(plan.steps.is_empty());
    assert!(plan.orders.contract_to_ui.is_empty());
}
