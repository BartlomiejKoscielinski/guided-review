//! A teammate's MR as S-02's header (F-06.1) and S-06's read-only MR browse (F-24.1) show it:
//! what GitLab said when the session was prepared, plus the files of `merge-base..head`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::git::commit::tree_file;
use crate::git::diff;
use crate::git::error::GitError;
use crate::git::runner::Git;
use crate::git::tree::{self, FileGroup};
use crate::gitlab::mr::MrInfo;
use crate::gitlab::mrs::PipelineState;
use crate::os::process::Cancel;

/// The MR fields stored with the session (`sessions.mr_json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MrMeta {
    #[ts(type = "number")]
    pub iid: u64,
    pub title: String,
    /// Empty when GitLab sent no author.
    pub author: String,
    /// ISO 8601.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub created_at: Option<String>,
    pub source_branch: String,
    pub target_branch: String,
    /// The head pipeline when the session was prepared; none without a pipeline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pipeline: Option<PipelineState>,
}

impl MrMeta {
    pub fn from_info(info: &MrInfo) -> Self {
        Self {
            iid: info.iid,
            title: info.title.clone(),
            author: info
                .author
                .as_ref()
                .map(|a| a.name.clone())
                .unwrap_or_default(),
            created_at: info.created_at.clone(),
            source_branch: info.source_branch.clone(),
            target_branch: info.target_branch.clone(),
            pipeline: info.pipeline_state(),
        }
    }
}

/// `session_mr`: the header numbers and the file tree of an MR session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionMr {
    pub mr: MrMeta,
    pub groups: Vec<FileGroup>,
    pub total_files: u32,
    pub additions: u32,
    pub deletions: u32,
    pub commits: u32,
}

/// The files and commits of `base..head` (`base` is the merge base, F-05.2).
pub async fn session_mr(
    git: &Git,
    mr: MrMeta,
    base: &str,
    head: &str,
    cancel: &Cancel,
) -> Result<SessionMr, GitError> {
    let files = diff::range_files(git, base, head, cancel).await?;
    let commits = git
        .run(["rev-list", "--count", &format!("{base}..{head}")], cancel)
        .await?;
    let additions = files.iter().map(|f| f.additions).sum();
    let deletions = files.iter().map(|f| f.deletions).sum();
    let total_files = u32::try_from(files.len()).unwrap_or(u32::MAX);
    Ok(SessionMr {
        mr,
        groups: tree::group(files.into_iter().map(tree_file).collect()),
        total_files,
        additions,
        deletions,
        commits: commits.stdout.trim().parse().unwrap_or(0),
    })
}
