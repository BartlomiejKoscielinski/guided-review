//! The GitLab token in Windows Credential Manager (T4, ADR-020): service `GuidedReview`,
//! account `<gitlab host>`. The token never goes to SQLite, logs, IPC payloads or error
//! messages; [`Token`] has no `Display`, and its `Debug` prints the masked form.

use std::fmt;

/// Keyring service name (ADR-020).
pub const SERVICE: &str = "GuidedReview";

/// GitLab token prefixes shown in the masked form (GitLab docs › Token prefixes).
const KNOWN_PREFIXES: [&str; 3] = ["glpat-", "gloas-", "gldt-"];

#[derive(Debug, thiserror::Error)]
pub enum CredentialsError {
    #[error("the token is empty or contains spaces or control characters")]
    InvalidToken,
    #[error("Windows Credential Manager is not available: {0}")]
    Store(String),
}

/// A GitLab personal access token. Use [`Token::expose`] only to build the request header.
#[derive(Clone, PartialEq, Eq)]
pub struct Token(String);

impl Token {
    pub fn new(value: &str) -> Result<Self, CredentialsError> {
        let value = value.trim();
        if value.is_empty() || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(CredentialsError::InvalidToken);
        }
        Ok(Self(value.to_owned()))
    }

    /// The secret itself, for the `PRIVATE-TOKEN` header only.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// `glpat-…3f9a`: the prefix (when GitLab's) and the last 4 characters (F-19.5, T4).
    pub fn masked(&self) -> String {
        let prefix = KNOWN_PREFIXES
            .iter()
            .find(|prefix| self.0.starts_with(**prefix))
            .copied()
            .unwrap_or("");
        let rest: Vec<char> = self.0[prefix.len()..].chars().collect();
        // Show the last 4 only when at least as many characters stay hidden.
        let tail: String = if rest.len() >= 8 {
            rest[rest.len() - 4..].iter().collect()
        } else {
            String::new()
        };
        format!("{prefix}…{tail}")
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Token({})", self.masked())
    }
}

/// Reads the token stored for `host`; `None` when there is none.
pub fn load(host: &str) -> Result<Option<Token>, CredentialsError> {
    match entry(host)?.get_password() {
        Ok(value) => Token::new(&value).map(Some),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(store_error(&error)),
    }
}

/// Stores the token for `host`, replacing an earlier one.
pub fn save(host: &str, token: &Token) -> Result<(), CredentialsError> {
    entry(host)?
        .set_password(token.expose())
        .map_err(|error| store_error(&error))
}

/// Removes the token for `host`; `Ok(false)` when there was none.
pub fn delete(host: &str) -> Result<bool, CredentialsError> {
    match entry(host)?.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(store_error(&error)),
    }
}

fn entry(host: &str) -> Result<keyring::Entry, CredentialsError> {
    keyring::Entry::new(SERVICE, host).map_err(|error| store_error(&error))
}

/// The store's error kind without any value (keyring errors can carry the bad secret).
fn store_error(error: &keyring::Error) -> CredentialsError {
    let kind = match error {
        keyring::Error::NoStorageAccess(_) => "no access",
        keyring::Error::PlatformFailure(_) => "platform failure",
        keyring::Error::NoDefaultStore => "no credential store",
        keyring::Error::TooLong(..) => "value too long",
        keyring::Error::Invalid(..) => "invalid entry",
        _ => "other",
    };
    CredentialsError::Store(kind.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nfr04_token_debug_is_masked() {
        let token = Token::new("glpat-Ab3x9zQ1.w2E3r4T53f9a").unwrap();
        assert_eq!(format!("{token:?}"), "Token(glpat-…3f9a)");
        assert_eq!(token.masked(), "glpat-…3f9a");
        assert_eq!(token.expose(), "glpat-Ab3x9zQ1.w2E3r4T53f9a");
    }

    #[test]
    fn nfr04_masks_tokens_without_a_known_prefix_and_short_ones() {
        assert_eq!(Token::new("abcdefghij1234").unwrap().masked(), "…1234");
        assert_eq!(Token::new("abc").unwrap().masked(), "…");
        assert_eq!(Token::new("glpat-12").unwrap().masked(), "glpat-…");
    }

    #[test]
    fn rejects_empty_and_whitespace_tokens_and_trims() {
        for bad in ["", "   ", "glpat-ab cd", "glpat-ab\ncd", "glpat-\u{7}x"] {
            assert!(Token::new(bad).is_err(), "{bad:?}");
        }
        assert_eq!(
            Token::new("  glpat-abcdef1234 \r\n").unwrap().expose(),
            "glpat-abcdef1234"
        );
    }

    /// Writes to the real Credential Manager; run by hand: `cargo test -- --ignored`.
    #[test]
    #[ignore = "touches Windows Credential Manager"]
    fn round_trip_in_credential_manager() {
        let host = "gr-test.invalid";
        let token = Token::new("glpat-roundtrip0000").unwrap();
        save(host, &token).unwrap();
        assert_eq!(load(host).unwrap(), Some(token));
        assert!(delete(host).unwrap());
        assert_eq!(load(host).unwrap(), None);
        assert!(!delete(host).unwrap());
    }
}
