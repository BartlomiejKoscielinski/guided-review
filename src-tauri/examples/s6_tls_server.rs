//! S6 spike: local HTTPS servers signed by a fresh test CA, to check that the app's TLS trusts
//! a CA from the Windows store without configuration (docs/09 › Environments, F-3).
//!
//! `cargo run --example s6_tls_server -- --out <dir> [--minutes 30]`
//!
//! Writes `<dir>\gr-test-ca.cer`, prints the `certutil` lines to import and remove it, and serves
//! until the time is up. The CA's private key exists only in this process: once it ends, the
//! imported certificate can't vouch for anything new. Remove it from the store anyway.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "spike tool")]

#[path = "../tests/support/tls_server.rs"]
mod tls_server;

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tls_server::{Leaf, TestCa, serve};

const PORTS: [(Leaf, u16); 4] = [
    (Leaf::Valid, 18441),
    (Leaf::Expired, 18442),
    (Leaf::WrongName, 18443),
    (Leaf::CrlUnreachable, 18444),
];

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let option = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let out = PathBuf::from(option("--out").unwrap_or_else(|| ".".into()));
    let minutes: u64 = option("--minutes")
        .and_then(|m| m.parse().ok())
        .unwrap_or(30);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let name = format!("Guided Review Test CA {stamp:x}");
    let ca = TestCa::new(&name);
    std::fs::create_dir_all(&out).unwrap();
    let cer = out.join("gr-test-ca.cer");
    std::fs::write(&cer, &ca.der).unwrap();
    for (leaf, port) in PORTS {
        let (chain, key) = ca.leaf(leaf);
        let address = serve(chain, key, port).await;
        println!("{leaf:?}: https://localhost:{}", address.port());
    }
    println!("CA: {name}");
    println!(
        "import: certutil -user -addstore Root \"{}\"",
        cer.display()
    );
    println!("remove: certutil -user -delstore Root \"{name}\"");
    println!("serving for {minutes} min");
    tokio::time::sleep(Duration::from_secs(minutes * 60)).await;
}
