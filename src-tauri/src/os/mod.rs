//! Windows integration: child processes (`process.rs`), credentials, Rider, deep links, notifications, autostart.

#[cfg(windows)]
mod job;
pub mod paths;
pub mod process;
pub mod window;
