//! The versions of an MR (`GET …/merge_requests/:iid/versions`, docs/05 › GitLab REST API v4):
//! the list itself, read by the draft-note positions (F-12.5) and the pipeline tabs (F-20.1), and
//! the version number S-08 shows for a pipeline's SHA.

use serde_json::Value;

use super::client::{GitlabClient, project_id};
use super::discussions::MAX_PAGES;
use super::error::GitlabError;

/// Every version of the MR as GitLab lists them (newest first).
pub async fn list(
    client: &GitlabClient,
    project: &str,
    iid: u64,
) -> Result<Vec<Value>, GitlabError> {
    let path = format!(
        "/projects/{}/merge_requests/{iid}/versions",
        project_id(project)
    );
    let (versions, _) = client.get_pages(&path, &[], MAX_PAGES).await?;
    Ok(versions)
}

/// The 1-based number of the version whose head is `sha`, counting from the oldest version
/// (lowest `id`) as 1, whatever order GitLab lists them in; `None` when no version has that head.
pub fn number_of(versions: &[Value], sha: &str) -> Option<u32> {
    let mut heads: Vec<(u64, &str)> = versions
        .iter()
        .filter_map(|v| Some((v.get("id")?.as_u64()?, v.get("head_commit_sha")?.as_str()?)))
        .collect();
    heads.sort_by_key(|(id, _)| *id);
    let index = heads.iter().position(|(_, head)| *head == sha)?;
    u32::try_from(index + 1).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn f20_1_the_version_number_counts_from_the_oldest_version() {
        let versions = vec![
            json!({ "id": 903, "head_commit_sha": "c3" }),
            json!({ "id": 901, "head_commit_sha": "a1" }),
            json!({ "id": 902, "head_commit_sha": "b2" }),
        ];
        assert_eq!(number_of(&versions, "a1"), Some(1));
        assert_eq!(number_of(&versions, "b2"), Some(2));
        assert_eq!(number_of(&versions, "c3"), Some(3));
        assert_eq!(number_of(&versions, "d4"), None);
    }
}
