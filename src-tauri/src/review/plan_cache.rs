//! Cached Claude results in `claude_cache`: plans (F-02.5, M3 decision 7) and step analyses
//! (F-09.6); docs/04 › Claude cache key, migration 004. The row keeps Claude's
//! `structured_output`, keyed by the SHA-256 of everything the task depends on; a hit is
//! validated again by the caller. "Plan is ready" matches the lookup
//! columns only (repository, subject, head, model, effort, prompt version), because an S-01 row
//! knows nothing else. Cached plans survive restarts.

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts::{self, PROMPT_VERSION};
use crate::gitlab::mrs::MrRow;
use crate::settings::ClaudeSettings;
use crate::source::model::{LocalScope, Source};
use crate::store::StoreError;

/// `claude_cache.task` of plans.
pub const TASK: &str = "plan";
/// `claude_cache.task` of step analyses.
pub const STEP_TASK: &str = "step";

/// `claude_cache.subject` of an MR.
pub fn mr_subject(iid: u64) -> String {
    format!("mr:{iid}")
}

/// `claude_cache.subject` (and `dismissals.mr`) of any review source (F-17.1): `mr:<iid>`,
/// `commit:<sha>`, `range:<from>..<to>` or `local:<scope>`, so plans, steps and dismissals of
/// commits and local changes never mix with an MR's or with each other's.
pub fn subject(source: &Source) -> String {
    match source {
        Source::Mr { iid, .. } => mr_subject(*iid),
        Source::Commits { from: None, to } => format!("commit:{to}"),
        Source::Commits {
            from: Some(from),
            to,
        } => format!("range:{from}..{to}"),
        Source::Local { scope } => match scope {
            LocalScope::Uncommitted => "local:uncommitted".to_owned(),
            LocalScope::Staged => "local:staged".to_owned(),
            LocalScope::BranchVsTarget { target } => format!("local:branch:{target}"),
        },
    }
}

/// The settings that are part of the key: model and effort of the task's override group (`''`
/// for "Same as Claude Code") and the "Writes in" language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskSettings {
    pub model: String,
    pub effort: String,
    pub lang: String,
}

impl TaskSettings {
    /// The Review plan group.
    pub fn plan(settings: &ClaudeSettings) -> Self {
        Self::for_group(settings, TaskGroup::Plan)
    }

    /// The Step analysis group.
    pub fn step(settings: &ClaudeSettings) -> Self {
        Self::for_group(settings, TaskGroup::Step)
    }

    /// The settings of any task group's override (the summary comment: "MR description and
    /// pipeline").
    pub fn for_group(settings: &ClaudeSettings, group: TaskGroup) -> Self {
        let resolved = models::resolve(settings, group);
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

/// What a task result was computed for (docs/04 › Claude cache key).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheKey {
    /// [`TASK`] or [`STEP_TASK`].
    pub task: &'static str,
    pub repo_id: i64,
    /// `mr:<iid>`, `commit:<sha>`, `range:<from>..<to>` or `local:<scope>`.
    pub subject: String,
    pub base_sha: String,
    pub head_sha: String,
    /// Every hunk of the change (plan) or of the step, sorted.
    pub hunk_ids: Vec<String>,
    /// SHA-256 of the team rules from the target branch; `''` without rules.
    pub rules_hash: String,
    pub settings: TaskSettings,
    pub prompt_version: u32,
}

impl CacheKey {
    #[allow(clippy::too_many_arguments, reason = "the fields of the key")]
    pub fn new(
        task: &'static str,
        repo_id: i64,
        subject: String,
        base_sha: &str,
        head_sha: &str,
        hunk_ids: impl IntoIterator<Item = String>,
        rules: Option<&str>,
        settings: TaskSettings,
    ) -> Self {
        let mut hunk_ids: Vec<String> = hunk_ids.into_iter().collect();
        hunk_ids.sort();
        Self {
            task,
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
            self.task.to_owned(),
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
pub fn get(conn: &Connection, key: &CacheKey) -> Result<Option<Value>, StoreError> {
    Ok(get_entry(conn, key)?.map(|entry| entry.output))
}

/// A cached result with the time it was stored.
#[derive(Debug, Clone, PartialEq)]
pub struct CacheEntry {
    pub output: Value,
    /// ISO 8601 UTC ("Plan from cache · <age>", F-06.12).
    pub created_at: String,
}

/// [`get`] with the time the row was stored.
pub fn get_entry(conn: &Connection, key: &CacheKey) -> Result<Option<CacheEntry>, StoreError> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT result_json, created_at FROM claude_cache WHERE key = ?1 AND task = ?2",
            params![key.key(), key.task],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(row.and_then(|(json, created_at)| {
        serde_json::from_str(&json)
            .ok()
            .map(|output| CacheEntry { output, created_at })
    }))
}

/// Stores Claude's validated `structured_output` (replacing an older row with the same key).
pub fn put(conn: &Connection, key: &CacheKey, output: &Value) -> Result<(), StoreError> {
    conn.execute(
        "INSERT OR REPLACE INTO claude_cache
             (key, task, result_json, session_ref, created_at,
              repo_id, subject, head_sha, model, effort, prompt_version)
         VALUES (?1, ?2, ?3, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            key.key(),
            key.task,
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
    settings: &TaskSettings,
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
    settings: &TaskSettings,
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

    fn settings() -> TaskSettings {
        TaskSettings::plan(&ClaudeSettings::default())
    }

    fn key(head: &str, settings: TaskSettings) -> CacheKey {
        CacheKey::new(
            TASK,
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
        let custom = TaskSettings::plan(&custom);
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
    fn f09_6_step_results_have_their_own_key_and_settings() {
        let step = TaskSettings::step(&ClaudeSettings::default());
        assert_eq!(
            (step.model.as_str(), step.effort.as_str()),
            ("claude-sonnet-5-5", "medium")
        );
        let plan = key("h1", settings());
        let mut as_step = plan.clone();
        as_step.task = STEP_TASK;
        assert_ne!(as_step.key(), plan.key());
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|conn| {
                put(conn, &as_step, &json!({ "findings": [] }))?;
                assert_eq!(get(conn, &plan)?, None);
                // A cached step is not a cached plan (F-02.5).
                assert!(!plan_ready(conn, &settings(), 1, 482, "h1")?);
                assert!(get(conn, &as_step)?.is_some());
                Ok(())
            })
            .unwrap();
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
                let stored = get_entry(conn, &cached)?.unwrap().created_at;
                assert!(stored.contains('T') && stored.ends_with('Z'), "{stored}");
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
    fn f17_1_every_source_has_its_own_subject() {
        let local = |scope| subject(&Source::Local { scope });
        let subjects = [
            subject(&Source::Mr {
                project: "team/app".into(),
                iid: 482,
            }),
            subject(&Source::Commits {
                from: None,
                to: "c2".into(),
            }),
            subject(&Source::Commits {
                from: Some("c1".into()),
                to: "c2".into(),
            }),
            local(LocalScope::Uncommitted),
            local(LocalScope::Staged),
            local(LocalScope::BranchVsTarget {
                target: "origin/develop".into(),
            }),
        ];
        assert_eq!(
            subjects,
            [
                "mr:482",
                "commit:c2",
                "range:c1..c2",
                "local:uncommitted",
                "local:staged",
                "local:branch:origin/develop"
            ]
        );
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
