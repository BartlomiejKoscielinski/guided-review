//! The only place that runs git (docs/05 › git). Every call gets
//! `-c core.quotepath=off -c core.longpaths=true -c color.ui=false`, `LC_ALL=C`, no terminal
//! prompts and literal pathspecs (file names with `*` or `[` are never globs), and goes through
//! `os/process.rs` (argument arrays, no shell, `CREATE_NO_WINDOW`, Job Object).
//!
//! Never `reset --hard`, `clean`, `checkout` of other refs, `rebase` or force-push on the
//! user's checkout (T8): the commands built in this module don't offer them.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::error::GitError;
use crate::os::process::{self, Cancel, ProcessOutput, ProcessSpec};

/// Options every git call starts with (docs/04 › Processes on Windows).
pub const STANDARD_OPTIONS: [&str; 6] = [
    "-c",
    "core.quotepath=off",
    "-c",
    "core.longpaths=true",
    "-c",
    "color.ui=false",
];

/// Minimum git version (`merge-tree --write-tree --merge-base`, docs/05).
pub const MIN_VERSION: (u32, u32) = (2, 40);

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

/// git bound to one repository's working tree.
#[derive(Debug, Clone)]
pub struct Git {
    program: PathBuf,
    repo: PathBuf,
}

impl Git {
    /// `program` is the Settings value (`git.path`) or `git` from PATH.
    pub fn new(program: Option<&Path>, repo: impl Into<PathBuf>) -> Self {
        Self {
            program: program.map_or_else(|| PathBuf::from("git"), Path::to_path_buf),
            repo: repo.into(),
        }
    }

    pub fn repo(&self) -> &Path {
        &self.repo
    }

    /// The same git program bound to another working tree (a review worktree).
    pub fn at(&self, dir: impl Into<PathBuf>) -> Self {
        Self {
            program: self.program.clone(),
            repo: dir.into(),
        }
    }

    /// The process for `git <standard options> <args>` in the repository.
    pub fn spec<I, S>(&self, args: I) -> ProcessSpec
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        ProcessSpec::new(&self.program)
            .args(STANDARD_OPTIONS)
            .args(args)
            .cwd(&self.repo)
            .env("LC_ALL", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_LITERAL_PATHSPECS", "1")
            .timeout(DEFAULT_TIMEOUT)
    }

    /// Runs and returns the output if git exits with 0.
    pub async fn run<I, S>(&self, args: I, cancel: &Cancel) -> Result<ProcessOutput, GitError>
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        self.run_spec(self.spec(args), cancel, &[0]).await
    }

    /// Runs a prepared spec and accepts the given exit codes (e.g. `diff --no-index` exits 1
    /// when files differ).
    pub async fn run_spec(
        &self,
        spec: ProcessSpec,
        cancel: &Cancel,
        ok_codes: &[i32],
    ) -> Result<ProcessOutput, GitError> {
        let command = command_name(&spec.args);
        let output = process::run(&spec, cancel).await?;
        if output.code.is_some_and(|code| ok_codes.contains(&code)) {
            Ok(output)
        } else {
            Err(GitError::Failed {
                command,
                code: output.code,
                stderr: output.stderr.trim().to_owned(),
            })
        }
    }

    /// `git --version` ≥ 2.40, else `GitTooOld`. Returns the version text.
    pub async fn check_version(&self, cancel: &Cancel) -> Result<String, GitError> {
        let output = self.run(["--version"], cancel).await?;
        let text = output.stdout.trim().to_owned();
        match parse_version(&text) {
            Some(version) if version >= MIN_VERSION => Ok(text),
            _ => Err(GitError::TooOld { found: text }),
        }
    }

    /// The absolute git directory (`.git`, or the worktree's folder under the main `.git`).
    pub async fn git_dir(&self, cancel: &Cancel) -> Result<PathBuf, GitError> {
        let output = self
            .run(["rev-parse", "--absolute-git-dir"], cancel)
            .await
            .map_err(|e| match e {
                GitError::Failed { .. } => {
                    GitError::NotARepository(self.repo.display().to_string())
                }
                other => other,
            })?;
        Ok(PathBuf::from(output.stdout.trim()))
    }

    /// The top of the working tree containing `repo` (the picked folder may be a subfolder).
    pub async fn toplevel(&self, cancel: &Cancel) -> Result<PathBuf, GitError> {
        let output = self
            .run(["rev-parse", "--show-toplevel"], cancel)
            .await
            .map_err(|e| match e {
                GitError::Failed { .. } => {
                    GitError::NotARepository(self.repo.display().to_string())
                }
                other => other,
            })?;
        Ok(PathBuf::from(output.stdout.trim()))
    }
}

/// The git subcommand of an argument list (after the standard `-c` options), for messages.
fn command_name(args: &[OsString]) -> String {
    args.iter()
        .skip(STANDARD_OPTIONS.len())
        .map(|a| a.to_string_lossy())
        .find(|a| !a.starts_with('-'))
        .map(|a| a.into_owned())
        .unwrap_or_else(|| "git".to_owned())
}

/// "git version 2.53.0.windows.1" → (2, 53).
pub fn parse_version(text: &str) -> Option<(u32, u32)> {
    let version = text.strip_prefix("git version ")?;
    let mut parts = version.split('.');
    let major = parts.next()?.trim().parse().ok()?;
    let minor = parts
        .next()?
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .ok()?;
    Some((major, minor))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_git_versions() {
        assert_eq!(parse_version("git version 2.53.0.windows.1"), Some((2, 53)));
        assert_eq!(parse_version("git version 2.40.1"), Some((2, 40)));
        assert_eq!(
            parse_version("git version 2.39.5 (Apple Git-154)"),
            Some((2, 39))
        );
        assert_eq!(parse_version("nonsense"), None);
    }

    #[test]
    fn every_call_has_the_standard_options_and_environment() {
        let git = Git::new(None, "C:\\repo ą");
        let spec = git.spec(["status"]);
        let args: Vec<_> = spec.args.iter().map(|a| a.to_string_lossy()).collect();
        assert_eq!(
            args,
            [
                "-c",
                "core.quotepath=off",
                "-c",
                "core.longpaths=true",
                "-c",
                "color.ui=false",
                "status"
            ]
        );
        let env: Vec<_> = spec
            .env_set
            .iter()
            .map(|(k, v)| format!("{}={}", k.to_string_lossy(), v.to_string_lossy()))
            .collect();
        assert!(env.contains(&"LC_ALL=C".to_owned()));
        assert!(env.contains(&"GIT_TERMINAL_PROMPT=0".to_owned()));
        assert!(env.contains(&"GIT_LITERAL_PATHSPECS=1".to_owned()));
        assert_eq!(command_name(&spec.args), "status");
    }
}
