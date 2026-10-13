//! Coverage invariant (F-06.10, docs/04 › Core data model): after any plan change, every hunk
//! of the session belongs to exactly one step or one skim group, whatever Claude returned.
//! Unknown IDs are dropped, a hunk listed twice keeps its first place (steps before skim),
//! emptied steps and groups disappear, and missing hunks go to an "Other" step at the end.

use std::collections::{HashMap, HashSet};

use super::layer::Layer;
use super::plan_model::{Coverage, Plan, Step};
use super::strategy;
use crate::git::model::FileDiff;

pub const OTHER_TITLE: &str = "Other";
pub const OTHER_REASON: &str = "Changes the plan didn't place.";
pub const OTHER_DESCRIPTION: &str = "The app added these changes because the plan left them out.";

/// A hunk of the session and the file it belongs to, in diff order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HunkRef<'a> {
    pub id: &'a str,
    pub file: &'a str,
}

/// Every hunk of the change, file-level hunks included (F-05.7).
pub fn hunk_refs(files: &[FileDiff]) -> Vec<HunkRef<'_>> {
    files
        .iter()
        .flat_map(|f| {
            let file = f
                .new_path
                .as_deref()
                .or(f.old_path.as_deref())
                .unwrap_or_default();
            f.hunks.iter().map(move |h| HunkRef { id: &h.id, file })
        })
        .collect()
}

/// Restores the invariant and recomputes `plan.coverage`.
pub fn enforce(plan: &mut Plan, hunks: &[HunkRef]) {
    let known: HashSet<&str> = hunks.iter().map(|h| h.id).collect();
    let mut placed: HashSet<String> = HashSet::new();
    let mut keep = |ids: &mut Vec<String>| {
        ids.retain(|id| known.contains(id.as_str()) && placed.insert(id.clone()));
    };
    for step in &mut plan.steps {
        keep(&mut step.hunk_ids);
    }
    for group in &mut plan.skim {
        keep(&mut group.hunk_ids);
    }
    plan.steps.retain(|s| !s.hunk_ids.is_empty());
    plan.skim.retain(|g| !g.hunk_ids.is_empty());

    let missing: Vec<String> = hunks
        .iter()
        .filter(|h| !placed.contains(h.id))
        .map(|h| h.id.to_owned())
        .collect();
    if !missing.is_empty() {
        plan.steps.push(other_step(&plan.steps, missing));
    }
    drop_stale_step_refs(plan);
    plan.coverage = coverage(plan, hunks);
}

/// Whether every hunk is in exactly one step or skim group and no unknown ID is left.
pub fn holds(plan: &Plan, hunks: &[HunkRef]) -> bool {
    let mut seen: HashMap<&str, u32> = hunks.iter().map(|h| (h.id, 0)).collect();
    let listed = plan
        .steps
        .iter()
        .flat_map(|s| &s.hunk_ids)
        .chain(plan.skim.iter().flat_map(|g| &g.hunk_ids));
    for id in listed {
        match seen.get_mut(id.as_str()) {
            Some(count) => *count += 1,
            None => return false,
        }
    }
    seen.values().all(|&c| c == 1)
}

/// Files and hunks placed in a step or skim group, of all in the change.
pub fn coverage(plan: &Plan, hunks: &[HunkRef]) -> Coverage {
    let listed: HashSet<&str> = plan
        .steps
        .iter()
        .flat_map(|s| &s.hunk_ids)
        .chain(plan.skim.iter().flat_map(|g| &g.hunk_ids))
        .map(String::as_str)
        .collect();
    let mut files: HashMap<&str, bool> = HashMap::new();
    let mut covered_hunks = 0;
    for h in hunks {
        let covered = listed.contains(h.id);
        covered_hunks += u32::from(covered);
        let all = files.entry(h.file).or_insert(true);
        *all &= covered;
    }
    Coverage {
        files: count(files.values().filter(|&&all| all)),
        files_total: count(files.values()),
        hunks: covered_hunks,
        hunks_total: count(hunks.iter()),
    }
}

fn count<T>(items: impl Iterator<Item = T>) -> u32 {
    u32::try_from(items.count()).unwrap_or(u32::MAX)
}

fn other_step(steps: &[Step], hunk_ids: Vec<String>) -> Step {
    let next = steps
        .iter()
        .filter_map(|s| s.id.strip_prefix('s')?.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        + 1;
    Step {
        id: format!("s{next}"),
        title: OTHER_TITLE.into(),
        short_title: OTHER_TITLE.into(),
        reason: OTHER_REASON.into(),
        description: OTHER_DESCRIPTION.into(),
        layer: Layer::Other,
        hunk_ids,
        builds_on: Vec::new(),
    }
}

/// Removes references to steps that no longer exist and completes both Claude orders.
fn drop_stale_step_refs(plan: &mut Plan) {
    let ids: HashSet<String> = plan.steps.iter().map(|s| s.id.clone()).collect();
    for step in &mut plan.steps {
        step.builds_on.retain(|id| ids.contains(id));
    }
    for risk in &mut plan.risks {
        risk.steps.retain(|id| ids.contains(id));
    }
    for claim in &mut plan.description_check {
        if claim.step.as_ref().is_some_and(|id| !ids.contains(id)) {
            claim.step = None;
        }
    }
    strategy::complete_order(&mut plan.orders.contract_to_ui, &plan.steps);
    strategy::complete_order(&mut plan.orders.tests_first, &plan.steps);
}

#[cfg(test)]
mod tests;
