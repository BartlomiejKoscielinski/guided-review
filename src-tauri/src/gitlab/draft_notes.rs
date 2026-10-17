//! Draft notes of an MR (F-12.5, docs/05 › GitLab REST API v4 and › Draft note positions): `list`
//! the user's pending draft notes (M5 decision 8), `create` one with or without a line position,
//! and `bulk_publish`, which publishes every pending draft note of the user on the MR at once, so
//! the author gets a single notification. `bulk_publish` is sent without GitLab's own `note`
//! parameter: GitLab doesn't publish it (S5 on 17.11.7). `version_refs` reads the `diff_refs` of
//! the reviewed version from `GET …/versions`, the SHAs a line position is anchored to.

use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::client::{GitlabClient, project_id};
use super::discussions::MAX_PAGES;
use super::error::GitlabError;

/// `diff_refs` of an MR version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffRefs {
    pub base_sha: String,
    pub start_sha: String,
    pub head_sha: String,
}

/// Where a draft note sits in the diff: an added line has `new_line` only, a deleted line
/// `old_line` only, a context line both (docs/05). A renamed file keeps both of its paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotePosition {
    pub old_path: String,
    pub new_path: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

/// A pending draft note as GitLab lists or creates it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DraftNote {
    pub id: u64,
    #[serde(default)]
    pub note: Option<String>,
}

fn draft_notes_path(project: &str, iid: u64) -> String {
    format!(
        "/projects/{}/merge_requests/{iid}/draft_notes",
        project_id(project)
    )
}

/// The pending draft notes of the signed-in user on the MR, written here or in GitLab's web UI.
pub async fn list(
    client: &GitlabClient,
    project: &str,
    iid: u64,
) -> Result<Vec<DraftNote>, GitlabError> {
    let (items, _) = client
        .get_pages(&draft_notes_path(project, iid), &[], MAX_PAGES)
        .await?;
    items
        .into_iter()
        .map(|item| {
            serde_json::from_value(item).map_err(|error| GitlabError::Decode(error.to_string()))
        })
        .collect()
}

/// The JSON body of a new draft note; no `position` for a comment on the MR.
pub fn create_body(note: &str, position: Option<(&DiffRefs, &NotePosition)>) -> Value {
    let mut body = Map::new();
    body.insert("note".into(), json!(note));
    if let Some((refs, at)) = position {
        let mut place = Map::new();
        place.insert("position_type".into(), json!("text"));
        place.insert("base_sha".into(), json!(refs.base_sha));
        place.insert("start_sha".into(), json!(refs.start_sha));
        place.insert("head_sha".into(), json!(refs.head_sha));
        place.insert("old_path".into(), json!(at.old_path));
        place.insert("new_path".into(), json!(at.new_path));
        if let Some(line) = at.old_line {
            place.insert("old_line".into(), json!(line));
        }
        if let Some(line) = at.new_line {
            place.insert("new_line".into(), json!(line));
        }
        body.insert("position".into(), Value::Object(place));
    }
    Value::Object(body)
}

/// Creates one pending draft note; nothing reaches the author until [`bulk_publish`].
pub async fn create(
    client: &GitlabClient,
    project: &str,
    iid: u64,
    note: &str,
    position: Option<(&DiffRefs, &NotePosition)>,
) -> Result<DraftNote, GitlabError> {
    let response = client
        .post(
            &draft_notes_path(project, iid),
            &create_body(note, position),
        )
        .await?;
    serde_json::from_value(response.body).map_err(|error| GitlabError::Decode(error.to_string()))
}

/// Publishes every pending draft note of the user on the MR in one request (204).
pub async fn bulk_publish(
    client: &GitlabClient,
    project: &str,
    iid: u64,
) -> Result<(), GitlabError> {
    let path = format!("{}/bulk_publish", draft_notes_path(project, iid));
    client.post(&path, &json!({})).await?;
    Ok(())
}

/// The `diff_refs` of the version whose head is `head_sha`; the newest version when none is
/// (GitLab lists them newest first).
pub fn pick_version(versions: &[Value], head_sha: &str) -> Option<DiffRefs> {
    let refs = |v: &Value| -> Option<DiffRefs> {
        Some(DiffRefs {
            base_sha: v.get("base_commit_sha")?.as_str()?.to_owned(),
            start_sha: v.get("start_commit_sha")?.as_str()?.to_owned(),
            head_sha: v.get("head_commit_sha")?.as_str()?.to_owned(),
        })
    };
    versions
        .iter()
        .filter_map(refs)
        .find(|r| r.head_sha == head_sha)
        .or_else(|| versions.iter().find_map(refs))
}

/// The `diff_refs` of the reviewed version of the MR (`GET …/versions`).
pub async fn version_refs(
    client: &GitlabClient,
    project: &str,
    iid: u64,
    head_sha: &str,
) -> Result<DiffRefs, GitlabError> {
    let path = format!(
        "/projects/{}/merge_requests/{iid}/versions",
        project_id(project)
    );
    let (versions, _) = client.get_pages(&path, &[], MAX_PAGES).await?;
    pick_version(&versions, head_sha)
        .ok_or_else(|| GitlabError::Decode("the merge request has no version".into()))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;

    fn refs() -> DiffRefs {
        DiffRefs {
            base_sha: "b".into(),
            start_sha: "s".into(),
            head_sha: "h".into(),
        }
    }

    #[test]
    fn f12_5_a_position_sends_only_the_line_numbers_it_has() {
        let added = NotePosition {
            old_path: "a ą.cs".into(),
            new_path: "a ą.cs".into(),
            old_line: None,
            new_line: Some(7),
        };
        let body = create_body("Hi", Some((&refs(), &added)));
        let p = &body["position"];
        assert_eq!(p["position_type"], "text");
        assert_eq!(
            (p["base_sha"].as_str(), p["head_sha"].as_str()),
            (Some("b"), Some("h"))
        );
        assert_eq!(p["new_line"], 7);
        assert!(p.get("old_line").is_none(), "{p}");
        assert_eq!(body["note"], "Hi");

        let general = create_body("Summary", None);
        assert!(general.get("position").is_none(), "{general}");
    }

    #[test]
    fn f12_5_the_reviewed_version_is_picked_by_its_head_else_the_newest() {
        let versions = vec![
            json!({ "id": 2, "head_commit_sha": "h2", "base_commit_sha": "b2", "start_commit_sha": "s2" }),
            json!({ "id": 1, "head_commit_sha": "h1", "base_commit_sha": "b1", "start_commit_sha": "s1" }),
        ];
        let reviewed = pick_version(&versions, "h1").unwrap();
        assert_eq!(
            (reviewed.base_sha.as_str(), reviewed.start_sha.as_str()),
            ("b1", "s1")
        );
        assert_eq!(pick_version(&versions, "gone").unwrap().head_sha, "h2");
        assert!(pick_version(&[], "h1").is_none());
    }
}
