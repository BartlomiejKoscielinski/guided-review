//! Schema migrations. Migration 001 is the schema from docs/04 › SQLite schema; later changes
//! are new migrations appended here, never edits of applied ones.

use rusqlite_migration::{M, Migrations};

pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("migrations/001_initial.sql")),
        M::up(include_str!("migrations/002_app_state.sql")),
        M::up(include_str!("migrations/003_session_mr.sql")),
        M::up(include_str!("migrations/004_claude_cache_lookup.sql")),
        M::up(include_str!("migrations/005_findings_per_session.sql")),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Tables of docs/04 › SQLite schema (001) and app_state (002).
    const TABLES: [&str; 16] = [
        "app_state",
        "settings",
        "repos",
        "worktrees",
        "sessions",
        "plans",
        "steps_state",
        "findings",
        "drafts",
        "claude_cache",
        "claude_sessions",
        "dismissals",
        "rule_suggestions",
        "poll_state",
        "queued_replies",
        "job_variables",
    ];

    #[test]
    fn migrations_are_valid() {
        migrations().validate().unwrap();
    }

    #[test]
    fn migrations_create_every_table_of_the_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_latest(&mut conn).unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        let mut names: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        names.retain(|n| !n.starts_with("sqlite_"));
        let mut expected: Vec<String> = TABLES.iter().map(|t| (*t).to_owned()).collect();
        expected.sort();
        assert_eq!(names, expected);
    }

    #[test]
    fn migration_001_has_the_fields_added_at_kickoff() {
        // P-05 (findings.kind), G-21 (steps_state.checklist_json), G-22 (worktrees, repos.worktree_root).
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_latest(&mut conn).unwrap();
        for (table, column) in [
            ("findings", "kind"),
            ("steps_state", "checklist_json"),
            ("repos", "worktree_root"),
            ("worktrees", "head_sha"),
        ] {
            let found: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
                    [table, column],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(found, 1, "{table}.{column}");
        }
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_latest(&mut conn).unwrap();
        migrations().to_latest(&mut conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 5);
    }

    #[test]
    fn f09_4_migration_005_keeps_the_notes_and_keys_them_per_session() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_version(&mut conn, 4).unwrap();
        conn.execute(
            "INSERT INTO findings (id, session_id, step_id, json, kind, decision, fingerprint)
             VALUES ('f1', 'r1', 's1', '{}', 'unawaited-task', 'dismissed', 'aaaa')",
            [],
        )
        .unwrap();
        migrations().to_latest(&mut conn).unwrap();
        let kept: (String, String, String) = conn
            .query_row(
                "SELECT session_id, decision, fingerprint FROM findings WHERE id = 'f1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(kept, ("r1".into(), "dismissed".into(), "aaaa".into()));
        // Another review may hold a note with the same ID; the same session may not.
        let insert = |session: &str| {
            conn.execute(
                "INSERT INTO findings (id, session_id, step_id, json, kind, decision, fingerprint)
                 VALUES ('f1', ?1, 's1', '{}', 'unawaited-task', 'open', 'aaaa')",
                [session],
            )
        };
        insert("c1").unwrap();
        assert!(insert("r1").is_err());
    }
}
