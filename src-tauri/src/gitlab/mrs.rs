//! MR lists for S-01 (F-02.1, F-02.2) through GraphQL (ADR-024): one tab's rows with the counts
//! of all three tabs, the row model and its note line (01 › F-02.2).

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use super::account::GitlabUser;
use super::client::GitlabClient;
use super::error::GitlabError;

const QUERY: &str = include_str!("queries/mr_list.graphql");
/// Rows per GraphQL page (GitLab's maximum).
pub const PAGE_SIZE: u32 = 100;
/// Pages followed per list; more rows set `truncated`.
pub const MAX_PAGES: u32 = 5;
/// From this many files a row says "Large: the plan splits it by layer" (M2 plan decision 5).
pub const LARGE_FILES: u32 = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MrTab {
    /// I'm a reviewer and haven't approved.
    Waiting,
    /// I'm the author.
    Mine,
    /// All open MRs of the project.
    All,
}

/// The head pipeline as S-01 shows it (square + "pipeline passed/failed/running").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PipelineState {
    Passed,
    Failed,
    Running,
    /// Created, pending, preparing, scheduled, waiting for a resource.
    Waiting,
    Canceled,
    Skipped,
    Manual,
}

impl PipelineState {
    /// From GraphQL's `PipelineStatusEnum`.
    pub fn from_graphql(status: &str) -> Self {
        match status {
            "SUCCESS" => Self::Passed,
            "FAILED" => Self::Failed,
            "RUNNING" => Self::Running,
            "CANCELED" | "CANCELING" => Self::Canceled,
            "SKIPPED" => Self::Skipped,
            "MANUAL" => Self::Manual,
            _ => Self::Waiting,
        }
    }
}

/// One S-01 row (F-02.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MrRow {
    pub iid: u32,
    pub title: String,
    pub draft: bool,
    pub web_url: String,
    pub author: GitlabUser,
    /// I'm the author (the row opens S-10, F-02.3).
    pub mine: bool,
    /// ISO 8601; the row shows the age.
    pub created_at: String,
    pub updated_at: String,
    pub additions: u32,
    pub deletions: u32,
    pub files: u32,
    /// `null` when the MR has no pipeline.
    pub pipeline: Option<PipelineState>,
    pub unresolved_threads: u32,
    /// I'm one of the reviewers.
    pub reviewer: bool,
    /// I approved it.
    pub approved: bool,
    /// The one-line note (F-02.2), if any applies.
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MrCounts {
    pub waiting: u32,
    pub mine: u32,
    pub all: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MrList {
    pub tab: MrTab,
    /// Most recently updated first.
    pub rows: Vec<MrRow>,
    pub counts: MrCounts,
    /// More rows exist than [`MAX_PAGES`] pages hold.
    pub truncated: bool,
}

/// The note line (F-02.2): unresolved threads > Large > "You’re a reviewer".
pub fn note(unresolved_threads: u32, files: u32, reviewer: bool) -> Option<String> {
    match (unresolved_threads, files >= LARGE_FILES, reviewer) {
        (1, ..) => Some("1 unresolved thread from reviewers".to_owned()),
        (n, ..) if n > 1 => Some(format!("{n} unresolved threads from reviewers")),
        (_, true, _) => Some("Large: the plan splits it by layer".to_owned()),
        (_, _, true) => Some("You\u{2019}re a reviewer".to_owned()),
        _ => None,
    }
}

fn variables(project: &str, me: &str, tab: MrTab, first: u32, after: Option<&str>) -> Value {
    let mut vars = json!({ "project": project, "me": me, "first": first, "after": after });
    match tab {
        MrTab::Waiting => {
            vars["reviewer"] = json!(me);
            vars["not"] = json!({ "approvedBy": [me] });
        }
        MrTab::Mine => vars["author"] = json!(me),
        MrTab::All => {}
    }
    vars
}

/// Lists one tab of `project` for user `me`, following at most `max_pages` pages of
/// `page_size` rows. A project GitLab doesn't show (missing or no access) is `NotFound`.
pub async fn list(
    client: &GitlabClient,
    project: &str,
    me: &str,
    tab: MrTab,
    page_size: u32,
    max_pages: u32,
) -> Result<MrList, GitlabError> {
    let mut rows = Vec::new();
    let mut counts = None;
    let mut after: Option<String> = None;
    let mut pages = 0;
    loop {
        let data = client
            .graphql(
                QUERY,
                &variables(project, me, tab, page_size, after.as_deref()),
            )
            .await?;
        let project_data = data
            .get("project")
            .filter(|p| !p.is_null())
            .ok_or(GitlabError::NotFound)?;
        if counts.is_none() {
            counts = Some(read_counts(project_data));
        }
        let list = &project_data["list"];
        for node in list["nodes"].as_array().into_iter().flatten() {
            rows.push(read_row(node, me)?);
        }
        pages += 1;
        let page_info = &list["pageInfo"];
        let more = page_info["hasNextPage"].as_bool() == Some(true);
        let cursor = page_info["endCursor"].as_str().map(str::to_owned);
        match cursor {
            Some(cursor) if more && pages < max_pages => after = Some(cursor),
            _ => {
                return Ok(MrList {
                    tab,
                    rows,
                    counts: counts.unwrap_or(MrCounts {
                        waiting: 0,
                        mine: 0,
                        all: 0,
                    }),
                    truncated: more,
                });
            }
        }
    }
}

fn count(value: &Value) -> u32 {
    value
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0)
}

