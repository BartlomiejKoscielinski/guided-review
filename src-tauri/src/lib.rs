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
pub mod route;
pub mod settings;
pub mod store;

/// Builds and runs the Tauri app.
#[allow(
    clippy::expect_used,
    reason = "app startup: without its Tauri context the app cannot run"
)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            let app_data = os::paths::app_data_dir()?;
            let store = store::Store::open(&os::paths::db_path(&app_data))?;
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_health,
            commands::app::app_settings_get,
            commands::app::app_settings_set,
            commands::app::app_start_route,
            commands::sessions::sessions_list_unfinished,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Guided Review");
}
