//! F-11.3 below the Tauri layer: a thread written on an older version of the MR is shown on the
//! closest matching line of the current version (the same line text within +-20 lines of the line
//! the interdiff maps it to) with the outdated flag; without a match it is on the file header of
//! the first step, in the reader's order, that shows the file; a file no longer in the MR keeps
//! the thread out of every step (S-05 only). M5 decision 4.
//!
//! The threads travel the production path: a stored MR session, its cached plan,
//! `step_context::load` with a threads fetcher (GitLab's discussions JSON through
//! `discussions::parse`) and `step_view::of`. Old versions are commits of the fixture repository,
//! so they are read from the object store; fetching a missing commit is a field check. No
//! Claude run, synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::path::PathBuf;

use fixture_repo::FixtureRepo;
use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::queue::Queue;
use guided_review_lib::claude::tasks::plan::{self, Context, PlanRequest};
use guided_review_lib::claude::tasks::plan_inputs::PlanSource;
use guided_review_lib::git::Git;
use guided_review_lib::gitlab::discussions::{self, Thread};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::plan_cache;
use guided_review_lib::review::step_context::{self, StepContext};
use guided_review_lib::review::step_view::{self, StepView};
use guided_review_lib::settings::ClaudeSettings;
use guided_review_lib::store::{self, Store};
use serde_json::{Value, json};

/// Paths with spaces and Polish letters, as on the company PC.
const F: &str = "src/App/Zażółć/Upload ViewModel.cs";
const G: &str = "src/Core/Second file.cs";
const ENQUEUE: &str = "    await queue.EnqueueAsync(photo);";
const RESET: &str = "    Reset();";
const LEGACY: &str = "    LegacyUpload(photo);";
/// A commit the repository does not have (and no remote to fetch it from).
const MISSING: &str = "0123456789abcdef0123456789abcdef01234567";

/// `n` lines "    int f1;" ... a file whose lines are all different.
fn fill(n: usize) -> Vec<String> {
    (1..=n).map(|i| format!("    int f{i};")).collect()
}

/// Replaces the 1-based `line`.
fn put(lines: &mut [String], line: usize, text: &str) {
    lines[line - 1] = text.to_owned();
}

fn text(lines: &[String]) -> String {
    lines.join("\n") + "\n"
}

/// One hunk of base -> head as a step of its own: which step holds which lines.
struct HunkAt {
    step: String,
    path: String,
    old: (u32, u32),
    new: (u32, u32),
}

struct Case {
    repo: FixtureRepo,
    tmp: tempfile::TempDir,
    store: Store,
    queue: Queue,
    exe: ClaudeExecutable,
    settings: ClaudeSettings,
    base: String,
    old: String,
    head: String,
    hunks: Vec<HunkAt>,
}

/// A fixture repository with the file sets `base`, `old` (the version the threads were written
/// on) and `head` (the version the session reviews: base -> head) as three commits in a row, and
/// a stored MR session `r1` (!482) planned with one step per hunk (`s1`, `s2`, ... in file order).
/// `order` is the reader's order as step numbers; empty = file order.
async fn case(
    label: &str,
    base: &[(&str, String)],
    old: &[(&str, String)],
    head: &[(&str, String)],
    order: &[usize],
) -> Case {
    let repo = FixtureRepo::new(label);
    for (path, body) in base {
        repo.write(path, body);
    }
    let base_sha = repo.commit_all("base");
    for (path, body) in old {
        repo.write(path, body);
    }
    let old_sha = repo.commit_all("first version");
    for (path, body) in head {
        repo.write(path, body);
    }
    let head_sha = repo.commit_all("second version");
    Case::open(repo, base_sha, old_sha, head_sha, order).await
}

