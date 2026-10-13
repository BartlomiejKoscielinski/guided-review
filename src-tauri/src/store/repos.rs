//! `repos`: the configured repositories (F-19.6) and the active one (F-30.7).
//!
//! The **default** repository is the one the app starts with (and deep links without a project
//! use, F-24.2). The **active** repository is the one S-01 and S-06 show; switching it is kept
//! in `app_state` until the app restarts, when it goes back to the default.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Row, params};

use super::{StoreError, app_state};

/// `app_state` key of the repository switched to in the title bar (F-30.7).
pub const ACTIVE_KEY: &str = "repos.activeId";

/// Name of the review worktree folder next to a repository (F-19.6).
pub const REVIEW_FOLDER: &str = ".review";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoRow {
    pub id: i64,
    pub name: String,
    pub path: String,
    /// `group/project` from the `origin` remote; `None` without a GitLab origin.
    pub gitlab_project: Option<String>,
    pub is_default: bool,
    /// The folder set in Settings; `None` means [`default_worktree_root`].
    pub worktree_root: Option<String>,
}

impl RepoRow {
    /// The review worktree folder: the configured one or `<repo parent>\.review`.
    pub fn effective_worktree_root(&self) -> PathBuf {
        self.worktree_root.as_ref().map_or_else(
            || default_worktree_root(Path::new(&self.path)),
            PathBuf::from,
        )
    }
}

/// `<repo parent>\.review` (the repository folder itself when it has no parent).
pub fn default_worktree_root(repo: &Path) -> PathBuf {
    repo.parent().unwrap_or(repo).join(REVIEW_FOLDER)
}

const COLUMNS: &str = "id, name, path, gitlab_project, is_default, worktree_root";

fn row(row: &Row<'_>) -> rusqlite::Result<RepoRow> {
    Ok(RepoRow {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        gitlab_project: row.get(3)?,
        is_default: row.get::<_, Option<i64>>(4)?.unwrap_or(0) != 0,
        worktree_root: row.get(5)?,
    })
}

/// All repositories, in the order they were added.
pub fn list(conn: &Connection) -> Result<Vec<RepoRow>, StoreError> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM repos ORDER BY id"))?;
    let rows = stmt.query_map([], row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> Result<Option<RepoRow>, StoreError> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM repos WHERE id = ?1"),
            [id],
            row,
        )
        .optional()?)
}

/// The repository of a GitLab project (case-insensitive, as GitLab paths are), if configured.
pub fn by_project(conn: &Connection, project: &str) -> Result<Option<RepoRow>, StoreError> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {COLUMNS} FROM repos WHERE lower(gitlab_project) = lower(?1)
                 ORDER BY is_default DESC, id LIMIT 1"
            ),
            [project],
            row,
        )
        .optional()?)
}

/// The repository at a path (case-insensitive, as Windows paths are), if configured.
pub fn by_path(conn: &Connection, path: &str) -> Result<Option<RepoRow>, StoreError> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM repos WHERE lower(path) = lower(?1) LIMIT 1"),
            [path],
            row,
        )
        .optional()?)
}

fn default_or_first(conn: &Connection) -> Result<Option<RepoRow>, StoreError> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM repos ORDER BY is_default DESC, id ASC LIMIT 1"),
            [],
            row,
        )
        .optional()?)
}

/// The repository switched to in this run, else the default one, else the first one added.
pub fn active(conn: &Connection) -> Result<Option<RepoRow>, StoreError> {
    let switched = app_state::get(conn, ACTIVE_KEY)?
        .and_then(|id| id.parse::<i64>().ok())
        .map(|id| get(conn, id))
        .transpose()?
        .flatten();
    match switched {
        Some(repo) => Ok(Some(repo)),
        None => default_or_first(conn),
    }
}

/// Makes a repository the active one (F-30.7). `false` when it doesn't exist.
pub fn switch(conn: &Connection, id: i64) -> Result<bool, StoreError> {
    if get(conn, id)?.is_none() {
        return Ok(false);
    }
    app_state::set(conn, ACTIVE_KEY, &id.to_string())?;
    Ok(true)
}

/// Forgets the switched repository, so the default one is active again (app start).
pub fn reset_active(conn: &Connection) -> Result<(), StoreError> {
    app_state::remove(conn, ACTIVE_KEY)
}

/// Adds a repository, or updates the name and project of the one at the same path. The first
/// repository becomes the default.
pub fn add(
    conn: &mut Connection,
    name: &str,
    path: &str,
    gitlab_project: Option<&str>,
) -> Result<RepoRow, StoreError> {
    let tx = conn.transaction()?;
    let existing = by_path(&tx, path)?;
    let id = match existing {
        Some(repo) => {
            tx.execute(
                "UPDATE repos SET name = ?2, gitlab_project = ?3 WHERE id = ?1",
                params![repo.id, name, gitlab_project],
            )?;
            repo.id
        }
        None => {
            tx.execute(
                "INSERT INTO repos (name, path, gitlab_project) VALUES (?1, ?2, ?3)",
                params![name, path, gitlab_project],
            )?;
            tx.last_insert_rowid()
        }
    };
    tx.execute(
        "UPDATE repos SET is_default = 1
         WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM repos WHERE is_default = 1)",
        [id],
    )?;
    let added = get(&tx, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    tx.commit()?;
    Ok(added)
}

