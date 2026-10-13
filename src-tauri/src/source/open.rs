//! Resolving a commit range, a local scope or a branch into the session to open (F-01.3,
//! M2 decision 3): the `Source` with full SHAs and the base and head commits. The current
//! branch is reviewed as local changes against its target; another branch as the commits
//! `merge-base..branch`.

use super::error::SourceError;
use super::model::{CommitRange, LocalScope, Source};
use crate::git::{Git, refs};
use crate::os::process::Cancel;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub source: Source,
    pub base_sha: String,
    pub head_sha: String,
}

async fn commit(git: &Git, sha: &str, cancel: &Cancel) -> Result<String, SourceError> {
    refs::resolve_sha(git, sha, cancel)
        .await?
        .ok_or_else(|| SourceError::NoMatch(sha.to_owned()))
}

/// First parent of `sha`, or the empty tree for a root commit.
async fn first_parent(git: &Git, sha: &str, cancel: &Cancel) -> Result<String, SourceError> {
    let spec = git.spec([
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        &format!("{sha}^1"),
    ]);
    let output = git.run_spec(spec, cancel, &[0, 1, 128]).await?;
    match output.stdout.trim() {
        parent if output.code == Some(0) && !parent.is_empty() => Ok(parent.to_owned()),
        _ => Ok(crate::git::diff::empty_tree(git, cancel).await?),
    }
}

/// A single commit (against its first parent) or `from..to`.
pub async fn commits(
    git: &Git,
    range: &CommitRange,
    cancel: &Cancel,
) -> Result<Resolved, SourceError> {
    let to = commit(git, &range.to, cancel).await?;
    let (from, base) = match &range.from {
        Some(from) => {
            let from = commit(git, from, cancel).await?;
            if from == to || !refs::is_ancestor(git, &from, &to, cancel).await? {
                return Err(SourceError::Invalid(format!(
                    "{} isn't an earlier commit of {}.",
                    short(&from),
                    short(&to)
                )));
            }
            (Some(from.clone()), from)
        }
        None => (None, first_parent(git, &to, cancel).await?),
    };
    Ok(Resolved {
        source: Source::Commits {
            from,
            to: to.clone(),
        },
        base_sha: base,
        head_sha: to,
    })
}

/// Local changes in one of the three scopes. Base and head are HEAD for uncommitted and staged
/// changes (the working tree and index are read live), the merge base with the target and HEAD
/// for the whole branch.
pub async fn local(
    git: &Git,
    scope: &LocalScope,
    cancel: &Cancel,
) -> Result<Resolved, SourceError> {
    let head = refs::head(git, cancel)
        .await?
        .ok_or_else(|| SourceError::Invalid("The repository has no commits yet.".to_owned()))?;
    let base = match scope {
        LocalScope::Uncommitted | LocalScope::Staged => head.clone(),
        LocalScope::BranchVsTarget { target } => {
            let target_sha = refs::target_commit(git, target, cancel)
                .await?
                .ok_or_else(|| SourceError::NoMatch(target.clone()))?;
            crate::git::diff::merge_base(git, &target_sha, &head, cancel).await?
        }
    };
    Ok(Resolved {
        source: Source::Local {
            scope: scope.clone(),
        },
        base_sha: base,
        head_sha: head,
    })
}

/// The scope a repository opens with from S-01 (path input, current branch): the whole branch
/// against `origin/HEAD`, or uncommitted changes when there is no target.
pub async fn default_scope(git: &Git, cancel: &Cancel) -> Result<LocalScope, SourceError> {
    Ok(match refs::default_target(git, cancel).await? {
        Some(target) => LocalScope::BranchVsTarget { target },
        None => LocalScope::Uncommitted,
    })
}

/// A branch: the checked-out one as local changes in the default scope, another one as the
/// commits since its merge base with the target (or with HEAD without a target).
pub async fn branch(git: &Git, name: &str, cancel: &Cancel) -> Result<Resolved, SourceError> {
    let found = refs::branch(git, name, cancel)
        .await?
        .ok_or_else(|| SourceError::NoMatch(name.to_owned()))?;
    let current = refs::current_branch(git, cancel).await?;
    if !found.remote && current.as_deref() == Some(found.name.as_str()) {
        let scope = default_scope(git, cancel).await?;
        return local(git, &scope, cancel).await;
    }
    let against = match refs::default_target(git, cancel).await? {
        Some(target) => refs::target_commit(git, &target, cancel).await?,
        None => refs::head(git, cancel).await?,
    }
    .ok_or_else(|| SourceError::Invalid("The repository has no commits yet.".to_owned()))?;
    let base = crate::git::diff::merge_base(git, &against, &found.sha, cancel).await?;
    if base == found.sha {
        return Err(SourceError::Invalid(format!(
            "{} has no commits of its own.",
            found.name
        )));
    }
    Ok(Resolved {
        source: Source::Commits {
            from: Some(base.clone()),
            to: found.sha.clone(),
        },
        base_sha: base,
        head_sha: found.sha,
    })
}

fn short(sha: &str) -> &str {
    sha.get(..7).unwrap_or(sha)
}
