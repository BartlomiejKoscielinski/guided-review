//! What may leave the laptop (ADR-019, T11): JSON key paths and types instead of values, and
//! text with the machine's and the GitLab account's secrets replaced by placeholders.

use std::collections::BTreeMap;

use serde_json::Value;

/// Key paths and JSON types of a value, never the values (`[]` marks array items; at most
/// `depth` levels).
pub fn key_types(value: &Value, depth: usize) -> BTreeMap<String, String> {
    let mut keys = BTreeMap::new();
    collect_keys(value, "", depth, &mut keys);
    keys
}

fn collect_keys(value: &Value, prefix: &str, depth: usize, keys: &mut BTreeMap<String, String>) {
    let type_name = match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    };
    if !prefix.is_empty() {
        keys.entry(prefix.to_owned())
            .and_modify(|seen| {
                if seen != type_name && type_name != "null" {
                    *seen = if seen == "null" {
                        type_name.to_owned()
                    } else {
                        "mixed".to_owned()
                    };
                }
            })
            .or_insert_with(|| type_name.to_owned());
    }
    if depth == 0 {
        return;
    }
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                collect_keys(child, &path, depth - 1, keys);
            }
        }
        Value::Array(items) => {
            for item in items.iter().take(20) {
                collect_keys(item, &format!("{prefix}[]"), depth - 1, keys);
            }
        }
        _ => {}
    }
}

/// Replaces known secrets in text with placeholders.
#[derive(Debug, Clone, Default)]
pub struct Sanitizer {
    replacements: Vec<(String, String)>,
}

impl Sanitizer {
    /// Secrets of this machine: user profile path, user name, computer and domain names.
    pub fn from_env() -> Self {
        let var = |name: &str| std::env::var(name).ok();
        let mut sanitizer = Self::default();
        for (name, placeholder) in [
            ("USERPROFILE", "%USERPROFILE%"),
            ("LOCALAPPDATA", "%LOCALAPPDATA%"),
            ("APPDATA", "%APPDATA%"),
            ("TEMP", "%TEMP%"),
            ("ProgramFiles", "%ProgramFiles%"),
            ("ProgramFiles(x86)", "%ProgramFiles(x86)%"),
        ] {
            if let Some(value) = var(name) {
                sanitizer = sanitizer.with(&value, placeholder);
            }
        }
        for (name, placeholder) in [
            ("USERNAME", "<user>"),
            ("COMPUTERNAME", "<computer>"),
            ("USERDOMAIN", "<domain>"),
            ("USERDNSDOMAIN", "<domain>"),
        ] {
            if let Some(value) = var(name) {
                sanitizer = sanitizer.with(&value, placeholder);
            }
        }
        sanitizer
    }

    /// Adds a secret; values shorter than 3 characters are ignored.
    pub fn with(mut self, secret: &str, placeholder: &str) -> Self {
        let secret = secret.trim();
        if secret.chars().count() >= 3 {
            self.replacements
                .push((secret.to_owned(), placeholder.to_owned()));
            // Longest first, so a profile path wins over the user name inside it.
            self.replacements
                .sort_by_key(|(secret, _)| std::cmp::Reverse(secret.len()));
        }
        self
    }

    /// A GitLab host and its registrable domain (`gitlab.corp.example` → `corp.example`).
    pub fn with_host(self, host: &str) -> Self {
        let labels: Vec<&str> = host.split('.').collect();
        let sanitizer = self.with(host, "<host>");
        if labels.len() > 2 {
            let domain = labels[labels.len() - 2..].join(".");
            sanitizer.with(&domain, "<domain>")
        } else {
            sanitizer
        }
    }

    pub fn clean(&self, text: &str) -> String {
        self.replacements
            .iter()
            .fold(text.to_owned(), |text, (secret, placeholder)| {
                replace_ignore_case(&text, secret, placeholder)
            })
    }

    /// The first secret still present in `text`, if any.
    pub fn leak<'a>(&'a self, text: &str) -> Option<&'a str> {
        let lower = text.to_lowercase();
        self.replacements
            .iter()
            .map(|(secret, _)| secret.as_str())
            .find(|secret| lower.contains(&secret.to_lowercase()))
    }
}

fn replace_ignore_case(text: &str, secret: &str, placeholder: &str) -> String {
    let lower_text = text.to_lowercase();
    let lower_secret = secret.to_lowercase();
    // Lower-casing may change byte lengths (non-ASCII); then fall back to exact matching.
    if lower_text.len() != text.len() || lower_secret.len() != secret.len() {
        return text.replace(secret, placeholder);
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = 0;
    while let Some(found) = lower_text[rest..].find(&lower_secret) {
        let start = rest + found;
        out.push_str(&text[rest..start]);
        out.push_str(placeholder);
        rest = start + secret.len();
    }
    out.push_str(&text[rest..]);
    out
}

pub fn clean_value(value: Value, sanitizer: &Sanitizer) -> Value {
    match value {
        Value::String(text) => Value::String(sanitizer.clean(&text)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| clean_value(item, sanitizer))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, item)| (sanitizer.clean(&key), clean_value(item, sanitizer)))
                .collect(),
        ),
        other => other,
    }
}

pub fn value_leaks(value: &Value, sanitizer: &Sanitizer) -> bool {
    match value {
        Value::String(text) => sanitizer.leak(text).is_some(),
        Value::Array(items) => items.iter().any(|item| value_leaks(item, sanitizer)),
        Value::Object(map) => map
            .iter()
            .any(|(key, item)| sanitizer.leak(key).is_some() || value_leaks(item, sanitizer)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn key_types_keep_paths_and_types_only() {
        let body = json!({
            "id": 7, "username": "jan.kowalski",
            "approved_by": [{ "user": { "id": 1, "name": "Jan" } }], "expires_at": null
        });
        let keys = key_types(&body, 4);
        assert_eq!(keys["username"], "string");
        assert_eq!(keys["approved_by[].user.id"], "number");
        assert_eq!(keys["expires_at"], "null");
        assert!(!format!("{keys:?}").contains("jan"));
    }

    #[test]
    fn sanitizer_replaces_host_user_email_paths() {
        let s = Sanitizer::default()
            .with(r"C:\Users\jan.kowalski", "%USERPROFILE%")
            .with("jan.kowalski", "<user>")
            .with("jan.kowalski@corp.example", "<email>")
            .with("mobile/mobile-app", "<project>")
            .with_host("gitlab.corp.example");
        assert_eq!(
            s.clean(r"C:\Users\Jan.Kowalski\.local\bin\claude.exe"),
            r"%USERPROFILE%\.local\bin\claude.exe"
        );
        assert_eq!(
            s.clean("jan.kowalski@corp.example on GITLAB.corp.example"),
            "<email> on <host>"
        );
        assert_eq!(s.clean("other.corp.example"), "other.<domain>");
        assert_eq!(s.leak("group mobile/mobile-app"), Some("mobile/mobile-app"));
    }
}
