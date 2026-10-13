//! Cached plans in `claude_cache` (F-02.5, M3 decision 7; docs/04 › Claude cache key, migration
//! 004). The row keeps Claude's `structured_output`, keyed by the SHA-256 of everything the plan
//! depends on; a hit is validated again by the caller. "Plan is ready" matches the lookup
//! columns only (repository, subject, head, model, effort, prompt version), because an S-01 row
//! knows nothing else. Cached plans survive restarts.

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts::{self, PROMPT_VERSION};
use crate::gitlab::mrs::MrRow;
use crate::settings::ClaudeSettings;
use crate::store::StoreError;

/// `claude_cache.task` of plans.
pub const TASK: &str = "plan";

/// `claude_cache.subject` of an MR.
pub fn mr_subject(iid: u64) -> String {
    format!("mr:{iid}")
}

/// The plan settings that are part of the key: model and effort of the Review plan group
/// (`''` for "Same as Claude Code") and the "Writes in" language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanSettings {
    pub model: String,
    pub effort: String,
    pub lang: String,
}

impl PlanSettings {
    pub fn from(settings: &ClaudeSettings) -> Self {
        let resolved = models::resolve(settings, TaskGroup::Plan);
        Self {
            model: resolved.model.unwrap_or_default(),
            effort: resolved
                .effort
                .and_then(|e| serde_json::to_value(e).ok())
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
            lang: prompts::output_language(settings.lang).to_owned(),
        }
    }
}

/// What a plan was computed for (docs/04 › Claude cache key).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanKey {
    pub repo_id: i64,
    /// `mr:<iid>`, `commit:<sha>`, `range:<from>..<to>` or `local:<scope>`.
    pub subject: String,
    pub base_sha: String,
    pub head_sha: String,
    /// Every hunk of the change, sorted.
    pub hunk_ids: Vec<String>,
    /// SHA-256 of the team rules from the target branch; `''` without rules.
    pub rules_hash: String,
    pub settings: PlanSettings,
    pub prompt_version: u32,
}

impl PlanKey {
    pub fn new(
        repo_id: i64,
        subject: String,
        base_sha: &str,
        head_sha: &str,
        hunk_ids: impl IntoIterator<Item = String>,
        rules: Option<&str>,
        settings: PlanSettings,
    ) -> Self {
        let mut hunk_ids: Vec<String> = hunk_ids.into_iter().collect();
        hunk_ids.sort();
        Self {
            repo_id,
            subject,
            base_sha: base_sha.to_owned(),
            head_sha: head_sha.to_owned(),
            hunk_ids,
            rules_hash: rules.map(sha256).unwrap_or_default(),
            settings,
            prompt_version: PROMPT_VERSION,
        }
    }

    /// `claude_cache.key`: SHA-256 of the fields in docs/04's order, separated by `\0`.
    pub fn key(&self) -> String {
        let fields = [
            TASK.to_owned(),
            self.repo_id.to_string(),
            self.subject.clone(),
            self.base_sha.clone(),
            self.head_sha.clone(),
            self.hunk_ids.join(","),
            self.prompt_version.to_string(),
            self.settings.model.clone(),
            self.settings.effort.clone(),
            self.rules_hash.clone(),
            self.settings.lang.clone(),
        ];
        sha256(&fields.join("\0"))
    }
}

