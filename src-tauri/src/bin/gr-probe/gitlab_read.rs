//! `gitlab read` (S5 read, field visit 1): version and tier, the current user, the token's
//! scopes, MR list filters (F-02.1), pagination headers, and the key sets of MR detail,
//! approvals, versions, discussions, draft notes, pipelines and jobs, and the GraphQL schema and
//! MR list key sets (`gitlab_graphql.rs`, field visit 2). Read-only.
//!
//! The report holds statuses, booleans and key sets; values (names, titles, counts) never.

use guided_review_lib::gitlab::client::{GitlabClient, GitlabResponse, project_id};
use guided_review_lib::gitlab::error::GitlabError;
use guided_review_lib::gitlab::tls::TlsBackend;
use serde_json::Value;

use crate::report::{Check, Detail, Outcome, Sanitizer, key_types};
use crate::tls::error_code;
use crate::{Args, server_host, token};

/// A connected client, the current user and the sanitizer that knows their values.
pub struct Session {
    pub client: GitlabClient,
    pub sanitizer: Sanitizer,
    pub me_id: i64,
    pub me_username: String,
    pub project: Option<(String, String)>,
}

impl Session {
    /// `:id` of the project and its path for the sanitizer, when `--project` was given.
    pub fn project_id(&self) -> Option<&str> {
        self.project.as_ref().map(|(id, _)| id.as_str())
    }
}

pub async fn connect(args: &Args, checks: &mut Vec<Check>) -> Result<Session, String> {
    let server = args.required("server")?;
    let host = server_host(server)?;
    let token = token::stored(&host)?
        .ok_or_else(|| format!("no token for {host}; run: gr-probe token set --server {server}"))?;
    let client =
        GitlabClient::new(server, &token, TlsBackend::Platform).map_err(|e| e.to_string())?;
    let mut sanitizer = Sanitizer::from_env().with_host(&host);
    let user = client
        .get("/user", &[])
        .await
        .map_err(|error| format!("GET /user failed: {}", error_code(&error)))?;
    for key in [
        "username",
        "name",
        "email",
        "public_email",
        "commit_email",
        "web_url",
    ] {
        if let Some(value) = user.body.get(key).and_then(Value::as_str) {
            sanitizer = sanitizer.with(value, "<user>");
        }
    }
    checks.push(keys_check("user", &user.body, 1));
    let me_id = user
        .body
        .get("id")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let me_username = user
        .body
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let project = args.option("project").map(|path| {
        sanitizer = sanitizer.clone().with(path, "<project>");
        if let Some((namespace, _)) = path.rsplit_once('/') {
            sanitizer = sanitizer.clone().with(namespace, "<namespace>");
        }
        (project_id(path), path.to_owned())
    });
    Ok(Session {
        client,
        sanitizer,
        me_id,
        me_username,
        project,
    })
}

/// Status and key set of a response.
pub fn keys_check(id: &str, body: &Value, depth: usize) -> Check {
    Check::new(&format!("{id}.keys"), Outcome::Info).detail(Detail::Keys(key_types(body, depth)))
}

/// Pass with the status, or Fail with the error code.
pub fn status_check(id: &str, result: &Result<GitlabResponse, GitlabError>) -> Check {
    match result {
        Ok(response) => Check::new(id, Outcome::Pass).detail(Detail::Status(response.status)),
        Err(error) => Check::new(id, Outcome::Fail).detail(Detail::Code(error_code(error))),
    }
}

