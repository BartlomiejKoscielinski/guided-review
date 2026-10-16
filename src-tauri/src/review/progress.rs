//! Reviewed steps and files (F-07.1, F-07.2, F-07.10): each file of a step can be marked reviewed
//! on its own; a step is reviewed when all its files are, and **Mark reviewed** marks all its
//! files at once (on a reviewed step it unmarks them). The step's flag in `steps_state` is what
//! the steps list checks and the progress segments count; a step flagged before file marks
//! existed counts as all its files reviewed.

use rusqlite::Connection;

use super::plan_model::{Plan, Step};
use crate::error::{AppError, ErrorCode};
use crate::git::model::FileDiff;
use crate::store::{StoreError, sessions, steps_state};

#[derive(Debug, thiserror::Error)]
pub enum ProgressError {
    #[error("the step is not in the plan")]
    NotInPlan,
    #[error("the file is not in the step")]
    NotInStep,
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<ProgressError> for AppError {
    fn from(error: ProgressError) -> Self {
        match error {
            ProgressError::NotInPlan => {
                AppError::new(ErrorCode::InvalidInput, "The step is not in the plan.")
            }
            ProgressError::NotInStep => {
                AppError::new(ErrorCode::InvalidInput, "The file is not in the step.")
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

/// Mark reviewed or its undo (F-07.2, F-07.10): marking flags the step, so all its files count
/// as reviewed; the undo takes back every file mark of the step. The session counts as used now
/// ("Pick up where you left off" order). Returns the plan's reviewed steps.
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
    if !reviewed {
        steps_state::set_files(conn, session, step, &[])?;
    }
    sessions::touch(conn, session)?;
    Ok(reviewed_steps(conn, session, plan)?)
}

/// The paths of the step's files (new path, else old path), in the diff's order.
fn step_files(step: &Step, files: &[FileDiff]) -> Vec<String> {
    files
        .iter()
        .filter(|f| f.hunks.iter().any(|h| step.hunk_ids.contains(&h.id)))
        .filter_map(|f| f.new_path.clone().or_else(|| f.old_path.clone()))
        .collect()
}

fn plan_step<'a>(plan: &'a Plan, step: &str) -> Result<&'a Step, ProgressError> {
    plan.steps
        .iter()
        .find(|s| s.id == step)
        .ok_or(ProgressError::NotInPlan)
}

/// The step's files marked reviewed (F-07.10), in the diff's order: all of them once the step is
/// reviewed (also a step marked before file marks existed), else the ones marked on their own.
pub fn reviewed_files(
    conn: &Connection,
    session: &str,
    plan: &Plan,
    files: &[FileDiff],
    step: &str,
) -> Result<Vec<String>, ProgressError> {
    let paths = step_files(plan_step(plan, step)?, files);
    Ok(marked_in(conn, session, step, paths)?)
}

fn marked_in(
    conn: &Connection,
    session: &str,
    step: &str,
    paths: Vec<String>,
) -> Result<Vec<String>, StoreError> {
    if steps_state::reviewed(conn, session, step)? {
        return Ok(paths);
    }
    let marked = steps_state::files(conn, session, step)?;
    Ok(paths.into_iter().filter(|p| marked.contains(p)).collect())
}

/// Marks or unmarks one file of one step (F-07.10; the same file in another step is its own
/// mark). The step becomes reviewed with its last file and stops being reviewed when a file is
/// taken back; its other files stay marked. Returns the plan's reviewed steps.
pub fn mark_file(
    conn: &Connection,
    session: &str,
    plan: &Plan,
    files: &[FileDiff],
    step: &str,
    file: &str,
    reviewed: bool,
) -> Result<Vec<String>, ProgressError> {
    let paths = step_files(plan_step(plan, step)?, files);
    if !paths.iter().any(|p| p == file) {
        return Err(ProgressError::NotInStep);
    }
    let mut marked = marked_in(conn, session, step, paths.clone())?;
    marked.retain(|p| p != file);
    if reviewed {
        marked.push(file.to_owned());
    }
    let all = paths.iter().all(|p| marked.contains(p));
    let ordered: Vec<String> = paths.into_iter().filter(|p| marked.contains(p)).collect();
    steps_state::set_files(conn, session, step, &ordered)?;
    steps_state::set_reviewed(conn, session, step, all)?;
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
    fn f07_10_a_file_outside_the_step_is_refused_with_its_message() {
        let error: AppError = ProgressError::NotInStep.into();
        assert_eq!(error.code, ErrorCode::InvalidInput);
        assert_eq!(error.message, "The file is not in the step.");
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                let error = mark_file(c, "r1", &plan(&["s1"]), &[], "s1", "a.cs", true);
                assert!(matches!(error, Err(ProgressError::NotInStep)));
                assert!(steps_state::files(c, "r1", "s1")?.is_empty());
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
