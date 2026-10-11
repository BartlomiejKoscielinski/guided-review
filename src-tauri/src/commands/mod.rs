//! `#[tauri::command]` adapters, one file per area (`app`, `source`, `sessions`, `review`, …).
//! They only translate between IPC and the core modules; command names are `area_action`.

pub mod app;
