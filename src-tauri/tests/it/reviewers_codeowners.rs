//! Code owners for the reviewer suggestions of S-11 (F-27.3): the GitLab CODEOWNERS syntax
//! (comments, sections with default owners, `*`, `**`, a leading and a trailing `/`, the last
//! matching rule wins, only `@user` owners) and the file read from the target ref of a fixture
//! repository, never from the working tree. Paths carry Polish characters; no company data.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use crate::fixture_repo;

use fixture_repo::FixtureRepo;
use guided_review_lib::git::Git;
use guided_review_lib::os::process::Cancel;
use guided_review_lib::reviewers::codeowners::{CodeOwners, load};

/// The users that own `path` under `rules`; empty when no rule matches or the matching rule
/// names nobody the app can add.
fn users(rules: &str, path: &str) -> Vec<String> {
    CodeOwners::parse(rules)
        .owners_of(path)
        .map(|owned| owned.users)
        .unwrap_or_default()
}

fn table(rules: &str, cases: &[(&str, &[&str])]) {
    for (path, expected) in cases {
        assert_eq!(users(rules, path), *expected, "{path} under {rules:?}");
    }
}

#[test]
fn f27_3_codeowners_star_matches_a_file_name_at_any_depth_but_not_across_slashes() {
    table(
        "*.cs @ola.m\n",
        &[
            ("src/A/Foo.cs", &["ola.m"]),
            ("Foo.cs", &["ola.m"]),
            ("Foo.csx", &[]),
        ],
    );
    table(
        "README.md @marta.k\n",
        &[
            ("README.md", &["marta.k"]),
            ("docs/README.md", &["marta.k"]),
            ("docs/README.md.bak", &[]),
        ],
    );
}

#[test]
fn f27_3_codeowners_leading_slash_anchors_and_trailing_slash_takes_the_whole_folder() {
    table(
        "/src/App/Views/ @marta.k\n",
        &[
            ("src/App/Views/Main.xaml", &["marta.k"]),
            ("src/App/Views/Sub/Deep.xaml", &["marta.k"]),
            ("other/src/App/Views/Main.xaml", &[]),
            ("src/App/ViewsExtra/Main.xaml", &[]),
        ],
    );
    table(
        "/Widoki/Żółć/ @ola.m\n",
        &[
            ("Widoki/Żółć/Lista ąę.cs", &["ola.m"]),
            ("Widoki/Inne/Lista.cs", &[]),
        ],
    );
}

#[test]
fn f27_3_codeowners_double_star_spans_folders_and_single_star_does_not() {
    table(
        "/src/**/Models/*.cs @piotr.s\n",
        &[
            ("src/A/B/Models/Item.cs", &["piotr.s"]),
            ("src/Models/Item.cs", &["piotr.s"]),
            ("src/Models/Sub/Item.cs", &[]),
            ("src/A/Models/Item.csx", &[]),
            ("lib/A/Models/Item.cs", &[]),
        ],
    );
}

#[test]
fn f27_3_codeowners_the_last_matching_rule_wins() {
    let rules = "* @fallback.u\n/src/ @piotr.s\n/src/App/ @marta.k\n";
    table(
        rules,
        &[
            ("src/App/Main.cs", &["marta.k"]),
            ("src/Other.cs", &["piotr.s"]),
            ("Root.txt", &["fallback.u"]),
        ],
    );
    // The same rules in the other order: the broad rule is last and takes everything.
    table(
        "/src/App/ @marta.k\n* @fallback.u\n",
        &[("src/App/Main.cs", &["fallback.u"])],
    );
}

