//! "Wrote N% of the changed lines" for the reviewer suggestions of S-11 (F-27.3): `git blame` of
//! the lines the branch changes, read at the merge base with the target, as a share per author
//! e-mail. The signed-in user's own lines are left out of the list but stay in the total.
//! Authors and paths carry Polish characters; remotes are synthetic.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::reviewers::blame_share::shares;

const OLA: (&str, &str) = ("Ola Majewska", "ola.m@firma.example");
const LUKASZ: (&str, &str) = ("Łukasz Żółć", "lukasz.zolc@firma.example");
/// The fixture's own identity (`FixtureRepo::new`): the user who is creating the MR.
const ME: &str = "test@example.invalid";
const FILE: &str = "src/Widoki/Lista ąę.cs";

fn lines(prefix: &str, count: usize) -> String {
    (1..=count).map(|n| format!("{prefix}{n}\n")).collect()
}

fn commit_as(repo: &FixtureRepo, (name, email): (&str, &str), message: &str) {
    repo.git(&["add", "-A"]);
    repo.git(&[
        "commit",
        "-q",
        "--author",
        &format!("{name} <{email}>"),
        "-m",
        message,
    ]);
}

/// `main` (pushed to origin) holds `FILE`: `ola` lines by Ola, then `lukasz` lines by Łukasz,
/// then `mine` lines by the fixture's own identity. The checkout moves to a feature branch.
fn repo_with_history(label: &str, ola: usize, lukasz: usize, mine: usize) -> FixtureRepo {
    let repo = FixtureRepo::new(label);
    let mut text = lines("a", ola);
    repo.write(FILE, &text);
    commit_as(&repo, OLA, "Ola writes");
    text.push_str(&lines("b", lukasz));
    repo.write(FILE, &text);
    commit_as(&repo, LUKASZ, "Łukasz appends");
    text.push_str(&lines("c", mine));
    repo.write(FILE, &text);
    repo.commit_all("I append");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", "feature/zażółć"]);
    repo
}

async fn shares_of(repo: &FixtureRepo, me: Option<&str>) -> Vec<(String, String, u32)> {
    let git = Git::new(None, &repo.path);
    shares(&git, "main", me, &Cancel::new())
        .await
        .unwrap()
        .into_iter()
        .map(|s| (s.name, s.email, s.percent))
        .collect()
}

fn expected(rows: &[((&str, &str), u32)]) -> Vec<(String, String, u32)> {
    rows.iter()
        .map(|((name, email), percent)| ((*name).to_owned(), (*email).to_owned(), *percent))
        .collect()
}

#[tokio::test]
async fn f27_3_blame_share_counts_the_old_lines_the_branch_changes_per_author() {
    let repo = repo_with_history("f27-3-blame", 4, 3, 3);
    // Every one of the 10 old lines is rewritten; a new file adds lines nobody wrote before.
    repo.write(FILE, &lines("n", 10));
    repo.write("src/Nowy plik.cs", &lines("z", 5));
    repo.commit_all("Rewrite");
    // Ola 4 of 10 and Łukasz 3 of 10; my own 3 lines count in the total but are not listed.
    assert_eq!(
        shares_of(&repo, Some(ME)).await,
        expected(&[(OLA, 40), (LUKASZ, 30)])
    );
}

#[tokio::test]
async fn f27_3_blame_share_lists_everybody_when_the_user_is_unknown_and_ignores_e_mail_case() {
    let repo = repo_with_history("f27-3-blame-me", 4, 3, 2);
    repo.write(FILE, &lines("n", 9));
    repo.commit_all("Rewrite");
    // 4, 3 and 2 of 9 lines.
    assert_eq!(
        shares_of(&repo, None).await,
        expected(&[(OLA, 44), (LUKASZ, 33), (("Test Łukasz", ME), 22)])
    );
    assert_eq!(
        shares_of(&repo, Some("TEST@Example.Invalid")).await,
        expected(&[(OLA, 44), (LUKASZ, 33)])
    );
}

#[tokio::test]
async fn f27_3_blame_share_rounds_to_whole_percent_and_sorts_by_share() {
    let repo = repo_with_history("f27-3-blame-round", 4, 3, 0);
    // Łukasz's 3 lines and Ola's first 4 are rewritten: 4/7 and 3/7.
    repo.write(FILE, &lines("n", 7));
    repo.commit_all("Rewrite");
    assert_eq!(
        shares_of(&repo, Some(ME)).await,
        expected(&[(OLA, 57), (LUKASZ, 43)])
    );

    // Only Łukasz's lines change: 100%, and the order follows the share, not the file.
    let repo = repo_with_history("f27-3-blame-sorted", 4, 2, 0);
    repo.write(FILE, &format!("{}{}", lines("a", 4), lines("x", 2)));
    repo.commit_all("Rewrite the end");
    assert_eq!(shares_of(&repo, Some(ME)).await, expected(&[(LUKASZ, 100)]));
}

#[tokio::test]
async fn f27_3_blame_share_follows_a_renamed_file_and_skips_untouched_lines() {
    let repo = repo_with_history("f27-3-blame-rename", 6, 2, 0);
    repo.git(&["mv", FILE, "src/Widoki/Zażółć.cs"]);
    // The last 2 lines (Łukasz's) change; Ola's first 6 stay as they were.
    repo.write(
        "src/Widoki/Zażółć.cs",
        &format!("{}{}", lines("a", 6), lines("x", 2)),
    );
    repo.commit_all("Rename and change the end");
    assert_eq!(shares_of(&repo, Some(ME)).await, expected(&[(LUKASZ, 100)]));
}

#[tokio::test]
async fn f27_3_blame_share_a_branch_that_only_adds_files_has_no_share() {
    let repo = repo_with_history("f27-3-blame-new", 4, 3, 3);
    repo.write("src/Nowy plik.cs", &lines("z", 5));
    repo.commit_all("Only a new file");
    assert!(shares_of(&repo, Some(ME)).await.is_empty());
}

#[tokio::test]
async fn f27_3_blame_share_reads_the_merge_base_not_the_moved_target() {
    let repo = repo_with_history("f27-3-blame-base", 4, 3, 3);
    repo.write(FILE, &lines("n", 10));
    repo.commit_all("Rewrite");
    // The target moves on after the branch was cut: a file by Łukasz that the branch never saw.
    repo.git(&["checkout", "-q", "main"]);
    repo.write("src/Inny.cs", &lines("q", 10));
    commit_as(&repo, LUKASZ, "Target moves on");
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["checkout", "-q", "feature/zażółć"]);
    assert_eq!(
        shares_of(&repo, Some(ME)).await,
        expected(&[(OLA, 40), (LUKASZ, 30)])
    );
}
