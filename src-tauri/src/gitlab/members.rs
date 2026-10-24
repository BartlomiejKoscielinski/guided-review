//! Project members (F-27.3): the people S-11's reviewer search finds and the suggestions are
//! matched to, from `GET /projects/:id/members/all?query=` (inherited members included). Only
//! active accounts; blocked and deactivated ones can't review. Reads only.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::client::{GitlabClient, project_id};
use super::error::GitlabError;

/// How many members one search returns.
pub const SEARCH_LIMIT: u32 = 20;

/// A project member who can be asked to review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ProjectMember")]
pub struct Member {
    #[ts(type = "number")]
    pub id: u64,
    pub username: String,
    pub name: String,
}

#[derive(Deserialize)]
struct RawMember {
    id: u64,
    username: String,
    name: String,
    #[serde(default)]
    state: Option<String>,
}

/// The active members of `project` (`group/project`) whose name or username matches `query`,
/// as GitLab sends them.
pub async fn search(
    client: &GitlabClient,
    project: &str,
    query: &str,
) -> Result<Vec<Member>, GitlabError> {
    let path = format!("/projects/{}/members/all", project_id(project));
    let response = client
        .get(
            &path,
            &[
                ("query", query.to_owned()),
                ("per_page", SEARCH_LIMIT.to_string()),
            ],
        )
        .await?;
    parse(response.body)
}

fn parse(body: Value) -> Result<Vec<Member>, GitlabError> {
    let raw: Vec<RawMember> =
        serde_json::from_value(body).map_err(|e| GitlabError::Decode(e.to_string()))?;
    Ok(raw
        .into_iter()
        .filter(|m| m.state.as_deref().is_none_or(|s| s == "active"))
        .map(|m| Member {
            id: m.id,
            username: m.username,
            name: m.name,
        })
        .collect())
}

/// Bot accounts never review: project and group access tokens (`project_7_bot_3f9a1c`,
/// `group_2_bot_…`), the ghost user and names ending in `-bot` or `_bot`.
pub fn is_bot(username: &str) -> bool {
    let lower = username.to_lowercase();
    if lower == "ghost" || lower.ends_with("-bot") || lower.ends_with("_bot") {
        return true;
    }
    ["project_", "group_"].iter().any(|prefix| {
        lower
            .strip_prefix(prefix)
            .and_then(|rest| rest.split_once("_bot_"))
            .is_some_and(|(id, hash)| {
                !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) && !hash.is_empty()
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f27_3_bots_by_username() {
        for bot in [
            "project_7_bot_3f9a1c",
            "group_12_bot_ab",
            "ghost",
            "renovate-bot",
            "deploy_bot",
        ] {
            assert!(is_bot(bot), "{bot}");
        }
        for person in ["ola.m", "project_x_bot_1", "abbot", "botanik"] {
            assert!(!is_bot(person), "{person}");
        }
    }

    #[test]
    fn f27_3_members_without_a_state_count_as_active() {
        let body = serde_json::json!([{ "id": 1, "username": "a", "name": "A" }]);
        assert_eq!(parse(body).unwrap().len(), 1);
    }
}
