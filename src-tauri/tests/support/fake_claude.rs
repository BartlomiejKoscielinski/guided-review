//! Per-test copies of the fake `claude` (`tests/bin/fake_claude.rs`).
#![allow(
    dead_code,
    reason = "each test binary uses a different part of the helper"
)]
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test helper")]

use std::path::{Path, PathBuf};

/// Path to a fake `claude` copied into its own folder with a scenario file next to it
/// (`tests/bin/fake_claude.rs`); every test gets its own copy, so tests run in parallel.
pub struct FakeClaude {
    pub dir: tempfile::TempDir,
    pub exe: PathBuf,
}

impl FakeClaude {
    /// `source` is `env!("CARGO_BIN_EXE_fake-claude")` of the calling test binary.
    pub fn new(source: &Path, scenario: &serde_json::Value) -> Self {
        let dir = tempfile::Builder::new()
            .prefix("gr fake claude ż ")
            .tempdir()
            .unwrap();
        let exe = dir.path().join("claude.exe");
        std::fs::copy(source, &exe).unwrap();
        let fake = Self { dir, exe };
        fake.set_scenario(scenario);
        fake
    }

    pub fn set_scenario(&self, scenario: &serde_json::Value) {
        std::fs::write(
            self.dir.path().join("fake-claude.json"),
            serde_json::to_vec_pretty(scenario).unwrap(),
        )
        .unwrap();
    }

    /// The recorded calls (one JSON object per run: `argv`, `stdin`, `cwd`, `addDirFiles`).
    pub fn calls(&self) -> Vec<serde_json::Value> {
        std::fs::read_to_string(self.dir.path().join("calls.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }
}
