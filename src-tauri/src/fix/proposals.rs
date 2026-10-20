//! The proposals waiting for Accept or Discard (F-25.3, F-25.4), in core memory only: the run's
//! scratch worktree stays on disk until then (registered for the janitor, T8).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::git::scratch::Scratch;

/// A proposal's scratch and the repository it belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pending {
    /// The user's repository (where Accept writes, F-25.4).
    pub repo: PathBuf,
    pub scratch: Scratch,
}

/// The open proposals by id.
#[derive(Debug, Default)]
pub struct Proposals {
    open: Mutex<HashMap<String, Pending>>,
}

impl Proposals {
    /// Keeps the scratch of proposal `id` until Accept or Discard.
    pub fn keep(&self, id: &str, pending: Pending) {
        if let Ok(mut open) = self.open.lock() {
            open.insert(id.to_owned(), pending);
        }
    }

    /// Takes proposal `id` out (Accept, Discard); `None` when it isn't open.
    pub fn take(&self, id: &str) -> Option<Pending> {
        self.open.lock().ok().and_then(|mut open| open.remove(id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f25_3_a_kept_proposal_is_taken_once() {
        let proposals = Proposals::default();
        let pending = Pending {
            repo: PathBuf::from("C:/repo ą"),
            scratch: Scratch {
                path: PathBuf::from("C:/tmp/scratch/fix-1"),
                base_sha: "abc".into(),
                file: PathBuf::from("a.cs"),
                start_hash: "00".into(),
            },
        };
        proposals.keep("fix-1", pending.clone());
        assert_eq!(proposals.take("fix-1"), Some(pending));
        assert_eq!(proposals.take("fix-1"), None);
    }
}