impl Case {
    async fn open(
        repo: FixtureRepo,
        base: String,
        old: String,
        head: String,
        order: &[usize],
    ) -> Self {
        let store = Store::open_in_memory().unwrap();
        let path = repo.path.to_string_lossy().into_owned();
        let (base_c, head_c) = (base.clone(), head.clone());
        store
            .with_conn(move |c| {
                let row = store::repos::add(c, "app", &path, Some("team/app"))?;
                c.execute(
                    "INSERT INTO sessions (id, repo_id, source_json, base_sha, head_sha, mr_json)
                     VALUES ('r1', ?1, '{\"kind\":\"mr\",\"project\":\"team/app\",\"iid\":482}', ?2, ?3,
                     '{\"iid\":482,\"title\":\"Offline queue\",\"author\":\"Alice\",\"sourceBranch\":\"feature/queue\",\"targetBranch\":\"develop\"}')",
                    rusqlite::params![row.id, base_c, head_c],
                )?;
                Ok(())
            })
            .unwrap();
        let mut case = Self {
            repo,
            tmp: tempfile::tempdir().unwrap(),
            store,
            queue: Queue::new(2),
            exe: ClaudeExecutable::Native(PathBuf::from(env!("CARGO_BIN_EXE_fake-claude"))),
            settings: ClaudeSettings::default(),
            base,
            old,
            head,
            hunks: Vec::new(),
        };
        case.plan(order).await;
        case
    }

    fn ctx(&self) -> Context<'_> {
        Context {
            exe: &self.exe,
            settings: &self.settings,
            tmp_root: self.tmp.path(),
            queue: &self.queue,
            store: &self.store,
        }
    }

    /// S-02 planned the session: every hunk of base -> head is a step, in file order.
    async fn plan(&mut self, order: &[usize]) {
        let git = Git::new(None, &self.repo.path);
        let files = step_context::files(&git, &self.base, &self.head, &Cancel::new())
            .await
            .unwrap();
        let mut steps = Vec::new();
        for file in &files {
            let path = file.new_path.clone().or(file.old_path.clone()).unwrap();
            for h in &file.hunks {
                let id = format!("s{}", steps.len() + 1);
                self.hunks.push(HunkAt {
                    step: id.clone(),
                    path: path.clone(),
                    old: (h.old_start, h.old_lines),
                    new: (h.new_start, h.new_lines),
                });
                steps.push(
                    json!({ "id": id, "title": format!("Step {id}"), "short_title": id,
                    "reason": "Order.", "description": format!("Step {id}."),
                    "layer": "App", "hunk_ids": [h.id], "builds_on": [] }),
                );
            }
        }
        let ids: Vec<String> = if order.is_empty() {
            (1..=steps.len()).map(|n| format!("s{n}")).collect()
        } else {
            order.iter().map(|n| format!("s{n}")).collect()
        };
        let output = json!({
            "intent": "Uploads go through a queue.",
            "steps": steps,
            "orders": { "contract_to_ui": ids, "tests_first": ids },
            "skim": [], "risks": [], "description_check": [], "already_discussed": ""
        });
        let source = PlanSource::Mr {
            iid: 482,
            title: "Offline queue".into(),
            source_branch: "feature/queue".into(),
            target_branch: "develop".into(),
        };
        let key = plan::key(
            &self.ctx(),
            &PlanRequest {
                repo_id: 1,
                project: "team/app",
                source,
                base_sha: &self.base,
                head_sha: &self.head,
                cwd: &self.repo.path,
                description: None,
                files: &files,
                threads: &[],
                rules: None,
            },
        );
        self.store
            .with_conn(|c| plan_cache::put(c, &key, &output))
            .unwrap();
    }

    /// The step context as the commands build it: the threads come from GitLab (a stand-in
    /// fetcher).
    async fn load(&self, threads: Vec<Thread>) -> StepContext {
        step_context::load(
            &self.ctx(),
            None,
            "r1",
            move |_| async move { threads },
            &Cancel::new(),
        )
        .await
        .unwrap()
    }

    /// The step whose hunk holds `line` of `path` (the new side, else the old side).
    fn step_of(&self, path: &str, new_side: bool, line: u32) -> String {
        let holds = |(start, count): (u32, u32)| line >= start && line < start + count;
        self.hunks
            .iter()
            .find(|h| h.path == path && holds(if new_side { h.new } else { h.old }))
            .unwrap_or_else(|| panic!("no hunk holds {path}:{line}"))
            .step
            .clone()
    }

    /// The first step (file order) with a hunk of `path`.
    fn first_step_of(&self, path: &str) -> String {
        self.hunks
            .iter()
            .find(|h| h.path == path)
            .unwrap_or_else(|| panic!("no hunk in {path}"))
            .step
            .clone()
    }
}

