//! The GitLab account (F-19.2, F-19.5, F-01.6): Check and save, Replace, Remove and the status
//! the UI shows. The token goes from the Check and save input straight to the token store
//! (Windows Credential Manager, T4); everything returned here carries only its masked form.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::client::GitlabClient;
use super::error::GitlabError;
use super::tls::TlsBackend;
use crate::error::{AppError, ErrorCode};
use crate::os::credentials::{CredentialsError, Token, TokenStore};

/// The scope the app needs (F-19.5): reading MRs and writing drafts, approvals, pipelines.
pub const REQUIRED_SCOPE: &str = "api";

#[derive(Debug, thiserror::Error)]
pub enum AccountError {
    #[error("no GitLab server is set")]
    NoServer,
    #[error("the token is empty or malformed")]
    InvalidToken,
    #[error("the token lacks the api scope (has {0:?})")]
    MissingScope(Vec<String>),
    #[error(transparent)]
    Gitlab(#[from] GitlabError),
    #[error(transparent)]
    Store(#[from] CredentialsError),
}

impl From<AccountError> for AppError {
    fn from(error: AccountError) -> Self {
        match error {
            AccountError::NoServer => {
                AppError::new(ErrorCode::InvalidInput, "Enter the GitLab server URL.")
            }
            AccountError::InvalidToken => AppError::new(
                ErrorCode::InvalidInput,
                "Paste the whole personal access token.",
            ),
            AccountError::MissingScope(scopes) => AppError::new(
                ErrorCode::GitlabForbidden,
                "The token needs the api scope. Create one with scope api.",
            )
            .with_detail(if scopes.is_empty() {
                "It has no scopes.".to_owned()
            } else {
                format!("It has: {}.", scopes.join(", "))
            }),
            AccountError::Gitlab(error) => error.into(),
            AccountError::Store(error) => {
                AppError::internal("Windows Credential Manager couldn't keep the token.")
                    .with_detail(error.to_string())
            }
        }
    }
}

/// The signed-in GitLab user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitlabUser {
    pub username: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum GitlabConnection {
    /// The token works (green square, F-01.6).
    Connected,
    /// No server or no token yet ("Add token").
    NoToken,
    /// A token is stored but the check failed (orange; `problem` says why).
    Failing,
}

/// GitLab as the UI sees it (title bar F-01.6, Settings › GitLab F-19.2). Never the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitlabStatus {
    pub state: GitlabConnection,
    /// `gitlab.server`, as stored.
    pub server: Option<String>,
    pub user: Option<GitlabUser>,
    /// `glpat-…3f9a`, computed in the core (T4).
    pub token_masked: Option<String>,
    pub scopes: Vec<String>,
    /// `YYYY-MM-DD`; `null` for a token without expiry.
    pub expires_at: Option<String>,
    pub problem: Option<AppError>,
}

impl GitlabStatus {
    fn no_token(server: Option<&str>) -> Self {
        Self {
            state: GitlabConnection::NoToken,
            server: server.map(str::to_owned),
            user: None,
            token_masked: None,
            scopes: Vec::new(),
            expires_at: None,
            problem: None,
        }
    }
}

/// What the token check found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenInfo {
    pub user: GitlabUser,
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
}

