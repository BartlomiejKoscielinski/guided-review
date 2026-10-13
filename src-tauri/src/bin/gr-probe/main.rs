//! gr-probe: the field kit probe (ADR-019, docs/09 › Field kit). Built on the development PC
//! (`npm run build:probe`), run on the company laptop by `field/RUNBOOK-<n>.md`. It reuses the
//! app's code (os/process, claude/runner, the GitLab client and TLS) and writes a sanitized
//! report: versions, yes/no results, status codes, header names, JSON key sets, timings.
//!
//! The GitLab token is typed hidden (`token set`) into Windows Credential Manager and read from
//! there; it is never printed, logged or written to the report.

mod claude_checks;
mod claude_fixture;
mod claude_s3_s4;
mod env;
mod env_rider;
mod gitlab_graphql;
mod gitlab_read;
mod gitlab_write;
mod gitlab_write_steps;
mod report;
mod sanitize;
mod tls;
mod token;

use std::path::PathBuf;
use std::process::ExitCode;

use report::{Report, Sanitizer};

const USAGE: &str = "\
gr-probe (Guided Review field kit)

Usage:
  gr-probe env                                   [--report <stem>]
  gr-probe claude       [--model <id>]           [--report <stem>]
            (about ten short Claude calls on synthetic fixtures; Haiku by default)
  gr-probe token set    --server <url>
  gr-probe token delete --server <url>
  gr-probe tls          --server <url>           [--report <stem>]
  gr-probe gitlab read  --server <url> [--project <path>] [--report <stem>]
  gr-probe gitlab write --server <url> --project <sandbox path> [--report <stem>]
            (asks y/N before every call; only in a sandbox project)

--report <stem>  where to write <stem>.json and <stem>.md (default field/reports/visit-1)
";

/// Parsed command line: the subcommand words and `--name value` options.
#[derive(Debug, Default, PartialEq)]
pub struct Args {
    pub words: Vec<String>,
    pub options: Vec<(String, String)>,
}

impl Args {
    fn parse(raw: impl IntoIterator<Item = String>) -> Result<Self, String> {
        let mut args = Self::default();
        let mut raw = raw.into_iter();
        while let Some(arg) = raw.next() {
            if let Some(name) = arg.strip_prefix("--") {
                let value = raw
                    .next()
                    .ok_or_else(|| format!("--{name} needs a value"))?;
                args.options.push((name.to_owned(), value));
            } else {
                args.words.push(arg);
            }
        }
        Ok(args)
    }

    pub fn option(&self, name: &str) -> Option<&str> {
        self.options
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    pub fn required(&self, name: &str) -> Result<&str, String> {
        self.option(name)
            .ok_or_else(|| format!("--{name} is required"))
    }

    fn report_stem(&self) -> PathBuf {
        PathBuf::from(self.option("report").unwrap_or("field/reports/visit-1"))
    }
}

/// The host of a server URL, for the sanitizer and Credential Manager.
pub fn server_host(server: &str) -> Result<String, String> {
    reqwest::Url::parse(server.trim())
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .ok_or_else(|| "--server must be a URL such as https://gitlab.example.com".to_owned())
}

fn main() -> ExitCode {
    let args = match Args::parse(std::env::args().skip(1)) {
        Ok(args) => args,
        Err(message) => return usage_error(&message),
    };
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("gr-probe: {error}");
            return ExitCode::FAILURE;
        }
    };
    let words: Vec<&str> = args.words.iter().map(String::as_str).collect();
    let result = match words.as_slice() {
        ["env"] => Ok(("env", runtime.block_on(env::run()), Sanitizer::from_env())),
        ["claude"] => runtime
            .block_on(claude_checks::run(&args))
            .map(|(checks, sanitizer)| ("claude", checks, sanitizer)),
        ["token", "set"] => return finish(token::set(&args)),
        ["token", "delete"] => return finish(token::delete(&args)),
        ["tls"] => runtime
            .block_on(tls::run(&args))
            .map(|(checks, sanitizer)| ("tls", checks, sanitizer)),
        ["gitlab", "read"] => runtime
            .block_on(gitlab_read::run(&args))
            .map(|(checks, sanitizer)| ("gitlab_read", checks, sanitizer)),
        ["gitlab", "write"] => runtime
            .block_on(gitlab_write::run(&args))
            .map(|(checks, sanitizer)| ("gitlab_write", checks, sanitizer)),
        _ => return usage_error("unknown command"),
    };
    match result {
        Ok((section, checks, sanitizer)) => write_section(&args, section, checks, &sanitizer),
        Err(message) => {
            eprintln!("gr-probe: {message}");
            ExitCode::FAILURE
        }
    }
}

fn write_section(
    args: &Args,
    section: &str,
    checks: Vec<report::Check>,
    sanitizer: &Sanitizer,
) -> ExitCode {
    let stem = args.report_stem();
    let mut report = Report::load(&stem);
    report.set_section(section, checks);
    match report.write(&stem, sanitizer) {
        Ok(markdown) => {
            println!("gr-probe: {section} done; report: {}", markdown.display());
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("gr-probe: {message}");
            ExitCode::FAILURE
        }
    }
}

fn finish(result: Result<String, String>) -> ExitCode {
    match result {
        Ok(message) => {
            println!("gr-probe: {message}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("gr-probe: {message}");
            ExitCode::FAILURE
        }
    }
}

fn usage_error(message: &str) -> ExitCode {
    eprintln!("gr-probe: {message}\n\n{USAGE}");
    ExitCode::from(2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_words_and_options() {
        let args = Args::parse(
            [
                "gitlab",
                "read",
                "--server",
                "https://gitlab.com",
                "--report",
                "x",
            ]
            .map(String::from),
        )
        .unwrap();
        assert_eq!(args.words, ["gitlab", "read"]);
        assert_eq!(args.option("server"), Some("https://gitlab.com"));
        assert_eq!(args.report_stem(), PathBuf::from("x"));
        assert!(Args::parse(["--server".to_owned()]).is_err());
        assert!(args.required("project").is_err());
    }

    #[test]
    fn server_hosts() {
        assert_eq!(
            server_host("https://gitlab.corp.example/").unwrap(),
            "gitlab.corp.example"
        );
        assert!(server_host("gitlab.corp.example").is_err());
    }
}
