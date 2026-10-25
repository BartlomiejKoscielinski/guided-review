//! GitLab REST v4 client core (docs/05 › GitLab REST API v4): the `PRIVATE-TOKEN` header
//! (marked sensitive, never logged), JSON requests, `x-next-page` pagination, status and network
//! error mapping. The same client talks to the stand-in and to on-prem; only the URL differs
//! (ADR-019). Endpoint-specific calls are added per milestone on top of this.

use std::time::{Duration, Instant};

use reqwest::Method;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::Value;

use super::error::{GitlabError, NetworkProblem};
use super::tls::{self, TlsBackend};
use crate::os::credentials::Token;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Items per page for list endpoints.
pub const PER_PAGE: u32 = 100;

/// A successful response: status, the names (never values) of its headers, the next page from
/// `x-next-page`, and the JSON body (`Null` when empty).
#[derive(Debug, Clone, PartialEq)]
pub struct GitlabResponse {
    pub status: u16,
    pub header_names: Vec<String>,
    pub next_page: Option<u32>,
    pub body: Value,
}

/// A response before its body is decoded.
struct RawResponse {
    status: u16,
    header_names: Vec<String>,
    next_page: Option<u32>,
    retry_after: Option<Duration>,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct GitlabClient {
    http: reqwest::Client,
    api: reqwest::Url,
    host: String,
}

impl GitlabClient {
    /// A client for `server` (`https://gitlab.example.com`, optionally with a sub-path).
    pub fn new(server: &str, token: &Token, tls: TlsBackend) -> Result<Self, GitlabError> {
        let mut api = reqwest::Url::parse(server.trim()).map_err(|_| GitlabError::InvalidUrl)?;
        let host = match (api.scheme(), api.host_str()) {
            ("https" | "http", Some(host)) if !host.is_empty() => host.to_owned(),
            _ => return Err(GitlabError::InvalidUrl),
        };
        let path = format!("{}/api/v4/", api.path().trim_end_matches('/'));
        api.set_path(&path);
        api.set_query(None);
        api.set_fragment(None);

        let mut value =
            HeaderValue::from_str(token.expose()).map_err(|_| GitlabError::InvalidToken)?;
        value.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert("PRIVATE-TOKEN", value);
        let builder = reqwest::Client::builder()
            .default_headers(headers)
            .user_agent(concat!("GuidedReview/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT);
        let builder = match tls {
            TlsBackend::Platform => builder.tls_backend_rustls(),
            #[cfg(feature = "field-probe")]
            TlsBackend::Native => builder.tls_backend_native(),
        };
        let http = builder
            .build()
            .map_err(|error| GitlabError::Setup(error.to_string()))?;
        Ok(Self { http, api, host })
    }

    /// The server's host name (the Credential Manager account, ADR-020).
    pub fn host(&self) -> &str {
        &self.host
    }

    /// The URL of an API path such as `/projects/42/merge_requests`.
    pub fn url(&self, path: &str) -> Result<reqwest::Url, GitlabError> {
        self.api
            .join(path.trim_start_matches('/'))
            .map_err(|_| GitlabError::InvalidUrl)
    }

    pub async fn get(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<GitlabResponse, GitlabError> {
        self.request(Method::GET, path, query, None).await
    }

    pub async fn post(&self, path: &str, body: &Value) -> Result<GitlabResponse, GitlabError> {
        self.request(Method::POST, path, &[], Some(body)).await
    }

    pub async fn put(
        &self,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
    ) -> Result<GitlabResponse, GitlabError> {
        self.request(Method::PUT, path, query, body).await
    }

    /// A GraphQL query (`POST /api/graphql`, ADR-024) with the same token header. GraphQL
    /// answers errors with status 200: any entry in `errors` becomes [`GitlabError::Graphql`].
    /// Returns `data`.
    pub async fn graphql(&self, query: &str, variables: &Value) -> Result<Value, GitlabError> {
        let body = serde_json::json!({ "query": query, "variables": variables });
        let response = self
            .request(Method::POST, "../graphql", &[], Some(&body))
            .await?;
        if let Some(message) = graphql_error(&response.body) {
            return Err(GitlabError::Graphql(message));
        }
        match response.body.get("data") {
            Some(data) if !data.is_null() => Ok(data.clone()),
            _ => Err(GitlabError::Decode("GraphQL answer without data".into())),
        }
    }

    /// One request; error statuses and network failures become [`GitlabError`]s.
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
    ) -> Result<GitlabResponse, GitlabError> {
        let raw = self.send(method, path, query, body).await?;
        let body = if raw.bytes.iter().all(u8::is_ascii_whitespace) {
            Value::Null
        } else {
            match serde_json::from_slice(&raw.bytes) {
                Ok(body) => body,
                Err(_) if raw.status >= 400 => Value::Null,
                Err(error) => return Err(GitlabError::Decode(error.to_string())),
            }
        };
        if raw.status >= 400 {
            return Err(GitlabError::from_status(raw.status, raw.retry_after, &body));
        }
        Ok(GitlabResponse {
            status: raw.status,
            header_names: raw.header_names,
            next_page: raw.next_page,
            body,
        })
    }

    /// A GET whose answer is plain text (a job trace, F-20.5), decoded as UTF-8 with invalid
    /// bytes replaced; error statuses map like [`Self::request`].
    pub async fn get_text(&self, path: &str) -> Result<String, GitlabError> {
        let raw = self.send(Method::GET, path, &[], None).await?;
        if raw.status >= 400 {
            let body = serde_json::from_slice(&raw.bytes).unwrap_or(Value::Null);
            return Err(GitlabError::from_status(raw.status, raw.retry_after, &body));
        }
        Ok(String::from_utf8_lossy(&raw.bytes).into_owned())
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
    ) -> Result<RawResponse, GitlabError> {
        let started = Instant::now();
        let mut request = self
            .http
            .request(method.clone(), self.url(path)?)
            .query(query);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await.map_err(network_error)?;
        let status = response.status().as_u16();
        let headers = response.headers();
        let header_names = headers
            .keys()
            .map(|name| name.as_str().to_owned())
            .collect();
        let header_number = |name: &str| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok())
        };
        let next_page = header_number("x-next-page").and_then(|page| u32::try_from(page).ok());
        let retry_after = header_number("retry-after").map(Duration::from_secs);
        let bytes = response.bytes().await.map_err(network_error)?.to_vec();
        tracing::debug!(
            %method,
            path,
            status,
            ms = started.elapsed().as_millis(),
            "GitLab request"
        );
        Ok(RawResponse {
            status,
            header_names,
            next_page,
            retry_after,
            bytes,
        })
    }

