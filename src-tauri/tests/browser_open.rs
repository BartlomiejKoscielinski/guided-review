//! Open in GitLab (F-20.4, M6 decision 13, docs/06 T5): the core opens a URL in the default
//! browser only when it is an `https` URL on the configured GitLab host, and starts the browser
//! with an argument array (no shell, never a `.cmd`). Synthetic hosts only (ADR-019).
//!
//! The tests pin these names (the plan's `os/browser.rs`):
//! - `os::browser::checked_url(server, url) -> Result<String, E>` (`E: Debug`): `server` is the
//!   configured GitLab server URL, `url` what the screen asks to open. `Ok` gives the URL to
//!   open, unchanged; `Err` for anything that is not `https` on the server's host.
//! - `os::browser::open_gitlab_url(server, url) -> Result<_, E>`: `checked_url` first; a refused
//!   URL starts nothing (the tests only call it with refused URLs, so no browser opens).
//! - `os::browser::launch_command(url) -> (PathBuf, Vec<OsString>)`: the program and its
//!   arguments for the default browser; the URL is exactly one argument, whole and unquoted, and
//!   the program is not a shell.
//!
//! Not pinned: the port (the stand-in GitLab is `https://localhost:8443`), user info in the URL,
//! which Windows program opens the default browser.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::os::browser::{checked_url, launch_command, open_gitlab_url};

const SERVER: &str = "https://gitlab.local";
const PIPELINE: &str = "https://gitlab.local/sandbox/gr-sandbox/-/pipelines/18342";

#[test]
fn f20_4_a_pipeline_page_on_the_configured_host_is_opened_as_given() {
    assert_eq!(checked_url(SERVER, PIPELINE).unwrap(), PIPELINE);
}

#[test]
fn f20_4_the_stand_in_gitlab_with_its_port_is_accepted() {
    let url = "https://localhost:8443/sandbox/gr-sandbox/-/jobs/105";

    assert_eq!(checked_url("https://localhost:8443", url).unwrap(), url);
}

#[test]
fn f20_4_a_server_url_with_a_trailing_slash_or_path_does_not_change_the_host_check() {
    assert!(checked_url("https://gitlab.local/", PIPELINE).is_ok());
    assert!(checked_url("https://gitlab.local/gitlab", PIPELINE).is_ok());
}

#[test]
fn f20_4_the_host_compares_without_case() {
    assert!(
        checked_url(
            SERVER,
            "https://GitLab.Local/sandbox/gr-sandbox/-/pipelines/1"
        )
        .is_ok()
    );
    assert!(checked_url("https://GitLab.Local", PIPELINE).is_ok());
}

#[test]
fn f20_4_another_host_is_refused() {
    for url in [
        "https://evil.example/sandbox/gr-sandbox/-/pipelines/1",
        "https://gitlab.local.evil.example/x",
        "https://evilgitlab.local/x",
        "https://gitlab.localhost/x",
        "https://gitlab.local@evil.example/x",
        "https://evil.example/https://gitlab.local/x",
    ] {
        assert!(checked_url(SERVER, url).is_err(), "{url}");
    }
}

#[test]
fn f20_4_http_and_other_schemes_are_refused_even_on_the_gitlab_host() {
    for url in [
        "http://gitlab.local/sandbox/gr-sandbox/-/pipelines/1",
        "ftp://gitlab.local/x",
        "file:///C:/Windows/System32/calc.exe",
        "javascript:alert(1)",
        "//gitlab.local/x",
        "gitlab.local/x",
    ] {
        assert!(checked_url(SERVER, url).is_err(), "{url}");
    }
}

#[test]
fn f20_4_quotes_spaces_and_control_characters_are_refused() {
    for url in [
        "https://gitlab.local/a\"b",
        "https://gitlab.local/a'b",
        "https://gitlab.local/a b",
        " https://gitlab.local/x",
        "https://gitlab.local/x ",
        "https://gitlab.local/x\"&calc",
        "https://gitlab.local/x\ncalc",
        "https://gitlab.local/x\tcalc",
        "https://gitlab.local/x\0",
    ] {
        assert!(checked_url(SERVER, url).is_err(), "{url:?}");
    }
}

#[test]
fn f20_4_an_empty_url_or_no_configured_server_opens_nothing() {
    assert!(checked_url(SERVER, "").is_err());
    assert!(checked_url("", PIPELINE).is_err());
    assert!(checked_url("not a url", PIPELINE).is_err());
}

#[test]
fn f20_4_a_refused_url_is_an_error_from_open_gitlab_url_and_starts_no_browser() {
    assert!(open_gitlab_url(SERVER, "http://gitlab.local/x").is_err());
    assert!(open_gitlab_url(SERVER, "https://evil.example/x").is_err());
    assert!(open_gitlab_url(SERVER, "https://gitlab.local/a\"b").is_err());
}

#[test]
fn f20_4_the_browser_gets_the_url_as_one_plain_argument_and_no_shell_runs_it() {
    let url = "https://gitlab.local/sandbox/gr-sandbox/-/pipelines/18342?a=1&b=2";

    let (program, args) = launch_command(url);

    let url_args = args
        .iter()
        .filter(|a| a.to_string_lossy().contains(url))
        .count();
    assert_eq!(url_args, 1, "the URL is one whole argument: {args:?}");
    assert!(
        args.iter().any(|a| a.to_string_lossy() == url),
        "the URL is not quoted or joined with anything: {args:?}"
    );
    let name = program
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_ascii_lowercase();
    for shell in [
        "cmd.exe",
        "cmd",
        "powershell.exe",
        "pwsh.exe",
        "sh",
        "bash",
        "start",
    ] {
        assert_ne!(name, shell, "no shell: {program:?}");
    }
    assert!(
        !name.ends_with(".cmd") && !name.ends_with(".bat"),
        "never a batch file: {program:?}"
    );
}
