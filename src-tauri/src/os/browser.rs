//! Opening a GitLab page in the default browser (F-20.4 Open in GitLab, M6 decision 13, docs/06
//! T5): only an `https` URL on the configured GitLab host opens, and the browser is started with
//! an argument array through `spawn_detached` (no shell, never a `.cmd`). The URL is checked as
//! the screen sent it: whitespace, quotes and control characters are refused before parsing, so
//! nothing the parser would quietly repair reaches the browser.

use std::ffi::OsString;
use std::path::PathBuf;

use reqwest::Url;
use thiserror::Error;

use super::process::{ProcessError, spawn_detached};

#[derive(Debug, Error)]
pub enum BrowserError {
    /// The URL is not an `https` URL on the configured GitLab host (or no server is configured).
    #[error("That link isn’t on your GitLab server.")]
    Refused,
    #[error("The browser could not be started: {0}")]
    Launch(#[from] ProcessError),
}

/// `url` unchanged when it is an `https` URL on `server`'s host (and port); `Refused` otherwise.
pub fn checked_url(server: &str, url: &str) -> Result<String, BrowserError> {
    let plain = |text: &str| {
        !text.is_empty()
            && !text
                .chars()
                .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '"' | '\'' | '`'))
    };
    if !plain(url) {
        return Err(BrowserError::Refused);
    }
    let server = Url::parse(server.trim()).map_err(|_| BrowserError::Refused)?;
    let target = Url::parse(url).map_err(|_| BrowserError::Refused)?;
    let host = |u: &Url| u.host_str().map(str::to_ascii_lowercase);
    let same_place = host(&server).is_some()
        && host(&server) == host(&target)
        && server.port_or_known_default() == target.port_or_known_default();
    let no_user = target.username().is_empty() && target.password().is_none();
    if target.scheme() == "https" && same_place && no_user {
        Ok(url.to_owned())
    } else {
        Err(BrowserError::Refused)
    }
}

/// The program and arguments that open `url` in the default browser; `url` is one argument.
pub fn launch_command(url: &str) -> (PathBuf, Vec<OsString>) {
    #[cfg(windows)]
    {
        // The URL protocol handler of the shell (url.dll), started directly: no cmd.exe parsing.
        let root = std::env::var_os("SystemRoot").unwrap_or_else(|| OsString::from(r"C:\Windows"));
        let program = PathBuf::from(root).join("System32").join("rundll32.exe");
        let args = vec![
            OsString::from("url.dll,FileProtocolHandler"),
            OsString::from(url),
        ];
        (program, args)
    }
    #[cfg(target_os = "macos")]
    {
        (PathBuf::from("/usr/bin/open"), vec![OsString::from(url)])
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        (PathBuf::from("xdg-open"), vec![OsString::from(url)])
    }
}

/// Opens `url` in the default browser when `checked_url` accepts it; a refused URL starts nothing.
pub fn open_gitlab_url(server: &str, url: &str) -> Result<(), BrowserError> {
    let url = checked_url(server, url)?;
    let (program, args) = launch_command(&url);
    spawn_detached(&program, &args, None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f20_4_user_info_on_the_right_host_is_refused() {
        assert!(checked_url("https://gitlab.local", "https://me@gitlab.local/x").is_err());
    }

    #[test]
    fn f20_4_another_port_on_the_same_host_is_refused() {
        assert!(checked_url("https://localhost:8443", "https://localhost:9443/x").is_err());
        assert!(checked_url("https://gitlab.local", "https://gitlab.local:443/x").is_ok());
    }
}
