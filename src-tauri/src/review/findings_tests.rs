#![allow(clippy::unwrap_used, reason = "tests")]
use super::*;
use crate::git::diff::{parse_patches, to_model};
use serde_json::json;
use std::collections::HashMap;

/// Two files in the step and one outside it; synthetic content (ADR-019).
const PATCH: &str = "\
diff --git a/src/Core/Uploader.cs b/src/Core/Uploader.cs
index 1111111..2222222 100644
--- a/src/Core/Uploader.cs
+++ b/src/Core/Uploader.cs
@@ -10,4 +10,5 @@ class Uploader
 public async Task Up() {
-    await Send();
+    var r = await client.SendAsync(req);
+    cache[key] = r;
     Log();
 }
diff --git a/src/App/Zażółć/Upload ViewModel.cs b/src/App/Zażółć/Upload ViewModel.cs
index 3333333..4444444 100644
--- a/src/App/Zażółć/Upload ViewModel.cs
+++ b/src/App/Zażółć/Upload ViewModel.cs
@@ -1,3 +1,3 @@
 class Vm {
-    void Up() { Send(); }
+    void Up() { queue.Enqueue(); }
 }
diff --git a/src/Other.cs b/src/Other.cs
index 5555555..6666666 100644
--- a/src/Other.cs
+++ b/src/Other.cs
@@ -1 +1 @@
-a
+b
";

const UPLOADER: &str = "src/Core/Uploader.cs";
const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";

fn files() -> Vec<FileDiff> {
    parse_patches(PATCH)
        .unwrap()
        .iter()
        .map(|p| to_model(p, true))
        .collect()
}

fn root() -> std::path::PathBuf {
    std::env::temp_dir().join("Zażółć worktree")
}

fn finding(file: &str, side: &str, line: u32) -> Value {
    json!({
        "severity": "fix", "kind": "unhandled-cancellation", "title": "SendAsync ignores cancellation",
        "body": "The token isn't passed.", "file": file, "side": side, "line": line,
        "evidence": [{ "file": file, "line": line, "note": "the call" },
                     { "file": "src/Core/IClient.cs", "line": 12, "note": "the overload" }],
        "suggested_comment": "Should this pass the cancellation token?"
    })
}

fn output() -> Value {
    json!({
        "findings": [finding(VM, "new", 2), finding(UPLOADER, "new", 11)],
        "checklist": ["Is the retry copy right?"],
        "files_read": [{ "file": "src/Core/IClient.cs", "why": "the overload" }],
        "folds": [{ "file": UPLOADER, "new_start": 11, "new_end": 12, "title": "Fields", "reason": "Assignments." }]
    })
}

fn check(output: &Value, dismissed: &HashSet<String>) -> Result<StepAnalysis, ClaudeError> {
    let files = files();
    let ids: Vec<String> = files[..2].iter().map(|f| f.hunks[0].id.clone()).collect();
    let scope = StepScope::new("s2", &files, &ids);
    let lines: HashMap<&str, usize> = [(UPLOADER, 40), (VM, 3), ("src/Core/IClient.cs", 12)].into();
    let root = root();
    validate(
        Some(output),
        &scope,
        dismissed,
        |p| relative(&root, p),
        |rel| lines.get(rel).copied(),
    )
}

#[test]
fn f09_1_a_valid_result_keeps_every_field_in_diff_order() {
    let analysis = check(&output(), &HashSet::new()).unwrap();
    assert_eq!(analysis.step_id, "s2");
    let f = &analysis.findings;
    // Claude listed the ViewModel first; the step's diff order puts the Uploader first.
    assert_eq!((f[0].file.as_str(), f[0].line), (UPLOADER, 11));
    assert_eq!((f[1].file.as_str(), f[1].line), (VM, 2));
    assert_eq!(f[0].severity, Severity::Fix);
    assert_eq!(f[0].side, Side::New);
    assert_eq!(f[0].decision, Decision::Open);
    assert_eq!(f[0].evidence.len(), 2);
    assert_eq!(f[0].evidence[1].file, "src/Core/IClient.cs");
    assert_eq!(
        f[0].suggested_comment,
        "Should this pass the cancellation token?"
    );
    assert_eq!(f[0].fingerprint.len(), 16);
    assert_ne!(f[0].fingerprint, f[1].fingerprint);
    assert_eq!(analysis.checklist, ["Is the retry copy right?"]);
    assert_eq!(analysis.folds[0].new_end, 12);
    // Validating the same output again (a cache hit) keeps the IDs.
    let again = check(&output(), &HashSet::new()).unwrap();
    assert_eq!(again.findings[0].id, f[0].id);
    assert_ne!(f[0].id, f[1].id);
}

