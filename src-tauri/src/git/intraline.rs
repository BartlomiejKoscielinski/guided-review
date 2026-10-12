//! Intraline emphasis (docs/05 › Diff parsing): deleted and added lines are paired by position
//! inside each run of `-` lines followed by `+` lines, and each pair is diffed by words (by
//! characters for short lines) with `similar`. Ranges are in UTF-16 code units for the UI.

use similar::{ChangeTag, TextDiff};

use super::model::{Emphasis, LineKind};

/// Lines shorter than this (in characters) are compared character by character.
const SHORT_LINE: usize = 24;
/// Longer lines get no emphasis (cost and noise).
const MAX_LINE: usize = 2000;
/// Pairs less similar than this are shown without emphasis: everything would be marked.
const MIN_RATIO: f32 = 0.35;

/// Pairs `(deleted index, added index)` of a hunk's lines, by position within each run.
pub fn pairs(kinds: &[LineKind]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < kinds.len() {
        if kinds[i] != LineKind::Del {
            i += 1;
            continue;
        }
        let del_start = i;
        while i < kinds.len() && kinds[i] == LineKind::Del {
            i += 1;
        }
        let add_start = i;
        while i < kinds.len() && kinds[i] == LineKind::Add {
            i += 1;
        }
        let dels = add_start - del_start;
        let adds = i - add_start;
        out.extend((0..dels.min(adds)).map(|k| (del_start + k, add_start + k)));
    }
    out
}

/// Emphasis for the old and the new line, or `None` when the lines are too different or long.
pub fn emphasis(old: &str, new: &str) -> Option<(Vec<Emphasis>, Vec<Emphasis>)> {
    if old.chars().count() > MAX_LINE || new.chars().count() > MAX_LINE || old == new {
        return None;
    }
    let short = old.chars().count() < SHORT_LINE && new.chars().count() < SHORT_LINE;
    let diff = if short {
        TextDiff::from_chars(old, new)
    } else {
        TextDiff::from_words(old, new)
    };
    if diff.ratio() < MIN_RATIO {
        return None;
    }
    let (mut old_pos, mut new_pos) = (0u32, 0u32);
    let (mut old_ranges, mut new_ranges) = (Vec::new(), Vec::new());
    for change in diff.iter_all_changes() {
        let len = utf16_len(change.value());
        match change.tag() {
            ChangeTag::Equal => {
                old_pos += len;
                new_pos += len;
            }
            ChangeTag::Delete => {
                push(&mut old_ranges, old_pos, old_pos + len);
                old_pos += len;
            }
            ChangeTag::Insert => {
                push(&mut new_ranges, new_pos, new_pos + len);
                new_pos += len;
            }
        }
    }
    Some((old_ranges, new_ranges))
}

fn utf16_len(text: &str) -> u32 {
    u32::try_from(text.encode_utf16().count()).unwrap_or(u32::MAX)
}

/// Appends a range, merging it with the previous one when they touch.
fn push(ranges: &mut Vec<Emphasis>, start: u32, end: u32) {
    if start == end {
        return;
    }
    match ranges.last_mut() {
        Some(last) if last.end == start => last.end = end,
        _ => ranges.push(Emphasis { start, end }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use LineKind::{Add, Ctx, Del};

    fn text(line: &str, ranges: &[Emphasis]) -> Vec<String> {
        let units: Vec<u16> = line.encode_utf16().collect();
        ranges
            .iter()
            .map(|r| String::from_utf16_lossy(&units[r.start as usize..r.end as usize]))
            .collect()
    }

    #[test]
    fn f15_5_pairs_runs_by_position() {
        assert_eq!(pairs(&[Ctx, Del, Del, Add, Ctx]), vec![(1, 3)]);
        assert_eq!(
            pairs(&[Del, Del, Add, Add, Add, Ctx, Del, Add]),
            vec![(0, 2), (1, 3), (6, 7)]
        );
        assert_eq!(pairs(&[Add, Del, Ctx]), vec![]);
    }

    #[test]
    fn f15_5_intraline_word_level() {
        let old = "        catch (HttpRequestException ex)";
        let new = "        catch (HttpRequestException ex) when (item.Attempts < MaxAttempts)";
        let (o, n) = emphasis(old, new).unwrap();
        assert!(o.is_empty());
        assert_eq!(
            text(new, &n).concat(),
            " when (item.Attempts < MaxAttempts)"
        );
    }

    #[test]
    fn f15_5_intraline_char_level_for_short_lines_in_utf16() {
        let (o, n) = emphasis("gęślą = 1;", "gęślą = 2;").unwrap();
        assert_eq!(text("gęślą = 1;", &o), ["1"]);
        assert_eq!(n, vec![Emphasis { start: 8, end: 9 }]);
        // An astral character counts as two UTF-16 units.
        let (_, n) = emphasis("x 😀 a", "x 😀 b").unwrap();
        assert_eq!(n, vec![Emphasis { start: 5, end: 6 }]);
    }

    #[test]
    fn f15_5_no_emphasis_for_unrelated_lines() {
        assert_eq!(
            emphasis(
                "private readonly IUploadQueue _queue;",
                "return await Task.WhenAll(jobs);"
            ),
            None
        );
    }
}
