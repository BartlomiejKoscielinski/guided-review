//! GitLab client core against a local mock server (09 › Layers: GitLab client).
#![allow(clippy::unwrap_used, reason = "test helpers")]

use std::time::Duration;

use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::error::{GitlabError, NetworkProblem};
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials::Token;
use serde_json::json;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "glpat-wiremock0000000";

fn client(server: &MockServer) -> GitlabClient {
    GitlabClient::new(
        &server.uri(),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap()
}

#[tokio::test]
async fn sends_the_private_token_header_and_reads_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/version"))
        .and(header("PRIVATE-TOKEN", TOKEN))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"version": "18.5.0"})))
        .expect(1)
        .mount(&server)
        .await;
    let response = client(&server).get("/version", &[]).await.unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(response.body["version"], "18.5.0");
    assert!(response.header_names.iter().any(|h| h == "content-type"));
    assert_eq!(response.next_page, None);
}

#[tokio::test]
async fn posts_json_and_accepts_empty_bodies() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/api/v4/projects/g%2Fp/merge_requests/1/draft_notes/bulk_publish",
        ))
        .and(body_json(json!({})))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    let response = client(&server)
        .post(
            "/projects/g%2Fp/merge_requests/1/draft_notes/bulk_publish",
            &json!({}),
        )
        .await
        .unwrap();
    assert_eq!(response.status, 204);
    assert_eq!(response.body, serde_json::Value::Null);
}

#[tokio::test]
async fn gitlab_paginates_with_x_next_page() {
    let server = MockServer::start().await;
    for (page, next, items) in [
        ("1", "2", json!([1, 2])),
        ("2", "3", json!([3])),
        ("3", "", json!([4])),
    ] {
        Mock::given(method("GET"))
            .and(path("/api/v4/projects/1/merge_requests"))
            .and(query_param("page", page))
            .and(query_param("per_page", "100"))
            .and(query_param("state", "opened"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("x-next-page", next)
                    .set_body_json(items),
            )
            .mount(&server)
            .await;
    }
    let gitlab = client(&server);
    let query = [("state", "opened".to_owned())];
    let (items, pages) = gitlab
        .get_pages("/projects/1/merge_requests", &query, 10)
        .await
        .unwrap();
    assert_eq!(items, [json!(1), json!(2), json!(3), json!(4)]);
    assert_eq!(pages, 3);
    let (items, pages) = gitlab
        .get_pages("/projects/1/merge_requests", &query, 2)
        .await
        .unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(pages, 2);
}

#[tokio::test]
async fn gitlab_maps_401_403_404_409() {
    let server = MockServer::start().await;
    for (route, status, body) in [
        ("/api/v4/a", 401, json!({"message": "401 Unauthorized"})),
        (
            "/api/v4/b",
            403,
            json!({"message": "403 Forbidden - insufficient_scope"}),
        ),
        (
            "/api/v4/c",
            404,
            json!({"message": "404 Project Not Found"}),
        ),
        (
            "/api/v4/d",
            409,
            json!({"message": "SHA does not match HEAD of source branch"}),
        ),
    ] {
        Mock::given(path(route))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&server)
            .await;
    }
    let gitlab = client(&server);
    assert_eq!(gitlab.get("/a", &[]).await, Err(GitlabError::Unauthorized));
    assert_eq!(
        gitlab.get("/b", &[]).await,
        Err(GitlabError::Forbidden {
            message: Some("403 Forbidden - insufficient_scope".into())
        })
    );
    assert_eq!(gitlab.get("/c", &[]).await, Err(GitlabError::NotFound));
    let conflict = gitlab.get("/d", &[]).await.unwrap_err();
    assert_eq!(AppError::from(conflict).code, ErrorCode::Conflict);
}

#[tokio::test]
async fn nfr03_rate_limit_reports_retry_after() {
    let server = MockServer::start().await;
    Mock::given(path("/api/v4/user"))
        .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "17"))
        .mount(&server)
        .await;
    assert_eq!(
        client(&server).get("/user", &[]).await,
        Err(GitlabError::RateLimited {
            retry_after: Some(Duration::from_secs(17))
        })
    );
}

#[tokio::test]
async fn invalid_json_is_a_decode_error() {
    let server = MockServer::start().await;
    Mock::given(path("/api/v4/user"))
        .respond_with(ResponseTemplate::new(200).set_body_string("<html>proxy login</html>"))
        .mount(&server)
        .await;
    assert!(matches!(
        client(&server).get("/user", &[]).await,
        Err(GitlabError::Decode(_))
    ));
}

#[tokio::test]
async fn gitlab_unreachable_maps_to_gitlab_unreachable() {
    // A port nothing listens on.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let gitlab = GitlabClient::new(
        &format!("http://127.0.0.1:{port}"),
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap();
    let error = gitlab.get("/version", &[]).await.unwrap_err();
    assert_eq!(error, GitlabError::Unreachable(NetworkProblem::Refused));
    assert_eq!(AppError::from(error).code, ErrorCode::GitlabUnreachable);
}

#[tokio::test]
async fn unknown_host_is_a_dns_problem() {
    let gitlab = GitlabClient::new(
        "https://gr-test.invalid",
        &Token::new(TOKEN).unwrap(),
        TlsBackend::Platform,
    )
    .unwrap();
    assert_eq!(
        gitlab.get("/version", &[]).await,
        Err(GitlabError::Unreachable(NetworkProblem::Dns))
    );
}
