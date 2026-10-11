//! Test helper for `tests/process.rs`: a child process with scripted behaviour.
//!
//! Modes (first argument):
//! - `echo-stdin`: copies stdin to stdout.
//! - `argv <args…>`: prints the remaining arguments as a JSON array.
//! - `utf8`: prints Polish text with CRLF and LF line ends.
//! - `invalid-utf8`: prints bytes that are not UTF-8.
//! - `env <name>`: prints the variable's value or `<unset>`.
//! - `exit <code>`: exits with the code, writing `STDERR-CANARY` to stderr.
//! - `sleep <seconds>`: sleeps.
//! - `tree <pid file>`: starts a grandchild (`sleep 120`, inheriting stdout), writes
//!   "<own pid> <grandchild pid>" to the file, then sleeps.
//! - `spawn-and-exit <pid file>`: like `tree`, but exits right after writing the file.

use std::io::{Read, Write};
use std::process::{Command, ExitCode};
use std::time::Duration;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = args.first().map(String::as_str).unwrap_or("");
    let rest = &args[args.len().min(1)..];
    let mut out = std::io::stdout();
    match mode {
        "echo-stdin" => {
            let mut input = Vec::new();
            if std::io::stdin().read_to_end(&mut input).is_err() {
                return ExitCode::from(3);
            }
            let _ = out.write_all(&input);
        }
        "argv" => {
            let json = serde_json::to_string(rest).unwrap_or_default();
            let _ = out.write_all(json.as_bytes());
        }
        "utf8" => {
            let _ = out.write_all("zażółć gęślą jaźń\r\nZAŻÓŁĆ\n".as_bytes());
        }
        "invalid-utf8" => {
            let _ = out.write_all(&[0x66, 0xff, 0x6f]);
        }
        "env" => {
            let name = rest.first().map(String::as_str).unwrap_or("");
            let value = std::env::var(name).unwrap_or_else(|_| "<unset>".into());
            let _ = out.write_all(value.as_bytes());
        }
        "exit" => {
            let code = rest.first().and_then(|c| c.parse().ok()).unwrap_or(1);
            let _ = std::io::stderr().write_all(b"STDERR-CANARY");
            return ExitCode::from(code);
        }
        "sleep" => {
            let seconds = rest.first().and_then(|s| s.parse().ok()).unwrap_or(60);
            std::thread::sleep(Duration::from_secs(seconds));
        }
        "tree" | "spawn-and-exit" => {
            let Some(pid_file) = rest.first() else {
                return ExitCode::from(2);
            };
            let Ok(exe) = std::env::current_exe() else {
                return ExitCode::from(2);
            };
            let Ok(grandchild) = Command::new(exe).args(["sleep", "120"]).spawn() else {
                return ExitCode::from(4);
            };
            let pids = format!("{} {}", std::process::id(), grandchild.id());
            if std::fs::write(pid_file, pids).is_err() {
                return ExitCode::from(5);
            }
            if mode == "tree" {
                std::thread::sleep(Duration::from_secs(120));
            }
        }
        _ => return ExitCode::from(2),
    }
    ExitCode::SUCCESS
}