fn read_counts(project: &Value) -> MrCounts {
    MrCounts {
        waiting: count(&project["waiting"]["count"]),
        mine: count(&project["mine"]["count"]),
        all: count(&project["all"]["count"]),
    }
}

fn nodes(connection: &Value) -> impl Iterator<Item = &Value> {
    connection["nodes"].as_array().into_iter().flatten()
}

fn read_row(node: &Value, me: &str) -> Result<MrRow, GitlabError> {
    let text = |key: &str| node[key].as_str().unwrap_or_default().to_owned();
    let iid = node["iid"]
        .as_str()
        .and_then(|iid| iid.parse().ok())
        .ok_or_else(|| GitlabError::Decode("merge request without iid".into()))?;
    let author_username = node["author"]["username"].as_str().unwrap_or_default();
    let stats = &node["diffStatsSummary"];
    let files = count(&stats["fileCount"]);
    let unresolved = count(&node["resolvableDiscussionsCount"])
        .saturating_sub(count(&node["resolvedDiscussionsCount"]));
    let me_as_reviewer = nodes(&node["reviewers"]).find(|r| r["username"] == me);
    let reviewer = me_as_reviewer.is_some();
    let approved = me_as_reviewer
        .is_some_and(|r| r["mergeRequestInteraction"]["approved"].as_bool() == Some(true))
        || nodes(&node["approvedBy"]).any(|u| u["username"] == me);
    Ok(MrRow {
        iid,
        title: text("title"),
        draft: node["draft"].as_bool().unwrap_or(false),
        web_url: text("webUrl"),
        author: GitlabUser {
            username: author_username.to_owned(),
            name: node["author"]["name"]
                .as_str()
                .unwrap_or(author_username)
                .to_owned(),
        },
        mine: author_username == me,
        created_at: text("createdAt"),
        updated_at: text("updatedAt"),
        additions: count(&stats["additions"]),
        deletions: count(&stats["deletions"]),
        files,
        pipeline: node["headPipeline"]["status"]
            .as_str()
            .map(PipelineState::from_graphql),
        unresolved_threads: unresolved,
        reviewer,
        approved,
        note: note(unresolved, files, reviewer),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f02_2_note_priority() {
        assert_eq!(
            note(2, 61, true).as_deref(),
            Some("2 unresolved threads from reviewers")
        );
        assert_eq!(
            note(1, 0, false).as_deref(),
            Some("1 unresolved thread from reviewers")
        );
        assert_eq!(
            note(0, 40, true).as_deref(),
            Some("Large: the plan splits it by layer")
        );
        assert_eq!(
            note(0, 39, true).as_deref(),
            Some("You\u{2019}re a reviewer")
        );
        assert_eq!(note(0, 39, false), None);
    }

    #[test]
    fn f02_2_pipeline_states() {
        for (status, state) in [
            ("SUCCESS", PipelineState::Passed),
            ("FAILED", PipelineState::Failed),
            ("RUNNING", PipelineState::Running),
            ("PENDING", PipelineState::Waiting),
            ("WAITING_FOR_RESOURCE", PipelineState::Waiting),
            ("SCHEDULED", PipelineState::Waiting),
            ("CANCELED", PipelineState::Canceled),
            ("SKIPPED", PipelineState::Skipped),
            ("MANUAL", PipelineState::Manual),
        ] {
            assert_eq!(PipelineState::from_graphql(status), state, "{status}");
        }
    }

    #[test]
    fn f02_1_variables_per_tab() {
        let waiting = variables("g/p", "dev", MrTab::Waiting, 100, None);
        assert_eq!(waiting["reviewer"], "dev");
        assert_eq!(waiting["not"], json!({"approvedBy": ["dev"]}));
        assert!(waiting.get("author").is_none());
        let mine = variables("g/p", "dev", MrTab::Mine, 100, Some("c1"));
        assert_eq!(mine["author"], "dev");
        assert_eq!(mine["after"], "c1");
        assert!(mine.get("reviewer").is_none());
        let all = variables("g/p", "dev", MrTab::All, 100, None);
        assert!(all.get("reviewer").is_none() && all.get("author").is_none());
        assert_eq!(all["after"], Value::Null);
    }
}
