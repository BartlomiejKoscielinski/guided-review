//! The app's plan without Claude (02 › S-02 Claude failed or not signed in): one step per layer
//! group (F-05.4) in GitLab's file order, titled with the layer and the files' names as the
//! reason, the config risk (F-06.13), "N open threads." (F-06.9) and coverage; no intent, skim
//! or claims. Never cached.

use super::config_risk;
use super::coverage;
use super::layer::Layer;
use super::plan_model::{Orders, Plan, Step};
use super::strategy::gitlab_path_cmp;
use crate::claude::tasks::plan_inputs::layer_name;
use crate::git::model::FileDiff;
use crate::gitlab::discussions::{self, Thread};

/// The fallback plan of `files`; `threads` are the MR's (empty for other sources).
pub fn plan(files: &[FileDiff], threads: &[Thread]) -> Plan {
    let mut sorted: Vec<&FileDiff> = files.iter().filter(|f| !f.hunks.is_empty()).collect();
    sorted.sort_by(|a, b| gitlab_path_cmp(path(a), path(b)));

    let mut groups: Vec<(Layer, Vec<&FileDiff>)> = Vec::new();
    for file in sorted {
        match groups.iter_mut().find(|(layer, _)| *layer == file.layer) {
            Some((_, group)) => group.push(file),
            None => groups.push((file.layer, vec![file])),
        }
    }

    let steps: Vec<Step> = groups
        .into_iter()
        .enumerate()
        .map(|(i, (layer, group))| {
            let reason = group
                .iter()
                .map(|f| file_name(path(f)))
                .collect::<Vec<_>>()
                .join(", ");
            Step {
                id: format!("f{}", i + 1),
                title: layer_name(layer).to_owned(),
                short_title: layer_name(layer).to_owned(),
                description: reason.clone(),
                reason,
                layer,
                hunk_ids: group
                    .iter()
                    .flat_map(|f| f.hunks.iter().map(|h| h.id.clone()))
                    .collect(),
                builds_on: Vec::new(),
            }
        })
        .collect();
    let order: Vec<String> = steps.iter().map(|s| s.id.clone()).collect();

    let mut plan = Plan {
        intent: String::new(),
        steps,
        orders: Orders {
            contract_to_ui: order.clone(),
            tests_first: order,
        },
        skim: Vec::new(),
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: discussions::open_summary(threads).unwrap_or_default(),
        coverage: Default::default(),
    };
    config_risk::add_config_risk(&mut plan, files);
    plan.coverage = coverage::coverage(&plan, &coverage::hunk_refs(files));
    plan
}

fn path(file: &FileDiff) -> &str {
    file.new_path
        .as_deref()
        .or(file.old_path.as_deref())
        .unwrap_or_default()
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

#[cfg(test)]
#[path = "plan_fallback_tests.rs"]
mod tests;
