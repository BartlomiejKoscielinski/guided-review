//! Windows integration: child processes (`process.rs`), credentials, Rider, deep links, notifications, autostart.

pub mod cancel;
pub mod credentials;
#[cfg(windows)]
mod job;
pub mod paths;
pub mod process;
pub mod rider;
pub mod rider_pick;
pub mod window;
