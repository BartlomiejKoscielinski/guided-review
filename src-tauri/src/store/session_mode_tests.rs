//! F-08.1 The Focus | Detailed toggle is per session (M4 decision 4): `session_set_mode` keeps the
//! session's mode in `sessions.mode`, Continue and resume open it, and Settings › General › Start
//! in stays the mode of new sessions only. Every test writes through the functions the app writes
//! with and "restarts" by opening the same database file again.

use serde_json::json;

use super::session_state_tests::{MR, OTHER, restart, started};
use super::{sessions, settings};
use crate::review::model::Mode;
use crate::review::session_state;
use crate::route::Route;

fn resume_of(c: &rusqlite::Connection, id: &str) -> Route {
    sessions::list_unfinished(c, &Route::Start)
        .unwrap()
        .into_iter()
        .find(|s| s.id == id)
        .map(|s| s.resume)
        .unwrap()
}

#[test]
fn f08_1_set_mode_round_trip_is_kept_per_session_across_a_restart() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            assert!(sessions::set_mode(c, MR, Mode::Detailed)?);
            // The last choice wins.
            assert!(sessions::set_mode(c, OTHER, Mode::Detailed)?);
            assert!(sessions::set_mode(c, OTHER, Mode::Focus)?);
            // There is no session to keep a mode for.
            assert!(!sessions::set_mode(c, "gone", Mode::Detailed)?);
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(session_state::load(c, MR)?.unwrap().mode, Mode::Detailed);
            assert_eq!(session_state::load(c, OTHER)?.unwrap().mode, Mode::Focus);
            assert_eq!(session_state::load(c, "gone")?, None);
            Ok(())
        })
        .unwrap();
}

#[test]
fn f08_1_resume_route_follows_the_mode_toggle() {
    let (_dir, path, store) = started();
    store
        .with_conn(|c| {
            // Both sessions were opened in Focus: Continue opens step review in Focus.
            assert_eq!(
                resume_of(c, MR),
                Route::Step {
                    session_id: MR.into()
                }
            );
            assert!(sessions::set_mode(c, MR, Mode::Detailed)?);
            assert_eq!(
                resume_of(c, MR),
                Route::Detailed {
                    session_id: MR.into()
                }
            );
            Ok(())
        })
        .unwrap();
    let store = restart(store, &path);
    store
        .with_conn(|c| {
            assert_eq!(
                resume_of(c, MR),
                Route::Detailed {
                    session_id: MR.into()
                }
            );
            assert_eq!(
                resume_of(c, OTHER),
                Route::Step {
                    session_id: OTHER.into()
                }
            );
            // Back to Focus: Continue follows it again.
            assert!(sessions::set_mode(c, MR, Mode::Focus)?);
            assert_eq!(
                resume_of(c, MR),
                Route::Step {
                    session_id: MR.into()
                }
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn f08_1_the_toggle_leaves_start_in_and_start_in_leaves_open_sessions() {
    let (_dir, _path, store) = started();
    store
        .with_conn(|c| {
            settings::update(c, &json!({ "ui": { "startIn": "focus" } }))?;
            assert!(sessions::set_mode(c, MR, Mode::Detailed)?);
            // The toggle is not a preference: Start in is still Focus.
            assert_eq!(settings::load(c)?.ui.start_in, Mode::Focus);

            // Start in is the mode of new sessions only; open sessions keep their own.
            settings::update(c, &json!({ "ui": { "startIn": "detailed" } }))?;
            assert_eq!(settings::load(c)?.ui.start_in, Mode::Detailed);
            assert_eq!(session_state::load(c, MR)?.unwrap().mode, Mode::Detailed);
            assert_eq!(session_state::load(c, OTHER)?.unwrap().mode, Mode::Focus);
            Ok(())
        })
        .unwrap();
}
