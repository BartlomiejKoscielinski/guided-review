//! `repos`: the configured repositories. In M1 only the default one is used (S-06 "Pick a
//! repository"); the list, Set as default and Remove come with F-19.6 in M2.

use rusqlite::{Connection, OptionalExtension, params};

use super::StoreError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoRow {
    pub id: i64,
    pub name: String,
    pub path: String,
}

/// The default repository, or the first one added.
pub fn active(conn: &Connection) -> Result<Option<RepoRow>, StoreError> {
    Ok(conn
        .query_row(
            "SELECT id, name, path FROM repos ORDER BY is_default DESC, id ASC LIMIT 1",
            [],
            |row| {
                Ok(RepoRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                })
            },
        )
        .optional()?)
}

/// Adds the repository (or finds it by path) and makes it the default.
pub fn set_default(conn: &mut Connection, name: &str, path: &str) -> Result<RepoRow, StoreError> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO repos (name, path) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET name = excluded.name",
        params![name, path],
    )?;
    tx.execute("UPDATE repos SET is_default = (path = ?1)", [path])?;
    let row = tx.query_row(
        "SELECT id, name, path FROM repos WHERE path = ?1",
        [path],
        |row| {
            Ok(RepoRow {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
            })
        },
    )?;
    tx.commit()?;
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn the_picked_repository_becomes_the_default() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                assert_eq!(active(c)?, None);
                set_default(c, "mobile-app", r"C:\src\mobile-app")?;
                let second = set_default(c, "Zażółć", r"C:\src\Zażółć gęślą")?;
                assert_eq!(active(c)?, Some(second));
                let first = set_default(c, "mobile-app", r"C:\src\mobile-app")?;
                assert_eq!(active(c)?.map(|r| r.id), Some(first.id));
                let count: i64 = c.query_row("SELECT COUNT(*) FROM repos", [], |r| r.get(0))?;
                assert_eq!(count, 2);
                Ok(())
            })
            .unwrap();
    }
}
