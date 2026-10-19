//! The approval state of one MR (F-14.1, M5 decision 14): `GET
//! /projects/:id/merge_requests/:iid/approvals`, read only. It becomes the Approval tile of S-05
//! ("Not approved yet" / "Approved by you", "Approvals: X of Y"); the Approve and Revoke calls are
//! F-14.2's. Keys an answer leaves out (an unlicensed EE without approval rules) read as none
//! required, nobody approved and no password; an answer that is not an object is a decode error,
//! never a made-up state.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::account::GitlabUser;
use super::client::{GitlabClient, project_id};
use super::error::GitlabError;

/// What S-05's Approval tile shows of the MR.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApprovalState {
    /// The people who approved, in GitLab's order (the tile's X is their number).
    pub approved_by: Vec<GitlabUser>,
    /// How many approvals GitLab asks for; 0 when the MR asks for none ("Approvals: X").
    pub approvals_required: u32,
    /// The signed-in user approved this MR ("Approved by you").
    pub user_has_approved: bool,
    /// GitLab lets the user approve (F-14.2 disables Approve otherwise).
    pub user_can_approve: bool,
    /// The project asks for a password to approve; the app never handles it (F-14.2).
    pub require_password_to_approve: bool,
}

#[derive(Deserialize)]
struct Answer {
    #[serde(default)]
    approved_by: Vec<Approver>,
    #[serde(default)]
    approvals_required: Option<u32>,
    #[serde(default)]
    user_has_approved: bool,
    #[serde(default)]
    user_can_approve: bool,
    #[serde(default)]
    require_password_to_approve: Option<bool>,
}

#[derive(Deserialize)]
struct Approver {
    user: GitlabUser,
}

/// The approval state of `iid` in `project`: one GET, nothing written.
pub async fn state(
    client: &GitlabClient,
    project: &str,
    iid: u64,
) -> Result<ApprovalState, GitlabError> {
    let path = format!(
        "/projects/{}/merge_requests/{iid}/approvals",
        project_id(project)
    );
    let response = client.get(&path, &[]).await?;
    parse(response.body)
}

/// GitLab's `/approvals` answer as [`ApprovalState`].
pub fn parse(body: Value) -> Result<ApprovalState, GitlabError> {
    // serde reads a struct from a list too; only an object is an approvals answer.
    if !body.is_object() {
        return Err(GitlabError::Decode("approvals: not an object".into()));
    }
    let answer: Answer =
        serde_json::from_value(body).map_err(|e| GitlabError::Decode(format!("approvals: {e}")))?;
    Ok(ApprovalState {
        approved_by: answer.approved_by.into_iter().map(|a| a.user).collect(),
        approvals_required: answer.approvals_required.unwrap_or(0),
        user_has_approved: answer.user_has_approved,
        user_can_approve: answer.user_can_approve,
        require_password_to_approve: answer.require_password_to_approve.unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use serde_json::json;

    #[test]
    fn f14_1_null_counts_read_as_none_required_and_no_password() {
        let state = parse(json!({
            "approved_by": [{ "user": { "username": "dev", "name": "Dev", "id": 2 } }],
            "approvals_required": null, "require_password_to_approve": null,
            "user_has_approved": true, "user_can_approve": false
        }))
        .unwrap();
        assert_eq!(state.approvals_required, 0);
        assert!(!state.require_password_to_approve);
        assert_eq!(state.approved_by[0].username, "dev");
        assert!(state.user_has_approved);
    }

    #[test]
    fn f14_1_a_list_is_not_an_approvals_answer() {
        assert!(matches!(parse(json!([])), Err(GitlabError::Decode(_))));
    }
}
