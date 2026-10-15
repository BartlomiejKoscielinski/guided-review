//! Repositories and sources on fixture repositories (F-19.6, F-01.1, F-01.5, F-01.3, F-03.1,
//! F-03.3). Paths carry spaces and Polish characters; remotes are synthetic.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fixture_repo.rs"]
mod fixture_repo;

use std::path::Path;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::git::log;
use guided_review_lib::git::summary::{self, BranchCount, ScopeCount};
use guided_review_lib::os::process::Cancel;
use guided_review_lib::review::model::{Layout, Mode, SessionStatus};
use guided_review_lib::review::sessions::new_session;
use guided_review_lib::route::Route;
use guided_review_lib::source::detect::{self, DetectEnv, DetectedSource};
use guided_review_lib::source::{CommitRange, LocalScope, Source, folder, open};
use guided_review_lib::store::repos::{self, RepoRow};
use guided_review_lib::store::{self, Store};

const SERVER: &str = "https://gitlab.example.com";

fn git(repo: &FixtureRepo) -> Git {
    Git::new(None, &repo.path)
}

fn path(repo: &FixtureRepo) -> String {
    repo.path.to_string_lossy().into_owned()
}

/// main: base, then two commits; branch `feature/zażółć` with two commits of its own.
fn repo_with_history(label: &str) -> FixtureRepo {
    let repo = FixtureRepo::new(label);
    repo.write("src/Delivery ąę.cs", "one\n");
    repo.commit_all("Base commit");
    repo.write("src/Delivery ąę.cs", "one\ntwo\n");
    repo.commit_all("Fix scanner torch ąę");
    repo.write("README.md", "readme\n");
    repo.commit_all("Add readme");
    repo.git(&["checkout", "-q", "-b", "feature/zażółć"]);
    repo.write("src/Feature.cs", "feature\n");
    repo.commit_all("Feature one");
    repo.write("src/Feature.cs", "feature\nmore\n");
    repo.git(&["add", "-A"]);
    repo.git(&[
        "-c",
        "user.name=Anna Kowalska",
        "commit",
        "-q",
        "-m",
        "Feature two",
    ]);
    repo.git(&["checkout", "-q", "main"]);
    repo
}

/// Pushes `main` to a bare origin and sets `origin/HEAD` to it.
fn with_origin(repo: &FixtureRepo) {
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["remote", "set-head", "origin", "main"]);
}

fn row(id: i64, repo_path: &str, project: Option<&str>) -> RepoRow {
    RepoRow {
        id,
        name: "repo ąę".into(),
        path: repo_path.into(),
        gitlab_project: project.map(str::to_owned),
        is_default: id == 1,
        worktree_root: None,
    }
}

async fn detect_in(
    input: &str,
    repos: &[RepoRow],
    active: Option<&RepoRow>,
) -> Result<Option<DetectedSource>, String> {
    let env = DetectEnv {
        server: Some(SERVER),
        repos,
        active,
        git_program: None,
    };
    detect::detect(input, &env, &Cancel::new())
        .await
        .map_err(|e| e.to_string())
}

