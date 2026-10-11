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
    /// A session the Review tile can resume (F-30.2). Done and drafts-only sessions are not.
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
