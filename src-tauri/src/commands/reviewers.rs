//! The Reviewers of S-11 New merge request (F-27.3): `reviewers_suggest` builds at most three
//! suggestions with their reasons from the target's CODEOWNERS, `git blame` of the changed lines
//! and the merged MRs of the last 30 days; `gitlab_users_search` finds other project members.
//! Both only read; who is added goes to GitLab only with **Create merge request**.

use std::collections::BTreeMap;

use tauri::State;

use super::gitlab::{GitlabApp, active_project, connected_client, forget_status_on_auth_error};
use super::repo::active_git;
use crate::error::AppResult;
use crate::git::branch_info::{branch_info, branch_range};
use crate::git::diff::range_files;
use crate::git::error::GitError;
use crate::git::runner::Git;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::members::{self, Member, is_bot};
use crate::os::process::Cancel;
use crate::reviewers::codeowners::{self, Owned};
use crate::reviewers::history::{self, area_of, reviewed_counts};
use crate::reviewers::suggest::{self, Sources, Suggestion};
use crate::reviewers::{blame_share, blame_share::AuthorShare};
use crate::store::Store;

/// How many blame authors and reviewers are looked up among the members.
const LOOKUPS: usize = 8;

/// Reviewer suggestions for an MR of the current branch into `target` (a branch on origin; the
/// default when missing). Empty without a branch or a target.
#[tauri::command]
pub async fn reviewers_suggest(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    target: Option<String>,
) -> AppResult<Vec<Suggestion>> {
    let git = active_git(&store).await?;
    let cancel = Cancel::new();
    let info = branch_info(&git, target.as_deref(), &cancel).await?;
    let (Some(_), Some(target)) = (info.branch, info.target) else {
        return Ok(Vec::new());
    };
    let (client, status) = connected_client(&gitlab, &store).await?;
    let (Some(server), Some(user)) = (status.server.as_deref(), status.user.as_ref()) else {
        return Err(super::gitlab::not_connected(&status));
    };
    let project = active_project(&store, server).await?;
    match gather(&git, &client, &project, &target, &user.username, &cancel).await {
        Ok(sources) => Ok(suggest::build(&sources)),
        Err(GatherError::Git(error)) => Err(error.into()),
        Err(GatherError::Gitlab(error)) => {
            forget_status_on_auth_error(&gitlab, Some(&error)).await;
            Err(error.into())
        }
    }
}

/// What [`gather`] can fail on; a GitLab failure may also reset the title bar's status.
enum GatherError {
    Git(GitError),
    Gitlab(GitlabError),
}

impl From<GitError> for GatherError {
    fn from(error: GitError) -> Self {
        Self::Git(error)
    }
}

impl From<GitlabError> for GatherError {
    fn from(error: GitlabError) -> Self {
        Self::Gitlab(error)
    }
}

async fn gather(
    git: &Git,
    client: &GitlabClient,
    project: &str,
    target: &str,
    me: &str,
    cancel: &Cancel,
) -> Result<Sources, GatherError> {
    let Some((base, head)) = branch_range(git, Some(target), cancel).await? else {
        return Ok(Sources::default());
    };
    let files = range_files(git, &base, &head, cancel).await?;
    let changed: Vec<(String, u32)> = files
        .iter()
        .map(|f| (f.path.clone(), f.additions.saturating_add(f.deletions)))
        .collect();
    let rules = codeowners::load(git, target, cancel).await?;
    let owners = owners_of_change(&rules, &changed);
    let my_email = my_email(git, cancel).await;
    let blame = blame_share::shares(git, target, my_email.as_deref(), cancel).await?;
    let area = area_of(&changed);
    let reviewed = match &area {
        Some(area) => match history::merged_mrs(client, project, &history::month_ago()).await {
            Ok(mrs) => reviewed_counts(&mrs, area),
            // A query GitLab refuses (complexity, an older schema) only loses this reason.
            Err(GitlabError::Graphql(message)) => {
                tracing::warn!(%message, "reviewer history unavailable");
                Vec::new()
            }
            Err(error) => return Err(error.into()),
        },
        None => Vec::new(),
    };
    let members = lookup_members(client, project, &owners, &blame, &reviewed).await?;
    Ok(Sources {
        me: me.to_owned(),
        members,
        owners,
        blame,
        reviewed,
        area,
    })
}