#[tokio::test]
async fn f19_6_add_detects_the_project_from_https_and_ssh_origins() {
    let repo = FixtureRepo::new("f19-6-add");
    repo.commit_all("init");
    let cancel = Cancel::new();
    let sub = repo.path.join("src ść");
    std::fs::create_dir_all(&sub).unwrap();
    repo.git(&[
        "remote",
        "add",
        "origin",
        "https://gitlab.example.com/mobile/mobile-app.git",
    ]);
    let found = folder::inspect(None, &sub, Some(SERVER), &cancel)
        .await
        .unwrap();
    assert_eq!(found.path, path(&repo));
    assert_eq!(found.name, "repo ąę");
    assert_eq!(found.gitlab_project.as_deref(), Some("mobile/mobile-app"));

    repo.git(&[
        "remote",
        "set-url",
        "origin",
        "git@gitlab.example.com:mobile/zażółć-app.git",
    ]);
    let found = folder::inspect(None, &repo.path, Some(SERVER), &cancel)
        .await
        .unwrap();
    assert_eq!(found.gitlab_project.as_deref(), Some("mobile/zażółć-app"));

    let store = Store::open_in_memory().unwrap();
    let added = store
        .with_conn(|c| repos::add(c, &found.name, &found.path, found.gitlab_project.as_deref()))
        .unwrap();
    assert!(added.is_default);
    assert_eq!(
        added.effective_worktree_root(),
        repo.root.join(".review"),
        "default worktree root is <repo parent>\\.review"
    );

    repo.git(&["remote", "remove", "origin"]);
    let found = folder::inspect(None, &repo.path, Some(SERVER), &cancel)
        .await
        .unwrap();
    assert_eq!(found.gitlab_project, None);
    let other = FixtureRepo::new("f19-6-not-a-repo");
    std::fs::remove_dir_all(other.path.join(".git")).unwrap();
    assert!(
        folder::inspect(None, &other.path, Some(SERVER), &cancel)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn f01_1_detects_iid_sha_branch_and_path() {
    let repo = repo_with_history("f01-1");
    with_origin(&repo);
    repo.git(&["push", "-q", "origin", "feature/zażółć:remote-only"]);
    let active = row(1, &path(&repo), Some("mobile/mobile-app"));
    let repos = [active.clone()];
    let head = repo.head();

    match detect_in("!482", &repos, Some(&active)).await.unwrap() {
        Some(DetectedSource::Mr {
            project,
            iid,
            repo_id,
        }) => {
            assert_eq!(
                (project.as_str(), iid, repo_id),
                ("mobile/mobile-app", 482, 1)
            );
        }
        other => panic!("{other:?}"),
    }
    for input in [&head[..7], head.as_str(), &head.to_uppercase()[..12]] {
        match detect_in(input, &repos, Some(&active)).await.unwrap() {
            Some(DetectedSource::Commit { sha, short_sha }) => {
                assert_eq!(sha, head);
                assert_eq!(short_sha, head[..7]);
            }
            other => panic!("{input}: {other:?}"),
        }
    }
    match detect_in("feature/zażółć", &repos, Some(&active))
        .await
        .unwrap()
    {
        Some(DetectedSource::Branch {
            name,
            remote,
            current,
            ..
        }) => {
            assert_eq!(name, "feature/zażółć");
            assert!(!remote && !current);
        }
        other => panic!("{other:?}"),
    }
    match detect_in("main", &repos, Some(&active)).await.unwrap() {
        Some(DetectedSource::Branch { current, .. }) => assert!(current),
        other => panic!("{other:?}"),
    }
    match detect_in("remote-only", &repos, Some(&active))
        .await
        .unwrap()
    {
        Some(DetectedSource::Branch { name, remote, .. }) => {
            assert_eq!(name, "origin/remote-only");
            assert!(remote);
        }
        other => panic!("{other:?}"),
    }
    let quoted = format!("\"{}\"", repo.path.join("src").display());
    match detect_in(&quoted, &repos, Some(&active)).await.unwrap() {
        Some(DetectedSource::Repository {
            path: p, repo_id, ..
        }) => {
            assert_eq!(p, path(&repo));
            assert_eq!(repo_id, Some(1));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(detect_in("   ", &repos, Some(&active)).await.unwrap(), None);
}

#[tokio::test]
async fn f01_1_branch_with_a_hex_name_and_sha_first() {
    let repo = repo_with_history("f01-1-hex");
    let active = row(1, &path(&repo), None);
    let repos = [active.clone()];
    // A branch named like a SHA that doesn't resolve as one is a branch.
    repo.git(&["branch", "cafe1234"]);
    match detect_in("cafe1234", &repos, Some(&active)).await.unwrap() {
        Some(DetectedSource::Branch { name, .. }) => assert_eq!(name, "cafe1234"),
        other => panic!("{other:?}"),
    }
    // A SHA prefix wins over a branch of the same name.
    let head = repo.head();
    repo.git(&["branch", &head[..8]]);
    assert!(matches!(
        detect_in(&head[..8], &repos, Some(&active)).await.unwrap(),
        Some(DetectedSource::Commit { .. })
    ));
}

#[tokio::test]
async fn f01_5_unknown_input_errors_with_the_spec_copy() {
    let repo = repo_with_history("f01-5");
    let active = row(1, &path(&repo), None);
    let mobile = row(2, r"C:\nowhere", Some("mobile/mobile-app"));
    let repos = [active.clone(), mobile];
    assert_eq!(
        detect_in("no-such-branch", &repos, Some(&active))
            .await
            .unwrap_err(),
        "No commit, branch or repository matches “no-such-branch”."
    );
    assert_eq!(
        detect_in("HEAD~1", &repos, Some(&active))
            .await
            .unwrap_err(),
        "No commit, branch or repository matches “HEAD~1”."
    );
    assert_eq!(
        detect_in("--output=x", &repos, Some(&active))
            .await
            .unwrap_err(),
        "No commit, branch or repository matches “--output=x”."
    );
    assert_eq!(
        detect_in(
            "https://gitlab.example.com/mobile/x/-/merge_requests/9",
            &repos,
            Some(&active)
        )
        .await
        .unwrap_err(),
        "mobile/x is not one of your repositories. Add it in Settings › GitLab."
    );
    assert_eq!(
        detect_in(
            "https://gitlab.other.org/mobile/x/-/merge_requests/9",
            &repos,
            Some(&active)
        )
        .await
        .unwrap_err(),
        "gitlab.other.org is not the configured GitLab server."
    );
    // An MR of another configured repository names that repository (decision 7).
    match detect_in(
        "https://gitlab.example.com/Mobile/Mobile-App/-/merge_requests/482",
        &repos,
        Some(&active),
    )
    .await
    .unwrap()
    {
        Some(DetectedSource::Mr {
            project, repo_id, ..
        }) => {
            assert_eq!((project.as_str(), repo_id), ("mobile/mobile-app", 2));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(
        detect_in("!482", &repos, Some(&active)).await.unwrap_err(),
        "The repository's origin isn't a project on the configured GitLab server."
    );
    assert_eq!(
        detect_in("main", &repos, None).await.unwrap_err(),
        "Pick a repository first."
    );
}

#[tokio::test]
async fn f03_1_log_lists_newest_first_and_filters() {
    let repo = repo_with_history("f03-1");
    let git = git(&repo);
    let cancel = Cancel::new();
    let all = log::log(&git, None, None, &cancel).await.unwrap();
    assert_eq!(all.branch.as_deref(), Some("main"));
    let subjects: Vec<_> = all.commits.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(
        subjects,
        ["Add readme", "Fix scanner torch ąę", "Base commit"]
    );
    assert_eq!(all.commits[0].author, "Test Łukasz");
    assert_eq!(all.commits[0].short_sha.len(), 7);
    // F-03.2: a range starts at the oldest selected commit's parent.
    assert_eq!(
        all.commits[0].parent.as_deref(),
        Some(all.commits[1].sha.as_str())
    );
    assert_eq!(all.commits[2].parent, None, "root commit");

    let feature = log::log(&git, Some("feature/zażółć"), Some("anna"), &cancel)
        .await
        .unwrap();
    assert_eq!(feature.branch.as_deref(), Some("feature/zażółć"));
    let subjects: Vec<_> = feature.commits.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, ["Feature two"]);

    let by_message = log::log(&git, None, Some("TORCH ĄĘ"), &cancel)
        .await
        .unwrap();
    assert_eq!(by_message.commits.len(), 1, "case-insensitive, literal");
    let by_message = log::log(&git, None, Some("torch"), &cancel).await.unwrap();
    assert_eq!(by_message.commits[0].subject, "Fix scanner torch ąę");
    let by_author = log::log(&git, None, Some("łukasz"), &cancel).await.unwrap();
    assert_eq!(by_author.commits.len(), 3);

    let base = &all.commits[2].sha;
    let by_sha = log::log(&git, None, Some(&base[..6]), &cancel)
        .await
        .unwrap();
    assert_eq!(by_sha.commits.len(), 1);
    assert_eq!(&by_sha.commits[0].sha, base);
    let feature_sha = repo.git(&["rev-parse", "feature/zażółć"]);
    let off_branch = log::log(&git, None, Some(&feature_sha.trim()[..10]), &cancel)
        .await
        .unwrap();
    assert!(off_branch.commits.is_empty(), "SHA must be on the branch");
    let regex_chars = log::log(&git, None, Some("[("), &cancel).await.unwrap();
    assert!(regex_chars.commits.is_empty());
    assert!(log::log(&git, Some("HEAD~1"), None, &cancel).await.is_err());
}

#[tokio::test]
async fn f03_1_unborn_repository_has_no_commits() {
    let repo = FixtureRepo::new("f03-1-unborn");
    let list = log::log(&git(&repo), None, None, &Cancel::new())
        .await
        .unwrap();
    assert_eq!(list.branch.as_deref(), Some("main"));
    assert!(list.commits.is_empty());
}

#[tokio::test]
async fn f03_3_counts_for_the_three_scopes() {
    let repo = repo_with_history("f03-3");
    with_origin(&repo);
    repo.git(&["checkout", "-q", "feature/zażółć"]);
    repo.write("src/Feature.cs", "feature\nmore\nstaged\n");
    repo.git(&["add", "src/Feature.cs"]);
    repo.write("src/Feature.cs", "feature\nmore\nstaged\nunstaged\n");
    repo.write("Nowy plik ż.txt", "a\nb\n");
    let cancel = Cancel::new();
    let sum = summary::status_summary(&git(&repo), &cancel).await.unwrap();
    assert_eq!(sum.branch.as_deref(), Some("feature/zażółć"));
    assert_eq!(sum.target.as_deref(), Some("origin/main"));
    assert_eq!(sum.target_name.as_deref(), Some("main"));
    assert_eq!(
        sum.uncommitted,
        ScopeCount {
            files: 2,
            additions: 4,
            deletions: 0
        }
    );
    assert_eq!(
        sum.staged,
        ScopeCount {
            files: 1,
            additions: 1,
            deletions: 0
        }
    );
    assert_eq!(
        sum.branch_vs_target,
        Some(BranchCount {
            commits: 2,
            files: 1
        })
    );
}

#[tokio::test]
async fn f03_3_target_from_origin_head_and_without_origin() {
    let repo = repo_with_history("f03-3-target");
    let cancel = Cancel::new();
    let sum = summary::status_summary(&git(&repo), &cancel).await.unwrap();
    assert_eq!(sum.target, None);
    assert_eq!(sum.branch_vs_target, None);
    with_origin(&repo);
    repo.git(&["push", "-q", "origin", "main:develop"]);
    repo.git(&["remote", "set-head", "origin", "develop"]);
    let sum = summary::status_summary(&git(&repo), &cancel).await.unwrap();
    assert_eq!(sum.target.as_deref(), Some("origin/develop"));
    assert_eq!(sum.target_name.as_deref(), Some("develop"));
    assert_eq!(
        sum.branch_vs_target,
        Some(BranchCount {
            commits: 0,
            files: 0
        })
    );
}

fn store_with(repo: &FixtureRepo) -> (Store, i64) {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .with_conn(|c| repos::add(c, "repo ąę", &path(repo), None))
        .unwrap()
        .id;
    (store, id)
}

fn save(store: &Store, repo_id: i64, resolved: open::Resolved) -> (String, Route) {
    let (row, opened) = new_session(repo_id, resolved, Mode::Focus, Layout::A).unwrap();
    store
        .with_conn(|c| store::sessions::insert(c, &row))
        .unwrap();
    (opened.session_id, opened.route)
}

#[tokio::test]
async fn f01_3_session_for_a_commit_and_a_range() {
    let repo = repo_with_history("f01-3-commit");
    let (store, repo_id) = store_with(&repo);
    let git = git(&repo);
    let cancel = Cancel::new();
    let head = repo.head();
    let parent = repo.git(&["rev-parse", "HEAD~1"]).trim().to_owned();
    let root = repo.git(&["rev-parse", "HEAD~2"]).trim().to_owned();

    let single = CommitRange {
        from: None,
        to: head[..7].to_owned(),
    };
    let resolved = open::commits(&git, &single, &cancel).await.unwrap();
    assert_eq!(resolved.base_sha, parent);
    assert_eq!(resolved.head_sha, head);
    let (id, route) = save(&store, repo_id, resolved);
    // F-17.1 (M3 decision 12): a commit opens the plan like local changes and MRs.
    assert_eq!(
        route,
        Route::Plan {
            session_id: id.clone()
        }
    );
    let stored = store
        .with_conn(|c| store::sessions::source_of(c, &id))
        .unwrap()
        .unwrap();
    assert_eq!(stored.repo_id, repo_id);
    assert_eq!(stored.status, Some(SessionStatus::Planning));
    let source: Source = serde_json::from_str(&stored.source_json).unwrap();
    assert_eq!(
        source,
        Source::Commits {
            from: None,
            to: head.clone()
        }
    );
    assert_eq!(
        store
            .with_conn(|c| store::unfinished_sessions(c))
            .unwrap()
            .len(),
        1
    );

    let range = CommitRange {
        from: Some(root.clone()),
        to: head.clone(),
    };
    let resolved = open::commits(&git, &range, &cancel).await.unwrap();
    assert_eq!(resolved.base_sha, root);
    let backwards = CommitRange {
        from: Some(head.clone()),
        to: root.clone(),
    };
    assert!(open::commits(&git, &backwards, &cancel).await.is_err());
    let root_commit = CommitRange {
        from: None,
        to: root.clone(),
    };
    let resolved = open::commits(&git, &root_commit, &cancel).await.unwrap();
    assert_ne!(
        resolved.base_sha, root,
        "a root commit diffs against the empty tree"
    );
    let bad = CommitRange {
        from: None,
        to: "main".to_owned(),
    };
    assert!(open::commits(&git, &bad, &cancel).await.is_err());
}

#[tokio::test]
async fn f01_3_session_for_local_scopes_and_branches() {
    let repo = repo_with_history("f01-3-local");
    with_origin(&repo);
    let (store, repo_id) = store_with(&repo);
    let git = git(&repo);
    let cancel = Cancel::new();
    let main = repo.head();
    let feature = repo.git(&["rev-parse", "feature/zażółć"]).trim().to_owned();

    // Another branch: its own commits since the merge base with the target.
    let resolved = open::branch(&git, "feature/zażółć", &cancel).await.unwrap();
    assert_eq!(
        resolved.source,
        Source::Commits {
            from: Some(main.clone()),
            to: feature.clone()
        }
    );
    // The current branch: local changes, whole branch against origin/HEAD.
    repo.git(&["checkout", "-q", "feature/zażółć"]);
    let resolved = open::branch(&git, "feature/zażółć", &cancel).await.unwrap();
    assert_eq!(
        resolved.source,
        Source::Local {
            scope: LocalScope::BranchVsTarget {
                target: "origin/main".into()
            }
        }
    );
    assert_eq!(
        (resolved.base_sha.as_str(), resolved.head_sha.as_str()),
        (main.as_str(), feature.as_str())
    );
    let (id, route) = save(&store, repo_id, resolved);
    assert_eq!(
        route,
        Route::Plan {
            session_id: id.clone()
        }
    );
    let stored = store
        .with_conn(|c| store::sessions::source_of(c, &id))
        .unwrap()
        .unwrap();
    assert_eq!(stored.status, Some(SessionStatus::Planning));

    let staged = open::local(&git, &LocalScope::Staged, &cancel)
        .await
        .unwrap();
    assert_eq!(
        (staged.base_sha.as_str(), staged.head_sha.as_str()),
        (feature.as_str(), feature.as_str())
    );
    let unknown = LocalScope::BranchVsTarget {
        target: "origin/nope".into(),
    };
    assert!(open::local(&git, &unknown, &cancel).await.is_err());
    assert!(
        open::branch(&git, "main", &cancel).await.is_err(),
        "no commits of its own"
    );
}

#[tokio::test]
async fn f01_3_session_default_scope_without_origin_is_uncommitted() {
    let repo = repo_with_history("f01-3-no-origin");
    let scope = open::default_scope(&git(&repo), &Cancel::new())
        .await
        .unwrap();
    assert_eq!(scope, LocalScope::Uncommitted);
    let unborn = FixtureRepo::new("f01-3-unborn");
    assert!(
        open::local(&git(&unborn), &LocalScope::Uncommitted, &Cancel::new())
            .await
            .is_err()
    );
    assert!(Path::new(&path(&repo)).is_dir());
}

#[tokio::test]
async fn f04_1_a_self_review_card_is_named_after_the_checked_out_branch() {
    let repo = repo_with_history("f04-1-branch");
    repo.git(&["checkout", "-q", "feature/zażółć"]);
    let (store, repo_id) = store_with(&repo);
    let cancel = Cancel::new();
    let resolved = open::local(&git(&repo), &LocalScope::Uncommitted, &cancel)
        .await
        .unwrap();
    let (local, _) = save(&store, repo_id, resolved);
    let head = repo.head();
    let commit = open::commits(
        &git(&repo),
        &CommitRange {
            from: None,
            to: head.clone(),
        },
        &cancel,
    )
    .await
    .unwrap();
    let (commits, _) = save(&store, repo_id, commit);
    let (mut list, checkouts) = store
        .with_conn(|c| {
            let list = store::unfinished_sessions(c)?;
            let checkouts = store::sessions::self_review_checkouts(c, &list)?;
            Ok((list, checkouts))
        })
        .unwrap();
    assert_eq!(checkouts.len(), 1, "only the self-review needs its branch");
    let title = |list: &[guided_review_lib::review::sessions::UnfinishedSession], id: &str| {
        list.iter().find(|s| s.id == id).unwrap().title.clone()
    };
    assert_eq!(
        title(&list, &local),
        "repo ąę",
        "the repository until the branch is read"
    );
    guided_review_lib::review::sessions::name_self_reviews(&mut list, &checkouts, None, &cancel)
        .await;
    assert_eq!(title(&list, &local), "feature/zażółć");
    assert_eq!(
        title(&list, &commits),
        head.chars().take(7).collect::<String>()
    );

    // A detached HEAD has no branch: the repository's name stays.
    repo.git(&["checkout", "-q", "--detach"]);
    let mut list = store.with_conn(|c| store::unfinished_sessions(c)).unwrap();
    guided_review_lib::review::sessions::name_self_reviews(&mut list, &checkouts, None, &cancel)
        .await;
    assert_eq!(title(&list, &local), "repo ąę");
}
