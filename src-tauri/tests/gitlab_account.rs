//! GitLab account (F-19.5, F-19.2 data, F-01.6 status) against wiremock with cassettes from the
//! stand-in. The token must never reach anything the UI gets (T4).
#![allow(clippy::unwrap_used, reason = "tests")]

#[path = "support/cassette.rs"]
mod cassette;

use cassette::{MemoryStore, cassette};
use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::account::{self, AccountError, GitlabConnection, GitlabStatus};
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::TokenStore;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";
const HOST: &str = "127.0.0.1";

async fn answer(server: &MockServer, at: &str, status: u16, body: Value) {
    Mock::given(method("GET"))
        .and(path(format!("/api/v4{at}")))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .mount(server)
        .await;
}

/// `/user` and `/personal_access_tokens/self` as recorded from the stand-in.
async fn standin() -> MockServer {
    let server = MockServer::start().await;
    answer(&server, "/user", 200, cassette("user")).await;
    answer(
        &server,
        "/personal_access_tokens/self",
        200,
        cassette("pat_self"),
    )
    .await;
    server
}

async fn save(store: &MemoryStore, server: &MockServer) -> Result<GitlabStatus, AppError> {
    account::check_and_save(store, None, &server.uri(), TOKEN, TlsBackend::Platform)
        .await
        .map(|(_, status)| status)
        .map_err(AppError::from)
}

fn assert_no_token(value: &impl serde::Serialize) {
    let text = serde_json::to_string(value).unwrap();
    assert!(!text.contains(TOKEN), "token leaked: {text}");
    assert!(!text.contains("wiremock0000000"), "token leaked: {text}");
}

#[tokio::test]
async fn f19_5_check_and_save_stores_the_token_and_returns_only_its_mask() {
    let server = standin().await;
    let store = MemoryStore::default();
    let (saved_server, status) = account::check_and_save(
        &store,
        None,
        &format!("  {}/ ", server.uri()),
        &format!(" {TOKEN}\r\n"),
        TlsBackend::Platform,
    )
    .await
    .unwrap();
    assert_eq!(saved_server, server.uri());
    assert_eq!(status.state, GitlabConnection::Connected);
    assert_eq!(status.user.as_ref().unwrap().username, "dev");
    assert_eq!(status.user.as_ref().unwrap().name, "Dev Stand-in");
    assert_eq!(status.token_masked.as_deref(), Some("glpat-…0000"));
    assert_eq!(status.scopes, ["api"]);
    assert_eq!(status.expires_at.as_deref(), Some("2026-11-11"));
    assert_eq!(store.get(HOST).as_deref(), Some(TOKEN));
    assert_no_token(&status);
}

#[tokio::test]
async fn f19_5_rejected_tokens_are_not_saved() {
    let cases = [
        (
            401,
            json!({"message": "401 Unauthorized"}),
            ErrorCode::GitlabUnauthorized,
            "didn't accept",
        ),
        (
            401,
            json!({"error": "invalid_token", "error_description": "Token has expired."}),
            ErrorCode::GitlabUnauthorized,
            "expired",
        ),
        (
            401,
            json!({"error": "invalid_token", "error_description": "Token has been revoked."}),
            ErrorCode::GitlabUnauthorized,
            "revoked",
        ),
        (
            403,
            json!({"error": "insufficient_scope", "error_description": "The request requires higher privileges than provided by the access token."}),
            ErrorCode::GitlabForbidden,
            "api scope",
        ),
        (
            403,
            json!({"message": "403 Forbidden"}),
            ErrorCode::GitlabForbidden,
            "doesn't allow",
        ),
    ];
    for (status, body, code, words) in cases {
        let server = MockServer::start().await;
        answer(&server, "/user", status, body.clone()).await;
        let store = MemoryStore::default();
        let error = save(&store, &server).await.unwrap_err();
        assert_eq!(error.code, code, "{body}");
        assert!(error.message.contains(words), "{body}: {}", error.message);
        assert_eq!(store.get(HOST), None, "{body}");
        assert_no_token(&error);
    }
}

