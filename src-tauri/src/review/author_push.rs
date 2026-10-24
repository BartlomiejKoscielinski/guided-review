//! **Push and reply** on S-10 (F-26.5, docs/plans/M7.md decisions 11 and 12). The queued reply
//! "Fixed in <sha>. <one sentence>." reaches GitLab only after its commit is on the remote branch:
//!
//! 1. the commit `after_sha` must be on the checked-out branch, else nothing happens;
//! 2. `git ls-remote origin refs/heads/<branch>`: a remote tip that already holds the commit skips
//!    the push (a restart after a push, decision 12); a tip that isn't an ancestor of HEAD is
//!    "Pull first" and nothing is pushed or sent (decision 11);
//! 3. `git push` (the existing F-16.5 push), then the remote tip must hold `after_sha`;
//! 4. the reply, then Resolve when the switch is on, through `gitlab/thread_actions.rs`.
//!
//! Any failure keeps the reply `queued` with the failure in plain words (Retry); a note GitLab
//! already took is not posted again. Runs only on the user's click; nothing calls it by itself.

use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, ErrorCode};
use crate::git::commit::{self, validate_rev};
use crate::git::local;
use crate::git::refs;
use crate::git::runner::Git;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::thread_actions;
use crate::os::process::Cancel;
use crate::store::Store;
use crate::store::queued_replies::{self, QueuedReply, SENT};

/// What **Push and reply** works on.
pub struct PushReply<'a> {
    pub client: &'a GitlabClient,
    pub store: &'a Store,
    /// The user's own checkout, on the MR's source branch.
    pub git: &'a Git,
    pub project: &'a str,
    pub iid: u64,
    pub reply_id: &'a str,
}

/// How **Push and reply** ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum PushOutcome {
    /// The commit is on `remote_branch` ("origin/<branch>"), the reply was sent and, when the
    /// switch was on, the thread resolved.
    Done {
        #[serde(rename = "remoteBranch")]
        remote_branch: String,
        resolved: bool,
    },
    /// The remote has commits the checkout doesn't have: nothing pushed, nothing sent.
    PullFirst,
}

fn not_queued() -> AppError {
    AppError::new(ErrorCode::InvalidInput, "That reply isn't queued.")
}

fn not_on_branch(sha: &str) -> AppError {
    let short: String = sha.chars().take(7).collect();
    AppError::new(
        ErrorCode::Conflict,
        format!("Commit {short} isn't on your branch any more. Commit the fix again."),
    )
}

fn not_on_remote(sha: &str, remote_branch: &str) -> AppError {
    let short: String = sha.chars().take(7).collect();
    AppError::new(
        ErrorCode::Conflict,
        format!("Commit {short} didn't reach {remote_branch}. The reply waits."),
    )
}

/// Pushes the branch and sends the queued reply `reply_id` (see the module docs).
pub async fn push_and_reply(job: &PushReply<'_>, cancel: &Cancel) -> Result<PushOutcome, AppError> {
    let row = job
        .store
        .with_conn(|conn| queued_replies::get(conn, job.reply_id))?
        .filter(|r| r.project == job.project && r.iid == job.iid)
        .ok_or_else(not_queued)?;
    let result = run(job, &row, cancel).await;
    if let Err(error) = &result {
        job.store
            .with_conn(|conn| queued_replies::mark_failed(conn, &row.id, &error.message))?;
    }
    result
}

async fn run(
    job: &PushReply<'_>,
    row: &QueuedReply,
    cancel: &Cancel,
) -> Result<PushOutcome, AppError> {
    let status = local::read_status(job.git, cancel).await?;
    let Some(branch) = status.branch else {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "Check out a branch to push.",
        ));
    };
    let remote_branch = format!("origin/{branch}");
    if row.state == SENT {
        return Ok(PushOutcome::Done {
            remote_branch,
            resolved: row.resolve,
        });
    }
    let head = refs::verify_commit(job.git, "HEAD", cancel)
        .await?
        .ok_or_else(|| not_on_branch(&row.after_sha))?;
    if !holds(job.git, &head, &row.after_sha, cancel).await? {
        return Err(not_on_branch(&row.after_sha));
    }

    let tip = commit::remote_tip(job.git, &branch, cancel).await?;
    let pushed = match &tip {
        Some(tip) => holds(job.git, tip, &row.after_sha, cancel).await?,
        None => false,
    };
    if !pushed {
        if let Some(tip) = &tip
            && !holds(job.git, &head, tip, cancel).await?
        {
            return Ok(PushOutcome::PullFirst);
        }
        commit::push(job.git, cancel).await?;
        let after = commit::remote_tip(job.git, &branch, cancel).await?;
        let reached = match &after {
            Some(tip) => holds(job.git, tip, &row.after_sha, cancel).await?,
            None => false,
        };
        if !reached {
            return Err(not_on_remote(&row.after_sha, &remote_branch));
        }
    }

    if !row.replied {
        thread_actions::reply(job.client, job.project, job.iid, &row.discussion, &row.body).await?;
        job.store
            .with_conn(|conn| queued_replies::mark_replied(conn, &row.id))?;
    }
    if row.resolve {
        thread_actions::resolve(job.client, job.project, job.iid, &row.discussion, true).await?;
    }
    job.store
        .with_conn(|conn| queued_replies::mark_sent(conn, &row.id))?;
    Ok(PushOutcome::Done {
        remote_branch,
        resolved: row.resolve,
    })
}

/// Whether the commit `tip` holds the commit `sha` (both hex SHAs); a SHA the checkout doesn't
/// have is not held.
async fn holds(git: &Git, tip: &str, sha: &str, cancel: &Cancel) -> Result<bool, AppError> {
    if validate_rev(sha).is_err() || validate_rev(tip).is_err() || sha == "HEAD" {
        return Ok(false);
    }
    if tip == sha {
        return Ok(true);
    }
    let (Some(tip), Some(sha)) = (
        refs::verify_commit(git, tip, cancel).await?,
        refs::verify_commit(git, sha, cancel).await?,
    ) else {
        return Ok(false);
    };
    Ok(refs::is_ancestor(git, &sha, &tip, cancel).await?)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use serde_json::json;

    #[test]
    fn f26_5_the_outcome_reads_as_the_ui_expects() {
        let done = PushOutcome::Done {
            remote_branch: "origin/feature/upload-retry".to_owned(),
            resolved: true,
        };
        assert_eq!(
            serde_json::to_value(&done).unwrap(),
            json!({ "kind": "done", "remoteBranch": "origin/feature/upload-retry", "resolved": true })
        );
        assert_eq!(
            serde_json::to_value(PushOutcome::PullFirst).unwrap(),
            json!({ "kind": "pullFirst" })
        );
    }

    #[test]
    fn f26_5_failures_name_the_short_sha() {
        let sha = "9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40";
        assert_eq!(
            not_on_branch(sha).message,
            "Commit 9e1d4b7 isn't on your branch any more. Commit the fix again."
        );
        assert_eq!(not_queued().code, ErrorCode::InvalidInput);
    }
}
