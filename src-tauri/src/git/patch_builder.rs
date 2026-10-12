//! Builds the partial patches that stage and unstage selected lines (F-16.1; docs/05 › Stage
//! selection, Unstage selection):
//! - forward (stage, from the unstaged diff I→W): unselected `-` lines become context,
//!   unselected `+` lines are dropped;
//! - reverse (unstage, from the staged diff H→I, applied with `--reverse`): unselected `+`
//!   lines become context, unselected `-` lines are dropped.
//!
//! The result goes to `git apply --cached --recount` on stdin. Raw line text is kept (`\r`
//! included), so CRLF files stay CRLF in the index.

use super::model::{FileStatus, LineKind};
use super::patch::{PatchFile, PatchLine};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Stage: applied as is to the index.
    Forward,
    /// Unstage: applied with `--reverse`.
    Reverse,
}

/// The patch with only the selected change lines, or `None` when nothing is selected.
/// `selected(kind, old_no, new_no)` is asked for every `-` and `+` line.
pub fn build(
    file: &PatchFile,
    direction: Direction,
    selected: &dyn Fn(LineKind, Option<u32>, Option<u32>) -> bool,
) -> Option<String> {
    let mut body = String::new();
    for hunk in &file.hunks {
        let mut lines: Vec<(char, &PatchLine)> = Vec::new();
        let mut any = false;
        for (old, new, line) in hunk.numbered() {
            let marker = match (line.kind, direction) {
                (LineKind::Ctx, _) => Some(' '),
                (kind, _) if selected(kind, old, new) => {
                    any = true;
                    Some(if kind == LineKind::Add { '+' } else { '-' })
                }
                (LineKind::Del, Direction::Forward) | (LineKind::Add, Direction::Reverse) => {
                    Some(' ')
                }
                (LineKind::Del, Direction::Reverse) | (LineKind::Add, Direction::Forward) => None,
            };
            if let Some(marker) = marker {
                lines.push((marker, line));
            }
        }
        if !any {
            continue;
        }
        let old_count = count(&lines, &[' ', '-']);
        let new_count = count(&lines, &[' ', '+']);
        let old_start = if hunk.old_lines == 0 && old_count > 0 {
            hunk.old_start + 1
        } else {
            hunk.old_start
        };
        let new_start = if hunk.new_lines == 0 && new_count > 0 {
            hunk.new_start + 1
        } else {
            hunk.new_start
        };
        body.push_str(&format!(
            "@@ -{old_start},{old_count} +{new_start},{new_count} @@\n"
        ));
        for (marker, line) in lines {
            body.push(marker);
            body.push_str(&line.text);
            body.push('\n');
            if line.no_newline {
                body.push_str("\\ No newline at end of file\n");
            }
        }
    }
    if body.is_empty() {
        return None;
    }
    Some(header(file, direction) + &body)
}

fn count(lines: &[(char, &PatchLine)], markers: &[char]) -> u32 {
    u32::try_from(lines.iter().filter(|(m, _)| markers.contains(m)).count()).unwrap_or(u32::MAX)
}

/// File header. A forward patch of a new file (an intent-to-add entry) keeps `new file mode`;
/// everything else is an edit of the path the index has.
fn header(file: &PatchFile, direction: Direction) -> String {
    let path = file
        .new_path
        .as_deref()
        .or(file.old_path.as_deref())
        .unwrap_or_default();
    let a = quote(&format!("a/{path}"));
    let b = quote(&format!("b/{path}"));
    let mut out = format!("diff --git {a} {b}\n");
    if direction == Direction::Forward && file.status == FileStatus::Added {
        let mode = file.new_mode.as_deref().unwrap_or("100644");
        out.push_str(&format!("new file mode {mode}\n--- /dev/null\n"));
    } else {
        out.push_str(&format!("--- {}\n", side(&a)));
    }
    out.push_str(&format!("+++ {}\n", side(&b)));
    out
}

