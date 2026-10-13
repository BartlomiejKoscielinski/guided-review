//! Stand-in GitLab (ADR-019, `tools/standin/`): runs one read-only request with the token stored
//! for the server in Credential Manager and prints (or writes) the JSON answer. Used for GraphQL
//! introspection (ADR-024) and to record wiremock cassettes (09 › Environments: from the stand-in
//! only, synthetic data only). Never point it at another server.
//!
//! ```text
//! cargo run --example standin_query -- --graphql q.graphql [--vars '{"a":1}'] [--out x.json]
//! cargo run --example standin_query -- --get /user [--out x.json]
//! ```
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "dev tool")]

use guided_review_lib::gitlab::client::GitlabClient;
use guided_review_lib::gitlab::tls::TlsBackend;
use guided_review_lib::os::credentials;
use serde_json::Value;

const SERVER: &str = "https://localhost:8443";

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let token = credentials::load("localhost")
        .unwrap()
        .expect("no token stored for localhost (tools/standin/README.md step 7)");
    let client = GitlabClient::new(SERVER, &token, TlsBackend::Platform).unwrap();
    let body: Value = if let Some(file) = arg(&args, "--graphql") {
        let query = std::fs::read_to_string(file).unwrap();
        let vars = arg(&args, "--vars").map_or(Value::Null, |v| serde_json::from_str(&v).unwrap());
        let wrapped = serde_json::json!({ "query": query, "variables": vars });
        // The raw answer (with `errors`), not `client.graphql`, so introspection shows failures.
        client
            .request(reqwest::Method::POST, "../graphql", &[], Some(&wrapped))
            .await
            .unwrap()
            .body
    } else {
        let path = arg(&args, "--get").expect("--graphql <file> or --get <path>");
        client.get(&path, &[]).await.unwrap().body
    };
    let text = serde_json::to_string_pretty(&body).unwrap();
    match arg(&args, "--out") {
        Some(out) => std::fs::write(out, text + "\n").unwrap(),
        None => println!("{text}"),
    }
}
