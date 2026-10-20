//! NFR-08 "No telemetry": the webview may only talk to the core over IPC, never to the network.
#![allow(clippy::unwrap_used, reason = "test helpers")]

use std::path::Path;

fn csp(key: &str) -> serde_json::Map<String, serde_json::Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let config: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    config["app"]["security"][key].as_object().unwrap().clone()
}

#[test]
fn nfr08_no_remote_connections_in_csp() {
    let production = csp("csp");
    assert_eq!(production["connect-src"], "ipc: http://ipc.localhost");
    for (directive, value) in &production {
        let value = value.as_str().unwrap();
        for source in value.split_whitespace() {
            let remote = source.starts_with("http") || source.starts_with("ws");
            let local = source == "http://ipc.localhost" || source == "http://asset.localhost";
            assert!(!remote || local, "{directive} allows {source}");
        }
    }
}

#[test]
fn nfr08_dev_csp_reaches_only_the_local_dev_server() {
    for (directive, value) in &csp("devCsp") {
        for source in value.as_str().unwrap().split_whitespace() {
            if source.starts_with("http") || source.starts_with("ws") {
                assert!(
                    source.contains("localhost") || source.contains("127.0.0.1"),
                    "{directive} allows {source}"
                );
            }
        }
    }
}