fn sha256(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The cached `structured_output`, if any. A row that doesn't parse counts as a miss.
pub fn get(conn: &Connection, key: &PlanKey) -> Result<Option<Value>, StoreError> {
    let json: Option<String> = conn
        .query_row(
            "SELECT result_json FROM claude_cache WHERE key = ?1 AND task = ?2",
            params![key.key(), TASK],
            |row| row.get(0),
        )
        .optional()?;
    Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
}

/// Stores Claude's validated `structured_output` (replacing an older row with the same key).
pub fn put(conn: &Connection, key: &PlanKey, output: &Value) -> Result<(), StoreError> {
    conn.execute(
        "INSERT OR REPLACE INTO claude_cache
             (key, task, result_json, session_ref, created_at,
              repo_id, subject, head_sha, model, effort, prompt_version)
         VALUES (?1, ?2, ?3, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            key.key(),
            TASK,
            output.to_string(),
            key.repo_id,
            key.subject,
            key.head_sha,
            key.settings.model,
            key.settings.effort,
            key.prompt_version,
        ],
    )?;
    Ok(())
}

/// F-02.5: a plan of MR `iid` is cached for `head` under the current plan model and effort.
pub fn plan_ready(
    conn: &Connection,
    settings: &PlanSettings,
    repo_id: i64,
    iid: u64,
    head: &str,
) -> Result<bool, StoreError> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM claude_cache
             WHERE task = ?1 AND repo_id = ?2 AND subject = ?3 AND head_sha = ?4
               AND model = ?5 AND effort = ?6 AND prompt_version = ?7
             LIMIT 1",
            params![
                TASK,
                repo_id,
                mr_subject(iid),
                head,
                settings.model,
                settings.effort,
                PROMPT_VERSION,
            ],
            |row| row.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

/// Sets `plan_ready` on S-01 rows of the repository's project; rows without a head stay false.
pub fn mark_ready(
    conn: &Connection,
    settings: &PlanSettings,
    repo_id: i64,
    rows: &mut [MrRow],
) -> Result<(), StoreError> {
    for row in rows {
        row.plan_ready = match &row.head_sha {
            Some(head) => plan_ready(conn, settings, repo_id, u64::from(row.iid), head)?,
            None => false,
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::settings::{Lang, TaskEffort};
    use crate::store::Store;
    use serde_json::json;

    fn settings() -> PlanSettings {
        PlanSettings::from(&ClaudeSettings::default())
    }

    fn key(head: &str, settings: PlanSettings) -> PlanKey {
        PlanKey::new(
            1,
            mr_subject(482),
            "b0",
            head,
            ["h2".to_owned(), "h1".to_owned()],
            Some("Use async."),
            settings,
        )
    }

    #[test]
    fn f02_5_the_key_covers_every_input_of_the_plan() {
        let base = key("h", settings());
        assert_eq!(base.key().len(), 64);
        assert_eq!(base.hunk_ids, ["h1", "h2"]);
        let mut other = base.clone();
        other.base_sha = "b1".into();
        assert_ne!(other.key(), base.key());
        let mut other = base.clone();
        other.rules_hash = String::new();
        assert_ne!(other.key(), base.key());
        let mut other = base.clone();
        other.settings.lang = "Polish".into();
        assert_ne!(other.key(), base.key());
        let mut other = base.clone();
        other.prompt_version += 1;
        assert_ne!(other.key(), base.key());
        assert_eq!(key("h", settings()).key(), base.key());
    }

    #[test]
    fn f02_5_plan_settings_follow_the_review_plan_group() {
        let defaults = settings();
        assert_eq!(
            (defaults.model.as_str(), defaults.effort.as_str()),
            ("claude-opus-5-5", "high")
        );
        let mut custom = ClaudeSettings {
            lang: Lang::Pl,
            ..ClaudeSettings::default()
        };
        custom.tasks.plan.model = "claude-sonnet-5-5".into();
        custom.tasks.plan.effort = TaskEffort::Xhigh;
        let custom = PlanSettings::from(&custom);
        assert_eq!(
            (
                custom.model.as_str(),
                custom.effort.as_str(),
                custom.lang.as_str()
            ),
            ("claude-sonnet-5-5", "xhigh", "Polish")
        );
    }

    #[test]
    fn f02_5_cache_hit_other_head_other_model() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|conn| {
                let cached = key("h1", settings());
                assert_eq!(get(conn, &cached)?, None);
                put(conn, &cached, &json!({ "intent": "x" }))?;
                assert_eq!(get(conn, &cached)?, Some(json!({ "intent": "x" })));
                // Hit.
                assert!(plan_ready(conn, &settings(), 1, 482, "h1")?);
                // Other head, other MR, other repository.
                assert!(!plan_ready(conn, &settings(), 1, 482, "h2")?);
                assert!(!plan_ready(conn, &settings(), 1, 483, "h1")?);
                assert!(!plan_ready(conn, &settings(), 2, 482, "h1")?);
                // Other model or effort.
                let mut sonnet = settings();
                sonnet.model = "claude-sonnet-5-5".into();
                assert!(!plan_ready(conn, &sonnet, 1, 482, "h1")?);
                assert_eq!(get(conn, &key("h1", sonnet))?, None);
                let mut low = settings();
                low.effort = "low".into();
                assert!(!plan_ready(conn, &low, 1, 482, "h1")?);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn f02_5_survives_a_reopened_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Zażółć gęślą").join("guided-review.db");
        let store = Store::open(&path).unwrap();
        store
            .with_conn(|conn| put(conn, &key("h1", settings()), &json!({ "intent": "x" })))
            .unwrap();
        drop(store);
        let store = Store::open(&path).unwrap();
        store
            .with_conn(|conn| {
                assert!(plan_ready(conn, &settings(), 1, 482, "h1")?);
                assert!(get(conn, &key("h1", settings()))?.is_some());
                Ok(())
            })
            .unwrap();
    }
}
