//! A session's progress on its "Pick up where you left off" card (F-04.1): the steps of its plan
//! marked reviewed, the plan's step count and the drafts not published yet.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use serde_json::Value;

use super::{StoreError, steps_state};
use crate::review::plan_cache;

/// The numbers of a card's progress line.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Progress {
    pub reviewed: usize,
    pub total: usize,
    pub drafts: usize,
}

/// The session's place in the cache: repository, `plan_cache::subject` and head commit.
pub struct PlanOf<'a> {
    pub repo_id: Option<i64>,
    pub subject: &'a str,
    pub head_sha: &'a str,
}

/// The step IDs of a plan, from a stored `Plan` or Claude's plan output alike.
#[derive(Deserialize)]
struct PlanSteps {
    steps: Vec<StepId>,
}

#[derive(Deserialize)]
struct StepId {
    id: String,
}

fn step_ids(plan: Value) -> Option<Vec<String>> {
    serde_json::from_value::<PlanSteps>(plan)
        .ok()
        .map(|p| p.steps.into_iter().map(|s| s.id).collect())
}

/// The session's plan: `plans.plan_json`, else the newest cached plan of its source and head
/// (M3 decision 7). `None` while there is no plan.
fn plan_steps(
    conn: &Connection,
    session: &str,
    plan: &PlanOf<'_>,
) -> Result<Option<Vec<String>>, StoreError> {
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT plan_json FROM plans WHERE session_id = ?1",
            params![session],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(steps) = stored
        .flatten()
        .and_then(|json| serde_json::from_str::<Value>(&json).ok())
        .and_then(step_ids)
    {
        return Ok(Some(steps));
    }
    let Some(repo_id) = plan.repo_id else {
        return Ok(None);
    };
    Ok(plan_cache::latest_plan(conn, repo_id, plan.subject, plan.head_sha)?.and_then(step_ids))
}

/// Reviewed marks count only for steps of the current plan (like S-03's progress segments), so
/// marks left from an older plan never make "7 of 6 steps".
pub fn of(conn: &Connection, session: &str, plan: &PlanOf<'_>) -> Result<Progress, StoreError> {
    let steps = plan_steps(conn, session, plan)?.unwrap_or_default();
    let marked = steps_state::reviewed_ids(conn, session)?;
    let drafts: i64 = conn.query_row(
        "SELECT COUNT(*) FROM drafts WHERE session_id = ?1 AND published_note_id IS NULL",
        params![session],
        |row| row.get(0),
    )?;
    Ok(Progress {
        reviewed: steps.iter().filter(|id| marked.contains(*id)).count(),
        total: steps.len(),
        drafts: usize::try_from(drafts).unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::store::Store;
    use serde_json::json;

    const NONE: PlanOf<'static> = PlanOf {
        repo_id: None,
        subject: "local:uncommitted",
        head_sha: "h",
    };

    #[test]
    fn f04_1_marks_outside_the_plan_and_published_drafts_do_not_count() {
        let store = Store::open_in_memory().unwrap();
        let progress = store
            .with_conn(|c| {
                let plan = json!({ "steps": [{ "id": "s1" }, { "id": "s2" }] });
                c.execute(
                    "INSERT INTO plans (session_id, plan_json) VALUES ('a', ?1)",
                    params![plan.to_string()],
                )?;
                for step in ["s1", "s9"] {
                    steps_state::set_reviewed(c, "a", step, true)?;
                }
                c.execute(
                    "INSERT INTO drafts (id, session_id, published_note_id) VALUES
                     ('d1', 'a', NULL), ('d2', 'a', 77), ('d3', 'b', NULL)",
                    [],
                )?;
                of(c, "a", &NONE)
            })
            .unwrap();
        assert_eq!(
            progress,
            Progress {
                reviewed: 1,
                total: 2,
                drafts: 1
            }
        );
    }

    #[test]
    fn f04_1_a_session_without_a_plan_has_no_steps() {
        let store = Store::open_in_memory().unwrap();
        let progress = store.with_conn(|c| of(c, "a", &NONE)).unwrap();
        assert_eq!(progress, Progress::default());
    }
}