/// One GitLab discussion with a diff position, as the API sends it.
fn discussion(
    id: &str,
    path: &str,
    (old_line, new_line): (Option<u32>, Option<u32>),
    (head_sha, base_sha): (&str, &str),
    body: &str,
) -> Value {
    json!({ "id": id, "individual_note": false, "notes": [{
        "id": 1, "body": body, "author": { "username": "alice", "name": "Alice" },
        "created_at": "2026-10-12T10:00:00Z", "system": false, "resolvable": true,
        "resolved": false, "type": "DiffNote",
        "position": { "position_type": "text", "old_path": path, "new_path": path,
            "old_line": old_line, "new_line": new_line,
            "head_sha": head_sha, "base_sha": base_sha, "start_sha": base_sha }
    }] })
}

fn parse(items: Vec<Value>) -> Vec<Thread> {
    discussions::parse(items).unwrap()
}

/// Every step of the reader's order, as S-03 opens them.
fn views(cx: &StepContext) -> Vec<StepView> {
    let order = cx.order(Strategy::ContractToUi);
    order
        .iter()
        .map(|id| step_view::of(cx, &order, id, false).unwrap())
        .collect()
}

/// The steps that show thread `id` on a line, and the steps that show it on a file header.
fn seen(views: &[StepView], id: &str) -> (Vec<String>, Vec<String>) {
    let by = |pick: fn(&StepView) -> &Vec<Thread>| {
        views
            .iter()
            .filter(|v| pick(v).iter().any(|t| t.id == id))
            .map(|v| v.step.id.clone())
            .collect::<Vec<_>>()
    };
    (by(|v| &v.threads), by(|v| &v.file_threads))
}

fn thread_of<'a>(cx: &'a StepContext, id: &str) -> &'a Thread {
    cx.threads.iter().find(|t| t.id == id).unwrap()
}

#[tokio::test]
async fn f11_3_same_text_moved_by_12_lines_shows_on_its_new_line_with_the_outdated_flag() {
    let base = fill(60);
    let mut old = base.clone();
    put(&mut old, 20, ENQUEUE);
    // The author pushed again: 12 lines went in above, the statement is now on line 32.
    let mut head = base.clone();
    drop(head.splice(2..2, (1..=12).map(|i| format!("    int added{i};"))));
    put(&mut head, 32, ENQUEUE);
    let c = case(
        "f11-3 moved",
        &[(F, text(&base))],
        &[(F, text(&old))],
        &[(F, text(&head))],
        &[],
    )
    .await;
    let cx = c
        .load(parse(vec![discussion(
            "d1",
            F,
            (None, Some(20)),
            (&c.old, &c.base),
            "Should this be awaited?",
        )]))
        .await;

    let t = thread_of(&cx, "d1");
    assert!(t.outdated);
    assert_eq!(t.placed_line, Some(32));
    // GitLab's own position stays as it sent it.
    assert_eq!(t.position.as_ref().unwrap().new_line, Some(20));
    let shown_on = c.step_of(F, true, 32);
    assert_ne!(shown_on, c.step_of(F, true, 5), "two hunks, two steps");
    assert_eq!(seen(&views(&cx), "d1"), (vec![shown_on], vec![]));
}

#[tokio::test]
async fn f11_3_text_edited_goes_to_the_file_header_of_the_first_step_with_the_file() {
    let base = fill(60);
    let mut old = base.clone();
    put(&mut old, 20, ENQUEUE);
    let mut head = base.clone();
    put(&mut head, 20, "    await queue.EnqueueAsync(photo, token);");
    put(&mut head, 50, "    int other = 1;");
    let c = case(
        "f11-3 edited",
        &[(F, text(&base))],
        &[(F, text(&old))],
        &[(F, text(&head))],
        &[],
    )
    .await;
    let cx = c
        .load(parse(vec![discussion(
            "d1",
            F,
            (None, Some(20)),
            (&c.old, &c.base),
            "Should this be awaited?",
        )]))
        .await;

    let t = thread_of(&cx, "d1");
    assert!(t.outdated);
    assert_eq!(t.placed_line, None);
    // Two steps show the file; the card is on the header of the first one only, and not on a line.
    assert_eq!(c.first_step_of(F), c.step_of(F, true, 20));
    assert_ne!(c.first_step_of(F), c.step_of(F, true, 50));
    assert_eq!(seen(&views(&cx), "d1"), (vec![], vec![c.first_step_of(F)]));
}

