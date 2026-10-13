//! Fingerprints of Claude's notes (F-09.4): the note's `kind` + file + normalized code, i.e.
//! the line with whitespace collapsed plus one line of context on each side. Line numbers are
//! not part of it, so the same code moved or re-indented keeps its fingerprint. Dismissals are
//! stored by fingerprint and not raised again for the same head.

use sha2::{Digest, Sha256};

use super::finding_model::Side;
use crate::git::model::{Hunk, LineKind};

/// Whitespace runs collapsed to one space, trimmed.
pub fn normalize(code: &str) -> String {
    code.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// First 16 hex chars of SHA-256 over `kind \0 file \0 before \0 line \0 after` (normalized;
/// missing context is empty).
pub fn fingerprint(
    kind: &str,
    file: &str,
    before: Option<&str>,
    line: &str,
    after: Option<&str>,
) -> String {
    let fields = [
        kind.to_owned(),
        file.to_owned(),
        normalize(before.unwrap_or_default()),
        normalize(line),
        normalize(after.unwrap_or_default()),
    ];
    Sha256::digest(fields.join("\0").as_bytes())
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The fingerprint of a note on `line` (numbered on `side`) of `hunk`, with its context taken
/// from the hunk's lines on that side; `None` when the hunk has no such line.
pub fn for_hunk_line(kind: &str, file: &str, hunk: &Hunk, side: Side, line: u32) -> Option<String> {
    let lines: Vec<(u32, &str)> = hunk
        .lines
        .iter()
        .filter_map(|l| {
            let number = match (side, l.kind) {
                (Side::New, LineKind::Ctx | LineKind::Add) => l.new_no,
                (Side::Old, LineKind::Ctx | LineKind::Del) => l.old_no,
                _ => None,
            }?;
            Some((number, l.text.as_str()))
        })
        .collect();
    let at = lines.iter().position(|(n, _)| *n == line)?;
    let text = |i: Option<usize>| i.and_then(|i| lines.get(i)).map(|(_, t)| *t);
    Some(fingerprint(
        kind,
        file,
        text(at.checked_sub(1)),
        lines[at].1,
        text(Some(at + 1)),
    ))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::git::model::Line;

    fn line(kind: LineKind, old: Option<u32>, new: Option<u32>, text: &str) -> Line {
        Line {
            kind,
            old_no: old,
            new_no: new,
            text: text.to_owned(),
            emphasis: Vec::new(),
            staged: None,
        }
    }

    /// `+` lines from `new_start`, with one context line before and after.
    fn hunk(new_start: u32, before: &str, added: &[&str], after: &str) -> Hunk {
        let mut lines = vec![line(LineKind::Ctx, Some(10), Some(new_start), before)];
        for (i, text) in added.iter().enumerate() {
            lines.push(line(
                LineKind::Add,
                None,
                Some(new_start + 1 + i as u32),
                text,
            ));
        }
        let end = new_start + 1 + added.len() as u32;
        lines.push(line(LineKind::Ctx, Some(11), Some(end), after));
        Hunk {
            id: "h".into(),
            old_start: 10,
            old_lines: 2,
            new_start,
            new_lines: end - new_start + 1,
            header: String::new(),
            lines,
            file_level: false,
            staged_differs: false,
            mechanical: None,
        }
    }

    const CODE: [&str; 3] = [
        "    var result = await client.SendAsync(request);",
        "    cache[key] = result;",
        "    return result;",
    ];

    #[test]
    fn f09_4_moved_code_keeps_its_fingerprint() {
        let here = hunk(20, "{", &CODE, "}");
        let moved = hunk(140, "{", &CODE, "}");
        let a = for_hunk_line("unhandled-cancellation", "Api.cs", &here, Side::New, 22).unwrap();
        let b = for_hunk_line("unhandled-cancellation", "Api.cs", &moved, Side::New, 142).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn f09_4_whitespace_insensitive() {
        let reformatted = [
            "\tvar  result = await client.SendAsync(request);   ",
            "  cache[key]   =  result;",
            "return result;\r",
        ];
        let a = for_hunk_line("k-1", "Api.cs", &hunk(20, "{", &CODE, "}"), Side::New, 22);
        let b = for_hunk_line(
            "k-1",
            "Api.cs",
            &hunk(5, " { ", &reformatted, "}"),
            Side::New,
            7,
        );
        assert_eq!(a, b);
    }

    #[test]
    fn f09_4_kind_file_line_and_context_count() {
        let base = hunk(20, "{", &CODE, "}");
        let fp = |kind: &str, file: &str, h: &Hunk, line: u32| {
            for_hunk_line(kind, file, h, Side::New, line).unwrap()
        };
        let a = fp("null-check", "Api.cs", &base, 22);
        assert_ne!(a, fp("race-condition", "Api.cs", &base, 22));
        assert_ne!(a, fp("null-check", "Other.cs", &base, 22));
        assert_ne!(a, fp("null-check", "Api.cs", &base, 23));
        // One line of context on each side counts, two lines away does not.
        let other_next = hunk(20, "{", &[CODE[0], CODE[1], "    return null;"], "}");
        assert_ne!(a, fp("null-check", "Api.cs", &other_next, 22));
        let other_far = hunk(20, "// changed", &CODE, "}");
        assert_eq!(a, fp("null-check", "Api.cs", &other_far, 22));
    }

    #[test]
    fn f09_4_sides_and_edges() {
        let h = hunk(20, "{", &CODE, "}");
        // The first line has no line before it in the hunk.
        assert_eq!(
            for_hunk_line("k-1", "A.cs", &h, Side::New, 20),
            Some(fingerprint("k-1", "A.cs", None, "{", Some(CODE[0])))
        );
        // Old side: only context and removed lines are numbered there.
        assert!(for_hunk_line("k-1", "A.cs", &h, Side::Old, 10).is_some());
        assert_eq!(for_hunk_line("k-1", "A.cs", &h, Side::Old, 12), None);
        assert_eq!(for_hunk_line("k-1", "A.cs", &h, Side::New, 99), None);
    }
}
