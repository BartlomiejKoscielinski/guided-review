//! Reviewed steps (F-07.1, F-07.2): **Mark reviewed** toggles a step's flag in the session; the
//! steps list checks and the progress segments show the plan's reviewed steps.

use rusqlite::Connection;

use super::plan_model::Plan;
use crate::error::{AppError, ErrorCode};
use crate::store::{StoreError, sessions, steps_state};

#[derive(Debug, thiserror::Error)]
pub enum ProgressError {
    #[error("the step is not in the plan")]
    NotInPlan,
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<ProgressError> for AppError {
    fn from(error: ProgressError) -> Self {
        match error {
            ProgressError::NotInPlan => {
                AppError::new(ErrorCode::InvalidInput, "The step is not in the plan.")
            }
            ProgressError::Store(e) => e.into(),
        }
    }
}

/// The plan's steps marked reviewed in the session, in plan order. Marks left from an older
/// plan of the session (other step IDs) don't count.
pub fn reviewed_steps(
    conn: &Connection,
    session: &str,
    plan: &Plan,
) -> Result<Vec<String>, StoreError> {
    let marked = steps_state::reviewed_ids(conn, session)?;
    Ok(plan
        .steps
        .iter()
        .filter(|s| marked.contains(&s.id))
        .map(|s| s.id.clone())
        .collect())
}

/// Mark reviewed or its undo (F-07.2); the session counts as used now ("Pick up where you left
/// off" order). Returns the plan's reviewed steps.
pub fn mark(
    conn: &Connection,
    session: &str,
    plan: &Plan,
    step: &str,
    reviewed: bool,
) -> Result<Vec<String>, ProgressError> {
    if !plan.steps.iter().any(|s| s.id == step) {
        return Err(ProgressError::NotInPlan);
    }
    steps_state::set_reviewed(conn, session, step, reviewed)?;
    sessions::touch(conn, session)?;
    Ok(reviewed_steps(conn, session, plan)?)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::review::layer::Layer;
    use crate::review::plan_model::{Coverage, Orders, Step};
    use crate::store::Store;

    fn plan(ids: &[&str]) -> Plan {
        Plan {
            intent: String::new(),
            steps: ids
                .iter()
                .map(|&id| Step {
                    id: id.into(),
                    title: id.into(),
                    short_title: id.into(),
                    reason: String::new(),
                    description: String::new(),
                    layer: Layer::Core,
                    hunk_ids: Vec::new(),
                    builds_on: Vec::new(),
                })
                .collect(),
            orders: Orders {
                contract_to_ui: Vec::new(),
                tests_first: Vec::new(),
            },
            skim: Vec::new(),
            risks: Vec::new(),
            description_check: Vec::new(),
            already_discussed: String::new(),
            coverage: Coverage::default(),
        }
    }

    #[test]
    fn f07_2_mark_and_unmark_return_reviewed_steps_in_plan_order() {
        let store = Store::open_in_memory().unwrap();
        let plan = plan(&["s1", "s2", "s3"]);
        store
            .with_conn(|c| {
                assert_eq!(mark(c, "r1", &plan, "s3", true).unwrap(), ["s3"]);
                assert_eq!(mark(c, "r1", &plan, "s1", true).unwrap(), ["s1", "s3"]);
                assert_eq!(mark(c, "r1", &plan, "s3", false).unwrap(), ["s1"]);
                assert!(steps_state::reviewed(c, "r1", "s1")?);
                assert!(!steps_state::reviewed(c, "r1", "s3")?);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn f07_2_mark_refuses_a_step_outside_the_plan() {
        let store = Store::open_in_memory().unwrap();
        let plan = plan(&["s1"]);
        store
            .with_conn(|c| {
                let error = mark(c, "r1", &plan, "s9", true).unwrap_err();
                assert!(matches!(error, ProgressError::NotInPlan));
                assert!(steps_state::reviewed_ids(c, "r1")?.is_empty());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn f07_1_done_steps_ignore_marks_of_an_older_plan() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                steps_state::set_reviewed(c, "r1", "old", true)?;
                steps_state::set_reviewed(c, "r1", "s2", true)?;
                steps_state::set_reviewed(c, "r2", "s1", true)?;
                assert_eq!(reviewed_steps(c, "r1", &plan(&["s1", "s2"]))?, ["s2"]);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn f07_2_mark_touches_the_session() {
        let store = Store::open_in_memory().unwrap();
        let plan = plan(&["s1"]);
        store
            .with_conn(|c| {
                c.execute(
                    "INSERT INTO sessions (id, status, updated_at) VALUES ('r1', 'open', '2000-01-01')",
                    [],
                )?;
                mark(c, "r1", &plan, "s1", true).unwrap();
                let updated: String = c.query_row(
                    "SELECT updated_at FROM sessions WHERE id = 'r1'",
                    [],
                    |row| row.get(0),
                )?;
                assert!(updated.as_str() > "2000-01-01");
                Ok(())
            })
            .unwrap();
    }
}
