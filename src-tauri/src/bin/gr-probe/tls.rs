//! `tls` (S6): `GET /api/v4/version` with both TLS backends: rustls with the Windows platform
//! verifier (the app's choice) and SChannel through native-tls (comparison). A 401 still proves
//! the TLS handshake; the stored token is sent when there is one.

use std::time::Instant;

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::{GitlabError, NetworkProblem};
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;

use crate::report::{Check, Detail, Outcome, Sanitizer, key_types};
use crate::{Args, server_host, token};

pub async fn run(args: &Args) -> Result<(Vec<Check>, Sanitizer), String> {
    let server = args.required("server")?;
    let host = server_host(server)?;
    let sanitizer = Sanitizer::from_env().with_host(&host);
    let stored = token::stored(&host)?;
    let mut checks = vec![
        Check::new("token_stored", Outcome::Info).detail(Detail::Bool(stored.is_some())),
        Check::new("system_proxy_env", Outcome::Info).detail(Detail::Bool(
            ["HTTPS_PROXY", "https_proxy", "ALL_PROXY"]
                .iter()
                .any(|name| std::env::var_os(name).is_some()),
        )),
    ];
    let token = match stored {
        Some(token) => token,
        None => Token::new("gr-probe-no-token").map_err(|e| e.to_string())?,
    };
    for (name, backend) in [
        ("platform", TlsBackend::Platform),
        ("schannel", TlsBackend::Native),
    ] {
        checks.extend(version_check(server, &token, name, backend).await);
    }
    Ok((checks, sanitizer))
}

async fn version_check(server: &str, token: &Token, name: &str, backend: TlsBackend) -> Vec<Check> {
    let client = match GitlabClient::new(server, token, backend) {
        Ok(client) => client,
        Err(error) => {
            return vec![
                Check::new(&format!("{name}.client"), Outcome::Fail)
                    .detail(Detail::Code(error_code(&error))),
            ];
        }
    };
    let started = Instant::now();
    let result = client.get("/version", &[]).await;
    let ms = started.elapsed().as_millis();
    let (handshake, detail) = match &result {
        Ok(response) => (Outcome::Pass, Detail::Status(response.status)),
        // Any HTTP answer means the TLS handshake succeeded.
        Err(GitlabError::Unauthorized) => (Outcome::Pass, Detail::Status(401)),
        Err(GitlabError::Forbidden { .. }) => (Outcome::Pass, Detail::Status(403)),
        Err(GitlabError::NotFound) => (Outcome::Pass, Detail::Status(404)),
        Err(GitlabError::Status { status, .. }) => (Outcome::Pass, Detail::Status(*status)),
        Err(error) => (Outcome::Fail, Detail::Code(error_code(error))),
    };
    let mut checks = vec![
        Check::new(&format!("{name}.handshake"), handshake)
            .detail(detail)
            .ms(ms),
    ];
    if let Ok(response) = result {
        checks.push(
            Check::new(&format!("{name}.version_keys"), Outcome::Info)
                .detail(Detail::Keys(key_types(&response.body, 2))),
        );
        if let Some(version) = response.body.get("version").and_then(|v| v.as_str()) {
            checks.push(
                Check::new(&format!("{name}.gitlab_version"), Outcome::Info)
                    .detail(Detail::Version(version.to_owned())),
            );
        }
    }
    checks
}

/// A report word for a client error (`tls:unknown_issuer`, `dns`, `unauthorized`).
pub fn error_code(error: &GitlabError) -> String {
    match error {
        GitlabError::Unreachable(NetworkProblem::Tls(problem)) => format!(
            "tls:{}",
            serde_json::to_value(problem)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default()
        ),
        GitlabError::Unreachable(problem) => serde_json::to_value(problem)
            .ok()
            .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(str::to_owned))
            .unwrap_or_else(|| "unreachable".into()),
        GitlabError::Unauthorized => "unauthorized".into(),
        GitlabError::Forbidden { .. } => "forbidden".into(),
        GitlabError::NotFound => "not_found".into(),
        GitlabError::RateLimited { .. } => "rate_limited".into(),
        GitlabError::Status { status, .. } => format!("status:{status}"),
        GitlabError::InvalidUrl => "invalid_url".into(),
        GitlabError::InvalidToken => "invalid_token".into(),
        GitlabError::Setup(_) => "client_setup".into(),
        GitlabError::Decode(_) => "decode".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use guided_review_lib::gitlab::tls::TlsProblem;

    #[test]
    fn error_codes_are_report_words() {
        assert_eq!(
            error_code(&GitlabError::Unreachable(NetworkProblem::Tls(
                TlsProblem::UnknownIssuer
            ))),
            "tls:unknown_issuer"
        );
        assert_eq!(
            error_code(&GitlabError::Unreachable(NetworkProblem::Dns)),
            "dns"
        );
        assert_eq!(
            error_code(&GitlabError::Status {
                status: 409,
                message: Some("x".into())
            }),
            "status:409"
        );
    }
}
