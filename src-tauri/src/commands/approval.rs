//! `summary_status`, `gitlab_approve` and `gitlab_unapprove` (F-14.2, M5 decisions 10a and 14):
//! S-05 compares the MR's head with the head the session reviewed, Approve sends that reviewed
//! head as GitLab's `sha`, Revoke takes the user's approval back. Each write is its own click
//! (06 › T7); the project, the MR and the reviewed head come from the session in the store.

use tauri::State;

use super::gitlab::{GitlabApp, connected_client};
use super::gitlab_threads::{session_mr, session_mr_head};
use crate::error::AppResult;
use crate::gitlab::approvals::{self, SummaryStatus};
use crate::gitlab::mr;
use crate::store::Store;

/// The reviewed head against the MR's head now (one read). Called when the summary opens, never
/// on a restored start (F-30.4).
#[tauri::command]
pub async fn summary_status(
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
) -> AppResult<SummaryStatus> {
    let (mr_ref, reviewed_head) = session_mr_head(&store, &session).await?;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let info = mr::get(&client, &mr_ref.project, mr_ref.iid).await?;
    let changed = approvals::head_changed(&reviewed_head, info.sha.as_deref());
    Ok(SummaryStatus {
        reviewed_head,
        current_head: info.sha,
        changed,
    })
}

/// Approve MR: refused (`CONFLICT`) for any `sha` other than the reviewed head; GitLab's 409 for a
/// head that moved on is a `CONFLICT` too, which S-05 shows as the MR-changed state.
#[tauri::command]
pub async fn gitlab_approve(
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    sha: String,
) -> AppResult<()> {
    let (mr_ref, reviewed_head) = session_mr_head(&store, &session).await?;
    let (client, _) = connected_client(&gitlab, &store).await?;
    approvals::check_reviewed_head(&sha, &reviewed_head)?;
    approvals::approve(&client, &mr_ref.project, mr_ref.iid, &reviewed_head).await?;
    Ok(())
}

/// Revoke approval: the user's approval of the session's MR is taken back.
#[tauri::command]
pub async fn gitlab_unapprove(
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
) -> AppResult<()> {
    let mr_ref = session_mr(&store, &session).await?;
    let (client, _) = connected_client(&gitlab, &store).await?;
    approvals::unapprove(&client, &mr_ref.project, mr_ref.iid).await?;
    Ok(())
}
