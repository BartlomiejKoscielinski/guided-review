//! `gitlab_*` commands: the account (F-19.5, F-19.2), the connection status for the title bar
//! (F-01.6) and the MR lists of S-01 (F-02.1, F-02.2). The token comes in only through
//! `gitlab_account_save` and never goes back out (T4).

use std::sync::Arc;

use serde_json::json;
use tauri::State;

use super::repo::active_git;
use super::with_store;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::gitlab::account::{self, GitlabConnection, GitlabStatus};
use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::mrs::{self, MrList, MrTab};
use crate::gitlab::project::project_from_remote;
use crate::gitlab::tls::TlsBackend;
use crate::os::credentials::{Keyring, TokenStore};
use crate::os::process::Cancel;
use crate::store::{self, Store};

const TLS: TlsBackend = TlsBackend::Platform;

/// GitLab state shared by the commands: the token store and the last status.
pub struct GitlabApp {
    tokens: Arc<dyn TokenStore>,
    status: tokio::sync::Mutex<Option<GitlabStatus>>,
}

impl Default for GitlabApp {
    fn default() -> Self {
        Self {
            tokens: Arc::new(Keyring),
            status: tokio::sync::Mutex::new(None),
        }
    }
}

async fn server(store: &Store) -> AppResult<Option<String>> {
    with_store(store, |conn| Ok(store::settings::load(conn)?.gitlab.server)).await
}

/// The status, checked again when `refresh` is set or nothing was checked yet (F-01.6).
async fn current_status(
    gitlab: &GitlabApp,
    store: &Store,
    refresh: bool,
) -> AppResult<GitlabStatus> {
    let mut cached = gitlab.status.lock().await;
    if let Some(status) = cached.as_ref().filter(|_| !refresh) {
        return Ok(status.clone());
    }
    let server = server(store).await?;
    let status = account::status(gitlab.tokens.as_ref(), server.as_deref(), TLS).await;
    *cached = Some(status.clone());
    Ok(status)
}

/// GitLab connected / no token / failing, with user, masked token, scopes and expiry.
#[tauri::command]
pub async fn gitlab_status(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    refresh: bool,
) -> AppResult<GitlabStatus> {
    current_status(&gitlab, &store, refresh).await
}

/// Check and save / Replace token (F-19.5): stores the token and `gitlab.server` only after
/// GitLab accepted it with scope `api`.
#[tauri::command]
pub async fn gitlab_account_save(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    server: String,
    token: String,
) -> AppResult<GitlabStatus> {
    let previous = self::server(&store).await?;
    let (server, status) = account::check_and_save(
        gitlab.tokens.as_ref(),
        previous.as_deref(),
        &server,
        &token,
        TLS,
    )
    .await?;
    let patch = json!({ "gitlab": { "server": server } });
    with_store(&store, move |conn| store::settings::update(conn, &patch)).await?;
    *gitlab.status.lock().await = Some(status.clone());
    Ok(status)
}

/// Remove (F-19.5): deletes the token; the server URL stays.
#[tauri::command]
pub async fn gitlab_account_remove(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
) -> AppResult<GitlabStatus> {
    let server = server(&store).await?;
    let status = account::remove(gitlab.tokens.as_ref(), server.as_deref())?;
    *gitlab.status.lock().await = Some(status.clone());
    Ok(status)
}

/// One S-01 tab of the active repository's project (F-02.1, F-02.2).
#[tauri::command]
pub async fn gitlab_list_mrs(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    tab: MrTab,
) -> AppResult<MrList> {
    let status = current_status(&gitlab, &store, false).await?;
    let (Some(server), Some(user)) = (status.server.as_deref(), status.user.as_ref()) else {
        return Err(not_connected(&status));
    };
    let project = active_project(&store, server).await?;
    let host = account::server_host(server)?;
    let token = gitlab
        .tokens
        .load(&host)
        .map_err(account::AccountError::from)?
        .ok_or_else(add_token)?;
    let client = GitlabClient::new(server, &token, TLS)?;
    let result = mrs::list(
        &client,
        &project,
        &user.username,
        tab,
        mrs::PAGE_SIZE,
        mrs::MAX_PAGES,
    )
    .await;
    if matches!(
        result,
        Err(GitlabError::Unauthorized | GitlabError::TokenExpired | GitlabError::TokenRevoked)
    ) {
        // The title bar turns orange at its next status call.
        *gitlab.status.lock().await = None;
    }
    Ok(result?)
}

fn add_token() -> AppError {
    AppError::new(
        ErrorCode::GitlabUnauthorized,
        "Add a GitLab token in Settings › GitLab.",
    )
}

fn not_connected(status: &GitlabStatus) -> AppError {
    match (&status.state, &status.problem) {
        (GitlabConnection::Failing, Some(problem)) => problem.clone(),
        _ => add_token(),
    }
}

/// The GitLab project of the active repository, from its `origin` remote.
async fn active_project(store: &Store, server: &str) -> AppResult<String> {
    let git = active_git(store).await?;
    let output = git
        .run(["remote", "get-url", "origin"], &Cancel::new())
        .await
        .map_err(|_| {
            AppError::new(
                ErrorCode::InvalidInput,
                "The repository has no origin remote on the GitLab server.",
            )
        })?;
    project_from_remote(output.stdout.trim(), server).ok_or_else(|| {
        AppError::new(
            ErrorCode::InvalidInput,
            "The repository's origin isn't a project on the configured GitLab server.",
        )
    })
}
