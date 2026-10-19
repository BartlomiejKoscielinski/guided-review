//! GitLab's position for a draft's line (F-12.5, docs/05 › Draft note positions), read from the
//! session's diff of the reviewed version: an added line is `new_line` only, a deleted line
//! `old_line` only, a context line both, whichever side the draft was written on; the file keeps
//! its old and new path (a rename). A line outside every hunk (an expanded context line) is
//! unchanged, so its other number follows from the lines the hunks before it add and remove. A
//! file that isn't in the diff has no position.

use super::finding_model::Side;
use super::position::DiffPosition;
use crate::git::model::{FileDiff, Hunk, LineKind};
use crate::gitlab::draft_notes::NotePosition;

/// The file of `at`: its new path, else the old path of a deleted file.
fn file_of<'a>(files: &'a [FileDiff], at: &DiffPosition) -> Option<&'a FileDiff> {
    let named = |path: &Option<String>| path.as_deref() == Some(at.file.as_str());
    files
        .iter()
        .find(|f| named(&f.new_path))
        .or_else(|| files.iter().find(|f| named(&f.old_path)))
}

/// The last number of `hunk` on `side`, if it has a line there.
fn last_on(hunk: &Hunk, side: Side) -> Option<u32> {
    hunk.lines
        .iter()
        .filter_map(|l| match side {
            Side::New => l.new_no,
            Side::Old => l.old_no,
        })
        .max()
}

/// Lines added minus lines removed by `hunk`.
fn shift(hunk: &Hunk) -> i64 {
    hunk.lines
        .iter()
        .map(|l| match l.kind {
            LineKind::Add => 1,
            LineKind::Del => -1,
            LineKind::Ctx => 0,
        })
        .sum()
}

/// The other number of an unchanged line `line` on `side` outside every hunk.
fn unchanged(file: &FileDiff, side: Side, line: u32) -> Option<u32> {
    let before: i64 = file
        .hunks
        .iter()
        .filter(|h| last_on(h, side).is_some_and(|last| last < line))
        .map(shift)
        .sum();
    let other = match side {
        Side::New => i64::from(line) - before,
        Side::Old => i64::from(line) + before,
    };
    u32::try_from(other).ok().filter(|n| *n > 0)
}

/// GitLab's position of `at` in `files`; `None` when the file is not in the diff.
pub fn note_position(files: &[FileDiff], at: &DiffPosition) -> Option<NotePosition> {
    let file = file_of(files, at)?;
    let old_path = file.old_path.clone().or_else(|| file.new_path.clone())?;
    let new_path = file.new_path.clone().or_else(|| file.old_path.clone())?;
    let on_line = file
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .find(|l| at.is_on(l));
    let (old_line, new_line) = match on_line {
        Some(l) => match l.kind {
            LineKind::Add => (None, l.new_no),
            LineKind::Del => (l.old_no, None),
            LineKind::Ctx => (l.old_no, l.new_no),
        },
        None => {
            let other = unchanged(file, at.side, at.line)?;
            match at.side {
                Side::New => (Some(other), Some(at.line)),
                Side::Old => (Some(at.line), Some(other)),
            }
        }
    };
    Some(NotePosition {
        old_path,
        new_path,
        old_line,
        new_line,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::git::model::{FileStatus, Line};
    use crate::review::layer::Layer;

    fn line(kind: LineKind, old_no: Option<u32>, new_no: Option<u32>) -> Line {
        Line {
            kind,
            old_no,
            new_no,
            text: String::new(),
            emphasis: Vec::new(),
            staged: None,
        }
    }

    /// Old 10..=12 → new 10..=13: ctx 10/10, del 11, add 11, add 12, ctx 12/13.
    fn files() -> Vec<FileDiff> {
        vec![FileDiff {
            old_path: Some("a ą.cs".into()),
            new_path: Some("a ą.cs".into()),
            status: FileStatus::Modified,
            binary: false,
            mode_change: None,
            additions: 2,
            deletions: 1,
            layer: Layer::App,
            hunks: vec![Hunk {
                id: "h".into(),
                old_start: 10,
                old_lines: 3,
                new_start: 10,
                new_lines: 4,
                header: String::new(),
                lines: vec![
                    line(LineKind::Ctx, Some(10), Some(10)),
                    line(LineKind::Del, Some(11), None),
                    line(LineKind::Add, None, Some(11)),
                    line(LineKind::Add, None, Some(12)),
                    line(LineKind::Ctx, Some(12), Some(13)),
                ],
                file_level: false,
                staged_differs: false,
                mechanical: None,
            }],
            line_staging: true,
        }]
    }

    fn at(side: Side, line: u32) -> DiffPosition {
        DiffPosition {
            file: "a ą.cs".into(),
            side,
            line,
        }
    }

    fn lines(p: Option<NotePosition>) -> (Option<u32>, Option<u32>) {
        let p = p.unwrap();
        (p.old_line, p.new_line)
    }

    #[test]
    fn f12_5_each_line_kind_gets_its_numbers() {
        let files = files();
        assert_eq!(
            lines(note_position(&files, &at(Side::New, 12))),
            (None, Some(12))
        );
        assert_eq!(
            lines(note_position(&files, &at(Side::Old, 11))),
            (Some(11), None)
        );
        assert_eq!(
            lines(note_position(&files, &at(Side::Old, 12))),
            (Some(12), Some(13))
        );
    }

    #[test]
    fn f12_5_an_expanded_context_line_follows_the_hunks_before_it() {
        let files = files();
        // Above the hunk nothing moved; below it the new side is one line further.
        assert_eq!(
            lines(note_position(&files, &at(Side::New, 3))),
            (Some(3), Some(3))
        );
        assert_eq!(
            lines(note_position(&files, &at(Side::New, 20))),
            (Some(19), Some(20))
        );
        assert_eq!(
            lines(note_position(&files, &at(Side::Old, 19))),
            (Some(19), Some(20))
        );
    }

    #[test]
    fn f12_5_a_file_not_in_the_diff_has_no_position() {
        let mut gone = at(Side::New, 3);
        gone.file = "other.cs".into();
        assert!(note_position(&files(), &gone).is_none());
    }
}
