//! TLS of the GitLab client against a local HTTPS server whose CA Windows does not trust
//! (the trusted case is the S6 spike, `examples/s6_tls_server.rs`).
#![allow(clippy::unwrap_used, reason = "test helpers")]

#[path = "support/tls_server.rs"]
mod tls_server;

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::{GitlabError, NetworkProblem};
use guided_review_lib::gitlab::tls::{TlsBackend, TlsProblem};
use guided_review_lib::os::credentials::Token;
use tls_server::{Leaf, TestCa, serve};

async fn version_with(backend: TlsBackend) -> Result<serde_json::Value, GitlabError> {
    let ca = TestCa::new("Guided Review Test CA (never trusted)");
    let (chain, key) = ca.leaf(Leaf::Valid);
    let address = serve(chain, key, 0).await;
    let gitlab = GitlabClient::new(
        &format!("https://localhost:{}", address.port()),
        &Token::new("glpat-tls0000000000").unwrap(),
        backend,
    )
    .unwrap();
    gitlab.get("/version", &[]).await.map(|r| r.body)
}

#[tokio::test]
async fn tls_unknown_issuer_is_classified() {
    assert_eq!(
        version_with(TlsBackend::Platform).await,
        Err(GitlabError::Unreachable(NetworkProblem::Tls(
            TlsProblem::UnknownIssuer
        )))
    );
}

#[cfg(feature = "field-probe")]
#[tokio::test]
async fn tls_unknown_issuer_is_classified_with_schannel() {
    assert_eq!(
        version_with(TlsBackend::Native).await,
        Err(GitlabError::Unreachable(NetworkProblem::Tls(
            TlsProblem::UnknownIssuer
        )))
    );
}
