//! `worktrees`: the app-managed worktrees (F-05.1, ADR-018). Only paths registered here are
//! ever moved or removed by the app (T8).

use rusqlite::{Connection, OptionalExtension, params};

use super::StoreError;

/// `worktrees.kind` of a teammate's MR worktree.
pub const KIND_REVIEW: &str = "review";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeRow {
    pub path: String,
    pub repo_id: i64,
    pub kind: String,
    pub project: Option<String>,
    pub iid: Option<u64>,
    pub head_sha: Option<String>,
}

/// The registered worktree at `path` (ASCII case-insensitive, like `repos::by_path`).
pub fn get(conn: &Connection, path: &str) -> Result<Option<WorktreeRow>, StoreError> {
    Ok(conn
        .query_row(
            "SELECT path, repo_id, kind, project, iid, head_sha FROM worktrees
             WHERE lower(path) = lower(?1) LIMIT 1",
            [path],
            |row| {
                Ok(WorktreeRow {
                    path: row.get(0)?,
                    repo_id: row.get(1)?,
                    kind: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    project: row.get(3)?,
                    iid: row
                        .get::<_, Option<i64>>(4)?
                        .and_then(|i| u64::try_from(i).ok()),
                    head_sha: row.get(5)?,
                })
            },
        )
        .optional()?)
}

/// Registers (or re-registers) a worktree; called before git creates it, so a half-made one
/// can be removed.
pub fn register(conn: &Connection, row: &WorktreeRow) -> Result<(), StoreError> {
    let iid = row.iid.and_then(|i| i64::try_from(i).ok());
    conn.execute(
        "INSERT INTO worktrees (path, repo_id, kind, project, iid, head_sha, created_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(path) DO UPDATE SET repo_id = ?2, kind = ?3, project = ?4, iid = ?5,
                 head_sha = ?6, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![
            row.path,
            row.repo_id,
            row.kind,
            row.project,
            iid,
            row.head_sha
        ],
    )?;
    Ok(())
}

/// The worktree now sits at `head_sha` and was just used.
pub fn touch(conn: &Connection, path: &str, head_sha: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE worktrees SET head_sha = ?2, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE lower(path) = lower(?1)",
        params![path, head_sha],
    )?;
    Ok(())
}

pub fn unregister(conn: &Connection, path: &str) -> Result<(), StoreError> {
    conn.execute(
        "DELETE FROM worktrees WHERE lower(path) = lower(?1)",
        [path],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn f05_1_worktree_registry_round_trip() {
        let store = Store::open_in_memory().unwrap();
        let path = r"C:\src\.review\mobile ąę\482";
        store
            .with_conn(|c| {
                register(
                    c,
                    &WorktreeRow {
                        path: path.into(),
                        repo_id: 1,
                        kind: KIND_REVIEW.into(),
                        project: Some("mobile/mobile-app".into()),
                        iid: Some(482),
                        head_sha: None,
                    },
                )?;
                touch(c, &path.to_ascii_uppercase(), "abc")?;
                let row = get(c, path)?.unwrap();
                assert_eq!(row.head_sha.as_deref(), Some("abc"));
                assert_eq!(row.iid, Some(482));
                unregister(c, path)?;
                assert!(get(c, path)?.is_none());
                Ok(())
            })
            .unwrap();
    }
}