#[test]
fn f27_3_codeowners_names_the_matching_rule_and_all_its_users() {
    let owners =
        CodeOwners::parse("# who owns what\n\n/src/App/Views/ @marta.k @ola.m\n*.cs @x.y\n");
    let owned = owners.owners_of("src/App/Views/Main.xaml").unwrap();
    assert_eq!(owned.pattern, "src/App/Views/");
    assert_eq!(owned.users, ["marta.k", "ola.m"]);
    let owned = owners.owners_of("src/Lib/Zażółć.cs").unwrap();
    assert_eq!(owned.pattern, "*.cs");
    assert_eq!(owned.users, ["x.y"]);
    assert!(CodeOwners::parse("").owners_of("a.txt").is_none());
    assert!(
        CodeOwners::parse("# only a comment\n")
            .owners_of("a.txt")
            .is_none()
    );
}

#[test]
fn f27_3_codeowners_only_at_user_owners_count() {
    // Groups, roles and e-mail addresses are skipped; the user next to them stays.
    let rules = "/src/ @marta.k @team/mobile @@maintainer ola@firma.example\n";
    table(rules, &[("src/A.cs", &["marta.k"])]);
    // A rule with no user left still is the last match: it takes the file from the earlier rule.
    table(
        "* @fallback.u\n/docs/ @team/mobile\n",
        &[("docs/a.md", &[]), ("src/a.cs", &["fallback.u"])],
    );
}

#[test]
fn f27_3_codeowners_reads_windows_line_endings() {
    table(
        "# komentarz\r\n\r\n/src/ @marta.k\r\n",
        &[("src/A.cs", &["marta.k"])],
    );
}

#[test]
fn f27_3_codeowners_sections_give_default_owners_to_their_rules() {
    let rules = "\
[Views][2] @marta.k
/src/App/Views/
/src/App/Views/Special.xaml @ola.m

^[Docs] @piotr.s
/docs/
";
    let owners = CodeOwners::parse(rules);
    // A rule without owners takes the section's; the section's [2] is no part of its name.
    assert_eq!(users(rules, "src/App/Views/Main.xaml"), ["marta.k"]);
    assert_eq!(
        owners.owners_of("src/App/Views/Main.xaml").unwrap().pattern,
        "src/App/Views/"
    );
    // An own owner list replaces the default, and the last matching rule of the section wins.
    assert_eq!(users(rules, "src/App/Views/Special.xaml"), ["ola.m"]);
    // An optional section (^) still names owners.
    assert_eq!(users(rules, "docs/a.md"), ["piotr.s"]);
    assert!(users(rules, "other.txt").is_empty());
}

const OWNERS_ON_TARGET: &str = "/src/ @marta.k\n";

/// `main` on origin carries `CODEOWNERS` at `location`; the checkout is on a feature branch whose
/// own copy of that file names somebody else.
fn repo_with_owners_file(label: &str, location: &str) -> FixtureRepo {
    let repo = FixtureRepo::new(label);
    repo.write(location, OWNERS_ON_TARGET);
    repo.write("src/Plik ą.cs", "x\n");
    repo.commit_all("Base");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", "feature/zażółć"]);
    repo.write(location, "/src/ @ktos.inny\n");
    repo.commit_all("Feature changes the owners");
    repo.write(location, "/src/ @niezatwierdzony\n");
    repo
}

#[tokio::test]
async fn f27_3_codeowners_load_reads_the_file_from_the_target_ref() {
    for location in ["CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"] {
        let repo = repo_with_owners_file("f27-3-owners", location);
        let git = Git::new(None, &repo.path);
        let owners = load(&git, "main", &Cancel::new()).await.unwrap();
        let owned = owners.owners_of("src/Plik ą.cs").unwrap();
        assert_eq!(owned.users, ["marta.k"], "{location}");
        assert_eq!(owned.pattern, "src/", "{location}");
    }
}

#[tokio::test]
async fn f27_3_codeowners_load_without_a_file_finds_no_owner() {
    let repo = FixtureRepo::new("f27-3-no-owners");
    repo.write("src/A.cs", "x\n");
    repo.commit_all("Base");
    repo.add_bare_origin();
    repo.git(&["push", "-q", "origin", "main"]);
    let git = Git::new(None, &repo.path);
    let owners = load(&git, "main", &Cancel::new()).await.unwrap();
    assert!(owners.owners_of("src/A.cs").is_none());
}
