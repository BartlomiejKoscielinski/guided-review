use super::*;

#[test]
fn parses_a_modified_file_with_context_and_numbers() {
    let text = "diff --git a/src/A.cs b/src/A.cs\n\
index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644\n\
--- a/src/A.cs\n+++ b/src/A.cs\n\
@@ -54,4 +56,6 @@ ProcessAsync\n         }\n-        catch (X ex)\n+        catch (X ex) when (a)\n         {\n+            await A();\n+            await B();\n         }\n";
    let files = parse(text).unwrap();
    assert_eq!(files.len(), 1);
    let f = &files[0];
    assert_eq!(f.status, FileStatus::Modified);
    assert_eq!(f.path(), "src/A.cs");
    assert_eq!(f.old_mode.as_deref(), Some("100644"));
    assert_eq!((f.additions(), f.deletions()), (3, 1));
    let h = &f.hunks[0];
    assert_eq!(h.section, "ProcessAsync");
    let numbered: Vec<_> = h.numbered().map(|(o, n, _)| (o, n)).collect();
    assert_eq!(numbered[0], (Some(54), Some(56)));
    assert_eq!(numbered[1], (Some(55), None));
    assert_eq!(numbered[2], (None, Some(57)));
    assert_eq!(numbered[6], (Some(57), Some(61)));
}

#[test]
fn parses_new_deleted_renamed_mode_and_binary_files() {
    let text = "diff --git a/new.txt b/new.txt\nnew file mode 100644\n\
index 0000000000000000000000000000000000000000..3333333333333333333333333333333333333333\n\
--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n\
diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n\
index 4444444444444444444444444444444444444444..0000000000000000000000000000000000000000\n\
--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n\
diff --git a/keep.txt b/kept ż.txt\nsimilarity index 100%\nrename from keep.txt\nrename to kept ż.txt\n\
diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n\
diff --git a/a.png b/a.png\nindex 5555555555555555555555555555555555555555..6666666666666666666666666666666666666666 100644\n\
Binary files a/a.png and b/a.png differ\n";
    let files = parse(text).unwrap();
    assert_eq!(files.len(), 5);
    assert_eq!(files[0].status, FileStatus::Added);
    assert_eq!(files[0].old_path, None);
    assert_eq!(files[0].new_path.as_deref(), Some("new.txt"));
    assert_eq!(files[1].status, FileStatus::Deleted);
    assert_eq!(files[1].path(), "gone.txt");
    assert_eq!(files[1].new_path, None);
    assert_eq!(files[2].status, FileStatus::Renamed);
    assert_eq!(files[2].old_path.as_deref(), Some("keep.txt"));
    assert_eq!(files[2].new_path.as_deref(), Some("kept ż.txt"));
    assert!(files[2].hunks.is_empty());
    assert_eq!(files[3].path(), "run.sh");
    assert_eq!(files[3].old_mode.as_deref(), Some("100644"));
    assert_eq!(files[3].new_mode.as_deref(), Some("100755"));
    assert!(files[4].binary);
}

#[test]
fn names_with_spaces_have_a_trailing_tab_and_quoted_names_are_decoded() {
    let text = "diff --git a/d ą/f g.txt b/d ą/f g.txt\nindex 1..2 100644\n--- a/d ą/f g.txt\t\n+++ b/d ą/f g.txt\t\n@@ -1 +1,2 @@\n a\n+b\n\
diff --git \"a/q\\\"t\\tx.txt\" \"b/q\\\"t\\tx.txt\"\nindex 1..2 100644\n--- \"a/q\\\"t\\tx.txt\"\n+++ \"b/q\\\"t\\tx.txt\"\n@@ -1 +1 @@\n-a\n+b\n\
diff --git \"a/\\305\\274.txt\" \"b/\\305\\274.txt\"\nold mode 100644\nnew mode 100755\n";
    let files = parse(text).unwrap();
    assert_eq!(files[0].path(), "d ą/f g.txt");
    assert_eq!(files[1].path(), "q\"t\tx.txt");
    assert_eq!(files[2].path(), "ż.txt");
}

#[test]
fn keeps_carriage_returns_and_no_newline_markers() {
    let text = "diff --git a/a.txt b/a.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n x\r\n-y\r\n\\ No newline at end of file\n+z\r\n";
    let files = parse(text).unwrap();
    let lines = &files[0].hunks[0].lines;
    assert_eq!(lines[0].text, "x\r");
    assert!(lines[1].no_newline);
    assert!(!lines[2].no_newline);
}

#[test]
fn empty_context_lines_without_a_space_are_context() {
    // diff.suppressBlankEmpty prints an empty context line as an empty line.
    let text = "diff --git a/a.txt b/a.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n";
    let files = parse(text).unwrap();
    let kinds: Vec<_> = files[0].hunks[0].lines.iter().map(|l| l.kind).collect();
    assert_eq!(
        kinds,
        [LineKind::Ctx, LineKind::Ctx, LineKind::Del, LineKind::Add]
    );
}

#[test]
fn rejects_garbage() {
    assert!(parse("hello\n").is_err());
    assert!(parse("").unwrap().is_empty());
}