#[test]
fn f09_1_validation_table() {
    let abs = root().join("src").join("Core").join("IClient.cs");
    type Edit = Box<dyn Fn(&mut Value)>;
    let cases: Vec<(&str, Edit, bool)> = vec![
        ("unchanged", Box::new(|_| {}), true),
        (
            "line outside the step",
            Box::new(|o| o["findings"][1]["line"] = json!(30)),
            false,
        ),
        (
            "context line of the step",
            Box::new(|o| o["findings"][1]["line"] = json!(13)),
            true,
        ),
        (
            "file outside the step",
            Box::new(|o| o["findings"][1]["file"] = json!("src/Other.cs")),
            false,
        ),
        (
            "removed line on the old side",
            Box::new(|o| o["findings"][1] = finding(UPLOADER, "old", 11)),
            true,
        ),
        (
            "added line on the old side",
            Box::new(|o| o["findings"][1] = finding(UPLOADER, "old", 14)),
            false,
        ),
        (
            "evidence file not in the worktree",
            Box::new(|o| o["findings"][0]["evidence"][1]["file"] = json!("src/Gone.cs")),
            false,
        ),
        (
            "evidence line past the end",
            Box::new(|o| o["findings"][0]["evidence"][1]["line"] = json!(13)),
            false,
        ),
        (
            "evidence outside the worktree",
            Box::new(|o| o["findings"][0]["evidence"][1]["file"] = json!("../src/Core/IClient.cs")),
            false,
        ),
        (
            "evidence as an absolute path in the worktree",
            Box::new(move |o| {
                o["findings"][0]["evidence"][1]["file"] = json!(abs.to_string_lossy())
            }),
            true,
        ),
        (
            "no evidence",
            Box::new(|o| o["findings"][0]["evidence"] = json!([])),
            false,
        ),
        (
            "kind not kebab-case",
            Box::new(|o| o["findings"][0]["kind"] = json!("Bad Kind")),
            false,
        ),
        (
            "unknown severity",
            Box::new(|o| o["findings"][0]["severity"] = json!("blocker")),
            false,
        ),
        (
            "line 0",
            Box::new(|o| o["findings"][0]["line"] = json!(0)),
            false,
        ),
        ("unknown field", Box::new(|o| o["extra"] = json!(1)), false),
        (
            "missing field",
            Box::new(|o| {
                o.as_object_mut().unwrap().remove("folds");
            }),
            false,
        ),
        (
            "nine findings",
            Box::new(|o| o["findings"] = json!(vec![finding(UPLOADER, "new", 11); 9])),
            false,
        ),
        (
            "fold outside the step",
            Box::new(|o| o["folds"][0]["new_end"] = json!(15)),
            false,
        ),
        (
            "fold ends before it starts",
            Box::new(|o| o["folds"][0]["new_start"] = json!(13)),
            false,
        ),
        ("no findings", Box::new(|o| o["findings"] = json!([])), true),
    ];
    for (name, edit, valid) in cases {
        let mut out = output();
        edit(&mut out);
        let result = check(&out, &HashSet::new());
        assert_eq!(result.is_ok(), valid, "{name}: {result:?}");
        if let Err(error) = result {
            assert!(matches!(error, ClaudeError::Schema(_)), "{name}: {error:?}");
        }
    }
    // An absolute evidence path is stored relative to the worktree.
    let mut out = output();
    out["findings"][0]["evidence"][1]["file"] = json!(
        root()
            .join("src")
            .join("Core")
            .join("IClient.cs")
            .to_string_lossy()
    );
    let analysis = check(&out, &HashSet::new()).unwrap();
    assert_eq!(analysis.findings[1].evidence[1].file, "src/Core/IClient.cs");
    let no_output = validate(
        None,
        &StepScope::new("s1", &[], &[]),
        &HashSet::new(),
        |_| None,
        |_| None,
    );
    assert!(matches!(no_output, Err(ClaudeError::Schema(_))));
}