/// `---`/`+++` name: git appends a tab to unquoted names with spaces.
fn side(name: &str) -> String {
    if !name.starts_with('"') && name.contains(' ') {
        format!("{name}\t")
    } else {
        name.to_owned()
    }
}

/// C-style quoting as git does for names with quotes, backslashes or control characters.
pub fn quote(name: &str) -> String {
    if !name
        .chars()
        .any(|c| c == '"' || c == '\\' || c.is_control())
    {
        return name.to_owned();
    }
    let mut out = String::from("\"");
    for c in name.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if c.is_control() => {
                let mut buf = [0; 4];
                for b in c.encode_utf8(&mut buf).bytes() {
                    out.push_str(&format!("\\{b:03o}"));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::patch::parse;

    const HEAD: &str = "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n";

    fn file(hunks: &str) -> PatchFile {
        parse(&format!("{HEAD}{hunks}")).unwrap().remove(0)
    }

    #[test]
    fn f16_1_forward_keeps_selected_lines_only() {
        let f = file("@@ -10,4 +10,4 @@\n a\n-b\n-c\n+B\n+C\n d\n");
        // Stage "-c" and "+B" only.
        let patch = build(&f, Direction::Forward, &|kind, old, new| {
            (kind == LineKind::Del && old == Some(12)) || (kind == LineKind::Add && new == Some(11))
        })
        .unwrap();
        assert_eq!(
            patch,
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -10,4 +10,4 @@\n a\n b\n-c\n+B\n d\n"
        );
    }

    #[test]
    fn f16_1_reverse_mirrors_the_rules() {
        let f = file("@@ -10,4 +10,4 @@\n a\n-b\n-c\n+B\n+C\n d\n");
        // Unstage "+C" only: "-b"/"-c" are dropped, "+B" becomes context.
        let patch = build(&f, Direction::Reverse, &|kind, _, new| {
            kind == LineKind::Add && new == Some(12)
        })
        .unwrap();
        assert_eq!(
            patch,
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -10,3 +10,4 @@\n a\n B\n+C\n d\n"
        );
    }

    #[test]
    fn nothing_selected_gives_no_patch() {
        let f = file("@@ -1,2 +1,2 @@\n-a\n+b\n c\n");
        assert_eq!(build(&f, Direction::Forward, &|_, _, _| false), None);
    }

    #[test]
    fn new_files_keep_the_header_forward_only() {
        let text = "diff --git a/n b/n\nnew file mode 100644\nindex 0..1\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,3 @@\n+one\n+two\n+three\n";
        let f = parse(text).unwrap().remove(0);
        let forward = build(&f, Direction::Forward, &|_, _, new| new != Some(2)).unwrap();
        assert_eq!(
            forward,
            "diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+one\n+three\n"
        );
        let reverse = build(&f, Direction::Reverse, &|_, _, new| new == Some(3)).unwrap();
        assert_eq!(
            reverse,
            "diff --git a/n b/n\n--- a/n\n+++ b/n\n@@ -1,2 +1,3 @@\n one\n two\n+three\n"
        );
    }

    #[test]
    fn keeps_crlf_and_no_newline_markers() {
        let f = file("@@ -1,2 +1,2 @@\n a\r\n-b\r\n\\ No newline at end of file\n+c\r\n");
        let patch = build(&f, Direction::Forward, &|_, _, _| true).unwrap();
        assert!(
            patch.ends_with("@@ -1,2 +1,2 @@\n a\r\n-b\r\n\\ No newline at end of file\n+c\r\n")
        );
    }

    #[test]
    fn quotes_names_like_git() {
        assert_eq!(quote("a/plain ż.txt"), "a/plain ż.txt");
        assert_eq!(quote("a/q\"t\tx"), "\"a/q\\\"t\\tx\"");
        assert_eq!(side("a/with space"), "a/with space\t");
    }
}