pub async fn run(args: &Args) -> Result<(Vec<Check>, Sanitizer), String> {
    let mut checks = Vec::new();
    let session = connect(args, &mut checks).await?;
    let gitlab = &session.client;

    let version = gitlab.get("/version", &[]).await;
    checks.push(status_check("version", &version));
    if let Ok(version) = &version {
        checks.push(keys_check("version", &version.body, 1));
        if let Some(text) = version.body.get("version").and_then(Value::as_str) {
            checks.push(
                Check::new("version.gitlab", Outcome::Info).detail(Detail::Version(text.into())),
            );
        }
        if let Some(enterprise) = version.body.get("enterprise").and_then(Value::as_bool) {
            checks.push(
                Check::new("version.enterprise_edition", Outcome::Info)
                    .detail(Detail::Bool(enterprise)),
            );
        }
    }

    let token_self = gitlab.get("/personal_access_tokens/self", &[]).await;
    checks.push(status_check("token_self", &token_self));
    if let Ok(token_self) = &token_self {
        checks.push(keys_check("token_self", &token_self.body, 1));
        let scopes: Vec<String> = token_self
            .body
            .get("scopes")
            .and_then(Value::as_array)
            .map(|scopes| {
                scopes
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        checks.push(Check::new("token_self.scopes", Outcome::Info).detail(Detail::Names(scopes)));
        let expires = token_self
            .body
            .get("expires_at")
            .is_some_and(|v| !v.is_null());
        checks
            .push(Check::new("token_self.has_expiry", Outcome::Info).detail(Detail::Bool(expires)));
    }

    if let Some(id) = session.project_id() {
        let project = gitlab.get(&format!("/projects/{id}"), &[]).await;
        checks.push(status_check("project", &project));
    }
    checks.extend(mr_filters(&session).await);
    checks.extend(latest_mr_shapes(&session).await);
    checks.extend(crate::gitlab_graphql::checks(&session).await);
    Ok((checks, session.sanitizer))
}

/// The MR list path: the project's, or the global one with `scope=all`.
pub fn mr_list(session: &Session) -> (String, Vec<(&'static str, String)>) {
    match session.project_id() {
        Some(id) => (format!("/projects/{id}/merge_requests"), Vec::new()),
        None => (
            "/merge_requests".to_owned(),
            vec![("scope", "all".to_owned())],
        ),
    }
}

async fn mr_filters(session: &Session) -> Vec<Check> {
    let (path, base) = mr_list(session);
    let me = session.me_username.clone();
    let opened = [("state", "opened".to_owned())];
    let query = |extra: &[(&'static str, String)]| {
        base.iter()
            .cloned()
            .chain(opened.iter().cloned())
            .chain(extra.iter().cloned())
            .collect::<Vec<_>>()
    };
    let mut checks = Vec::new();
    let unfiltered = session.client.get_pages(&path, &query(&[]), 1).await;
    let baseline = unfiltered
        .as_ref()
        .map(|(items, _)| ids(items))
        .unwrap_or_default();
    let filters: [(&str, Vec<(&'static str, String)>); 8] = [
        ("reviewer_username", vec![("reviewer_username", me.clone())]),
        ("author_username", vec![("author_username", me.clone())]),
        (
            "scope_reviews_for_me",
            vec![("scope", "reviews_for_me".into())],
        ),
        (
            "approved_by_usernames_me",
            vec![("approved_by_usernames[]", me.clone())],
        ),
        (
            "approved_by_usernames_none",
            vec![("approved_by_usernames[]", "None".into())],
        ),
        (
            "not_approved_by_usernames_me",
            vec![("not[approved_by_usernames][]", me.clone())],
        ),
        (
            "approver_ids_me",
            vec![("approver_ids[]", session.me_id.to_string())],
        ),
        ("draft_no", vec![("draft", "no".into())]),
    ];
    for (name, extra) in filters {
        let result = session.client.get_pages(&path, &query(&extra), 1).await;
        let id = format!("mr_filter.{name}");
        match result {
            Ok((items, _)) => {
                let found = ids(&items);
                checks.push(Check::new(&id, Outcome::Pass).detail(Detail::Status(200)));
                checks.push(
                    Check::new(&format!("{id}.narrows_list"), Outcome::Info)
                        .detail(Detail::Bool(found != baseline)),
                );
            }
            Err(error) => {
                checks
                    .push(Check::new(&id, Outcome::Fail).detail(Detail::Code(error_code(&error))));
            }
        }
    }
    // Pagination headers with one item per page.
    let mut paged = base.clone();
    paged.extend([("state", "all".to_owned()), ("per_page", "1".to_owned())]);
    if let Ok(page) = session.client.get(&path, &paged).await {
        let names: Vec<String> = page
            .header_names
            .iter()
            .filter(|name| name.starts_with("x-") || *name == "link")
            .cloned()
            .collect();
        checks.push(Check::new("pagination.headers", Outcome::Info).detail(Detail::Names(names)));
        checks.push(
            Check::new("pagination.next_page_parsed", Outcome::Info)
                .detail(Detail::Bool(page.next_page.is_some())),
        );
    }
    checks
}

fn ids(items: &[Value]) -> Vec<i64> {
    let mut ids: Vec<i64> = items
        .iter()
        .filter_map(|mr| mr.get("id").and_then(Value::as_i64))
        .collect();
    ids.sort_unstable();
    ids
}

/// Key sets of the newest open MR's detail, approvals, versions, discussions, draft notes,
/// pipelines and jobs (when the user can see one).
async fn latest_mr_shapes(session: &Session) -> Vec<Check> {
    let (path, mut query) = mr_list(session);
    query.extend([("state", "opened".to_owned()), ("per_page", "1".to_owned())]);
    let Ok(list) = session.client.get(&path, &query).await else {
        return vec![Check::new("latest_mr", Outcome::Skip)];
    };
    let Some(mr) = list
        .body
        .as_array()
        .and_then(|items| items.first())
        .cloned()
    else {
        return vec![
            Check::new("latest_mr", Outcome::Skip).detail(Detail::Code("no_open_mr".into())),
        ];
    };
    let (Some(project), Some(iid)) = (
        mr.get("project_id").and_then(Value::as_i64),
        mr.get("iid").and_then(Value::as_i64),
    ) else {
        return vec![Check::new("latest_mr", Outcome::Skip)];
    };
    let base = format!("/projects/{project}/merge_requests/{iid}");
    let mut checks = Vec::new();
    for (name, suffix, depth) in [
        ("mr_detail", "", 2),
        ("mr_approvals", "/approvals", 3),
        ("mr_approval_state", "/approval_state", 2),
        ("mr_versions", "/versions", 2),
        ("mr_discussions", "/discussions", 4),
        ("mr_draft_notes", "/draft_notes", 3),
        ("mr_pipelines", "/pipelines", 2),
    ] {
        let result = session.client.get(&format!("{base}{suffix}"), &[]).await;
        checks.push(status_check(name, &result));
        if let Ok(response) = &result {
            checks.push(keys_check(name, &response.body, depth));
        }
    }
    if let Ok(pipelines) = session.client.get(&format!("{base}/pipelines"), &[]).await
        && let Some(pipeline) = pipelines
            .body
            .as_array()
            .and_then(|p| p.first())
            .and_then(|p| p.get("id"))
            .and_then(Value::as_i64)
    {
        let jobs = session
            .client
            .get(
                &format!("/projects/{project}/pipelines/{pipeline}/jobs"),
                &[],
            )
            .await;
        checks.push(status_check("pipeline_jobs", &jobs));
        if let Ok(jobs) = &jobs {
            checks.push(keys_check("pipeline_jobs", &jobs.body, 2));
        }
    }
    checks
}
