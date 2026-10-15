//! F-08.3 The rail's first item "Change overview" is done once the session's plan was opened:
//! S-02 calls `session_mark_plan_opened`, the core keeps the time in `sessions.plan_opened_at`
//! (migration 006) and `session_state` reads it back as `planOpened`. Every test writes through
//! the functions the app writes with and "restarts" by opening the same database file again.

use super::session_state_tests::{MR, OTHER, restart, started};
use super::sessions;
use crate::review::session_state;

#[test]
fn f08_3_plan_opened_is_kept_per_session_across_a_restart() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            // A session that S-02 never showed: the overview isn't done yet.
            assert!(!session_state::load(c, MR)?.unwrap().plan_opened);
            assert!(sessions::mark_plan_opened(c, MR)?);
            // Opening the plan again keeps it done.
            assert!(sessions::mark_plan_opened(c, MR)?);
            // There is no session to mark.
            assert!(!sessions::mark_plan_opened(c, "gone")?);
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert!(session_state::load(c, MR)?.unwrap().plan_opened);
            assert!(!session_state::load(c, OTHER)?.unwrap().plan_opened);
            assert_eq!(session_state::load(c, "gone")?, None);
            Ok(())
        })
        .unwrap();
}

#[test]
fn f08_3_migration_006_adds_plan_opened_at_to_sessions() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            let columns = c
                .prepare("SELECT name FROM pragma_table_info('sessions')")?
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            assert!(columns.iter().any(|name| name == "plan_opened_at"));
            assert!(sessions::mark_plan_opened(c, OTHER)?);
            let at: Option<String> = c.query_row(
                "SELECT plan_opened_at FROM sessions WHERE id = ?1",
                [OTHER],
                |row| row.get(0),
            )?;
            assert!(
                at.is_some_and(|t| !t.is_empty()),
                "the time S-02 was opened"
            );
            let untouched: Option<String> = c.query_row(
                "SELECT plan_opened_at FROM sessions WHERE id = ?1",
                [MR],
                |row| row.get(0),
            )?;
            assert_eq!(untouched, None);
            Ok(())
        })
        .unwrap();
}
