//! S7 spike: deep link + single instance, toasts (plugin, tauri-winrt-notification, toast XML
//! with protocol buttons), tray window positioning. Every event is appended to
//! `%TEMP%\gr-s7-spike.log` so results can be read without the UI.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_positioner::{Position, WindowExt};

const AUMID: &str = "com.inpost.guidedreview";

fn log(line: impl AsRef<str>) {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let path = std::env::temp_dir().join("gr-s7-spike.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{ms} pid={} {}", std::process::id(), line.as_ref());
    }
}

#[tauri::command]
fn toast_plugin(app: AppHandle) -> Result<String, String> {
    app.notification()
        .builder()
        .title("S7 plugin toast")
        .body("tauri-plugin-notification in a dev build")
        .show()
        .map_err(|e| e.to_string())?;
    log("toast_plugin shown");
    Ok("shown".into())
}

#[tauri::command]
fn toast_winrt() -> Result<String, String> {
    tauri_winrt_notification::Toast::new(AUMID)
        .title("S7 winrt toast")
        .text1("tauri-winrt-notification with the app's AUMID")
        .add_button("Start review", "start")
        .add_button("Later", "later")
        .on_activated(|action| {
            log(format!("toast_winrt activated action={action:?}"));
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())?;
    log("toast_winrt shown");
    Ok("shown".into())
}

#[tauri::command]
fn toast_xml() -> Result<String, String> {
    toast_xml_with("")
}

fn toast_xml_with(scenario: &str) -> Result<String, String> {
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    use windows::core::HSTRING;
    let xml = r#"<toast SCENARIO activationType="protocol" launch="guidedreview://mr/482?from=toast-body">
  <visual><binding template="ToastGeneric">
    <text>MR !482 needs your review</text>
    <text>Offline queue for delivery photos · Marta K.</text>
  </binding></visual>
  <actions>
    <action content="Start review" activationType="protocol" arguments="guidedreview://mr/482?from=toast-button"/>
    <action content="Later" activationType="protocol" arguments="guidedreview://snooze?minutes=30"/>
  </actions>
</toast>"#;
    let doc = XmlDocument::new().map_err(|e| e.to_string())?;
    let xml = xml.replace("SCENARIO", scenario);
    doc.LoadXml(&HSTRING::from(xml)).map_err(|e| e.to_string())?;
    let toast = ToastNotification::CreateToastNotification(&doc).map_err(|e| e.to_string())?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID))
        .map_err(|e| e.to_string())?;
    notifier.Show(&toast).map_err(|e| e.to_string())?;
    log("toast_xml shown");
    Ok("shown".into())
}

fn toggle_tray_window(app: &AppHandle, rect: tauri::Rect) {
    let Some(window) = app.get_webview_window("tray") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        log("tray window hidden");
        return;
    }
    let moved = window.move_window(Position::TrayBottomCenter);
    let _ = window.show();
    let _ = window.set_focus();
    let outer = window.outer_position().ok();
    let size = window.outer_size().ok();
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| (m.work_area().position, m.work_area().size, m.scale_factor()));
    log(format!(
        "tray window shown moved={moved:?} icon_rect={rect:?} window_pos={outer:?} window_size={size:?} monitor_work_area={monitor:?}"
    ));
}

fn main() {
    log(format!("start args={:?}", std::env::args().collect::<Vec<_>>()));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            log(format!("single-instance argv={argv:?} cwd={cwd}"));
            // Spike control: `gr-s7-spike.exe --toast plugin|winrt|xml` from a second instance.
            if argv.get(1).map(String::as_str) == Some("--toast") {
                let kind = argv.get(2).cloned().unwrap_or_default();
                let app = app.clone();
                let run = move || match kind.as_str() {
                    "plugin" => toast_plugin(app),
                    "winrt" | "winrt-inline" => toast_winrt(),
                    "xml" | "xml-inline" => toast_xml(),
                    "xml-reminder" => toast_xml_with(r#"scenario="reminder""#),
                    other => Err(format!("unknown toast {other:?}")),
                };
                if argv.get(2).is_some_and(|k| k.ends_with("-inline")) {
                    // In the single-instance callback itself (window procedure of WM_COPYDATA).
                    log(format!("toast request (inline) result={:?}", run()));
                } else {
                    std::thread::spawn(move || log(format!("toast request (thread) result={:?}", run())));
                }
                return;
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            let registered = app.deep_link().register_all();
            log(format!("deep-link register_all={registered:?}"));
            log(format!("deep-link get_current={:?}", app.deep_link().get_current()));
            app.deep_link().on_open_url(|event| {
                log(format!("deep-link on_open_url urls={:?}", event.urls()));
            });
            let tray_window = WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("tray.html".into()))
                .title("tray")
                .inner_size(410.0, 520.0)
                .decorations(false)
                .resizable(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .visible(false)
                .build()?;
            let hide_on_blur = tray_window.clone();
            tray_window.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    let _ = hide_on_blur.hide();
                    log("tray window hidden on blur");
                }
            });
            TrayIconBuilder::with_id("s7")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("Guided Review S7 spike")
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        position,
                        ..
                    } = event
                    {
                        log(format!("tray click position={position:?}"));
                        toggle_tray_window(tray.app_handle(), rect);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![toast_plugin, toast_winrt, toast_xml])
        .run(tauri::generate_context!())
        .expect("error while running the S7 spike");
}
