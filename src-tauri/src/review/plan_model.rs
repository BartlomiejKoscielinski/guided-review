//! The review plan (docs/04 › Core data model): Claude's plan after validation (`plan.rs`),
//! with the coverage invariant applied (`coverage.rs`) and app risks added (`config_risk.rs`).
//! Stored as `plans.plan_json`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::layer::Layer;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Plan {
    /// "What this change does" (F-06.2).
    pub intent: String,
    pub steps: Vec<Step>,
    pub orders: Orders,
    pub skim: Vec<SkimGroup>,
    pub risks: Vec<Risk>,
    pub description_check: Vec<Claim>,
    pub already_discussed: String,
    pub coverage: Coverage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Step {
    /// "s1", "s2", …
    pub id: String,
    pub title: String,
    /// Label in the steps list of layout A.
    pub short_title: String,
    /// Why the step is here in the order; the same under every strategy.
    pub reason: String,
    pub description: String,
    pub layer: Layer,
    pub hunk_ids: Vec<String>,
    pub builds_on: Vec<String>,
}

/// Claude's step orders (F-06.4); File order is computed (`strategy.rs`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Orders {
    pub contract_to_ui: Vec<String>,
    pub tests_first: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SkimGroup {
    pub hunk_ids: Vec<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RiskSeverity {
    /// Orange square ("Should fix").
    Fix,
    Q,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Risk {
    pub text: String,
    pub severity: RiskSeverity,
    /// Step IDs the risk points at.
    pub steps: Vec<String>,
    /// Added by the app without AI (F-06.13), not by Claude.
    pub app: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ClaimStatus {
    Found,
    Missing,
    Contradicted,
    NotInDescription,
}

/// A claim of the MR description checked against the code (F-06.8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Claim {
    pub claim: String,
    pub status: ClaimStatus,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
}

/// Aside Coverage (F-06.10): files and hunks in a step or skim group, of all in the change.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Coverage {
    pub files: u32,
    pub files_total: u32,
    pub hunks: u32,
    pub hunks_total: u32,
}
