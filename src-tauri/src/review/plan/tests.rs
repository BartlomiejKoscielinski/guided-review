use serde_json::{Value, json};

use super::*;
use crate::error::{AppError, ErrorCode};

const HUNKS: [HunkRef; 10] = [
    HunkRef {
        id: "a1",
        file: "src/Mobile.Core/Upload/IUploadQueue.cs",
    },
    HunkRef {
        id: "a2",
        file: "src/Mobile.Core/Upload/UploadQueue.cs",
    },
    HunkRef {
        id: "a3",
        file: "src/Mobile.Core/Upload/UploadQueue.cs",
    },
    HunkRef {
        id: "a4",
        file: "src/App/ViewModels/QueueViewModel.cs",
    },
    HunkRef {
        id: "a5",
        file: "src/App/ViewModels/QueueViewModel.cs",
    },
    HunkRef {
        id: "a6",
        file: "src/App/Views/QueuePage.xaml",
    },
    HunkRef {
        id: "a7",
        file: "tests/Mobile.Core.Tests/UploadQueueTests.cs",
    },
    HunkRef {
        id: "a8",
        file: "tests/Mobile.Core.Tests/UploadQueueTests.cs",
    },
    HunkRef {
        id: "a9",
        file: "src/App/App.csproj",
    },
    HunkRef {
        id: "b1",
        file: "src/App/Strings/AppResources.resx",
    },
];

fn sample() -> Value {
    json!({
        "intent": "Uploads go through a queue instead of running inline.",
        "steps": [
            { "id": "s1", "title": "Core: upload queue", "short_title": "Queue",
              "reason": "Everything else builds on this.", "description": "The queue and its contract.",
              "layer": "Core", "hunk_ids": ["a1", "a2", "a3"], "builds_on": [] },
            { "id": "s2", "title": "ViewModel: queue instead of upload", "short_title": "ViewModel",
              "reason": "Uses the queue.", "description": "The view model enqueues.",
              "layer": "App", "hunk_ids": ["a4", "a5"], "builds_on": ["s1"] },
            { "id": "s3", "title": "Queue page", "short_title": "View",
              "reason": "Shows the queue.", "description": "Binds the list.",
              "layer": "XAML", "hunk_ids": ["a6"], "builds_on": ["s2"] },
            { "id": "s4", "title": "Queue tests", "short_title": "Tests",
              "reason": "Pins the behaviour.", "description": "Retry and order.",
              "layer": "Tests", "hunk_ids": ["a7", "a8"], "builds_on": ["s1"] }
        ],
        "orders": { "contract_to_ui": ["s1", "s2", "s3", "s4"], "tests_first": ["s4", "s1", "s2", "s3"] },
        "skim": [ { "hunk_ids": ["a9", "b1"], "reason": "Package bump and a new string." } ],
        "risks": [ { "text": "Retry can upload twice.", "severity": "fix", "steps": ["s1"] },
                   { "text": "Is the queue drained on logout?", "severity": "q", "steps": [] } ],
        "description_check": [
            { "claim": "Adds an upload queue.", "status": "found", "step": "s1" },
            { "claim": "Removes the old uploader.", "status": "missing" },
            { "claim": "Changes the retry count.", "status": "not_in_description", "step": "s1" }
        ],
        "already_discussed": "One open thread about naming."
    })
}

fn err(value: &Value, hunks: &[HunkRef]) -> AppError {
    AppError::from(validate(Some(value), hunks).unwrap_err())
}

fn assert_schema(value: &Value) {
    let e = err(value, &HUNKS);
    assert_eq!(e.code, ErrorCode::ClaudeSchema, "{:?}", e.detail);
}

#[test]
fn f06_3_valid_plan_becomes_a_plan_with_full_coverage() {
    let plan = validate(Some(&sample()), &HUNKS).unwrap();
    assert_eq!(plan.steps.len(), 4);
    assert_eq!(plan.steps[2].layer, Layer::Xaml);
    assert_eq!(plan.steps[1].builds_on, ["s1"]);
    assert_eq!(plan.orders.tests_first, ["s4", "s1", "s2", "s3"]);
    assert_eq!(plan.risks[0].severity, RiskSeverity::Fix);
    assert!(!plan.risks[0].app);
    assert_eq!(plan.description_check[1].step, None);
    assert_eq!(
        plan.description_check[2].status,
        ClaimStatus::NotInDescription
    );
    let full = Coverage {
        files: 7,
        files_total: 7,
        hunks: 10,
        hunks_total: 10,
    };
    assert_eq!(plan.coverage, full);
}

