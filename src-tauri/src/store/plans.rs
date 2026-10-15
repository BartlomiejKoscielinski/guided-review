//! Plans repository (table `plans`): the session's plan as S-02 and S-03 show it in `plan_json`
//! (the "Pick up where you left off" card counts its steps, F-04.1) and the reader's dragged
//! step order (F-06.5) in `custom_order_json`. Claude's raw plan output lives in `claude_cache`
//! (M3 decision 7).

use rusqlite::{Connection, OptionalExtension, params};

use super::{Store, StoreError};
use crate::review::plan_model::Plan;

/// Stores the session's plan as S-02 and S-03 show it: Claude's plan after validation and the
/// coverage invariant (an "Other" step included), or the app's fallback plan. Replaces the
/// session's earlier plan; the dragged order stays.
pub fn set_plan(conn: &Connection, session: &str, plan: &Plan) -> Result<(), StoreError> {
    let json = serde_json::to_string(plan)
        .map_err(|e| StoreError::Sql(rusqlite::Error::ToSqlConversionFailure(Box::new(e))))?;
    conn.execute(
        "INSERT INTO plans (session_id, plan_json) VALUES (?1, ?2)
         ON CONFLICT(session_id) DO UPDATE SET plan_json = excluded.plan_json",
        params![session, json],
    )?;
    Ok(())
}

/// [`set_plan`] where a failure only costs the session's card its step count: logged, the plan
/// is still shown.
pub fn keep_plan(store: &Store, session: &str, plan: &Plan) {
    if let Err(error) = store.with_conn(|conn| set_plan(conn, session, plan)) {
        tracing::warn!(%error, "the session's plan was not stored");
    }
}

/// The session's custom step order; `None` when the reader hasn't dragged (or a strategy
/// cleared it). A row that doesn't parse counts as none.
pub fn custom_order(conn: &Connection, session: &str) -> Result<Option<Vec<String>>, StoreError> {
    let json: Option<Option<String>> = conn
        .query_row(
            "SELECT custom_order_json FROM plans WHERE session_id = ?1",
            params![session],
            |row| row.get(0),
        )
        .optional()?;
    Ok(json
        .flatten()
        .and_then(|j| serde_json::from_str::<Vec<String>>(&j).ok()))
}

/// Stores the custom order, or clears it with `None`.
pub fn set_custom_order(
    conn: &Connection,
    session: &str,
    order: Option<&[String]>,
) -> Result<(), StoreError> {
    let json = order.map(|o| serde_json::Value::from(o.to_vec()).to_string());
    conn.execute(
        "INSERT INTO plans (session_id, custom_order_json) VALUES (?1, ?2)
         ON CONFLICT(session_id) DO UPDATE SET custom_order_json = excluded.custom_order_json",
        params![session, json],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::store::Store;

    #[test]
    fn f06_5_custom_order_round_trip_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Zażółć gęślą").join("guided-review.db");
        let store = Store::open(&path).unwrap();
        let order = vec!["s2".to_owned(), "s1".to_owned()];
        store
            .with_conn(|c| {
                assert_eq!(custom_order(c, "r1")?, None);
                set_custom_order(c, "r1", Some(&order))?;
                Ok(())
            })
            .unwrap();
        drop(store);
        let store = Store::open(&path).unwrap();
        store
            .with_conn(|c| {
                assert_eq!(custom_order(c, "r1")?, Some(order.clone()));
                assert_eq!(custom_order(c, "r2")?, None);
                set_custom_order(c, "r1", None)?;
                assert_eq!(custom_order(c, "r1")?, None);
                Ok(())
            })
            .unwrap();
    }
}
