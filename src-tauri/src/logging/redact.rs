//! Redaction of secrets in log records (NFR-08, T4): GitLab tokens by prefix, the values of
//! `PRIVATE-TOKEN`, `Authorization` and similar headers, cookies and query parameters, and
//! credentials embedded in URLs. Applied to every formatted record before it is written.

use std::borrow::Cow;
use std::sync::LazyLock;

use regex::{Captures, Regex};

/// What a redacted value is replaced with.
pub const REDACTED: &str = "[REDACTED]";

/// `scheme://user:password@` → the user info.
const URL_CREDENTIALS: &str = r"(?i)\b([a-z][a-z0-9+.\-]*://)[^/\s:@]+:[^/\s@]+@";
/// GitLab token prefixes (GitLab docs › Token prefixes, 2026-10-11) and the token body; newer
/// routable tokens contain dots.
const TOKEN: &str = r"\b(glpat|gloas|glptt|glrtr|glrt|gldt|glcbt|glft|glimt|glagent|glwt|glsoat|glffct)-[0-9A-Za-z_\-.]+";
/// Secret-carrying header, cookie and query names, a separator (`: `, `=`, JSON `": "`), then the
/// value, including an auth scheme such as `Bearer`.
const NAMED_VALUE: &str = r#"(?i)\b(private[-_]token|job[-_]token|authorization|_gitlab_session)(["']?\s*[:=]\s*["']?)((?:(?:bearer|basic|token)\s+)?[^\s"',;&}]+)"#;

struct Patterns {
    url_credentials: Regex,
    token: Regex,
    named_value: Regex,
}

#[allow(
    clippy::expect_used,
    reason = "constant patterns; every one is exercised by the tests below"
)]
static PATTERNS: LazyLock<Patterns> = LazyLock::new(|| Patterns {
    url_credentials: Regex::new(URL_CREDENTIALS).expect("URL credentials pattern"),
    token: Regex::new(TOKEN).expect("token pattern"),
    named_value: Regex::new(NAMED_VALUE).expect("named value pattern"),
});

/// Returns `text` with every secret replaced by [`REDACTED`]; borrows when nothing matched.
pub fn redact(text: &str) -> Cow<'_, str> {
    let patterns = &*PATTERNS;
    let text = patterns
        .url_credentials
        .replace_all(text, |c: &Captures| format!("{}{REDACTED}@", &c[1]));
    let text = replace_in(text, &patterns.token, |c| format!("{}-{REDACTED}", &c[1]));
    replace_in(text, &patterns.named_value, |c| {
        format!("{}{}{REDACTED}", &c[1], &c[2])
    })
}

/// `Regex::replace_all` on a `Cow`, keeping it borrowed when nothing matched.
fn replace_in<'t>(
    text: Cow<'t, str>,
    regex: &Regex,
    replacement: impl Fn(&Captures) -> String,
) -> Cow<'t, str> {
    match text {
        Cow::Borrowed(borrowed) => regex.replace_all(borrowed, replacement),
        Cow::Owned(owned) => match regex.replace_all(&owned, replacement) {
            Cow::Borrowed(_) => Cow::Owned(owned),
            Cow::Owned(replaced) => Cow::Owned(replaced),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nfr08_redacts_gitlab_token_prefixes() {
        // Prefixes from GitLab's token documentation (NFR-08 names the first four).
        let prefixes = [
            "glpat", "gloas", "glptt", "glrt", "glrtr", "gldt", "glcbt", "glft", "glimt",
            "glagent", "glwt", "glsoat", "glffct",
        ];
        for prefix in prefixes {
            let text = format!("token {prefix}-Ab3_x-9zQ1w2E3r4T5y6U7 used");
            assert_eq!(
                redact(&text),
                format!("token {prefix}-[REDACTED] used"),
                "{prefix}"
            );
        }
    }

    #[test]
    fn nfr08_redacts_routable_tokens_with_dots() {
        assert_eq!(
            redact("glpat-AbCdEfGh1234.01.0w1x2y3z4 end"),
            "glpat-[REDACTED] end"
        );
    }

    #[test]
    fn nfr08_redacts_private_token_and_authorization_values() {
        let cases = [
            ("PRIVATE-TOKEN: s3cr3t-value", "PRIVATE-TOKEN: [REDACTED]"),
            ("private-token:s3cr3t", "private-token:[REDACTED]"),
            (
                r#"{"private-token": "s3cr3t", "accept": "json"}"#,
                r#"{"private-token": "[REDACTED]", "accept": "json"}"#,
            ),
            (
                "Authorization: Bearer abc.def.ghi",
                "Authorization: [REDACTED]",
            ),
            (
                "authorization=Basic dXNlcjpwYXNz",
                "authorization=[REDACTED]",
            ),
            ("JOB-TOKEN: abc123", "JOB-TOKEN: [REDACTED]"),
            (
                "GET /api/v4/user?private_token=abc123&per_page=1",
                "GET /api/v4/user?private_token=[REDACTED]&per_page=1",
            ),
            (
                "Cookie: _gitlab_session=abc123; x=1",
                "Cookie: _gitlab_session=[REDACTED]; x=1",
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(redact(input), expected, "{input}");
        }
    }

    #[test]
    fn nfr08_redacts_credentials_in_urls() {
        assert_eq!(
            redact("remote https://oauth2:s3cr3t@gitlab.example.com/group/app.git"),
            "remote https://[REDACTED]@gitlab.example.com/group/app.git"
        );
        assert_eq!(
            redact("remote https://glpat-Ab3x9zQ1.w2E3r4T5y6U7@gitlab.example.com/a.git"),
            "remote https://glpat-[REDACTED]@gitlab.example.com/a.git"
        );
    }

    #[test]
    fn nfr08_leaves_text_without_secrets_unchanged() {
        let texts = [
            "window placement failed; showing the window where it is",
            "glob pattern src/**/*.cs matched 12 files",
            "masked token glpat-…3f9a for user",
            "https://gitlab.example.com/group/app/-/merge_requests/482",
            "Authorization header missing",
            "C:\\Users\\Zażółć gęślą\\AppData\\Roaming\\GuidedReview",
        ];
        for text in texts {
            let out = redact(text);
            assert!(matches!(out, Cow::Borrowed(_)), "{text}");
            assert_eq!(out, text);
        }
    }

    #[test]
    fn nfr08_redacts_every_occurrence_on_a_line() {
        assert_eq!(
            redact("a glpat-aaaaaaaaaa.aaaaaaaaaa b PRIVATE-TOKEN: x c glrt-bbbbbbbbbbbb"),
            "a glpat-[REDACTED] b PRIVATE-TOKEN: [REDACTED] c glrt-[REDACTED]"
        );
    }
}
