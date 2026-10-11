//! NFR-08 for the GitLab client: the token header never reaches the logs, even at trace level
//! of the HTTP stack. Own test binary because it installs the global logger.
#![allow(clippy::unwrap_used, reason = "test helpers")]

use std::sync::Arc;

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::logging::{self, rotate::RotatingFile};
use guided_review_lib::os::credentials::Token;
use wiremock::matchers::path;
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn nfr08_gitlab_token_header_is_never_logged() {
    let dir = tempfile::tempdir().unwrap();
    let file = Arc::new(RotatingFile::open(dir.path(), "test", 1 << 22, 2).unwrap());
    // The client and the HTTP stack only: the mock server may log what it received.
    let filter = logging::filter_from(Some(
        "gitlab_logging=trace,guided_review_lib=trace,reqwest=trace,hyper=trace,hyper_util=trace,rustls=trace,off",
    ));
    tracing::subscriber::set_global_default(logging::subscriber(
        Some(Arc::clone(&file)),
        filter,
        false,
    ))
    .unwrap();
    let server = MockServer::start().await;
    Mock::given(path("/api/v4/user"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    // No GitLab prefix, so redaction can't hide a leak: the header must not be logged at all.
    let secret = "plain-secret-token-0123456789";
    let gitlab = GitlabClient::new(
        &server.uri(),
        &Token::new(secret).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap();
    let error = gitlab.get("/user", &[]).await.unwrap_err();
    tracing::warn!(error = %error, client = ?gitlab, "request failed");
    let log = std::fs::read_to_string(file.path(0)).unwrap();
    assert!(log.contains("request failed"), "{log}");
    assert!(!log.contains(secret), "{log}");
    assert!(!log.contains("0123456789"), "{log}");
}