#[tokio::test]
async fn f11_3_the_match_may_be_20_lines_away_but_not_21() {
    let base = fill(70);
    let mut old = base.clone();
    put(&mut old, 30, ENQUEUE);
    // The statement moved down: 20 lines from the changed line in F, 21 in G.
    let mut head_f = base.clone();
    put(&mut head_f, 30, RESET);
    put(&mut head_f, 50, ENQUEUE);
    let mut head_g = base.clone();
    put(&mut head_g, 30, RESET);
    put(&mut head_g, 51, ENQUEUE);
    let c = case(
        "f11-3 distance",
        &[(F, text(&base)), (G, text(&base))],
        &[(F, text(&old)), (G, text(&old))],
        &[(F, text(&head_f)), (G, text(&head_g))],
        &[],
    )
    .await;
    let cx = c
        .load(parse(vec![
            discussion("near", F, (None, Some(30)), (&c.old, &c.base), "Near."),
            discussion("far", G, (None, Some(30)), (&c.old, &c.base), "Far."),
        ]))
        .await;

    let near = thread_of(&cx, "near");
    assert!(near.outdated);
    assert_eq!(near.placed_line, Some(50));
    let far = thread_of(&cx, "far");
    assert!(far.outdated);
    assert_eq!(far.placed_line, None);

    let views = views(&cx);
    assert_eq!(seen(&views, "near"), (vec![c.step_of(F, true, 50)], vec![]));
    assert_eq!(seen(&views, "far"), (vec![], vec![c.first_step_of(G)]));
}

#[tokio::test]
async fn f11_3_the_nearest_match_wins_and_a_tie_goes_to_the_upper_line() {
    let base = fill(60);
    let mut old = base.clone();
    put(&mut old, 30, ENQUEUE);
    // F: copies 5 lines above and 5 below the changed line 30 (a tie).
    let mut head_f = base.clone();
    put(&mut head_f, 30, RESET);
    put(&mut head_f, 25, ENQUEUE);
    put(&mut head_f, 35, ENQUEUE);
    // G: a copy 10 lines above and one 3 below; the nearer one wins, not the upper one.
    let mut head_g = base.clone();
    put(&mut head_g, 30, RESET);
    put(&mut head_g, 20, ENQUEUE);
    put(&mut head_g, 33, ENQUEUE);
    let c = case(
        "f11-3 nearest",
        &[(F, text(&base)), (G, text(&base))],
        &[(F, text(&old)), (G, text(&old))],
        &[(F, text(&head_f)), (G, text(&head_g))],
        &[],
    )
    .await;
    let cx = c
        .load(parse(vec![
            discussion("tie", F, (None, Some(30)), (&c.old, &c.base), "Tie."),
            discussion("near", G, (None, Some(30)), (&c.old, &c.base), "Nearer."),
        ]))
        .await;

    assert_eq!(thread_of(&cx, "tie").placed_line, Some(25));
    assert_eq!(thread_of(&cx, "near").placed_line, Some(33));
    let views = views(&cx);
    assert_eq!(seen(&views, "tie"), (vec![c.step_of(F, true, 25)], vec![]));
    assert_eq!(seen(&views, "near"), (vec![c.step_of(G, true, 33)], vec![]));
}

#[tokio::test]
async fn f11_3_same_text_ignores_leading_and_trailing_whitespace() {
    let base = fill(60);
    let mut old = base.clone();
    put(&mut old, 30, ENQUEUE);
    let mut head = base.clone();
    put(&mut head, 30, RESET);
    // The block was re-indented and a trailing space slipped in.
    put(&mut head, 33, "        await queue.EnqueueAsync(photo);  ");
    let c = case(
        "f11-3 whitespace",
        &[(F, text(&base))],
        &[(F, text(&old))],
        &[(F, text(&head))],
        &[],
    )
    .await;
    let cx = c
        .load(parse(vec![discussion(
            "d1",
            F,
            (None, Some(30)),
            (&c.old, &c.base),
            "Indented now.",
        )]))
        .await;

    assert!(thread_of(&cx, "d1").outdated);
    assert_eq!(thread_of(&cx, "d1").placed_line, Some(33));
    assert_eq!(
        seen(&views(&cx), "d1"),
        (vec![c.step_of(F, true, 33)], vec![])
    );
}

