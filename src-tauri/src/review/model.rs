//! Shared review enums from docs/04 › Core data model, also used by settings and routes.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Focus or Detailed step review (ADR-010). Stored as "focus" / "detailed".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Mode {
    #[default]
    Focus,
    Detailed,
}

/// Focus layouts A Sidebar, B Minimal, C Guide (F-07.1).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Layout {
    #[default]
    A,
    B,
    C,
}

/// Step order on S-02 (F-06.4). Stored in `sessions.strategy` as "contractToUi", …
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Strategy {
    #[default]
    ContractToUi,
    TestsFirst,
    FileOrder,
}

/// Lifecycle of a review session; stored in `sessions.status` as "preparing", "planning", …
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SessionStatus {
    Preparing,
    Planning,
    Reviewing,
    Done,
    DraftsOnly,
}

impl SessionStatus {
    /// A session with steps left to review (F-30.2). Done and drafts-only sessions are not; the
    /// listing still offers a drafts-only session while it holds unpublished drafts (F-12.7).
    pub const fn is_unfinished(self) -> bool {
        matches!(self, Self::Preparing | Self::Planning | Self::Reviewing)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_as_stored_in_the_database() {
        assert_eq!(
            serde_json::to_value(Mode::Detailed).unwrap(),
            json!("detailed")
        );
        assert_eq!(serde_json::to_value(Layout::B).unwrap(), json!("B"));
        assert_eq!(
            serde_json::to_value(SessionStatus::DraftsOnly).unwrap(),
            json!("draftsOnly")
        );
    }

    #[test]
    fn only_preparing_planning_and_reviewing_are_unfinished() {
        assert!(SessionStatus::Preparing.is_unfinished());
        assert!(SessionStatus::Planning.is_unfinished());
        assert!(SessionStatus::Reviewing.is_unfinished());
        assert!(!SessionStatus::Done.is_unfinished());
        assert!(!SessionStatus::DraftsOnly.is_unfinished());
    }
}
