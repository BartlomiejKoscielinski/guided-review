//! Guided Review core. All logic lives in the modules below and is testable without Tauri;
//! `commands/` holds the thin `#[tauri::command]` adapters (docs/04-architecture.md).

pub mod claude;
pub mod commands;
pub mod error;
pub mod git;
pub mod gitlab;
pub mod nav;
pub mod os;
pub mod review;
pub mod store;

/// Builds and runs the Tauri app.
#[allow(
    clippy::expect_used,
    reason = "app startup: without its Tauri context the app cannot run"
)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::app::app_health])
        .run(tauri::generate_context!())
        .expect("error while running Guided Review");
}
