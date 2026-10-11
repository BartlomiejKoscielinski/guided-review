//! Cancellation shared between a UI-facing task and the processes it runs (`process.rs`).

use std::sync::Arc;

use tokio::sync::watch;

/// Cancellation signal shared between the UI-facing task and the processes it runs.
#[derive(Debug, Clone)]
pub struct Cancel(Arc<watch::Sender<bool>>);

impl Default for Cancel {
    fn default() -> Self {
        Self::new()
    }
}

impl Cancel {
    pub fn new() -> Self {
        Self(Arc::new(watch::channel(false).0))
    }

    pub fn cancel(&self) {
        self.0.send_replace(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }

    /// Completes once [`Cancel::cancel`] was called (immediately if it already was).
    pub async fn cancelled(&self) {
        let mut receiver = self.0.subscribe();
        let _ = receiver.wait_for(|cancelled| *cancelled).await;
    }
}