#[tokio::test]
async fn f11_3_a_thread_on_a_removed_line_keeps_its_old_side_line() {
    let mut base = fill(60);
    put(&mut base, 20, LEGACY);
    // The first version removed the line; the second one also inserted 12 lines above it, which
    // moves every new-side line but not the old side (the target branch didn't change).
    let mut old = base.clone();
    old.remove(19);
    let mut head = old.clone();
    drop(head.splice(2..2, (1..=12).map(|i| format!("    int added{i};"))));
    let c = case(
        "f11-3 removed",
        &[(F, text(&base))],
        &[(F, text(&old))],
        &[(F, text(&head))],
        &[],
    )
    .await;
    let cx = c
        .load(parse(vec![discussion(
            "d1",
            F,
            (Some(20), None),
            (&c.old, &c.base),
            "Why is this going away?",
        )]))
        .await;

    let t = thread_of(&cx, "d1");
    assert!(t.outdated);
    assert_eq!(t.placed_line, Some(20));
    let shown_on = c.step_of(F, false, 20);
    assert_ne!(
        shown_on,
        c.step_of(F, true, 5),
        "the insertion is another step"
    );
    assert_eq!(seen(&views(&cx), "d1"), (vec![shown_on], vec![]));
}

#[tokio::test]
async fn f11_3_rebase_with_an_unchanged_file_keeps_the_lines() {
    // main moves on (another file), the branch is rebuilt on it with the same change to F.
    let repo = FixtureRepo::new("f11-3 rebase");
    let mut base = fill(60);
    put(&mut base, 40, LEGACY);
    repo.write(F, &text(&base));
    repo.write("other.txt", "one\n");
    let base_sha = repo.commit_all("base");
    repo.git(&["checkout", "-q", "-b", "feature"]);
    let mut version = base.clone();
    put(&mut version, 20, ENQUEUE);
    version.remove(39);
    repo.write(F, &text(&version));
    let old_sha = repo.commit_all("first version");
    repo.git(&["checkout", "-q", "main"]);
    repo.write("other.txt", "one\ntwo\n");
    let moved_base = repo.commit_all("target moved on");
    repo.git(&["checkout", "-q", "-b", "feature-rebased"]);
    repo.write(F, &text(&version));
    let head_sha = repo.commit_all("rebased");
    let c = Case::open(repo, moved_base, old_sha.clone(), head_sha, &[]).await;
    let cx = c
        .load(parse(vec![
            discussion(
                "added",
                F,
                (None, Some(20)),
                (&old_sha, &base_sha),
                "On the added line.",
            ),
            discussion(
                "removed",
                F,
                (Some(40), None),
                (&old_sha, &base_sha),
                "On the removed line.",
            ),
        ]))
        .await;

    // Written on another version (the head moved), so both carry the flag; the file didn't
    // change between the versions, so neither line moved.
    let added = thread_of(&cx, "added");
    assert!(added.outdated);
    assert_eq!(added.placed_line, Some(20));
    let removed = thread_of(&cx, "removed");
    assert!(removed.outdated);
    assert_eq!(removed.placed_line, Some(40));
    let views = views(&cx);
    assert_eq!(
        seen(&views, "added"),
        (vec![c.step_of(F, true, 20)], vec![])
    );
    assert_eq!(
        seen(&views, "removed"),
        (vec![c.step_of(F, false, 40)], vec![])
    );
}

#[tokio::test]
async fn f11_3_a_file_no_longer_in_the_mr_is_in_no_step_but_stays_in_the_session() {
    let base = fill(60);
    let mut old = base.clone();
    put(&mut old, 20, ENQUEUE);
    // The second version took the change to G back out; F keeps its own.
    let mut head_f = base.clone();
    put(&mut head_f, 20, RESET);
    let c = case(
        "f11-3 gone",
        &[(F, text(&base)), (G, text(&base))],
        &[(F, text(&old)), (G, text(&old))],
        &[(F, text(&head_f)), (G, text(&base))],
        &[],
    )
    .await;
    let cx = c
        .load(parse(vec![
            discussion("gone", G, (None, Some(20)), (&c.old, &c.base), "Gone."),
            discussion("kept", F, (None, Some(20)), (&c.old, &c.base), "Kept."),
        ]))
        .await;

    // S-05 lists it; no step shows it.
    let t = thread_of(&cx, "gone");
    assert!(t.outdated);
    assert_eq!(t.placed_line, None);
    let views = views(&cx);
    assert_eq!(seen(&views, "gone"), (vec![], vec![]));
    // The other file's thread is not lost with it (the changed line itself: no copy, header).
    assert_eq!(seen(&views, "kept"), (vec![], vec![c.first_step_of(F)]));
}