#[test]
fn f09_1_long_strings_are_clamped() {
    let mut out = output();
    out["findings"][0]["title"] = json!("x".repeat(200));
    out["findings"][0]["suggested_comment"] = json!("y".repeat(700));
    out["checklist"][0] = json!("z".repeat(300));
    let analysis = check(&out, &HashSet::new()).unwrap();
    let f = &analysis.findings[1];
    assert_eq!(f.title.chars().count(), 80);
    assert!(f.title.ends_with('…'));
    assert_eq!(f.suggested_comment.chars().count(), 600);
    assert_eq!(analysis.checklist[0].chars().count(), 140);
}

#[test]
fn f09_4_dismissed_fingerprints_are_left_out() {
    let all = check(&output(), &HashSet::new()).unwrap();
    let dismissed: HashSet<String> = [all.findings[0].fingerprint.clone()].into();
    let left = check(&output(), &dismissed).unwrap();
    assert_eq!(left.findings.len(), 1);
    assert_eq!(left.findings[0], all.findings[1]);
}

#[test]
fn f09_1_worktree_lines_and_relative_paths() {
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().join("Zażółć gęślą");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("A b.cs"), "one\r\ntwo\r\n").unwrap();
    std::fs::write(folder.join("c.cs"), "one\ntwo\nthree").unwrap();
    std::fs::write(folder.join("empty.cs"), "").unwrap();
    let lines = worktree_lines(dir.path());
    assert_eq!(lines("Zażółć gęślą/A b.cs"), Some(2));
    assert_eq!(lines("Zażółć gęślą/c.cs"), Some(3));
    assert_eq!(lines("Zażółć gęślą/empty.cs"), Some(0));
    assert_eq!(lines("Zażółć gęślą/missing.cs"), None);
    assert_eq!(lines("Zażółć gęślą"), None);

    let root = dir.path();
    assert_eq!(relative(root, "a\\b.cs").as_deref(), Some("a/b.cs"));
    assert_eq!(relative(root, "./a/b.cs").as_deref(), Some("a/b.cs"));
    assert_eq!(
        relative(root, &root.join("x").join("y.cs").to_string_lossy()).as_deref(),
        Some("x/y.cs")
    );
    assert_eq!(relative(root, "../a.cs"), None);
    assert_eq!(relative(root, "a/../../b.cs"), None);
    assert_eq!(relative(root, "/etc/hosts"), None);
    assert_eq!(relative(root, ""), None);
}

#[test]
fn f09_1_body_and_evidence_notes_are_clamped() {
    let mut out = output();
    out["findings"][0]["body"] = json!("b".repeat(700));
    out["findings"][0]["evidence"][1]["note"] = json!("n".repeat(200));
    let analysis = check(&out, &HashSet::new()).unwrap();
    // Claude listed the ViewModel note first; the step's diff order puts it second.
    let long = &analysis.findings[1];
    assert_eq!(long.body.chars().count(), 600);
    assert!(long.body.ends_with('…'));
    assert_eq!(long.evidence[1].note.chars().count(), 120);
    assert!(long.evidence[1].note.ends_with('…'));
    // Text within the limits is kept as it is.
    assert_eq!(analysis.findings[0].body, "The token isn't passed.");
    assert_eq!(analysis.findings[0].evidence[1].note, "the overload");
}

