//! Where an MR thread shows in the steps (F-11.3, M5 decision 4). A thread written on another
//! version of the MR is `outdated`; its `placed_line` is the line with its text in the reviewed
//! version ([`line_map`]), on the side of its position. A thread shows on its line when a hunk
//! of a step holds it; else (no match, an expanded-context line, a hunk no step shows) on the
//! file header of the first step in the reader's order that shows the file; a file no step
//! shows keeps it out of every step (S-05 lists it). One place per thread: no duplicate cards,
//! and no diff thread drops out of the review.

use std::collections::HashSet;

use super::line_map::LineMap;
use super::plan_model::Plan;
use crate::git::model::{FileDiff, Hunk};
use crate::git::{Git, refs};
use crate::gitlab::discussions::Thread;
use crate::os::process::Cancel;

/// Sets `outdated` and `placed_line` of the diff threads for the reviewed version
/// `base → head`: a thread written on another head (a commit SHA) is outdated, and its line is
/// looked for in `head` (new side) or `base` (old side: a removed line).
pub async fn place(git: &Git, threads: &mut [Thread], base: &str, head: &str, cancel: &Cancel) {
    let mut map = LineMap::new(git, cancel);
    for thread in threads.iter_mut() {
        let Some(pos) = thread.position.clone() else {
            continue;
        };
        // Without a commit SHA the version is unknown: the thread keeps GitLab's position.
        if !refs::is_sha_like(&pos.head_sha) || pos.head_sha.eq_ignore_ascii_case(head) {
            continue;
        }
        thread.outdated = true;
        thread.placed_line = match (pos.new_line, pos.old_line) {
            (Some(line), _) => map.line(&pos.head_sha, head, &pos.new_path, line).await,
            (None, Some(line)) => {
                let from = if pos.base_sha.is_empty() {
                    base
                } else {
                    &pos.base_sha
                };
                map.line(from, base, &pos.old_path, line).await
            }
            (None, None) => None,
        };
    }
}

/// The line a thread shows on, `(new side, line)`: an outdated thread's placed line, a current
/// one's position line; the new side first, the old side for a removed line.
fn line_of(thread: &Thread) -> Option<(bool, u32)> {
    let pos = thread.position.as_ref()?;
    let new_side = pos.new_line.is_some();
    let line = if thread.outdated {
        thread.placed_line?
    } else {
        pos.new_line.or(pos.old_line)?
    };
    Some((new_side, line))
}

fn inside(hunk: &Hunk, (new_side, line): (bool, u32)) -> bool {
    let (start, count) = if new_side {
        (hunk.new_start, hunk.new_lines)
    } else {
        (hunk.old_start, hunk.old_lines)
    };
    line >= start && line < start.saturating_add(count)
}

/// The thread is on `file` (by its new or its old path).
fn same_file(file: &FileDiff, thread: &Thread) -> bool {
    thread.position.as_ref().is_some_and(|pos| {
        file.new_path.as_deref() == Some(pos.new_path.as_str())
            || file.old_path.as_deref() == Some(pos.old_path.as_str())
    })
}

/// The thread shows on a line inside one of `file`'s hunks.
pub fn on_line(file: &FileDiff, thread: &Thread) -> bool {
    same_file(file, thread)
        && line_of(thread).is_some_and(|at| file.hunks.iter().any(|h| inside(h, at)))
}

/// The threads on the file headers of step `step_id`: each diff thread that no step shows on a
/// line, in the first step of `order` that shows its file, in GitLab's order.
pub fn on_headers(
    plan: &Plan,
    files: &[FileDiff],
    threads: &[Thread],
    order: &[String],
    step_id: &str,
) -> Vec<Thread> {
    let shown: HashSet<&str> = plan
        .steps
        .iter()
        .flat_map(|s| s.hunk_ids.iter().map(String::as_str))
        .collect();
    let first_step = |file: &FileDiff| {
        order.iter().find(|id| {
            plan.steps
                .iter()
                .any(|s| &s.id == *id && file.hunks.iter().any(|h| s.hunk_ids.contains(&h.id)))
        })
    };
    threads
        .iter()
        .filter(|thread| {
            let Some(file) = files.iter().find(|f| same_file(f, thread)) else {
                return false;
            };
            let on_a_step_line = line_of(thread).is_some_and(|at| {
                file.hunks
                    .iter()
                    .any(|h| shown.contains(h.id.as_str()) && inside(h, at))
            });
            !on_a_step_line && first_step(file).is_some_and(|id| id == step_id)
        })
        .cloned()
        .collect()
}