#[tokio::test]
async fn f19_5_a_token_without_the_api_scope_is_refused() {
    let server = MockServer::start().await;
    answer(&server, "/user", 200, cassette("user")).await;
    let mut token = cassette("pat_self");
    token["scopes"] = json!(["read_api", "read_repository"]);
    answer(&server, "/personal_access_tokens/self", 200, token).await;
    let store = MemoryStore::default();
    let error = save(&store, &server).await.unwrap_err();
    assert_eq!(error.code, ErrorCode::GitlabForbidden);
    assert_eq!(
        error.detail.as_deref(),
        Some("It has: read_api, read_repository.")
    );
    assert_eq!(store.get(HOST), None);
}

#[tokio::test]
async fn f19_5_an_inactive_or_revoked_token_is_refused() {
    for (field, value, words) in [("active", false, "expired"), ("revoked", true, "revoked")] {
        let server = MockServer::start().await;
        answer(&server, "/user", 200, cassette("user")).await;
        let mut token = cassette("pat_self");
        token[field] = json!(value);
        answer(&server, "/personal_access_tokens/self", 200, token).await;
        let store = MemoryStore::default();
        let error = save(&store, &server).await.unwrap_err();
        assert!(error.message.contains(words), "{field}: {}", error.message);
        assert_eq!(store.get(HOST), None);
    }
}

#[tokio::test]
async fn f19_5_invalid_input_is_refused_before_any_request() {
    let store = MemoryStore::default();
    for (server, token) in [
        ("", TOKEN),
        ("gitlab.example.com", TOKEN),
        ("https://x.test", "  "),
    ] {
        let error = account::check_and_save(&store, None, server, token, TlsBackend::Platform)
            .await
            .unwrap_err();
        assert!(
            matches!(
                error,
                AccountError::NoServer | AccountError::InvalidToken | AccountError::Gitlab(_)
            ),
            "{server:?}: {error:?}"
        );
        assert_eq!(
            AppError::from(error).code,
            ErrorCode::InvalidInput,
            "{server:?}"
        );
    }
}

#[tokio::test]
async fn f19_5_replace_for_another_server_removes_the_old_token() {
    let server = standin().await;
    let store = MemoryStore::with("old.example.com", "glpat-old000000");
    account::check_and_save(
        &store,
        Some("https://old.example.com"),
        &server.uri(),
        TOKEN,
        TlsBackend::Platform,
    )
    .await
    .unwrap();
    assert_eq!(store.get("old.example.com"), None);
    assert_eq!(store.get(HOST).as_deref(), Some(TOKEN));
}

#[tokio::test]
async fn f19_5_remove_deletes_the_token_and_keeps_the_server() {
    let store = MemoryStore::with(HOST, TOKEN);
    let status = account::remove(&store, Some("http://127.0.0.1:9")).unwrap();
    assert_eq!(status.state, GitlabConnection::NoToken);
    assert_eq!(status.server.as_deref(), Some("http://127.0.0.1:9"));
    assert_eq!(store.load(HOST).unwrap(), None);
}

#[tokio::test]
async fn f01_6_status_is_no_token_connected_or_failing() {
    let store = MemoryStore::default();
    let none = account::status(&store, None, TlsBackend::Platform).await;
    assert_eq!(none.state, GitlabConnection::NoToken);
    let no_token = account::status(&store, Some("https://x.test"), TlsBackend::Platform).await;
    assert_eq!(no_token.state, GitlabConnection::NoToken);
    assert_eq!(no_token.server.as_deref(), Some("https://x.test"));

    let server = standin().await;
    let store = MemoryStore::with(HOST, TOKEN);
    let ok = account::status(&store, Some(&server.uri()), TlsBackend::Platform).await;
    assert_eq!(ok.state, GitlabConnection::Connected);
    assert_eq!(ok.user.as_ref().unwrap().username, "dev");
    assert_no_token(&ok);

    let failing_server = MockServer::start().await;
    answer(
        &failing_server,
        "/user",
        401,
        json!({"message": "401 Unauthorized"}),
    )
    .await;
    let failing = account::status(&store, Some(&failing_server.uri()), TlsBackend::Platform).await;
    assert_eq!(failing.state, GitlabConnection::Failing);
    assert_eq!(
        failing.problem.as_ref().unwrap().code,
        ErrorCode::GitlabUnauthorized
    );
    assert_eq!(failing.token_masked.as_deref(), Some("glpat-…0000"));
    assert_no_token(&failing);
}
