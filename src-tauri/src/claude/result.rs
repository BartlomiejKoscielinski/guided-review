//! The result message of a `claude -p` run (docs/05 › Claude Code): the single JSON object of
//! `--output-format json`, or the last `"type":"result"` line of stream-json. Failure is read
//! from `is_error`, `terminal_reason` and `api_error_status`, never from `subtype` (S1).
//! Errors map to `CLAUDE_*` codes in `error.rs`.

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ClaudeResult {
    #[serde(default)]
    pub is_error: bool,
    pub result: Option<String>,
    pub structured_output: Option<Value>,
    pub session_id: Option<String>,
    pub terminal_reason: Option<String>,
    pub api_error_status: Option<u16>,
    #[serde(default)]
    pub permission_denials: Vec<Value>,
    pub total_cost_usd: Option<f64>,
}

/// The result message and its raw JSON, or `None` when stdout holds no result (a killed
/// process, a flag error printed to stderr).
pub fn parse_result(stdout: &str) -> Option<(ClaudeResult, Value)> {
    stdout.lines().rev().find_map(|line| {
        let raw: Value = serde_json::from_str(line.trim()).ok()?;
        if raw.get("type").and_then(Value::as_str) != Some("result") {
            return None;
        }
        let parsed = serde_json::from_value(raw.clone()).ok()?;
        Some((parsed, raw))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_a_json_result_with_structured_output() {
        let stdout = json!({
            "type": "result", "subtype": "success", "is_error": false, "result": "",
            "structured_output": { "word": "HELLO" }, "session_id": "s-1",
            "terminal_reason": "completed", "permission_denials": [], "total_cost_usd": 0.01
        })
        .to_string();
        let (result, raw) = parse_result(&stdout).unwrap();
        assert!(!result.is_error);
        assert_eq!(result.structured_output, Some(json!({ "word": "HELLO" })));
        assert_eq!(result.session_id.as_deref(), Some("s-1"));
        assert_eq!(raw["subtype"], "success");
    }

    #[test]
    fn subtype_success_with_is_error_is_still_an_error() {
        let stdout = r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"limit"}"#;
        let (result, _) = parse_result(stdout).unwrap();
        assert!(result.is_error);
        assert_eq!(result.api_error_status, Some(429));
    }

    #[test]
    fn takes_the_last_result_line_of_stream_json() {
        let stdout = concat!(
            r#"{"type":"system","subtype":"init","tools":[]}"#,
            "\n",
            r#"{"type":"assistant","message":{}}"#,
            "\n",
            r#"{"type":"result","is_error":false,"session_id":"s-2","permission_denials":[{"tool_name":"Read"}]}"#,
            "\n"
        );
        let (result, _) = parse_result(stdout).unwrap();
        assert_eq!(result.session_id.as_deref(), Some("s-2"));
        assert_eq!(result.permission_denials.len(), 1);
    }

    #[test]
    fn no_result_in_empty_or_foreign_output() {
        assert_eq!(parse_result(""), None);
        assert_eq!(parse_result("error: unknown option '--x'"), None);
        assert_eq!(parse_result(r#"{"type":"system"}"#), None);
    }
}
