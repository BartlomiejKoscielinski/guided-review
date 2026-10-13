//! Validation of the plan task's `structured_output` (F-06.3, 05 › Tasks, models and
//! contracts). Authoritative even though the CLI enforces `plan.schema.json`: structural
//! errors, unknown step or hunk IDs and plans that reference fewer than 90% of the hunks are
//! `CLAUDE_SCHEMA` (never partial data); too long strings are clamped with "…". The result
//! satisfies the coverage invariant.

use std::collections::HashSet;

use serde::Deserialize;
use serde_json::Value;

use super::coverage::{self, HunkRef};
use super::layer::Layer;
use super::plan_model::{
    Claim, ClaimStatus, Coverage, Orders, Plan, Risk, RiskSeverity, SkimGroup, Step,
};
use crate::claude::error::ClaudeError;
use crate::claude::result::clamp;

// maxLength and maxItems of plan.schema.json.
const INTENT_MAX: usize = 600;
const TITLE_MAX: usize = 60;
const SHORT_TITLE_MAX: usize = 24;
const REASON_MAX: usize = 110;
const DESCRIPTION_MAX: usize = 300;
const SKIM_REASON_MAX: usize = 120;
const RISK_MAX: usize = 200;
const CLAIM_MAX: usize = 160;
const DISCUSSED_MAX: usize = 300;
const STEPS_MAX: usize = 15;
const RISKS_MAX: usize = 6;
const CLAIMS_MAX: usize = 8;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlanOutput {
    intent: String,
    steps: Vec<StepOutput>,
    orders: OrdersOutput,
    skim: Vec<SkimOutput>,
    risks: Vec<RiskOutput>,
    description_check: Vec<ClaimOutput>,
    already_discussed: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StepOutput {
    id: String,
    title: String,
    short_title: String,
    reason: String,
    description: String,
    layer: String,
    hunk_ids: Vec<String>,
    builds_on: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OrdersOutput {
    contract_to_ui: Vec<String>,
    tests_first: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SkimOutput {
    hunk_ids: Vec<String>,
    reason: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RiskOutput {
    text: String,
    severity: RiskSeverity,
    steps: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClaimOutput {
    claim: String,
    #[serde(deserialize_with = "claim_status")]
    status: ClaimStatus,
    #[serde(default)]
    step: Option<String>,
}

fn claim_status<'de, D: serde::Deserializer<'de>>(d: D) -> Result<ClaimStatus, D::Error> {
    match String::deserialize(d)?.as_str() {
        "found" => Ok(ClaimStatus::Found),
        "missing" => Ok(ClaimStatus::Missing),
        "contradicted" => Ok(ClaimStatus::Contradicted),
        "not_in_description" => Ok(ClaimStatus::NotInDescription),
        _ => Err(serde::de::Error::custom("unknown claim status")),
    }
}

/// The schema's layer names ("XAML", …) as `Layer`.
fn layer(name: &str) -> Option<Layer> {
    Some(match name {
        "Core" => Layer::Core,
        "Infrastructure" => Layer::Infrastructure,
        "App" => Layer::App,
        "XAML" => Layer::Xaml,
        "Platforms" => Layer::Platforms,
        "Tests" => Layer::Tests,
        "Resources" => Layer::Resources,
        "Build" => Layer::Build,
        "Other" => Layer::Other,
        _ => return None,
    })
}

fn is_step_id(id: &str) -> bool {
    id.strip_prefix('s')
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

fn schema(detail: &str) -> ClaudeError {
    ClaudeError::Schema(detail.to_owned())
}

/// The validated plan for the session's hunks (diff order). Details never quote Claude's text.
pub fn validate(output: Option<&Value>, hunks: &[HunkRef]) -> Result<Plan, ClaudeError> {
    let value = output.ok_or_else(|| schema("no structured output"))?;
    let out = PlanOutput::deserialize(value)
        .map_err(|_| schema("structured output doesn't match plan.schema.json"))?;
    check_shape(&out)?;
    check_ids(&out, hunks)?;

    let mut plan = Plan {
        intent: clamp(&out.intent, INTENT_MAX),
        steps: out.steps.iter().map(step).collect::<Result<_, _>>()?,
        orders: Orders {
            contract_to_ui: out.orders.contract_to_ui,
            tests_first: out.orders.tests_first,
        },
        skim: out
            .skim
            .into_iter()
            .map(|g| SkimGroup {
                reason: clamp(&g.reason, SKIM_REASON_MAX),
                hunk_ids: g.hunk_ids,
            })
            .collect(),
        risks: out
            .risks
            .into_iter()
            .map(|r| Risk {
                text: clamp(&r.text, RISK_MAX),
                severity: r.severity,
                steps: r.steps,
                app: false,
            })
            .collect(),
        description_check: out
            .description_check
            .into_iter()
            .map(|c| Claim {
                claim: clamp(&c.claim, CLAIM_MAX),
                status: c.status,
                step: c.step,
            })
            .collect(),
        already_discussed: clamp(&out.already_discussed, DISCUSSED_MAX),
        coverage: Coverage::default(),
    };
    coverage::enforce(&mut plan, hunks);
    Ok(plan)
}

fn step(s: &StepOutput) -> Result<Step, ClaudeError> {
    Ok(Step {
        id: s.id.clone(),
        title: clamp(&s.title, TITLE_MAX),
        short_title: clamp(&s.short_title, SHORT_TITLE_MAX),
        reason: clamp(&s.reason, REASON_MAX),
        description: clamp(&s.description, DESCRIPTION_MAX),
        layer: layer(&s.layer).ok_or_else(|| schema("unknown step layer"))?,
        hunk_ids: s.hunk_ids.clone(),
        builds_on: s.builds_on.clone(),
    })
}

/// minItems, maxItems and the step ID pattern of the schema.
fn check_shape(out: &PlanOutput) -> Result<(), ClaudeError> {
    if out.steps.is_empty() || out.steps.len() > STEPS_MAX {
        return Err(schema("number of steps outside 1-15"));
    }
    if out.risks.len() > RISKS_MAX || out.description_check.len() > CLAIMS_MAX {
        return Err(schema("too many risks or description claims"));
    }
    let empty_step = out.steps.iter().any(|s| s.hunk_ids.is_empty());
    if empty_step || out.skim.iter().any(|g| g.hunk_ids.is_empty()) {
        return Err(schema("a step or skim group without hunks"));
    }
    let mut ids = HashSet::new();
    if !out
        .steps
        .iter()
        .all(|s| is_step_id(&s.id) && ids.insert(&s.id))
    {
        return Err(schema("invalid or duplicate step ID"));
    }
    Ok(())
}

/// Every step reference names a step of the plan, every hunk ID a hunk of the change, and at
/// least 90% of the change's hunks are referenced.
fn check_ids(out: &PlanOutput, hunks: &[HunkRef]) -> Result<(), ClaudeError> {
    let steps: HashSet<&str> = out.steps.iter().map(|s| s.id.as_str()).collect();
    let step_refs = out
        .steps
        .iter()
        .flat_map(|s| &s.builds_on)
        .chain(&out.orders.contract_to_ui)
        .chain(&out.orders.tests_first)
        .chain(out.risks.iter().flat_map(|r| &r.steps))
        .chain(out.description_check.iter().filter_map(|c| c.step.as_ref()));
    if step_refs.into_iter().any(|id| !steps.contains(id.as_str())) {
        return Err(schema("unknown step ID"));
    }

    let known: HashSet<&str> = hunks.iter().map(|h| h.id).collect();
    let mut referenced: HashSet<&str> = HashSet::new();
    let hunk_refs = out
        .steps
        .iter()
        .flat_map(|s| &s.hunk_ids)
        .chain(out.skim.iter().flat_map(|g| &g.hunk_ids));
    for id in hunk_refs {
        if !known.contains(id.as_str()) {
            return Err(schema("unknown hunk ID"));
        }
        referenced.insert(id);
    }
    if referenced.len() * 10 < known.len() * 9 {
        return Err(ClaudeError::Schema(format!(
            "the plan references {} of {} hunks (at least 90% required)",
            referenced.len(),
            known.len()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
