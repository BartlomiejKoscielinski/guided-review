//! Windows integration: child processes (`process.rs`), credentials, Rider, deep links, notifications, autostart.

pub mod cancel;
#[cfg(windows)]
mod job;
pub mod paths;
pub mod process;
pub mod window;
