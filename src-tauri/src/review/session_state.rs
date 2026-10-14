//! What S-03 keeps of a session between app starts (F-04.3), read when it opens: the step it was
//! on, its layout, where each step was scrolled and the ticked "For you to judge" items. Reviewed
//! steps (`review_mark_step`), note decisions, drafts and the step order are kept by their own
//! commands. Reads the database only.

use std::collections::BTreeMap;

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use super::model::Layout;
use crate::store::{StoreError, sessions, steps_state};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionState {
    /// The step S-03 was on; `None` before a step was opened.
    pub current_step: Option<String>,
    /// The last layout chosen for the session, else the one it was opened in (F-07.1).
    pub layout: Layout,
    /// Scroll offset in pixels of each scrolled step; a step not listed opens at the top.
    pub scroll: BTreeMap<String, u32>,
    /// The ticked "For you to judge" items of each step that has any (F-08.7).
    pub checklist: BTreeMap<String, Vec<String>>,
}

/// The session's state; `None` when there is no such session.
pub fn load(conn: &Connection, session: &str) -> Result<Option<SessionState>, StoreError> {
    let Some(layout) = sessions::layout(conn, session)? else {
        return Ok(None);
    };
    Ok(Some(SessionState {
        current_step: sessions::current_step(conn, session)?,
        layout,
        scroll: steps_state::scrolls(conn, session)?,
        checklist: steps_state::checklists(conn, session)?,
    }))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::store::Store;

    fn texts(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn f04_3_session_state_reads_what_s03_kept() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                sessions::insert_for_test(c, "r1", "reviewing", "focus", "2026-10-14T09:00:00Z");
                sessions::insert_for_test(c, "r2", "reviewing", "focus", "2026-10-14T09:00:00Z");
                assert!(sessions::set_layout(c, "r1", Layout::C)?);
                assert!(sessions::set_current_step(c, "r1", "s4")?);
                steps_state::set_scroll(c, "r1", "s4", 245)?;
                steps_state::set_scroll(c, "r1", "s2", 0)?;
                steps_state::set_reviewed(c, "r1", "s1", true)?;
                steps_state::set_checklist(c, "r1", "s4", &texts(&["Is the retry copy right?"]))?;
                steps_state::set_checklist(c, "r1", "s5", &[])?;
                steps_state::set_scroll(c, "r2", "s4", 9)?;

                let state = load(c, "r1")?.unwrap();
                assert_eq!(state.current_step.as_deref(), Some("s4"));
                assert_eq!(state.layout, Layout::C);
                assert_eq!(
                    state.scroll,
                    BTreeMap::from([("s2".to_owned(), 0), ("s4".to_owned(), 245)])
                );
                assert_eq!(
                    state.checklist,
                    BTreeMap::from([("s4".to_owned(), texts(&["Is the retry copy right?"]))])
                );

                // A session opened without a layout reads as A; nothing scrolled or ticked yet.
                let other = load(c, "r2")?.unwrap();
                assert_eq!(other.current_step, None);
                assert_eq!(other.layout, Layout::A);
                assert_eq!(other.scroll, BTreeMap::from([("s4".to_owned(), 9)]));
                assert!(other.checklist.is_empty());

                assert_eq!(load(c, "gone")?, None);
                Ok(())
            })
            .unwrap();
    }
}
