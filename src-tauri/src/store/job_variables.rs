//! The last variables a manual job ran with on this machine (F-20.6, M6 decision 11), one row per
//! project and job name in `job_variables(project, job_name, vars_json, updated_at)`. Written only
//! after a successful play; read when the job's form opens. Values are stored as typed (they may be
//! secrets the user chose to pass) and never logged.

use rusqlite::{Connection, OptionalExtension, params};

use super::StoreError;
use crate::gitlab::jobs::JobVariable;

/// The variables job `job_name` of `project` last ran with, in their order; empty for a job name
/// never played. A row that no longer decodes reads as empty.
pub fn get(
    conn: &Connection,
    project: &str,
    job_name: &str,
) -> Result<Vec<JobVariable>, StoreError> {
    let json: Option<String> = conn
        .query_row(
            "SELECT vars_json FROM job_variables WHERE project = ?1 AND job_name = ?2",
            params![project, job_name],
            |row| row.get(0),
        )
        .optional()?;
    Ok(json
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default())
}

/// Replaces the variables of job `job_name` of `project` with `variables` (an empty list too).
pub fn save(
    conn: &Connection,
    project: &str,
    job_name: &str,
    variables: &[JobVariable],
) -> Result<(), StoreError> {
    let json = serde_json::to_string(variables).unwrap_or_else(|_| "[]".to_owned());
    conn.execute(
        "INSERT INTO job_variables (project, job_name, vars_json, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(project, job_name) DO UPDATE
         SET vars_json = excluded.vars_json, updated_at = excluded.updated_at",
        params![project, job_name, json],
    )?;
    Ok(())
}
