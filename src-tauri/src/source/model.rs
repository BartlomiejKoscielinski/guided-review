//! `Source` and `LocalScope` from docs/04 › Core data model, stored as `sessions.source_json`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Source {
    Mr {
        project: String,
        #[ts(type = "number")]
        iid: u64,
    },
    /// The commits of `from..to`: `from` is the base and is not included; `None` means the
    /// first parent of `to` (a single commit).
    Commits {
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        to: String,
    },
    Local {
        scope: LocalScope,
    },
}

/// The three scopes of My changes (F-03.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum LocalScope {
    Uncommitted,
    Staged,
    /// HEAD against its merge base with `target` (`origin/develop`).
    BranchVsTarget {
        target: String,
    },
}

/// What `session_open_commit` takes: a single commit (`from` absent) or a range `from..to`
/// (F-03.2; `from` excluded, like git).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitRange {
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    pub to: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_tagged_for_the_sessions_table() {
        assert_eq!(
            serde_json::to_value(Source::Local {
                scope: LocalScope::BranchVsTarget {
                    target: "origin/develop".into()
                }
            })
            .unwrap(),
            json!({ "kind": "local", "scope": { "kind": "branchVsTarget", "target": "origin/develop" } })
        );
        assert_eq!(
            serde_json::to_value(Source::Commits {
                from: None,
                to: "abc".into()
            })
            .unwrap(),
            json!({ "kind": "commits", "to": "abc" })
        );
        let mr: Source =
            serde_json::from_value(json!({ "kind": "mr", "project": "a/b", "iid": 4 })).unwrap();
        assert_eq!(
            mr,
            Source::Mr {
                project: "a/b".into(),
                iid: 4
            }
        );
    }
}
