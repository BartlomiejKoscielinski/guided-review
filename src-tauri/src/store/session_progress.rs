//! A session's progress on its "Pick up where you left off" card (F-04.1): the steps of its plan
//! marked reviewed, the plan's step count and the drafts not published yet. The plan is the one
//! S-02 and S-03 show (`plans.plan_json`, stored by `plans::set_plan`), never Claude's raw cached
//! output: validation can add an "Other" step or drop one (`review::coverage`).

use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;

use super::{StoreError, steps_state};

/// The numbers of a card's progress line.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Progress {
    pub reviewed: usize,
    pub total: usize,
    pub drafts: usize,
}

/// The step IDs of a stored `Plan`.
#[derive(Deserialize)]
struct PlanSteps {
    steps: Vec<StepId>,
}

#[derive(Deserialize)]
struct StepId {
    id: String,
}

/// The step IDs of the session's stored plan; empty while it has none (or it doesn't parse).
fn plan_steps(conn: &Connection, session: &str) -> Result<Vec<String>, StoreError> {
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT plan_json FROM plans WHERE session_id = ?1",
            params![session],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored
        .flatten()
        .and_then(|json| serde_json::from_str::<PlanSteps>(&json).ok())
        .map(|plan| plan.steps.into_iter().map(|s| s.id).collect())
        .unwrap_or_default())
}

/// Reviewed marks count only for steps of the current plan (like S-03's progress segments), so
/// marks left from an older plan never make "7 of 6 steps".
pub fn of(conn: &Connection, session: &str) -> Result<Progress, StoreError> {
    let steps = plan_steps(conn, session)?;
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
    use crate::review::plan_cache::{self, CacheKey, TaskSettings};
    use crate::review::plan_model::Plan;
    use crate::settings::ClaudeSettings;
    use crate::store::{Store, plans};
    use serde_json::json;

    /// A plan as S-02 shows it, with the given step IDs.
    fn plan(ids: &[&str]) -> Plan {
        let steps: Vec<_> = ids
            .iter()
            .map(|id| {
                json!({ "id": id, "title": id, "shortTitle": id, "reason": "", "description": "",
                        "layer": "core", "hunkIds": ["h1"], "buildsOn": [] })
            })
            .collect();
        serde_json::from_value(json!({
            "intent": "", "steps": steps,
            "orders": { "contractToUi": [], "testsFirst": [] },
            "skim": [], "risks": [], "descriptionCheck": [], "alreadyDiscussed": "",
            "coverage": { "files": 1, "filesTotal": 1, "hunks": 1, "hunksTotal": 1 }
        }))
        .unwrap()
    }

    #[test]
    fn f04_1_marks_outside_the_plan_and_published_drafts_do_not_count() {
        let store = Store::open_in_memory().unwrap();
        let progress = store
            .with_conn(|c| {
                plans::set_plan(c, "a", &plan(&["s1", "s2"]))?;
                for step in ["s1", "s9"] {
                    steps_state::set_reviewed(c, "a", step, true)?;
                }
                c.execute(
                    "INSERT INTO drafts (id, session_id, published_note_id) VALUES
                     ('d1', 'a', NULL), ('d2', 'a', 77), ('d3', 'b', NULL)",
                    [],
                )?;
                of(c, "a")
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
        let progress = store.with_conn(|c| of(c, "a")).unwrap();
        assert_eq!(progress, Progress::default());
    }

    #[test]
    fn f04_1_the_card_counts_the_stored_plan_never_claudes_raw_cached_output() {
        let store = Store::open_in_memory().unwrap();
        let progress = store
            .with_conn(|c| {
                // Claude's output names two steps; validation added an "Other" step s3.
                let raw = json!({ "steps": [{ "id": "s1" }, { "id": "s2" }] });
                let key = CacheKey::new(
                    plan_cache::TASK,
                    1,
                    "mr:471".into(),
                    "base",
                    "head",
                    ["h1".to_owned()],
                    None,
                    TaskSettings::plan(&ClaudeSettings::default()),
                );
                plan_cache::put(c, &key, &raw)?;
                // A cached plan alone is not the session's plan.
                assert_eq!(of(c, "a")?, Progress::default());
                plans::set_plan(c, "a", &plan(&["s1", "s2", "s3"]))?;
                steps_state::set_reviewed(c, "a", "s3", true)?;
                of(c, "a")
            })
            .unwrap();
        assert_eq!((progress.reviewed, progress.total), (1, 3));
    }

    #[test]
    fn f04_1_a_new_plan_replaces_the_stored_one_and_keeps_the_dragged_order() {
        let store = Store::open_in_memory().unwrap();
        let order = vec!["s2".to_owned(), "s1".to_owned()];
        let (progress, kept) = store
            .with_conn(|c| {
                plans::set_custom_order(c, "a", Some(&order))?;
                plans::set_plan(c, "a", &plan(&["s1", "s2", "s3", "s4"]))?;
                plans::set_plan(c, "a", &plan(&["f1", "f2"]))?;
                steps_state::set_reviewed(c, "a", "s1", true)?;
                Ok((of(c, "a")?, plans::custom_order(c, "a")?))
            })
            .unwrap();
        assert_eq!((progress.reviewed, progress.total), (0, 2));
        assert_eq!(kept, Some(order));
    }
}
