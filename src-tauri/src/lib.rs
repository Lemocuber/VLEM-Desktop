use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRequest {
    link: String,
    mode: String,
    routing: String,
    socks_port: u16,
    http_port: u16,
}

#[derive(Debug, Serialize)]
struct NativeError {
    message: String,
}

impl From<&str> for NativeError {
    fn from(message: &str) -> Self {
        Self {
            message: message.to_string(),
        }
    }
}

#[tauri::command]
fn start_proxy(request: StartRequest) -> Result<(), NativeError> {
    let _ = (
        request.link,
        request.mode,
        request.routing,
        request.socks_port,
        request.http_port,
    );
    Err("Native Xray start is not implemented yet.".into())
}

#[tauri::command]
fn stop_proxy() -> Result<(), NativeError> {
    Ok(())
}

#[tauri::command]
fn measure_delay(link: String) -> Result<i32, NativeError> {
    let _ = link;
    Ok(-1)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("VLEM")?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_proxy,
            stop_proxy,
            measure_delay
        ])
        .run(tauri::generate_context!())
        .expect("error while running VLEM");
}