#[tokio::test]
async fn f11_3_current_threads_stay_on_their_lines_and_one_on_a_context_line_goes_to_the_header() {
    let base = fill(60);
    let mut head = base.clone();
    put(&mut head, 30, ENQUEUE);
    // One version: the threads were written on the head itself.
    let c = case(
        "f11-3 current",
        &[(F, text(&base))],
        &[(F, text(&head))],
        &[(F, text(&head))],
        &[],
    )
    .await;
    let cx = c
        .load(parse(vec![
            discussion(
                "inside",
                F,
                (None, Some(30)),
                (&c.head, &c.base),
                "On the change.",
            ),
            // Line 5 is far from the one hunk (lines 27-33): a comment on expanded context.
            discussion(
                "context",
                F,
                (None, Some(5)),
                (&c.head, &c.base),
                "On context.",
            ),
        ]))
        .await;

    assert!(!thread_of(&cx, "inside").outdated);
    assert!(!thread_of(&cx, "context").outdated);
    let views = views(&cx);
    assert_eq!(
        seen(&views, "inside"),
        (vec![c.step_of(F, true, 30)], vec![])
    );
    assert_eq!(seen(&views, "context"), (vec![], vec![c.first_step_of(F)]));
}

#[tokio::test]
async fn f11_3_the_header_card_is_in_the_first_step_of_the_readers_order_that_shows_the_file() {
    let base = fill(60);
    let mut old = base.clone();
    put(&mut old, 30, ENQUEUE);
    let mut head = base.clone();
    put(&mut head, 10, "    int first = 1;");
    put(&mut head, 30, "    await queue.EnqueueAsync(photo, token);");
    put(&mut head, 50, "    int last = 1;");
    // Three steps of F in file order; the reader's order starts with the last hunk.
    let c = case(
        "f11-3 order",
        &[(F, text(&base))],
        &[(F, text(&old))],
        &[(F, text(&head))],
        &[3, 1, 2],
    )
    .await;
    let cx = c
        .load(parse(vec![discussion(
            "d1",
            F,
            (None, Some(30)),
            (&c.old, &c.base),
            "No match.",
        )]))
        .await;

    assert_eq!(c.step_of(F, true, 50), "s3");
    assert_eq!(seen(&views(&cx), "d1"), (vec![], vec!["s3".to_owned()]));
}

#[tokio::test]
async fn f11_3_an_old_commit_that_cannot_be_read_puts_the_thread_on_the_file_header() {
    let base = fill(60);
    let mut head = base.clone();
    put(&mut head, 20, ENQUEUE);
    let c = case(
        "f11-3 missing",
        &[(F, text(&base))],
        &[(F, text(&head))],
        &[(F, text(&head))],
        &[],
    )
    .await;
    let cx = c
        .load(parse(vec![discussion(
            "d1",
            F,
            (None, Some(20)),
            (MISSING, &c.base),
            "From a version we can't read.",
        )]))
        .await;

    // Not in the object store and not fetchable: no line to trust, but the thread isn't lost.
    let t = thread_of(&cx, "d1");
    assert!(t.outdated);
    assert_eq!(t.placed_line, None);
    assert_eq!(seen(&views(&cx), "d1"), (vec![], vec![c.first_step_of(F)]));
}

#[test]
fn f11_3_a_position_keeps_the_base_sha_it_was_written_against() {
    let threads = parse(vec![discussion(
        "d1",
        F,
        (None, Some(7)),
        ("headsha1", "basesha1"),
        "Text.",
    )]);
    let pos = threads[0].position.as_ref().unwrap();
    assert_eq!(pos.head_sha, "headsha1");
    assert_eq!(pos.base_sha, "basesha1");
    // A thread nobody has placed yet is not outdated and has no placed line.
    assert!(!threads[0].outdated);
    assert_eq!(threads[0].placed_line, None);
}
