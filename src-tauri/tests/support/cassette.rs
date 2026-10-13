//! Cassettes: GitLab answers recorded from the stand-in (09 › Environments; synthetic data only)
//! with `cargo run --example standin_query`, and a token store kept in memory.
#![allow(dead_code, clippy::unwrap_used, reason = "test helpers")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use guided_review_lib::os::credentials::{CredentialsError, Token, TokenStore};
use serde_json::Value;

/// A recorded answer from `tests/cassettes/standin/<name>.json`.
pub fn cassette(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("cassettes")
        .join("standin")
        .join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

/// Token store in memory, standing in for Windows Credential Manager.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, Token>>);

impl MemoryStore {
    pub fn with(host: &str, token: &str) -> Self {
        let store = Self::default();
        store.save(host, &Token::new(token).unwrap()).unwrap();
        store
    }

    pub fn get(&self, host: &str) -> Option<String> {
        self.0
            .lock()
            .unwrap()
            .get(host)
            .map(|t| t.expose().to_owned())
    }
}

impl TokenStore for MemoryStore {
    fn load(&self, host: &str) -> Result<Option<Token>, CredentialsError> {
        Ok(self.0.lock().unwrap().get(host).cloned())
    }
    fn save(&self, host: &str, token: &Token) -> Result<(), CredentialsError> {
        self.0
            .lock()
            .unwrap()
            .insert(host.to_owned(), token.clone());
        Ok(())
    }
    fn delete(&self, host: &str) -> Result<bool, CredentialsError> {
        Ok(self.0.lock().unwrap().remove(host).is_some())
    }
}