#[test]
fn f06_3_missing_output_or_wrong_shape_is_claude_schema() {
    let e = AppError::from(validate(None, &HUNKS).unwrap_err());
    assert_eq!(e.code, ErrorCode::ClaudeSchema);
    let mut v = sample();
    v["steps"][0]["hunk_ids"] = json!("a1");
    assert_schema(&v);
    let mut v = sample();
    v["extra"] = json!(1);
    assert_schema(&v);
    let mut v = sample();
    v["steps"][1]["layer"] = json!("ViewModels");
    assert_schema(&v);
    let mut v = sample();
    v["risks"][0]["severity"] = json!("nit");
    assert_schema(&v);
    let mut v = sample();
    v["description_check"][0]["status"] = json!("maybe");
    assert_schema(&v);
}

#[test]
fn f06_3_schema_limits_are_enforced() {
    let mut v = sample();
    v["steps"] = json!([]);
    assert_schema(&v);
    let mut v = sample();
    v["steps"][3]["hunk_ids"] = json!([]);
    assert_schema(&v);
    let mut v = sample();
    v["skim"][0]["hunk_ids"] = json!([]);
    assert_schema(&v);
    let mut v = sample();
    let risk = v["risks"][0].clone();
    v["risks"] = json!(vec![risk; 7]);
    assert_schema(&v);
    let mut v = sample();
    v["steps"][1]["id"] = json!("s1");
    assert_schema(&v);
    let mut v = sample();
    v["steps"][1]["id"] = json!("step2");
    assert_schema(&v);
}

#[test]
fn f06_3_unknown_step_ids_are_claude_schema() {
    for pointer in [
        "/steps/1/builds_on/0",
        "/orders/contract_to_ui/0",
        "/orders/tests_first/2",
        "/risks/0/steps/0",
        "/description_check/0/step",
    ] {
        let mut v = sample();
        *v.pointer_mut(pointer).unwrap() = json!("s9");
        assert_schema(&v);
    }
}

#[test]
fn f06_3_unknown_hunk_ids_are_claude_schema() {
    let mut v = sample();
    v["steps"][0]["hunk_ids"][0] = json!("zz");
    assert_schema(&v);
    let mut v = sample();
    v["skim"][0]["hunk_ids"][1] = json!("zz");
    assert_schema(&v);
}

#[test]
fn f06_3_fewer_than_90_percent_of_hunks_is_claude_schema() {
    // 9 of 10 referenced: allowed, the tenth goes to the "Other" step.
    let mut v = sample();
    v["skim"][0]["hunk_ids"] = json!(["a9"]);
    let plan = validate(Some(&v), &HUNKS).unwrap();
    let other = plan.steps.last().unwrap();
    assert_eq!((other.id.as_str(), other.title.as_str()), ("s5", "Other"));
    assert_eq!(other.hunk_ids, ["b1"]);
    assert_eq!(plan.orders.contract_to_ui.last().unwrap(), "s5");
    // 8 of 10: rejected.
    v["steps"][3]["hunk_ids"] = json!(["a7"]);
    let e = err(&v, &HUNKS);
    assert_eq!(e.code, ErrorCode::ClaudeSchema);
    assert!(e.detail.unwrap().contains("8 of 10"));
}

#[test]
fn f06_3_long_strings_are_clamped_with_an_ellipsis() {
    let mut v = sample();
    v["steps"][0]["title"] = json!("Ż".repeat(80));
    v["steps"][0]["short_title"] = json!("x".repeat(30));
    v["intent"] = json!("i".repeat(700));
    v["risks"][0]["text"] = json!("r ".repeat(150));
    let plan = validate(Some(&v), &HUNKS).unwrap();
    let title = &plan.steps[0].title;
    assert_eq!(title.chars().count(), 60);
    assert!(title.ends_with('…'));
    assert_eq!(plan.steps[0].short_title.chars().count(), 24);
    assert_eq!(plan.intent.chars().count(), 600);
    assert!(plan.risks[0].text.chars().count() <= 200);
    assert!(plan.risks[0].text.ends_with("r…"));
}

#[test]
fn f06_3_duplicate_orders_and_hunks_are_normalized() {
    let mut v = sample();
    v["orders"]["contract_to_ui"] = json!(["s2", "s2", "s1"]);
    v["steps"][1]["hunk_ids"] = json!(["a4", "a5", "a1"]);
    let plan = validate(Some(&v), &HUNKS).unwrap();
    assert_eq!(plan.orders.contract_to_ui, ["s2", "s1", "s3", "s4"]);
    assert_eq!(plan.steps[1].hunk_ids, ["a4", "a5"]);
    assert!(coverage::holds(&plan, &HUNKS));
}

#[test]
fn f06_3_details_never_quote_claude_text() {
    let mut v = sample();
    v["steps"][0]["hunk_ids"][0] = json!("secret-looking value");
    let detail = err(&v, &HUNKS).detail.unwrap_or_default();
    assert!(!detail.contains("secret"));
}
