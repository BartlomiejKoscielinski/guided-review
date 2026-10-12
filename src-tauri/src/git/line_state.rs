//! Whether each change of the local diff is in the index (F-16.1, F-16.2, ADR-008;
//! docs/05 › Local diff shown in S-06). S-06 shows HEAD → working tree (H→W); the state comes
//! from the staged diff (H→I) and the unstaged diff (I→W), matched by line numbers:
//! - a deleted line is numbered in HEAD on both H→W and H→I, so it is staged when H→I deletes
//!   the same HEAD line;
//! - an added line is numbered in the working tree on both H→W and I→W, so it is staged when
//!   I→W doesn't add that working-tree line (the index already has it).
//!
//! Lines that the index has but the file no longer has (staged, then edited again) can't be
//! shown; the hunk near them gets `staged_differs`.

use std::collections::HashSet;

use super::model::{FileDiff, LineKind};
use super::patch::PatchFile;

/// HEAD line numbers deleted by the staged diff.
pub fn staged_deletions(hi: Option<&PatchFile>) -> HashSet<u32> {
    numbers(hi, LineKind::Del)
}

/// Working-tree line numbers added by the unstaged diff.
pub fn unstaged_additions(iw: Option<&PatchFile>) -> HashSet<u32> {
    numbers(iw, LineKind::Add)
}

fn numbers(file: Option<&PatchFile>, kind: LineKind) -> HashSet<u32> {
    file.into_iter()
        .flat_map(|f| &f.hunks)
        .flat_map(|h| h.numbered())
        .filter(|(_, _, line)| line.kind == kind)
        .filter_map(|(old, new, _)| if kind == LineKind::Del { old } else { new })
        .collect()
}

/// Sets `staged` on every changed line of the H→W model and `staged_differs` on hunks.
pub fn apply(model: &mut FileDiff, hi: Option<&PatchFile>, iw: Option<&PatchFile>) {
    let staged_del = staged_deletions(hi);
    let unstaged_add = unstaged_additions(iw);
    for hunk in &mut model.hunks {
        for line in &mut hunk.lines {
            line.staged = match line.kind {
                LineKind::Ctx => None,
                LineKind::Del => line.old_no.map(|h| staged_del.contains(&h)),
                LineKind::Add => line.new_no.map(|w| !unstaged_add.contains(&w)),
            };
        }
    }
    for anchor in hidden_staged_anchors(hi, iw) {
        let target = model
            .hunks
            .iter()
            .position(|h| {
                !h.file_level && anchor + 1 >= h.old_start && anchor <= h.old_start + h.old_lines
            })
            .or_else(|| {
                model
                    .hunks
                    .iter()
                    .enumerate()
                    .filter(|(_, h)| !h.file_level)
                    .min_by_key(|(_, h)| h.old_start.abs_diff(anchor))
                    .map(|(i, _)| i)
            });
        if let Some(index) = target {
            model.hunks[index].staged_differs = true;
        }
    }
}

/// HEAD positions (the HEAD line before) of index lines that the working tree deleted again.
fn hidden_staged_anchors(hi: Option<&PatchFile>, iw: Option<&PatchFile>) -> Vec<u32> {
    let (Some(hi), Some(iw)) = (hi, iw) else {
        return Vec::new();
    };
    let deleted_from_index: HashSet<u32> = iw
        .hunks
        .iter()
        .flat_map(|h| h.numbered())
        .filter(|(_, _, l)| l.kind == LineKind::Del)
        .filter_map(|(old, _, _)| old)
        .collect();
    let mut anchors = Vec::new();
    for hunk in &hi.hunks {
        let mut last_head = hunk.old_start.saturating_sub(1);
        for (old, new, line) in hunk.numbered() {
            if let Some(old) = old {
                last_head = old;
            }
            if line.kind == LineKind::Add && new.is_some_and(|i| deleted_from_index.contains(&i)) {
                anchors.push(last_head);
            }
        }
    }
    anchors.dedup();
    anchors
}

/// The new-side number of an old-side line that the patch keeps, or `None` if it deletes it.
pub fn old_to_new(file: Option<&PatchFile>, old: u32) -> Option<u32> {
    map(file, old, true)
}

/// The old-side number of a new-side line that the patch doesn't add, or `None` if it adds it.
pub fn new_to_old(file: Option<&PatchFile>, new: u32) -> Option<u32> {
    map(file, new, false)
}

