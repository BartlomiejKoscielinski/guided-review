//! SQLite store: connection, migrations, repositories (one per table group).
//!
//! One database file in the app data folder (docs/04 › Files and folders). The connection sits
//! behind a mutex; commands run store calls on the blocking thread pool.

pub mod app_state;
pub mod claude_sessions;
pub mod migrations;
pub mod plans;
pub mod repos;
pub mod session_progress;
pub mod sessions;
pub mod settings;
pub mod steps_state;
pub mod worktrees;

#[cfg(test)]
mod file_marks_tests;
#[cfg(test)]
mod session_mode_tests;
#[cfg(test)]
mod session_plan_opened_tests;
#[cfg(test)]
mod session_state_notes_tests;
#[cfg(test)]
mod session_state_tests;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::Connection;

use crate::error::AppError;
use crate::review::sessions::UnfinishedSession;
use crate::route::Route;
use crate::settings::SettingsError;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("could not create the folder {path}: {source}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("could not open the database {path}: {source}")]
    Open {
        path: PathBuf,
        source: rusqlite::Error,
    },
    #[error("database migration failed: {0}")]
    Migrate(#[from] rusqlite_migration::Error),
    #[error("database query failed: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("the database connection is unavailable after an earlier failure")]
    Poisoned,
    #[error(transparent)]
    Settings(#[from] SettingsError),
}

impl From<StoreError> for AppError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::Settings(e) => e.into(),
            other => AppError::internal("The app's database could not be used.")
                .with_detail(other.to_string()),
        }
    }
}

/// Handle to the app database; cheap to clone.
#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

impl Store {
    /// Opens (or creates) the database file, creating its folder, and migrates it.
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|source| StoreError::CreateDir {
                path: dir.to_path_buf(),
                source,
            })?;
        }
        let conn = Connection::open(path).map_err(|source| StoreError::Open {
            path: path.to_path_buf(),
            source,
        })?;
        Self::init(conn, true)
    }

    /// An in-memory database with the full schema, for tests.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::init(Connection::open_in_memory()?, false)
    }

    fn init(mut conn: Connection, file: bool) -> Result<Self, StoreError> {
        if file {
            // WAL lets a second app instance read while this one writes.
            conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| {
                row.get::<_, String>(0)
            })?;
        }
        conn.busy_timeout(Duration::from_secs(5))?;
        migrations::migrations().to_latest(&mut conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Runs `f` with the connection.
    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let mut conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        f(&mut conn)
    }
}

/// The screen to open on start (F-30.4): the saved last route if it can be restored, else S-01.
/// Reads only the database; it never starts Claude or GitLab work.
pub fn start_route(conn: &Connection) -> Result<Route, StoreError> {
    let last = settings::load(conn)?.ui.last_route;
    Ok(last.restored(|id| {
        sessions::exists(conn, id).unwrap_or_else(|error| {
            tracing::warn!(%error, "session lookup failed; opening the start screen");
            false
        })
    }))
}

/// Unfinished sessions for the Review tile, resumed at the saved last route when it is theirs.
pub fn unfinished_sessions(conn: &Connection) -> Result<Vec<UnfinishedSession>, StoreError> {
    let last = settings::load(conn)?.ui.last_route;
    sessions::list_unfinished(conn, &last)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::os::paths::db_path;
    use serde_json::json;

    #[test]
    fn f30_4_start_route_restores_a_screen_whose_session_exists() {
        let store = Store::open_in_memory().unwrap();
        let route = store
            .with_conn(|c| {
                sessions::insert_for_test(c, "s1", "reviewing", "focus", "2026-10-11T09:00:00Z");
                settings::update(
                    c,
                    &json!({ "ui": { "lastRoute": { "screen": "S-04", "sessionId": "s1" } } }),
                )?;
                start_route(c)
            })
            .unwrap();
        assert_eq!(
            route,
            Route::Detailed {
                session_id: "s1".into()
            }
        );
    }

    #[test]
    fn f30_4_start_route_falls_back_to_start_when_the_session_is_gone() {
        let store = Store::open_in_memory().unwrap();
        let route = store
            .with_conn(|c| {
                settings::update(
                    c,
                    &json!({ "ui": { "lastRoute": { "screen": "S-02", "sessionId": "gone" } } }),
                )?;
                start_route(c)
            })
            .unwrap();
        assert_eq!(route, Route::Start);
    }

    #[test]
    fn f30_4_invalid_last_route_falls_back_to_start() {
        let store = Store::open_in_memory().unwrap();
        let route = store
            .with_conn(|c| {
                c.execute(
                    "INSERT INTO settings (key, value) VALUES ('ui.lastRoute', '{\"screen\":\"S-42\"}')",
                    [],
                )?;
                start_route(c)
            })
            .unwrap();
        assert_eq!(route, Route::Start);
    }

    #[test]
    fn creates_the_database_and_its_folder_in_a_path_with_spaces_and_polish_characters() {
        let tmp = tempfile::tempdir().unwrap();
        let app_data = tmp.path().join("Zażółć gęślą jaźń").join("GuidedReview");
        let path = db_path(&app_data);
        let store = Store::open(&path).unwrap();
        assert!(path.is_file());
        let mode: String = store
            .with_conn(|c| Ok(c.query_row("PRAGMA journal_mode", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(mode, "wal");
        drop(store);
        // Reopening an existing database keeps it and doesn't migrate twice.
        let again = Store::open(&path).unwrap();
        let version: i64 = again
            .with_conn(|c| Ok(c.query_row("PRAGMA user_version", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(version, 7);
    }

    #[test]
    fn database_errors_become_internal_app_errors() {
        let app: AppError = StoreError::Poisoned.into();
        assert_eq!(app.code, ErrorCode::Internal);
        assert_eq!(app.message, "The app's database could not be used.");
        assert!(app.detail.is_some());
    }
}
