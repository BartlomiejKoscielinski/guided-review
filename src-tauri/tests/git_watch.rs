//! The working-tree watcher on a fixture repository (F-16.2).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use fixture_repo::FixtureRepo;
use guided_review_lib::git::watch::RepoWatcher;

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

#[test]
fn f16_2_watcher_debounces_index_changes() {
    let repo = FixtureRepo::new("watch");
    repo.write("a ż.txt", "a\n");
    repo.commit_all("base");
    let count = Arc::new(AtomicU32::new(0));
    let seen = Arc::clone(&count);
    let _watcher = RepoWatcher::start(&repo.path, &repo.path.join(".git"), move || {
        seen.fetch_add(1, Ordering::SeqCst);
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(200));

    // A burst of edits is reported once or a few times, not once per write.
    for i in 0..20 {
        repo.write("a ż.txt", &format!("edit {i}\n"));
    }
    assert!(wait_for(&count, 1), "no event for working-tree edits");
    std::thread::sleep(Duration::from_millis(700));
    let after_burst = count.load(Ordering::SeqCst);
    assert!(after_burst <= 3, "{after_burst} events for one burst");

    // Staging from outside (Rider, a terminal) changes only the index.
    repo.git(&["add", "-A"]);
    assert!(wait_for(&count, after_burst + 1), "no event for git add");
}