fn map(file: Option<&PatchFile>, line: u32, from_old: bool) -> Option<u32> {
    let Some(file) = file else {
        return Some(line);
    };
    let mut delta: i64 = 0;
    for hunk in &file.hunks {
        let (start, count, other_count) = if from_old {
            (hunk.old_start, hunk.old_lines, hunk.new_lines)
        } else {
            (hunk.new_start, hunk.new_lines, hunk.old_lines)
        };
        let before = if count == 0 {
            line <= start
        } else {
            line < start
        };
        if before {
            break;
        }
        if count > 0 && line < start + count {
            for (old, new, l) in hunk.numbered() {
                let (from, to) = if from_old { (old, new) } else { (new, old) };
                if from == Some(line) {
                    return if l.kind == LineKind::Ctx { to } else { None };
                }
            }
            return None;
        }
        delta += i64::from(other_count) - i64::from(count);
    }
    u32::try_from(i64::from(line) + delta).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::diff::to_model;
    use crate::git::patch::parse;

    fn one(text: &str) -> PatchFile {
        parse(text).unwrap().remove(0)
    }

    const HEAD: &str = "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n";

    #[test]
    fn maps_unchanged_lines_through_hunks() {
        // Old: 1..10. Line 3 replaced by two lines, line 8 deleted.
        let p = one(&format!(
            "{HEAD}@@ -2,3 +2,4 @@\n a2\n-a3\n+b3\n+b4\n a4\n@@ -7,3 +8,2 @@\n a7\n-a8\n a9\n"
        ));
        assert_eq!(old_to_new(Some(&p), 1), Some(1));
        assert_eq!(old_to_new(Some(&p), 3), None);
        assert_eq!(old_to_new(Some(&p), 4), Some(5));
        assert_eq!(old_to_new(Some(&p), 6), Some(7));
        assert_eq!(old_to_new(Some(&p), 8), None);
        assert_eq!(old_to_new(Some(&p), 10), Some(10));
        assert_eq!(new_to_old(Some(&p), 3), None);
        assert_eq!(new_to_old(Some(&p), 5), Some(4));
        assert_eq!(new_to_old(Some(&p), 10), Some(10));
        assert_eq!(old_to_new(None, 7), Some(7));
    }

    #[test]
    fn maps_around_pure_insertions() {
        // Two lines inserted after old line 2.
        let p = one(&format!("{HEAD}@@ -2,0 +3,2 @@\n+x\n+y\n"));
        assert_eq!(old_to_new(Some(&p), 2), Some(2));
        assert_eq!(old_to_new(Some(&p), 3), Some(5));
        assert_eq!(new_to_old(Some(&p), 4), None);
        assert_eq!(new_to_old(Some(&p), 5), Some(3));
    }

    #[test]
    fn f16_2_line_state_comes_from_the_staged_and_unstaged_diffs() {
        // HEAD: a b c d. Index: a B c d (b→B staged). Worktree: a B c D (d→D unstaged).
        let hw = one(&format!("{HEAD}@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n-d\n+D\n"));
        let hi = one(&format!("{HEAD}@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n"));
        let iw = one(&format!("{HEAD}@@ -2,3 +2,3 @@\n B\n c\n-d\n+D\n"));
        let mut model = to_model(&hw, true);
        apply(&mut model, Some(&hi), Some(&iw));
        let states: Vec<_> = model.hunks[0]
            .lines
            .iter()
            .map(|l| (l.kind, l.staged))
            .collect();
        assert_eq!(
            states,
            [
                (LineKind::Ctx, None),
                (LineKind::Del, Some(true)),
                (LineKind::Add, Some(true)),
                (LineKind::Ctx, None),
                (LineKind::Del, Some(false)),
                (LineKind::Add, Some(false)),
            ]
        );
        assert!(!model.hunks[0].staged_differs);
    }

    #[test]
    fn f16_2_staged_version_that_the_file_no_longer_has_is_flagged() {
        // HEAD: a b c. Index: a X c. Worktree: a Y c.
        let hw = one(&format!("{HEAD}@@ -1,3 +1,3 @@\n a\n-b\n+Y\n c\n"));
        let hi = one(&format!("{HEAD}@@ -1,3 +1,3 @@\n a\n-b\n+X\n c\n"));
        let iw = one(&format!("{HEAD}@@ -1,3 +1,3 @@\n a\n-X\n+Y\n c\n"));
        let mut model = to_model(&hw, true);
        apply(&mut model, Some(&hi), Some(&iw));
        let lines = &model.hunks[0].lines;
        assert_eq!(lines[1].staged, Some(true));
        assert_eq!(lines[2].staged, Some(false));
        assert!(model.hunks[0].staged_differs);
    }
}
