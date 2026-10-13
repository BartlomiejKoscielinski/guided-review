//! The session's step order (F-06.4, F-06.5): the strategy's order, or the reader's dragged
//! order, which overrides it until a strategy is picked again (that clears it). S-02 and the
//! S-03 step and ask tasks use the same order.

use std::collections::HashSet;

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use super::coverage::HunkRef;
use super::model::Strategy;
use super::plan_model::Plan;
use super::strategy;
use crate::error::{AppError, ErrorCode};
use crate::store::{self, StoreError};

/// The steps in the reader's order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StepOrder {
    pub strategy: Strategy,
    /// The reader dragged; no strategy is active on the toggle.
    pub custom: bool,
    /// Every step ID exactly once.
    pub order: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum StepOrderError {
    #[error("unknown session")]
    UnknownSession,
    #[error("the order doesn't match the plan's steps")]
    Mismatch,
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<StepOrderError> for AppError {
    fn from(error: StepOrderError) -> Self {
        match error {
            StepOrderError::UnknownSession => {
                AppError::new(ErrorCode::InvalidInput, "Unknown session.")
            }
            StepOrderError::Mismatch => AppError::new(
                ErrorCode::InvalidInput,
                "The order doesn't match the plan's steps.",
            ),
            StepOrderError::Store(e) => e.into(),
        }
    }
}

/// The stored order; a custom order saved for another plan keeps its known steps and gets the
/// new ones appended.
pub fn load(
    conn: &Connection,
    session: &str,
    plan: &Plan,
    hunks: &[HunkRef],
) -> Result<StepOrder, StepOrderError> {
    let strategy = store::sessions::strategy(conn, session)?;
    Ok(match store::plans::custom_order(conn, session)? {
        Some(mut order) => {
            strategy::complete_order(&mut order, &plan.steps);
            StepOrder {
                strategy,
                custom: true,
                order,
            }
        }
        None => StepOrder {
            strategy,
            custom: false,
            order: strategy::step_order(plan, strategy, hunks),
        },
    })
}

/// Picks a strategy (F-06.4): stored, the custom order cleared. No Claude call.
pub fn set_strategy(
    conn: &Connection,
    session: &str,
    strategy: Strategy,
    plan: &Plan,
    hunks: &[HunkRef],
) -> Result<StepOrder, StepOrderError> {
    if !store::sessions::set_strategy(conn, session, strategy)? {
        return Err(StepOrderError::UnknownSession);
    }
    store::plans::set_custom_order(conn, session, None)?;
    load(conn, session, plan, hunks)
}

/// Saves a dragged order (F-06.5); it must name every step of the plan exactly once.
pub fn reorder(
    conn: &Connection,
    session: &str,
    order: &[String],
    plan: &Plan,
    hunks: &[HunkRef],
) -> Result<StepOrder, StepOrderError> {
    if !store::sessions::exists(conn, session)? {
        return Err(StepOrderError::UnknownSession);
    }
    let steps: HashSet<&str> = plan.steps.iter().map(|s| s.id.as_str()).collect();
    let given: HashSet<&str> = order.iter().map(String::as_str).collect();
    if order.len() != steps.len() || given != steps {
        return Err(StepOrderError::Mismatch);
    }
    store::plans::set_custom_order(conn, session, Some(order))?;
    load(conn, session, plan, hunks)
}

#[cfg(test)]
#[path = "step_order_tests.rs"]
mod tests;