/// Makes a repository the default one (F-19.6 Set as default). `false` when it doesn't exist.
pub fn set_default(conn: &mut Connection, id: i64) -> Result<bool, StoreError> {
    let tx = conn.transaction()?;
    if get(&tx, id)?.is_none() {
        return Ok(false);
    }
    tx.execute("UPDATE repos SET is_default = (id = ?1)", [id])?;
    tx.commit()?;
    Ok(true)
}

/// Removes a repository from the list (F-19.6 Remove; files on disk stay). When it was the
/// default, the first remaining one becomes the default; when it was active, the default is
/// active again. `false` when it doesn't exist.
pub fn remove(conn: &mut Connection, id: i64) -> Result<bool, StoreError> {
    let tx = conn.transaction()?;
    if tx.execute("DELETE FROM repos WHERE id = ?1", [id])? == 0 {
        return Ok(false);
    }
    tx.execute(
        "UPDATE repos SET is_default = 1
         WHERE id = (SELECT MIN(id) FROM repos)
           AND NOT EXISTS (SELECT 1 FROM repos WHERE is_default = 1)",
        [],
    )?;
    if app_state::get(&tx, ACTIVE_KEY)?.as_deref() == Some(id.to_string().as_str()) {
        app_state::remove(&tx, ACTIVE_KEY)?;
    }
    tx.commit()?;
    Ok(true)
}

/// Sets the review worktree folder; `None` goes back to `<repo parent>\.review`.
pub fn set_worktree_root(
    conn: &Connection,
    id: i64,
    root: Option<&str>,
) -> Result<bool, StoreError> {
    Ok(conn.execute(
        "UPDATE repos SET worktree_root = ?2 WHERE id = ?1",
        params![id, root],
    )? > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    const MOBILE: &str = r"C:\src\mobile-app";
    const POLISH: &str = r"C:\Repos ąę\Zażółć gęślą";

    fn with_store(f: impl FnOnce(&mut Connection) -> Result<(), StoreError>) {
        Store::open_in_memory().unwrap().with_conn(f).unwrap();
    }

    #[test]
    fn f19_6_first_added_repository_is_the_default() {
        with_store(|c| {
            assert_eq!(active(c)?, None);
            let first = add(c, "mobile-app", MOBILE, Some("mobile/mobile-app"))?;
            assert!(first.is_default);
            let second = add(c, "Zażółć gęślą", POLISH, None)?;
            assert!(!second.is_default);
            assert_eq!(second.path, POLISH);
            assert_eq!(active(c)?.map(|r| r.id), Some(first.id));
            assert_eq!(list(c)?.len(), 2);
            Ok(())
        });
    }

    #[test]
    fn f19_6_adding_the_same_path_again_updates_it() {
        with_store(|c| {
            let first = add(c, "mobile-app", MOBILE, None)?;
            let again = add(
                c,
                "mobile-app",
                &MOBILE.to_uppercase(),
                Some("mobile/mobile-app"),
            )?;
            assert_eq!(again.id, first.id);
            assert_eq!(again.gitlab_project.as_deref(), Some("mobile/mobile-app"));
            assert_eq!(list(c)?.len(), 1);
            Ok(())
        });
    }

    #[test]
    fn f19_6_set_default_and_remove() {
        with_store(|c| {
            let first = add(c, "mobile-app", MOBILE, None)?;
            let second = add(c, "Zażółć gęślą", POLISH, Some("mobile/zazolc"))?;
            assert!(set_default(c, second.id)?);
            assert!(!get(c, first.id)?.unwrap().is_default);
            assert_eq!(active(c)?.map(|r| r.id), Some(second.id));
            assert!(remove(c, second.id)?);
            assert!(get(c, first.id)?.unwrap().is_default);
            assert!(!remove(c, second.id)?);
            assert!(!set_default(c, 999)?);
            assert_eq!(by_project(c, "MOBILE/zazolc")?, None);
            Ok(())
        });
    }

    #[test]
    fn f19_6_worktree_root_defaults_next_to_the_repository() {
        with_store(|c| {
            let repo = add(c, "Zażółć gęślą", POLISH, None)?;
            assert_eq!(
                repo.effective_worktree_root(),
                Path::new(r"C:\Repos ąę").join(".review")
            );
            assert!(set_worktree_root(c, repo.id, Some(r"D:\review ćma"))?);
            assert_eq!(
                get(c, repo.id)?.unwrap().effective_worktree_root(),
                PathBuf::from(r"D:\review ćma")
            );
            set_worktree_root(c, repo.id, None)?;
            assert_eq!(get(c, repo.id)?.unwrap().worktree_root, None);
            Ok(())
        });
    }

    #[test]
    fn f30_7_switching_changes_the_active_repository_until_reset() {
        with_store(|c| {
            let first = add(c, "mobile-app", MOBILE, Some("mobile/mobile-app"))?;
            let second = add(c, "Zażółć gęślą", POLISH, Some("mobile/zazolc"))?;
            assert!(switch(c, second.id)?);
            assert_eq!(active(c)?.map(|r| r.id), Some(second.id));
            assert_eq!(
                by_project(c, "Mobile/Mobile-App")?.map(|r| r.id),
                Some(first.id)
            );
            reset_active(c)?;
            assert_eq!(active(c)?.map(|r| r.id), Some(first.id));
            switch(c, second.id)?;
            remove(c, second.id)?;
            assert_eq!(active(c)?.map(|r| r.id), Some(first.id));
            assert!(!switch(c, second.id)?);
            Ok(())
        });
    }
}
