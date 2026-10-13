#![allow(clippy::unwrap_used, reason = "tests")]
use super::*;
use crate::git::diff::{parse_patches, to_model};

/// One logic change, the four mechanical kinds of 05 › Mechanical hunks, and a rename-only file
/// (file-level hunk, F-05.7); synthetic content (ADR-019).
const PATCH: &str = "\
diff --git a/src/App/UploadViewModel.cs b/src/App/UploadViewModel.cs
index 1111111..2222222 100644
--- a/src/App/UploadViewModel.cs
+++ b/src/App/UploadViewModel.cs
@@ -1,3 +1,3 @@ class UploadViewModel
 class UploadViewModel {
-    void Upload() { Send(); }
+    void Upload() { queue.Enqueue(); }
 }
diff --git a/src/Core/Upload.cs b/src/Core/Upload.cs
index 3333333..4444444 100644
--- a/src/Core/Upload.cs
+++ b/src/Core/Upload.cs
@@ -2 +2 @@
-int  x =  1;
+int x = 1;
diff --git a/App.csproj b/App.csproj
index 5555555..6666666 100644
--- a/App.csproj
+++ b/App.csproj
@@ -3 +3 @@
-    <PackageReference Include=\"Foo\" Version=\"1.0.0\" />
+    <PackageReference Include=\"Foo\" Version=\"1.1.0\" />
diff --git a/Resources/Strings.resx b/Resources/Strings.resx
index 7777777..8888888 100644
--- a/Resources/Strings.resx
+++ b/Resources/Strings.resx
@@ -10,0 +11,3 @@
+  <data name=\"Retry\" xml:space=\"preserve\">
+    <value>Retry</value>
+  </data>
diff --git a/obj/Debug/Gen.g.cs b/obj/Debug/Gen.g.cs
index 9999999..aaaaaaa 100644
--- a/obj/Debug/Gen.g.cs
+++ b/obj/Debug/Gen.g.cs
@@ -5 +5 @@
-int a;
+int b;
diff --git a/src/Zażółć/Old Name.cs b/src/Zażółć/New Name.cs
similarity index 100%
rename from src/Zażółć/Old Name.cs
rename to src/Zażółć/New Name.cs
";

pub(crate) fn fixture_files() -> Vec<FileDiff> {
    parse_patches(PATCH)
        .unwrap()
        .iter()
        .map(|p| to_model(p, true))
        .collect()
}

#[test]
fn f05_5_mechanical_hunks_go_into_the_plan_input() {
    let files = fixture_files();
    assert_eq!(files.len(), 6);
    let reasons: Vec<Option<MechanicalReason>> =
        files.iter().map(|f| f.hunks[0].mechanical).collect();
    assert_eq!(
        reasons,
        [
            None,
            Some(MechanicalReason::Whitespace),
            Some(MechanicalReason::PackageBump),
            Some(MechanicalReason::ResxKeyAdded),
            Some(MechanicalReason::Generated),
            None,
        ]
    );
    let text = mechanical_file(&files);
    let rows: Vec<&str> = text.lines().skip(1).collect();
    let expected = [
        (1, "src/Core/Upload.cs\twhitespace only"),
        (2, "App.csproj\tpackage bump"),
        (3, "Resources/Strings.resx\tresx key added"),
        (4, "obj/Debug/Gen.g.cs\tgenerated"),
    ];
    assert_eq!(rows.len(), expected.len(), "{text}");
    for (row, (file, rest)) in rows.iter().zip(expected) {
        assert_eq!(*row, format!("{}\t{rest}", files[file].hunks[0].id));
    }
    // Neither the logic change nor the file-level hunk is mechanical.
    assert!(!text.contains(&files[0].hunks[0].id));
    assert!(!text.contains(&files[5].hunks[0].id));
    assert_eq!(mechanical_file(&files[..1]), "none\n");
}

#[test]
fn f06_2_hunk_index_has_one_line_per_hunk() {
    let files = fixture_files();
    let index = hunk_index(&files);
    let lines: Vec<&str> = index.lines().collect();
    assert_eq!(lines.len(), 7, "{index}");
    assert!(lines[0].starts_with("# hunk_id\tfile\tlayer"));
    let first: Vec<&str> = lines[1].split('\t').collect();
    assert_eq!(first[0], files[0].hunks[0].id);
    assert_eq!(first[1], "src/App/UploadViewModel.cs");
    assert_eq!(first[2], layer_name(files[0].layer));
    assert_eq!(first[3], "+1/-1");
    assert_eq!(first[4], "old 2: void Upload() { Send(); }");
    assert!(lines[4].ends_with("+3/-0\tnew 11: <data name=\"Retry\" xml:space=\"preserve\">"));
    assert!(
        lines[6].ends_with("+0/-0\t(file renamed, from src/Zażółć/Old Name.cs)"),
        "{}",
        lines[6]
    );
}

#[test]
fn f06_2_diff_text_names_every_hunk() {
    let files = fixture_files();
    let diff = diff_text(&files);
    for file in &files {
        assert!(diff.contains(&format!("# hunk {}", file.hunks[0].id)));
    }
    assert!(diff.contains("@@ -1,3 +1,3 @@ class UploadViewModel\n# hunk "));
    assert!(
        diff.contains(
            "-    void Upload() { Send(); }\n+    void Upload() { queue.Enqueue(); }\n }\n"
        )
    );
    assert!(diff.contains(
        "diff --git a/src/Zażółć/Old Name.cs b/src/Zażółć/New Name.cs\n# (file renamed, from src/Zażółć/Old Name.cs)\n"
    ));
}

#[test]
fn f06_2_source_label_block_and_text_inputs() {
    let source = PlanSource::Mr {
        iid: 482,
        title: "Torch".into(),
        source_branch: "feature/torch".into(),
        target_branch: "develop".into(),
    };
    assert_eq!(
        source.label(),
        "merge request !482 \"Torch\" (feature/torch → develop)"
    );
    assert_eq!(
        source.block("b0", "h1"),
        "The diff runs from the merge base with develop (b0) to the MR head (h1)."
    );
    assert_eq!(source.subject(), "mr:482");
    assert_eq!(or_none(None), "none\n");
    assert_eq!(or_none(Some("  \n")), "none\n");
    assert_eq!(or_none(Some("Adds a torch.\n")), "Adds a torch.\n");
}
