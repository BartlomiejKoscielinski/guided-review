//! The job log of S-08 (F-20.5, M6 decision 10): a GitLab job trace as plain text lines. ANSI
//! escapes and GitLab's `section_start` / `section_end` markers are removed (a line that held only
//! a `section_end` vanishes), the last [`MAX_LINES`] lines are kept (`truncated` when lines were
//! cut), and each line is a command, a pass, an error or plain. [`follow`] re-reads the trace
//! while the job runs and hands on only the new lines. Text only: the UI never renders it as HTML.

use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::jobs;

/// The most lines the log panel shows (S-08 "log too long").
pub const MAX_LINES: usize = 500;

/// How often a running job's trace is read again (plan M6).
pub const FOLLOW_INTERVAL: Duration = Duration::from_secs(3);

/// The job statuses in which the trace can still grow.
const UNFINISHED: [&str; 5] = [
    "created",
    "pending",
    "waiting_for_resource",
    "preparing",
    "running",
];

/// What a log line is (decision 10); the UI colors it from tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LogKind {
    Command,
    Pass,
    Error,
    Plain,
}

/// One line of the log, its text without escapes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct LogLine {
    pub kind: LogKind,
    pub text: String,
}

/// A whole trace as the panel shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLog {
    pub lines: Vec<LogLine>,
    pub truncated: bool,
}

/// One message of the `job_trace` stream: `replace` starts the log over (the first event, or
/// more new lines than the panel keeps), else `lines` are appended; `done` ends the stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct JobLogEvent {
    pub lines: Vec<LogLine>,
    pub replace: bool,
    pub truncated: bool,
    pub done: bool,
}

/// The foreground color a visible character was printed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fg {
    Default,
    Red,
    Green,
    Other,
}

/// Which signal colors a line showed.
#[derive(Debug, Default, Clone, Copy)]
struct Colors {
    red: bool,
    green: bool,
}

/// The trace `raw` as the panel shows it: the last [`MAX_LINES`] lines.
pub fn parse_trace(raw: &str) -> ParsedLog {
    let mut lines = parse_lines(raw);
    let truncated = lines.len() > MAX_LINES;
    if truncated {
        lines.drain(..lines.len() - MAX_LINES);
    }
    ParsedLog { lines, truncated }
}

/// Every line of `raw` (a trailing newline adds none).
pub fn parse_lines(raw: &str) -> Vec<LogLine> {
    if raw.is_empty() {
        return Vec::new();
    }
    let body = raw.strip_suffix('\n').unwrap_or(raw);
    body.split('\n').filter_map(clean_line).collect()
}

/// One raw line as text and kind; `None` for a line that held only section markers.
fn clean_line(raw: &str) -> Option<LogLine> {
    let (without, had_marker) = strip_sections(raw);
    let mut colors = Colors::default();
    let stripped = strip_ansi(&without, &mut colors);
    // A carriage return overwrites the line on a terminal: what was written last shows.
    let text = stripped
        .split('\r')
        .rfind(|part| !part.is_empty())
        .unwrap_or("")
        .to_owned();
    if had_marker && text.trim().is_empty() {
        return None;
    }
    let kind = classify(&text, colors);
    Some(LogLine { kind, text })
}

/// Removes every `section_start:<ts>:<name>…\r` and `section_end:<ts>:<name>…\r` marker.
fn strip_sections(line: &str) -> (String, bool) {
    let mut rest = line;
    let mut out = String::with_capacity(line.len());
    let mut found = false;
    while let Some(at) = marker_at(rest) {
        out.push_str(&rest[..at]);
        let after = &rest[at..];
        rest = match after.find('\r') {
            Some(cr) => &after[cr + 1..],
            None => "",
        };
        found = true;
    }
    out.push_str(rest);
    (out, found)
}

/// Where the first GitLab section marker in `text` starts (a prefix followed by a digit).
fn marker_at(text: &str) -> Option<usize> {
    ["section_start:", "section_end:"]
        .iter()
        .filter_map(|prefix| {
            text.match_indices(prefix)
                .find(|(at, _)| {
                    text[at + prefix.len()..]
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_ascii_digit())
                })
                .map(|(at, _)| at)
        })
        .min()
}

/// The text of `line` without escape sequences and control characters (tabs and carriage
/// returns stay); notes whether visible text was printed red or green.
fn strip_ansi(line: &str, colors: &mut Colors) -> String {
    let mut out = String::with_capacity(line.len());
    let mut fg = Fg::Default;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    let mut params = String::new();
                    for p in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&p) {
                            if p == 'm' {
                                fg = apply_sgr(&params, fg);
                            }
                            break;
                        }
                        params.push(p);
                    }
                }
                Some(']') => {
                    // OSC: up to BEL or ESC \.
                    chars.next();
                    while let Some(p) = chars.next() {
                        if p == '\u{7}' || (p == '\u{1b}' && chars.next_if_eq(&'\\').is_some()) {
                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            }
            continue;
        }
        if c.is_control() && c != '\t' && c != '\r' {
            continue;
        }
        if !c.is_whitespace() {
            match fg {
                Fg::Red => colors.red = true,
                Fg::Green => colors.green = true,
                Fg::Default | Fg::Other => {}
            }
        }
        out.push(c);
    }
    out
}