/// The rules that own the changed files in any section, the one owning most changed lines
/// first; the same pattern in several sections is one entry with the users of each.
fn owners_of_change(rules: &codeowners::CodeOwners, changed: &[(String, u32)]) -> Vec<Owned> {
    let mut by_pattern: BTreeMap<String, (Owned, u32)> = BTreeMap::new();
    for (path, lines) in changed {
        for owned in rules.owners_in_sections(path) {
            if owned.users.is_empty() {
                continue;
            }
            let entry = by_pattern.entry(owned.pattern.clone()).or_insert_with(|| {
                let empty = Owned {
                    pattern: owned.pattern.clone(),
                    users: Vec::new(),
                };
                (empty, 0)
            });
            for user in owned.users {
                if !entry.0.users.contains(&user) {
                    entry.0.users.push(user);
                }
            }
            entry.1 = entry.1.saturating_add(*lines);
        }
    }
    let mut owners: Vec<(Owned, u32)> = by_pattern.into_values().collect();
    owners.sort_by_key(|o| std::cmp::Reverse(o.1));
    owners.into_iter().map(|(owned, _)| owned).collect()
}

/// `user.email` of the repository, to leave my own lines out of the blame shares.
async fn my_email(git: &Git, cancel: &Cancel) -> Option<String> {
    let spec = git.spec(["config", "--get", "user.email"]);
    let output = git.run_spec(spec, cancel, &[0, 1]).await.ok()?;
    let email = output.stdout.trim();
    (output.code == Some(0) && !email.is_empty()).then(|| email.to_owned())
}

/// The members the owners, blame authors and reviewers can be matched to: one search per name,
/// username and e-mail local part.
async fn lookup_members(
    client: &GitlabClient,
    project: &str,
    owners: &[Owned],
    blame: &[AuthorShare],
    reviewed: &[history::ReviewCount],
) -> Result<Vec<Member>, GitlabError> {
    let mut queries: Vec<String> = Vec::new();
    let mut ask = |query: &str| {
        let query = query.trim();
        if !query.is_empty() && !queries.iter().any(|q| q.eq_ignore_ascii_case(query)) {
            queries.push(query.to_owned());
        }
    };
    owners
        .iter()
        .flat_map(|o| &o.users)
        .take(LOOKUPS)
        .for_each(|u| ask(u));
    for share in blame.iter().take(LOOKUPS) {
        ask(&share.name);
        if let Some((local, _)) = share.email.split_once('@') {
            ask(local);
        }
    }
    reviewed.iter().take(LOOKUPS).for_each(|r| ask(&r.username));
    let mut found: Vec<Member> = Vec::new();
    for query in queries {
        for member in members::search(client, project, &query).await? {
            if !found.iter().any(|m| m.id == member.id) {
                found.push(member);
            }
        }
    }
    Ok(found)
}

/// Project members matching the typed text, by name; never me or a bot. A blank query asks
/// nobody.
#[tauri::command]
pub async fn gitlab_users_search(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    query: String,
) -> AppResult<Vec<Member>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let (client, status) = connected_client(&gitlab, &store).await?;
    let (Some(server), Some(user)) = (status.server.as_deref(), status.user.as_ref()) else {
        return Err(super::gitlab::not_connected(&status));
    };
    let project = active_project(&store, server).await?;
    let result = members::search(&client, &project, query).await;
    forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
    let mut found: Vec<Member> = result?
        .into_iter()
        .filter(|m| !m.username.eq_ignore_ascii_case(&user.username) && !is_bot(&m.username))
        .collect();
    found.sort_by_key(|m| m.name.to_lowercase());
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f27_3_a_path_owned_in_two_sections_names_both_owners() {
        let rules = codeowners::CodeOwners::parse(
            "[Views] @marta.k\n/src/App/Views/\n\n[QA]\n*.xaml @qa.lead\n",
        );
        let owners = owners_of_change(&rules, &[("src/App/Views/Main.xaml".to_owned(), 12)]);
        let mut owned: Vec<(&str, &[String])> = owners
            .iter()
            .map(|o| (o.pattern.as_str(), o.users.as_slice()))
            .collect();
        owned.sort();
        let marta = ["marta.k".to_owned()];
        let qa = ["qa.lead".to_owned()];
        assert_eq!(owned, [("*.xaml", &qa[..]), ("src/App/Views/", &marta[..])]);
    }
}
