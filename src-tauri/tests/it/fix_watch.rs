//! F-26.3 the Rider watch behind `fix_watch(file, ch)` (docs/plans/M7.md F-26.3, decision 7):
//! after **Fix in Rider** the app waits for a content change of that one file. Fixture
//! repositories with spaces and Polish characters in the path; synthetic data only (ADR-019).
//!
//! Contract the tests lock (`git/watch.rs`, next to `RepoWatcher`, same debouncer):
//! - `guided_review_lib::git::watch::FileWatcher::start(repo: &Path, file: &str, on_change:
//!   impl Fn() + Send + 'static) -> Result<FileWatcher, WatchError>`. `file` is a path relative
//!   to the working tree (as the thread's `path`), `/` or `\` separated. The content hash of the
//!   file is taken inside `start`, before it returns (the click); `on_change` runs when the
//!   file's hash differs from it. Changes of other files, and a write of the same content, are
//!   ignored. The callback runs at most once: the watch ends on the first change. Dropping the
//!   `FileWatcher` ends it too (Stop waiting, thread switch, leaving S-10). A file outside the
//!   working tree (`..`) is refused with an error.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use fixture_repo::FixtureRepo;
use guided_review_lib::git::watch::FileWatcher;

const FILE: &str = "src/Zażółć gęślą/Upload Queue.cs";
const OTHER: &str = "src/Mobile ąę/Other.cs";
const BASE: &str = "class Queue {\n    void Enqueue() { }\n}\n";
const FIXED: &str = "class Queue {\n    void Enqueue() { Check(); }\n}\n";

fn wait_for(count: &AtomicU32, at_least: u32) -> bool {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) {
        if count.load(Ordering::SeqCst) >= at_least {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

/// A committed repository with the two files, and a watch on `FILE` counting its events.
fn watching(label: &str) -> (FixtureRepo, Arc<AtomicU32>, FileWatcher) {
    let repo = FixtureRepo::new(label);
    repo.write(FILE, BASE);
    repo.write(OTHER, BASE);
    repo.commit_all("base");
    let count = Arc::new(AtomicU32::new(0));
    let seen = Arc::clone(&count);
    let watcher = FileWatcher::start(&repo.path, FILE, move || {
        seen.fetch_add(1, Ordering::SeqCst);
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(200));
    (repo, count, watcher)
}

#[test]
fn f26_3_writing_the_file_reports_one_change_and_ends_the_watch() {
    let (repo, count, _watcher) = watching("f26-3-write");

    repo.write(FILE, FIXED);
    assert!(wait_for(&count, 1), "no event for the change of the file");

    // The watch ended with the first change: more edits report nothing.
    std::thread::sleep(Duration::from_millis(700));
    repo.write(FILE, "class Queue { }\n");
    std::thread::sleep(Duration::from_millis(900));
    assert_eq!(
        count.load(Ordering::SeqCst),
        1,
        "one event, then the watch is over"
    );
}

#[test]
fn f26_3_a_burst_of_writes_is_one_event() {
    let (repo, count, _watcher) = watching("f26-3-burst");

    for i in 0..20 {
        repo.write(FILE, &format!("class Queue {{ /* edit {i} */ }}\n"));
    }
    assert!(wait_for(&count, 1), "no event for the burst");
    std::thread::sleep(Duration::from_millis(900));
    assert_eq!(count.load(Ordering::SeqCst), 1);
}

#[test]
fn f26_3_changes_to_other_files_are_ignored() {
    let (repo, count, _watcher) = watching("f26-3-other");

    repo.write(OTHER, FIXED);
    repo.write("src/New file.cs", "class New { }\n");
    repo.git(&["add", "-A"]);
    std::thread::sleep(Duration::from_millis(1200));
    assert_eq!(
        count.load(Ordering::SeqCst),
        0,
        "another file is not the watched one"
    );

    // Still alive: the watched file's own change is reported.
    repo.write(FILE, FIXED);
    assert!(wait_for(&count, 1), "the watch died on an unrelated change");
}

#[test]
fn f26_3_writing_the_same_content_is_ignored() {
    let (repo, count, _watcher) = watching("f26-3-same");

    repo.write(FILE, BASE);
    repo.write(FILE, BASE);
    std::thread::sleep(Duration::from_millis(1200));
    assert_eq!(count.load(Ordering::SeqCst), 0, "same content is no change");

    repo.write(FILE, FIXED);
    assert!(
        wait_for(&count, 1),
        "the watch died on a same-content write"
    );
}

#[test]
fn f26_3_the_hash_is_the_one_at_the_click() {
    // Edited before the click (uncommitted work): that content is the baseline, so rewriting it
    // is no change and a different one is.
    let repo = FixtureRepo::new("f26-3-baseline");
    repo.write(FILE, BASE);
    repo.commit_all("base");
    repo.write(FILE, FIXED);
    let count = Arc::new(AtomicU32::new(0));
    let seen = Arc::clone(&count);
    let _watcher = FileWatcher::start(&repo.path, FILE, move || {
        seen.fetch_add(1, Ordering::SeqCst);
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(200));

    repo.write(FILE, FIXED);
    std::thread::sleep(Duration::from_millis(1200));
    assert_eq!(
        count.load(Ordering::SeqCst),
        0,
        "the content at the click is the baseline"
    );

    repo.write(FILE, BASE);
    assert!(
        wait_for(&count, 1),
        "a content different from the click is a change"
    );
}

#[test]
fn f26_3_the_path_may_use_backslashes() {
    let repo = FixtureRepo::new("f26-3-backslash");
    repo.write(FILE, BASE);
    repo.commit_all("base");
    let count = Arc::new(AtomicU32::new(0));
    let seen = Arc::clone(&count);
    let _watcher = FileWatcher::start(&repo.path, &FILE.replace('/', "\\"), move || {
        seen.fetch_add(1, Ordering::SeqCst);
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(200));

    repo.write(FILE, FIXED);
    assert!(wait_for(&count, 1), "no event for a backslash path");
}

#[test]
fn f26_3_dropping_the_watcher_ends_the_watch() {
    let (repo, count, watcher) = watching("f26-3-drop");

    drop(watcher);
    std::thread::sleep(Duration::from_millis(300));
    repo.write(FILE, FIXED);
    std::thread::sleep(Duration::from_millis(1200));
    assert_eq!(
        count.load(Ordering::SeqCst),
        0,
        "Stop waiting must stop the callback"
    );
}

#[test]
fn f26_3_a_file_outside_the_working_tree_is_refused() {
    let repo = FixtureRepo::new("f26-3-outside");
    repo.write(FILE, BASE);
    repo.commit_all("base");

    assert!(FileWatcher::start(&repo.path, "../outside.txt", || ()).is_err());
    assert!(FileWatcher::start(&repo.path, "src/../../outside.txt", || ()).is_err());
}
