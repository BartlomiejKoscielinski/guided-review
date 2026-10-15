//! NFR-08 for `os/process.rs`: logs name the program, never its stdin, stdout or stderr.
//! A test binary of its own: it installs the global logger, which a scoped one in a
//! multi-threaded test binary can't replace reliably (tracing caches callsite interest).
#![allow(clippy::unwrap_used, reason = "test helpers")]
#![expect(
    clippy::disallowed_methods,
    reason = "own test binary: it installs the global logger"
)]

use std::sync::Arc;

use guided_review_lib::logging::{self, rotate::RotatingFile};
use guided_review_lib::os::process::{self, Cancel, ProcessSpec};

#[tokio::test]
async fn nfr08_process_never_logs_stdin_or_output() {
    let dir = tempfile::tempdir().unwrap();
    let file = Arc::new(RotatingFile::open(dir.path(), "test", 1 << 20, 2).unwrap());
    let subscriber = logging::subscriber(
        Some(Arc::clone(&file)),
        logging::filter_from(Some("trace")),
        false,
    );
    tracing::subscriber::set_global_default(subscriber).unwrap();
    let child = || ProcessSpec::new(env!("CARGO_BIN_EXE_gr-test-child"));
    let secret = "PROMPT-CANARY diff --git a/x b/x";
    let output = process::run(&child().arg("echo-stdin").stdin(secret), &Cancel::new())
        .await
        .unwrap();
    assert_eq!(output.stdout, secret);
    let failed = process::run(&child().args(["exit", "3"]), &Cancel::new())
        .await
        .unwrap();
    assert_eq!(failed.stderr, "STDERR-CANARY");
    let log = std::fs::read_to_string(file.path(0)).unwrap();
    assert!(log.contains("gr-test-child"), "{log}");
    assert!(!log.contains("PROMPT-CANARY"), "{log}");
    assert!(!log.contains("diff --git"), "{log}");
    assert!(!log.contains("STDERR-CANARY"), "{log}");
}
