//! The field report (09 › Field kit, ADR-019, T11): sanitized by construction. A check's detail
//! is one of a few typed values (version, code, status, key set, header names, path, number,
//! bool), each validated again before writing; every string then passes the [`Sanitizer`], and
//! writing is refused if a known secret (host, user, email, project, computer, domain) is left.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Placeholder for anything that fails validation.
pub const WITHHELD: &str = "<withheld>";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Report {
    pub probe: String,
    pub sections: BTreeMap<String, Section>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub ran_at: String,
    pub checks: Vec<Check>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Check {
    pub id: String,
    pub outcome: Outcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<Detail>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Pass,
    Fail,
    Info,
    Skip,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type", content = "value")]
pub enum Detail {
    Bool(bool),
    Number(i64),
    /// A version such as `2.1.296 (Claude Code)` or `18.5.0-pre`.
    Version(String),
    /// A machine word: an enum value, an error code (`unknown_issuer`, `api_error`).
    Code(String),
    Status(u16),
    /// JSON key paths and their types (`approved_by[].user.id` → `number`), never values.
    Keys(BTreeMap<String, String>),
    /// Header or field names.
    Names(Vec<String>),
    /// A path under a placeholder root (`%USERPROFILE%\.local\bin\claude.exe`).
    Path(String),
}

impl Check {
    pub fn new(id: &str, outcome: Outcome) -> Self {
        Self {
            id: id.to_owned(),
            outcome,
            detail: None,
            ms: None,
        }
    }

    pub fn detail(mut self, detail: Detail) -> Self {
        self.detail = Some(detail);
        self
    }

    pub fn ms(mut self, ms: u128) -> Self {
        self.ms = u64::try_from(ms).ok();
        self
    }
}

fn is_version(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 48
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || " .-+_()".contains(c))
}

fn is_code(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 64
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.:-/".contains(c))
}

fn is_key(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 96
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.-[]".contains(c))
}

const PATH_ROOTS: [&str; 6] = [
    "%USERPROFILE%",
    "%LOCALAPPDATA%",
    "%APPDATA%",
    "%ProgramFiles%",
    "%ProgramFiles(x86)%",
    "%TEMP%",
];

impl Detail {
    /// The same value with anything that isn't of its kind withheld.
    fn validated(self) -> Self {
        match self {
            Self::Version(v) if !is_version(&v) => Self::Version(WITHHELD.into()),
            Self::Code(c) if !is_code(&c) => Self::Code(WITHHELD.into()),
            Self::Keys(keys) => Self::Keys(
                keys.into_iter()
                    .map(|(k, t)| {
                        let k = if is_key(&k) { k } else { WITHHELD.into() };
                        let t = if is_code(&t) { t } else { WITHHELD.into() };
                        (k, t)
                    })
                    .collect(),
            ),
            Self::Names(names) => Self::Names(
                names
                    .into_iter()
                    .map(|n| if is_key(&n) { n } else { WITHHELD.into() })
                    .collect(),
            ),
            Self::Path(p) if !PATH_ROOTS.iter().any(|root| p.starts_with(root)) => {
                Self::Path(WITHHELD.into())
            }
            other => other,
        }
    }
}

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

impl Report {
    /// Loads `<stem>.json`, or an empty report.
    pub fn load(stem: &Path) -> Self {
        std::fs::read_to_string(stem.with_extension("json"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_else(|| Self {
                probe: env!("CARGO_PKG_VERSION").to_owned(),
                sections: BTreeMap::new(),
            })
    }

    pub fn set_section(&mut self, name: &str, checks: Vec<Check>) {
        self.probe = env!("CARGO_PKG_VERSION").to_owned();
        self.sections.insert(
            name.to_owned(),
            Section {
                ran_at: utc_now(),
                checks,
            },
        );
    }

    /// Validates every detail, cleans every string, and returns the JSON and Markdown text,
    /// or the leaked secret's placeholder kind when cleaning wasn't enough.
    pub fn render(&self, sanitizer: &Sanitizer) -> Result<(String, String), String> {
        const LEAK: &str = "a known secret is still in the report; nothing was written";
        // Clean every string (keys and values) before serializing: in JSON text, paths would
        // be escaped and slip past a text replacement.
        // Clean first, then validate: a profile path becomes `%USERPROFILE%\…` and passes.
        let value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        let value = clean_value(value, sanitizer);
        if value_leaks(&value, sanitizer) {
            return Err(LEAK.into());
        }
        let report = serde_json::from_value::<Report>(value)
            .map_err(|e| e.to_string())?
            .validated();
        let json = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
        let markdown = report.markdown();
        if sanitizer.leak(&markdown).is_some() {
            return Err(LEAK.into());
        }
        Ok((json, markdown))
    }

    fn validated(&self) -> Self {
        let mut report = self.clone();
        for section in report.sections.values_mut() {
            for check in &mut section.checks {
                check.detail = check.detail.take().map(Detail::validated);
            }
        }
        report
    }

    /// Writes `<stem>.json` and `<stem>.md`.
    pub fn write(&self, stem: &Path, sanitizer: &Sanitizer) -> Result<PathBuf, String> {
        let (json, markdown) = self.render(sanitizer)?;
        if let Some(dir) = stem.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(stem.with_extension("json"), json).map_err(|e| e.to_string())?;
        let md = stem.with_extension("md");
        std::fs::write(&md, markdown).map_err(|e| e.to_string())?;
        Ok(md)
    }

    fn markdown(&self) -> String {
        let mut out = format!(
            "# Field report\n\ngr-probe {}. Sanitized: versions, yes/no results, status codes, header names, JSON key sets and types, timings. No hosts, users, code or values (ADR-019).\n",
            self.probe
        );
        for (name, section) in &self.sections {
            out.push_str(&format!(
                "\n## {name}\n\nRan at {}.\n\n| Check | Outcome | Detail | ms |\n| - | - | - | - |\n",
                section.ran_at
            ));
            for check in &section.checks {
                let detail = check
                    .detail
                    .as_ref()
                    .map(markdown_detail)
                    .unwrap_or_default();
                let ms = check.ms.map(|ms| ms.to_string()).unwrap_or_default();
                out.push_str(&format!(
                    "| {} | {:?} | {} | {ms} |\n",
                    check.id, check.outcome, detail
                ));
            }
        }
        out
    }
}

fn clean_value(value: Value, sanitizer: &Sanitizer) -> Value {
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

fn value_leaks(value: &Value, sanitizer: &Sanitizer) -> bool {
    match value {
        Value::String(text) => sanitizer.leak(text).is_some(),
        Value::Array(items) => items.iter().any(|item| value_leaks(item, sanitizer)),
        Value::Object(map) => map
            .iter()
            .any(|(key, item)| sanitizer.leak(key).is_some() || value_leaks(item, sanitizer)),
        _ => false,
    }
}

fn markdown_detail(detail: &Detail) -> String {
    let text = match detail {
        Detail::Bool(b) => b.to_string(),
        Detail::Number(n) => n.to_string(),
        Detail::Status(s) => s.to_string(),
        Detail::Version(v) | Detail::Code(v) | Detail::Path(v) => format!("`{v}`"),
        Detail::Keys(keys) => keys
            .iter()
            .map(|(k, t)| format!("`{k}`: {t}"))
            .collect::<Vec<_>>()
            .join(", "),
        Detail::Names(names) => names
            .iter()
            .map(|n| format!("`{n}`"))
            .collect::<Vec<_>>()
            .join(", "),
    };
    text.replace('|', "\\|")
}

/// `2026-10-11T12:34:56Z` without a date library (civil-from-days).
pub fn utc_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let days = i64::try_from(secs / 86_400).unwrap_or_default();
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sanitizer() -> Sanitizer {
        Sanitizer::default()
            .with(r"C:\Users\jan.kowalski", "%USERPROFILE%")
            .with("jan.kowalski", "<user>")
            .with("jan.kowalski@corp.example", "<email>")
            .with("mobile/mobile-app", "<project>")
            .with_host("gitlab.corp.example")
    }

    #[test]
    fn report_has_no_values_only_key_sets() {
        let body = json!({
            "id": 7, "username": "jan.kowalski", "web_url": "https://gitlab.corp.example/x",
            "approved_by": [{ "user": { "id": 1, "name": "Jan" } }], "expires_at": null
        });
        let keys = key_types(&body, 4);
        assert_eq!(keys["username"], "string");
        assert_eq!(keys["approved_by[].user.id"], "number");
        assert_eq!(keys["expires_at"], "null");
        let mut report = Report::default();
        report.set_section(
            "gitlab_read",
            vec![Check::new("user.keys", Outcome::Info).detail(Detail::Keys(keys))],
        );
        let (json, md) = report.render(&sanitizer()).unwrap();
        for text in [&json, &md] {
            assert!(!text.contains("jan"), "{text}");
            assert!(!text.contains("corp.example"), "{text}");
            assert!(text.contains("approved_by[].user.id"), "{text}");
        }
    }

    #[test]
    fn sanitizer_replaces_host_user_email_paths() {
        let s = sanitizer();
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

    #[test]
    fn details_that_are_not_their_kind_are_withheld() {
        let cases = [
            (
                Detail::Version("2.1.296 (Claude Code)".into()),
                Detail::Version("2.1.296 (Claude Code)".into()),
            ),
            (
                Detail::Version("see https://x/y".into()),
                Detail::Version(WITHHELD.into()),
            ),
            (
                Detail::Code("unknown_issuer".into()),
                Detail::Code("unknown_issuer".into()),
            ),
            (
                Detail::Code("Jan Kowalski".into()),
                Detail::Code(WITHHELD.into()),
            ),
            (
                Detail::Path(r"%USERPROFILE%\.local\bin\claude.exe".into()),
                Detail::Path(r"%USERPROFILE%\.local\bin\claude.exe".into()),
            ),
            (
                Detail::Path(r"D:\Work\Corp\app".into()),
                Detail::Path(WITHHELD.into()),
            ),
            (
                Detail::Names(vec!["x-next-page".into(), "a b".into()]),
                Detail::Names(vec!["x-next-page".into(), WITHHELD.into()]),
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(input.validated(), expected);
        }
    }

    #[test]
    fn paths_are_cleaned_although_json_escapes_backslashes() {
        let mut report = Report::default();
        report.set_section(
            "env",
            vec![Check::new(r"C:\Users\jan.kowalski\x", Outcome::Info)],
        );
        let (json, md) = report.render(&sanitizer()).unwrap();
        assert!(json.contains(r"%USERPROFILE%\\x"), "{json}");
        assert!(md.contains(r"%USERPROFILE%\x"), "{md}");
    }

    #[test]
    fn refuses_to_write_when_a_secret_survives() {
        let mut report = Report::default();
        report.set_section("x", vec![Check::new("ok", Outcome::Pass)]);
        // "İ" changes byte length when lower-cased, so cleaning falls back to exact matching
        // and misses "İstanbul"; the leak check still sees it.
        let s = Sanitizer::default().with("İSTANBUL", "<user>");
        let mut leaky = report.clone();
        leaky.sections.get_mut("x").unwrap().checks[0].id = "İstanbul".into();
        assert!(leaky.render(&s).is_err());
        assert!(report.render(&s).is_ok());
    }

    #[test]
    fn utc_now_is_iso_8601() {
        let now = utc_now();
        assert_eq!(now.len(), 20);
        assert!(now.starts_with("20") && now.ends_with('Z'), "{now}");
    }
}