/// `https://gitlab.example.com/` → `https://gitlab.example.com`; empty → `None`.
pub fn normalize_server(server: &str) -> Option<String> {
    let trimmed = server.trim().trim_end_matches('/');
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// The Credential Manager account for a server: its host name (ADR-020).
pub fn server_host(server: &str) -> Result<String, AccountError> {
    let url = reqwest::Url::parse(server).map_err(|_| GitlabError::InvalidUrl)?;
    match (url.scheme(), url.host_str()) {
        ("https" | "http", Some(host)) if !host.is_empty() => Ok(host.to_owned()),
        _ => Err(GitlabError::InvalidUrl.into()),
    }
}

/// Checks a token (F-19.5): the user (`GET /user`), then scopes and expiry
/// (`GET /personal_access_tokens/self`). Expired and revoked tokens fail with 401 already.
pub async fn check(client: &GitlabClient) -> Result<TokenInfo, AccountError> {
    let user = match client.get("/user", &[]).await {
        Err(GitlabError::Forbidden { message }) if is_scope_message(message.as_deref()) => {
            return Err(AccountError::MissingScope(Vec::new()));
        }
        result => result?.body,
    };
    let token = client.get("/personal_access_tokens/self", &[]).await?.body;
    let scopes: Vec<String> = token
        .get("scopes")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    if token.get("revoked").and_then(Value::as_bool) == Some(true) {
        return Err(GitlabError::TokenRevoked.into());
    }
    if token.get("active").and_then(Value::as_bool) == Some(false) {
        return Err(GitlabError::TokenExpired.into());
    }
    if !scopes.iter().any(|scope| scope == REQUIRED_SCOPE) {
        return Err(AccountError::MissingScope(scopes));
    }
    let text = |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
    let username = text(&user, "username")
        .ok_or_else(|| GitlabError::Decode("/user without username".into()))?;
    Ok(TokenInfo {
        user: GitlabUser {
            name: text(&user, "name").unwrap_or_else(|| username.clone()),
            username,
        },
        scopes,
        expires_at: text(&token, "expires_at"),
    })
}

/// GitLab's 403 for a token without a scope the endpoint needs: `error: insufficient_scope`
/// with `error_description` "…requires higher privileges than provided by the access token."
fn is_scope_message(message: Option<&str>) -> bool {
    message.is_some_and(|m| m.contains("insufficient_scope") || m.contains("higher privileges"))
}

fn connected(server: &str, token: &Token, info: TokenInfo) -> GitlabStatus {
    GitlabStatus {
        state: GitlabConnection::Connected,
        server: Some(server.to_owned()),
        user: Some(info.user),
        token_masked: Some(token.masked()),
        scopes: info.scopes,
        expires_at: info.expires_at,
        problem: None,
    }
}

/// Check and save / Replace token (F-19.5): checks `raw_token` against `server` and stores it
/// only when the check passes. A token of an earlier server on another host is removed.
/// Returns the normalized server (for `gitlab.server`) and the status.
pub async fn check_and_save(
    store: &dyn TokenStore,
    previous_server: Option<&str>,
    server: &str,
    raw_token: &str,
    tls: TlsBackend,
) -> Result<(String, GitlabStatus), AccountError> {
    let server = normalize_server(server).ok_or(AccountError::NoServer)?;
    let host = server_host(&server)?;
    let token = Token::new(raw_token).map_err(|_| AccountError::InvalidToken)?;
    let client = GitlabClient::new(&server, &token, tls)?;
    let info = check(&client).await?;
    store.save(&host, &token)?;
    if let Some(previous) = previous_server.and_then(|s| server_host(s).ok())
        && previous != host
    {
        store.delete(&previous)?;
    }
    tracing::info!(host, "GitLab token checked and stored");
    let status = connected(&server, &token, info);
    Ok((server, status))
}

/// Remove (F-19.5): deletes the stored token; the server URL stays.
pub fn remove(store: &dyn TokenStore, server: Option<&str>) -> Result<GitlabStatus, AccountError> {
    if let Some(server) = server {
        store.delete(&server_host(server)?)?;
    }
    Ok(GitlabStatus::no_token(server))
}

/// The status for the title bar and Settings (F-01.6, F-19.2): no token, connected, or failing
/// with the reason.
pub async fn status(store: &dyn TokenStore, server: Option<&str>, tls: TlsBackend) -> GitlabStatus {
    let Some(server) = server else {
        return GitlabStatus::no_token(None);
    };
    let token = match server_host(server).and_then(|host| Ok(store.load(&host)?)) {
        Ok(Some(token)) => token,
        Ok(None) => return GitlabStatus::no_token(Some(server)),
        Err(error) => return failing(server, None, error),
    };
    let result = match GitlabClient::new(server, &token, tls) {
        Ok(client) => check(&client).await,
        Err(error) => Err(error.into()),
    };
    match result {
        Ok(info) => connected(server, &token, info),
        Err(error) => failing(server, Some(&token), error),
    }
}

fn failing(server: &str, token: Option<&Token>, error: AccountError) -> GitlabStatus {
    tracing::warn!(%error, "GitLab check failed");
    GitlabStatus {
        state: GitlabConnection::Failing,
        server: Some(server.to_owned()),
        user: None,
        token_masked: token.map(Token::masked),
        scopes: Vec::new(),
        expires_at: None,
        problem: Some(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f19_5_normalizes_servers_and_finds_the_host() {
        assert_eq!(
            normalize_server("  https://gitlab.example.com/ "),
            Some("https://gitlab.example.com".into())
        );
        assert_eq!(normalize_server("   "), None);
        assert_eq!(server_host("https://localhost:8443").unwrap(), "localhost");
        assert!(server_host("gitlab.example.com").is_err());
    }

    #[test]
    fn f19_5_missing_scope_names_the_scopes_it_has() {
        let e = AppError::from(AccountError::MissingScope(vec!["read_api".into()]));
        assert_eq!(e.code, ErrorCode::GitlabForbidden);
        assert_eq!(e.detail.as_deref(), Some("It has: read_api."));
    }
}