#[test]
fn f09_1_a_note_names_one_to_four_places_it_checked() {
    let places = |count: u32| -> Vec<Value> {
        (1..=count)
            .map(|line| json!({ "file": "src/Core/IClient.cs", "line": line, "note": format!("place {line}") }))
            .collect()
    };
    for (count, valid) in [(0, false), (1, true), (4, true), (5, false)] {
        let mut out = output();
        out["findings"][0]["evidence"] = json!(places(count));
        let result = check(&out, &HashSet::new());
        assert_eq!(result.is_ok(), valid, "{count} places: {result:?}");
        if let Err(error) = result {
            assert!(
                matches!(error, ClaudeError::Schema(_)),
                "{count}: {error:?}"
            );
        }
    }
    // The list keeps Claude's order, each entry with file, line and what it showed.
    let mut out = output();
    out["findings"][0]["evidence"] = json!(places(4));
    let analysis = check(&out, &HashSet::new()).unwrap();
    let kept: Vec<_> = analysis.findings[1]
        .evidence
        .iter()
        .map(|e| (e.file.as_str(), e.line, e.note.as_str()))
        .collect();
    assert_eq!(
        kept,
        [
            ("src/Core/IClient.cs", 1, "place 1"),
            ("src/Core/IClient.cs", 2, "place 2"),
            ("src/Core/IClient.cs", 3, "place 3"),
            ("src/Core/IClient.cs", 4, "place 4"),
        ]
    );
    // A line 0 is not a place in a file.
    let mut out = output();
    out["findings"][0]["evidence"][1]["line"] = json!(0);
    assert!(matches!(
        check(&out, &HashSet::new()),
        Err(ClaudeError::Schema(_))
    ));
}

#[test]
fn f09_1_the_note_keeps_its_severity_file_side_and_line() {
    for (word, expected) in [
        ("fix", Severity::Fix),
        ("q", Severity::Q),
        ("nit", Severity::Nit),
    ] {
        let mut out = output();
        out["findings"][1]["severity"] = json!(word);
        let analysis = check(&out, &HashSet::new()).unwrap();
        assert_eq!(analysis.findings[0].severity, expected, "{word}");
    }
    // A note on a removed line is numbered on the old side and keeps that side.
    let mut out = output();
    out["findings"][1] = finding(UPLOADER, "old", 11);
    let analysis = check(&out, &HashSet::new()).unwrap();
    let old = &analysis.findings[0];
    assert_eq!(
        (old.file.as_str(), old.side, old.line),
        (UPLOADER, Side::Old, 11)
    );
    // The other note stays on the new side of its own file.
    assert_eq!(analysis.findings[1].side, Side::New);
    assert_eq!(analysis.findings[1].file, VM);
}

#[test]
fn f09_1_the_notes_own_line_is_evidence_even_where_the_worktree_has_no_such_line() {
    let files = files();
    let ids: Vec<String> = files[..2].iter().map(|f| f.hunks[0].id.clone()).collect();
    let scope = StepScope::new("s2", &files, &ids);
    let root = root();
    // The worktree holds the new version: it has no file at all for the checks below.
    let nothing = |_: &str| None;
    let mut out = output();
    out["findings"] = json!([{
        "severity": "fix", "kind": "removed-await", "title": "The old call was awaited",
        "body": "The removed line awaited the call.", "file": UPLOADER, "side": "old", "line": 11,
        "evidence": [{ "file": UPLOADER, "line": 11, "note": "the removed call" }],
        "suggested_comment": "Why is the await gone?"
    }]);
    let ok = validate(
        Some(&out),
        &scope,
        &HashSet::new(),
        |p| relative(&root, p),
        nothing,
    )
    .unwrap();
    assert_eq!(ok.findings[0].evidence[0].file, UPLOADER);
    assert_eq!(ok.findings[0].evidence[0].line, 11);
    // Another line of that file is only evidence where the worktree has it.
    out["findings"][0]["evidence"][0]["line"] = json!(40);
    let missing = validate(
        Some(&out),
        &scope,
        &HashSet::new(),
        |p| relative(&root, p),
        nothing,
    );
    assert!(matches!(missing, Err(ClaudeError::Schema(_))));
}