/// The foreground color after the SGR parameters `params` (`31;1`, `0;`, `39`).
fn apply_sgr(params: &str, mut fg: Fg) -> Fg {
    for param in params.split(';') {
        fg = match param.trim() {
            "" | "0" | "39" => Fg::Default,
            "31" | "91" => Fg::Red,
            "32" | "92" => Fg::Green,
            "30" | "33" | "34" | "35" | "36" | "37" | "90" | "93" | "94" | "95" | "96" | "97" => {
                Fg::Other
            }
            _ => fg,
        };
    }
    fg
}

/// Decision 10: a command starts with `$ `; an error is red or starts with an error word or holds
/// ` error ` / `Error:`; a pass is green or starts with a pass word; else plain. Leading spaces do
/// not hide a prefix; a command beats an error, an error beats a pass.
fn classify(text: &str, colors: Colors) -> LogKind {
    let t = text.trim_start();
    if t.starts_with("$ ") {
        LogKind::Command
    } else if colors.red
        || ["ERROR", "error", "Failed", "FAIL"]
            .iter()
            .any(|p| t.starts_with(p))
        || t.contains(" error ")
        || t.contains("Error:")
    {
        LogKind::Error
    } else if colors.green
        || ["\u{2714}", "Passed", "PASS", "Job succeeded"]
            .iter()
            .any(|p| t.starts_with(p))
    {
        LogKind::Pass
    } else {
        LogKind::Plain
    }
}

/// The part of `raw` up to its last newline: a running job may still be writing the last line.
fn complete_lines(raw: &str) -> &str {
    raw.rfind('\n').map_or("", |at| &raw[..=at])
}

/// An event for `lines`, keeping the last [`MAX_LINES`]; a cut always starts the log over.
fn event_of(lines: &[LogLine], replace: bool, done: bool) -> JobLogEvent {
    let truncated = lines.len() > MAX_LINES;
    let start = lines.len().saturating_sub(MAX_LINES);
    JobLogEvent {
        lines: lines[start..].to_vec(),
        replace: replace || truncated,
        truncated,
        done,
    }
}

/// Streams the log of job `job_id`: each round reads the job, then its trace; the first round
/// sends the whole log (`replace`), later rounds only the new lines (nothing when there are
/// none), and the round that sees the job finished sends `done` and ends. `emit` returning false
/// (nobody listens any more) ends it too. A GitLab error ends it with that error.
pub async fn follow<F>(
    client: &GitlabClient,
    project: &str,
    job_id: u64,
    interval: Duration,
    mut emit: F,
) -> Result<(), GitlabError>
where
    F: FnMut(JobLogEvent) -> bool,
{
    let mut sent: Option<usize> = None;
    loop {
        let job = jobs::job(client, project, job_id).await?;
        let finished = !UNFINISHED.contains(&job.status.as_str());
        let raw = jobs::trace(client, project, job_id).await?;
        let lines = parse_lines(if finished { &raw } else { complete_lines(&raw) });
        let event = match sent {
            // The trace only grows; a shorter one (erased or replaced) starts the log over.
            Some(count) if count <= lines.len() => {
                let new = &lines[count..];
                (finished || !new.is_empty()).then(|| event_of(new, false, finished))
            }
            _ => Some(event_of(&lines, true, finished)),
        };
        sent = Some(lines.len());
        if let Some(event) = event
            && !emit(event)
        {
            return Ok(());
        }
        if finished {
            return Ok(());
        }
        tokio::time::sleep(interval).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_partial_last_line_is_held_back_while_running() {
        assert_eq!(complete_lines("a\nb"), "a\n");
        assert_eq!(complete_lines("a"), "");
    }

    #[test]
    fn a_section_marker_in_the_middle_of_a_line_is_removed() {
        let (text, found) = strip_sections("x section_end:1:a\r\u{1b}[0Ksection_start:2:b\rok");
        assert!(found);
        assert_eq!(text, "x \u{1b}[0Kok");
        assert!(!strip_sections("section_start:abc").1);
    }

    #[test]
    fn a_carriage_return_keeps_what_was_written_last() {
        let line = clean_line("10%\r50%\r100%\r").unwrap();
        assert_eq!(line.text, "100%");
    }

    #[test]
    fn a_reset_color_before_the_text_does_not_color_it() {
        let line = clean_line("\u{1b}[31m\u{1b}[0mfine").unwrap();
        assert_eq!(line.kind, LogKind::Plain);
    }

    #[test]
    fn more_new_lines_than_the_panel_keeps_start_the_log_over() {
        let lines: Vec<LogLine> = (0..=MAX_LINES)
            .map(|n| LogLine {
                kind: LogKind::Plain,
                text: n.to_string(),
            })
            .collect();
        let event = event_of(&lines, false, false);
        assert!(event.replace && event.truncated);
        assert_eq!(event.lines.len(), MAX_LINES);
    }
}
