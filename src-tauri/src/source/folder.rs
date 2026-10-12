//! The repository a picked or typed folder belongs to (F-19.6): its working tree root and the
//! GitLab project of its `origin` remote (https or ssh, on the configured server only).

use std::path::{Path, PathBuf};

use crate::git::{Git, GitError};
use crate::gitlab::project::project_from_remote;
use crate::os::process::Cancel;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderRepo {
    /// Folder name of the working tree root.
    pub name: String,
    /// Absolute path of the working tree root, with Windows separators.
    pub path: String,
    pub gitlab_project: Option<String>,
}

/// git prints forward slashes; the app shows and stores the Windows form.
pub fn windows_path(path: &Path) -> PathBuf {
    PathBuf::from(
        path.to_string_lossy()
            .replace('/', std::path::MAIN_SEPARATOR_STR),
    )
}

/// Inspects a folder inside a working tree. `NotARepository` when it isn't one.
pub async fn inspect(
    git_program: Option<&Path>,
    folder: &Path,
    server: Option<&str>,
    cancel: &Cancel,
) -> Result<FolderRepo, GitError> {
    let top = windows_path(&Git::new(git_program, folder).toplevel(cancel).await?);
    let git = Git::new(git_program, &top);
    let gitlab_project = match server {
        Some(server) => origin_url(&git, cancel)
            .await?
            .and_then(|url| project_from_remote(&url, server)),
        None => None,
    };
    Ok(FolderRepo {
        name: top
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: top.to_string_lossy().into_owned(),
        gitlab_project,
    })
}

/// The URL of `origin`, `None` without that remote.
pub async fn origin_url(git: &Git, cancel: &Cancel) -> Result<Option<String>, GitError> {
    let spec = git.spec(["remote", "get-url", "origin"]);
    let output = git.run_spec(spec, cancel, &[0, 2, 128]).await?;
    Ok((output.code == Some(0))
        .then(|| output.stdout.trim().to_owned())
        .filter(|url| !url.is_empty()))
}
