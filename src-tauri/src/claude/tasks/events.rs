//! Events of a Claude task on its IPC channel (docs/04 › IPC contract): `queued`, `started`,
//! `partialText` (asks only), then `done` with the result or `failed` with the error.

use serde::Serialize;
use ts_rs::TS;

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ClaudeTaskEvent<T> {
    /// Waiting for a slot in the Claude queue.
    Queued,
    /// `claude` is running; a cached result goes from `queued` straight to `done`.
    Started,
    /// A piece of the streamed answer, in order.
    PartialText {
        text: String,
    },
    Done {
        result: T,
    },
    Failed {
        error: AppError,
    },
}
