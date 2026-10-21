//! `fix_watch` and `fix_watch_stop` (F-26.3, M7 decision 7): after **Fix in Rider** S-10 waits
//! for a content change of the thread's file in the user's own checkout (the active repository).
//! The change arrives once on the channel (`{ kind: "changed" }`); the UI ends the watch by its
//! id (Stop waiting, another thread, leaving S-10). Read only: nothing is written.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use ts_rs::TS;

use super::repo::active_git;
use crate::error::AppResult;
use crate::git::watch::FileWatcher;
use crate::store::Store;

/// One message of the `fix_watch` channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum FixWatchEvent {
    /// The file's content differs from the one at the click; the watch is over.
    Changed,
}

/// The running watches by id.
#[derive(Default)]
pub struct FixWatches(Arc<Mutex<HashMap<String, FileWatcher>>>);

impl FixWatches {
    fn insert(&self, id: String, watcher: FileWatcher) {
        if let Ok(mut watches) = self.0.lock() {
            watches.insert(id, watcher);
        }
    }

    /// Removed off the watcher's own event thread: dropping a debouncer from its callback
    /// would wait for itself.
    fn remove_later(watches: &Arc<Mutex<HashMap<String, FileWatcher>>>, id: String) {
        let watches = Arc::clone(watches);
        std::thread::spawn(move || {
            if let Ok(mut watches) = watches.lock() {
                watches.remove(&id);
            }
        });
    }

    fn stop(&self, id: &str) {
        let removed = self
            .0
            .lock()
            .ok()
            .and_then(|mut watches| watches.remove(id));
        drop(removed);
    }
}

/// Watches `file` (repository-relative, as the thread's path) of the active repository; answers
/// the id `fix_watch_stop` takes.
#[tauri::command]
pub async fn fix_watch(
    store: State<'_, Store>,
    watches: State<'_, FixWatches>,
    file: String,
    ch: Channel<FixWatchEvent>,
) -> AppResult<String> {
    let git = active_git(&store).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let registry = Arc::clone(&watches.0);
    let own = id.clone();
    let watcher = FileWatcher::start(git.repo(), &file, move || {
        if let Err(error) = ch.send(FixWatchEvent::Changed) {
            tracing::debug!(%error, "fix watch event not delivered");
        }
        FixWatches::remove_later(&registry, own.clone());
    })?;
    watches.insert(id.clone(), watcher);
    Ok(id)
}

/// Ends the watch `id`; nothing when it ended already.
#[tauri::command]
pub fn fix_watch_stop(watches: State<'_, FixWatches>, id: String) {
    watches.stop(&id);
}
