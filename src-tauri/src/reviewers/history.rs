//! "Reviewed N MRs in <area> this month" (F-27.3, M7 decision 17). The area of a change is the
//! folder that directly holds most changed lines (`Views` for `src/App/Views/…`); this month is
//! the last 30 days; a merged MR of the project counts once for each of its reviewers when one of
//! its paths is under the area's folder. Read through GraphQL, the first 100 merged MRs.

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;

/// "This month".
pub const DAYS: u64 = 30;

/// The folder a change mostly happens in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Area {
    /// From the repository root, `/`-separated, e.g. `src/App/Views`.
    pub dir: String,
    /// Its last part, as the reason names it, e.g. `Views`.
    pub name: String,
}

/// The reviewers and changed paths of one merged MR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergedMr {
    pub reviewers: Vec<String>,
    pub paths: Vec<String>,
}

/// How many merged MRs in the area a person reviewed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewCount {
    pub username: String,
    pub count: u32,
}

/// The folder that directly holds most of `changed` (path, changed lines); a tie goes to the
/// folder that sorts first. Files at the root have no area.
pub fn area_of(changed: &[(String, u32)]) -> Option<Area> {
    let mut lines: BTreeMap<&str, u32> = BTreeMap::new();
    for (path, count) in changed {
        if let Some((dir, _)) = path.rsplit_once('/')
            && !dir.is_empty()
        {
            let entry = lines.entry(dir).or_default();
            *entry = entry.saturating_add(*count);
        }
    }
    // BTreeMap order: the first folder with the largest count wins a tie.
    let mut best: Option<(&str, u32)> = None;
    for (dir, count) in lines {
        if best.is_none_or(|(_, top)| count > top) {
            best = Some((dir, count));
        }
    }
    best.map(|(dir, _)| Area {
        dir: dir.to_owned(),
        name: dir.rsplit('/').next().unwrap_or(dir).to_owned(),
    })
}

/// Per reviewer, the merged MRs with a path under `area` (each MR once), most first; a tie keeps
/// the order of first appearance.
pub fn reviewed_counts(mrs: &[MergedMr], area: &Area) -> Vec<ReviewCount> {
    let prefix = format!("{}/", area.dir);
    let mut counts: Vec<ReviewCount> = Vec::new();
    for mr in mrs {
        if !mr.paths.iter().any(|p| p.starts_with(&prefix)) {
            continue;
        }
        let mut seen: Vec<&str> = Vec::new();
        for reviewer in &mr.reviewers {
            if seen.contains(&reviewer.as_str()) {
                continue;
            }
            seen.push(reviewer);
            match counts.iter_mut().find(|c| &c.username == reviewer) {
                Some(found) => found.count += 1,
                None => counts.push(ReviewCount {
                    username: reviewer.clone(),
                    count: 1,
                }),
            }
        }
    }
    counts.sort_by_key(|c| std::cmp::Reverse(c.count));
    counts
}

const QUERY: &str = "query($project: ID!, $mergedAfter: Time) {
  project(fullPath: $project) {
    mergeRequests(state: merged, mergedAfter: $mergedAfter, first: 100) {
      nodes { reviewers { nodes { username } } diffStats { path } }
    }
  }
}";

/// The merged MRs of `project` since `merged_after` (ISO 8601) with their reviewers and paths.
pub async fn merged_mrs(
    client: &GitlabClient,
    project: &str,
    merged_after: &str,
) -> Result<Vec<MergedMr>, GitlabError> {
    let data = client
        .graphql(
            QUERY,
            &json!({ "project": project, "mergedAfter": merged_after }),
        )
        .await?;
    let project = data
        .get("project")
        .filter(|p| !p.is_null())
        .ok_or(GitlabError::NotFound)?;
    let strings = |list: &Value, key: &str| -> Vec<String> {
        list.as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| item.get(key).and_then(Value::as_str))
            .map(str::to_owned)
            .collect()
    };
    Ok(project["mergeRequests"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|node| MergedMr {
            reviewers: strings(&node["reviewers"]["nodes"], "username"),
            paths: strings(&node["diffStats"], "path"),
        })
        .collect())
}

/// The start of "this month" for [`merged_mrs`]: [`DAYS`] days before now, ISO 8601 UTC.
pub fn month_ago() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    iso_utc(now.saturating_sub(DAYS * 86_400))
}

/// `2026-09-24T10:00:00Z` for seconds since 1970 (civil-from-days, no date library).
pub fn iso_utc(secs: u64) -> String {
    let days = i64::try_from(secs / 86_400).unwrap_or_default();
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f27_3_iso_utc_formats_a_date() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        // 2026-09-24T10:00:00Z
        assert_eq!(iso_utc(1_790_244_000), "2026-09-24T10:00:00Z");
    }
}
