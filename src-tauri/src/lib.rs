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

use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_window_state::{StateFlags, WindowExt};

use os::window::{MonitorArea, Rect, fit_window};

/// Geometry the window-state plugin keeps between runs (F-30.4); its file lives in
/// `%APPDATA%\com.inpost.guidedreview\` (ADR-020).
fn window_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

/// Restores the main window's size and position, fits it onto a monitor, restores the
/// maximized state, then shows it. The window is created hidden, so none of this flickers,
/// and it is shown even when placement fails.
fn show_main_window(window: &WebviewWindow) {
    if let Err(error) = place_main_window(window) {
        tracing::warn!(%error, "window placement failed; showing the window where it is");
    }
    if let Err(error) = window.show().and_then(|()| window.set_focus()) {
        tracing::error!(%error, "the main window could not be shown");
    }
}

fn place_main_window(window: &WebviewWindow) -> tauri::Result<()> {
    // tao sizes an undecorated window by its window-minus-client offset, which on the hidden,
    // never-shown window still includes the 30px caption: every restore grew the window by
    // that much. Toggling decorations makes Windows recompute the frame first (tao 0.37.1).
    window.set_decorations(true)?;
    window.set_decorations(false)?;
    window.restore_state(StateFlags::SIZE | StateFlags::POSITION)?;
    // Place the client area: an undecorated window is all client area, while its outer rect
    // also has invisible resize borders (8px on Windows 11) that may lie off the work area.
    let outer = window.outer_position()?;
    let inner = window.inner_position()?;
    let size = window.inner_size()?;
    let current = Rect::new(inner.x, inner.y, size.width, size.height);
    let monitors = window.available_monitors()?;
    let areas: Vec<MonitorArea> = monitors
        .iter()
        .map(|m| {
            let work = m.work_area();
            MonitorArea {
                work: Rect::new(
                    work.position.x,
                    work.position.y,
                    work.size.width,
                    work.size.height,
                ),
                scale: m.scale_factor(),
            }
        })
        .collect();
    let primary = window
        .primary_monitor()?
        .and_then(|p| {
            monitors
                .iter()
                .position(|m| m.position() == p.position() && m.size() == p.size())
        })
        .unwrap_or(0);
    if let Some(placement) = fit_window(current, &areas, primary) {
        let (min_width, min_height) = placement.min_size_logical();
        // The config already sets 1280×800; only a smaller work area needs a lower minimum.
        if (min_width, min_height) != os::window::MIN_SIZE {
            window.set_min_size(Some(LogicalSize::new(min_width, min_height)))?;
        }
        if placement.rect != current {
            let rect = placement.rect;
            window.set_size(PhysicalSize::new(rect.width, rect.height))?;
            window.set_position(PhysicalPosition::new(
                rect.x - (inner.x - outer.x),
                rect.y - (inner.y - outer.y),
            ))?;
        }
    }
    window.restore_state(StateFlags::MAXIMIZED)?;
    Ok(())
}

/// Builds and runs the Tauri app.
#[allow(
    clippy::expect_used,
    reason = "app startup: without its Tauri context the app cannot run"
)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .skip_initial_state("main")
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                show_main_window(&window);
            }
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