    /// All items of a list endpoint, following `x-next-page` for at most `max_pages` pages of
    /// [`PER_PAGE`] items. Returns the items and the number of pages fetched.
    pub async fn get_pages(
        &self,
        path: &str,
        query: &[(&str, String)],
        max_pages: u32,
    ) -> Result<(Vec<Value>, u32), GitlabError> {
        let mut items = Vec::new();
        let mut page = 1;
        let mut pages = 0;
        loop {
            let mut paged = query.to_vec();
            paged.push(("per_page", PER_PAGE.to_string()));
            paged.push(("page", page.to_string()));
            let response = self.get(path, &paged).await?;
            pages += 1;
            match response.body {
                Value::Array(list) => items.extend(list),
                _ => return Err(GitlabError::Decode(format!("{path} did not return a list"))),
            }
            match response.next_page {
                Some(next) if pages < max_pages => page = next,
                _ => return Ok((items, pages)),
            }
        }
    }
}

/// The first GraphQL error message (shortened like REST messages), if any.
fn graphql_error(body: &Value) -> Option<String> {
    let first = body.get("errors")?.as_array()?.first()?;
    let message = first
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("GraphQL error");
    Some(message.chars().take(300).collect())
}

/// Maps a transport failure: TLS problems first, then DNS, refused, timeout.
fn network_error(error: reqwest::Error) -> GitlabError {
    if let Some(problem) = tls::classify(&error) {
        return GitlabError::Unreachable(NetworkProblem::Tls(problem));
    }
    if error.is_timeout() {
        return GitlabError::Unreachable(NetworkProblem::Timeout);
    }
    if error.is_decode() || error.is_body() {
        return GitlabError::Decode(error.to_string());
    }
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(&error);
    while let Some(current) = source {
        if let Some(io) = current.downcast_ref::<std::io::Error>() {
            if io.kind() == std::io::ErrorKind::ConnectionRefused {
                return GitlabError::Unreachable(NetworkProblem::Refused);
            }
            // WSAHOST_NOT_FOUND, WSATRY_AGAIN, WSANO_RECOVERY, WSANO_DATA
            if matches!(io.raw_os_error(), Some(11001..=11004)) {
                return GitlabError::Unreachable(NetworkProblem::Dns);
            }
        }
        source = current.source();
    }
    if format!("{error:?}").contains("dns error") {
        return GitlabError::Unreachable(NetworkProblem::Dns);
    }
    GitlabError::Unreachable(NetworkProblem::Other)
}

/// `:id` for a project path: `mobile/mobile-app` → `mobile%2Fmobile-app`.
pub fn project_id(path: &str) -> String {
    path.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token() -> Token {
        Token::new("glpat-test00000000").unwrap()
    }

    #[test]
    fn api_urls_keep_sub_paths_and_encoded_project_ids() {
        let client = GitlabClient::new(
            "https://gitlab.example.com/",
            &token(),
            TlsBackend::Platform,
        )
        .unwrap();
        assert_eq!(client.host(), "gitlab.example.com");
        assert_eq!(
            client.url("/version").unwrap().as_str(),
            "https://gitlab.example.com/api/v4/version"
        );
        let nested =
            GitlabClient::new("https://example.com/gitlab", &token(), TlsBackend::Platform)
                .unwrap();
        let path = format!(
            "/projects/{}/merge_requests",
            project_id("mobile/mobile-app")
        );
        assert_eq!(
            nested.url(&path).unwrap().as_str(),
            "https://example.com/gitlab/api/v4/projects/mobile%2Fmobile-app/merge_requests"
        );
    }

    #[test]
    fn rejects_invalid_server_urls() {
        for server in [
            "",
            "gitlab.example.com",
            "ftp://gitlab.example.com",
            "https://",
        ] {
            assert!(
                matches!(
                    GitlabClient::new(server, &token(), TlsBackend::Platform),
                    Err(GitlabError::InvalidUrl)
                ),
                "{server}"
            );
        }
    }

    #[test]
    fn project_ids_are_percent_encoded() {
        assert_eq!(
            project_id("group/sub group/app"),
            "group%2Fsub%20group%2Fapp"
        );
        assert_eq!(project_id("42"), "42");
        assert_eq!(
            project_id("grupa/zażółć"),
            "grupa%2Fza%C5%BC%C3%B3%C5%82%C4%87"
        );
    }
}
