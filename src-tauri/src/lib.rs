use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use url::Url;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRequest {
    link: String,
    mode: String,
    routing: String,
    socks_port: u16,
    http_port: u16,
}

struct RuntimeState {
    child: Option<Child>,
    pid_file: Option<PathBuf>,
    mode: String,
}

type SharedRuntime = Mutex<Option<RuntimeState>>;

#[derive(Debug)]
struct Node {
    id: String,
    host: String,
    port: u16,
    flow: Option<String>,
    network: String,
    security: String,
    public_key: String,
    fingerprint: String,
    server_name: String,
    short_id: Option<String>,
    spider_x: Option<String>,
}

#[tauri::command]
fn start_proxy(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    request: StartRequest,
) -> Result<(), String> {
    stop_current(&app, runtime.inner())?;

    let node = parse_vless(&request.link)?;
    let app_dir = app_data_dir(&app)?;
    fs::create_dir_all(&app_dir).map_err(|err| format!("Create app data failed: {err}"))?;
    let config_path = app_dir.join("xray.json");
    let log_path = app_dir.join("xray.log");
    let pid_file = app_dir.join("xray.pid");
    let xray = xray_path(&app)?;
    let asset_dir = xray
        .parent()
        .ok_or_else(|| "Invalid Xray binary path.".to_string())?
        .to_path_buf();

    let config = xray_config(&node, &request);
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&config).map_err(|err| format!("Serialize Xray config failed: {err}"))?,
    )
    .map_err(|err| format!("Write Xray config failed: {err}"))?;

    if request.mode == "tun" {
        start_tun_xray(&xray, &asset_dir, &config_path, &log_path, &pid_file)?;
        wait_for_pid(&pid_file)?;
        *runtime.lock().map_err(|_| "Runtime lock failed.".to_string())? = Some(RuntimeState {
            child: None,
            pid_file: Some(pid_file),
            mode: request.mode,
        });
        Ok(())
    } else {
        let log = fs::File::create(&log_path).map_err(|err| format!("Open Xray log failed: {err}"))?;
        let mut child = Command::new(&xray)
            .arg("run")
            .arg("-config")
            .arg(&config_path)
            .current_dir(&asset_dir)
            .env("XRAY_LOCATION_ASSET", &asset_dir)
            .stdout(log.try_clone().map_err(|err| format!("Clone Xray log failed: {err}"))?)
            .stderr(log)
            .spawn()
            .map_err(|err| format!("Start Xray failed: {err}"))?;
        std::thread::sleep(Duration::from_millis(250));
        if let Some(status) = child.try_wait().map_err(|err| format!("Check Xray failed: {err}"))? {
            let log = fs::read_to_string(&log_path).unwrap_or_default();
            return Err(format!("Xray exited early with {status}. {}", log.trim()));
        }
        set_system_proxy(request.socks_port, request.http_port)?;
        *runtime.lock().map_err(|_| "Runtime lock failed.".to_string())? = Some(RuntimeState {
            child: Some(child),
            pid_file: None,
            mode: request.mode,
        });
        Ok(())
    }
}

#[tauri::command]
fn stop_proxy(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>) -> Result<(), String> {
    stop_current(&app, runtime.inner())
}

fn stop_current(app: &tauri::AppHandle, runtime: &SharedRuntime) -> Result<(), String> {
    let state = runtime.lock().map_err(|_| "Runtime lock failed.".to_string())?.take();
    if let Some(mut state) = state {
        if state.mode == "system" {
            clear_system_proxy()?;
        }
        if let Some(mut child) = state.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(pid_file) = state.pid_file.take() {
            stop_privileged_pid(&pid_file)?;
        }
    } else {
        let pid_file = app_data_dir(&app)?.join("xray.pid");
        if pid_file.exists() {
            stop_privileged_pid(&pid_file)?;
        }
        clear_system_proxy()?;
    }
    Ok(())
}

#[tauri::command]
fn measure_delay(link: String) -> Result<i32, String> {
    let node = parse_vless(&link)?;
    let start = Instant::now();
    let addr = (node.host.as_str(), node.port)
        .to_socket_addrs()
        .map_err(|_| "Resolve failed.".to_string())?
        .next()
        .ok_or_else(|| "Resolve failed.".to_string())?;
    match TcpStream::connect_timeout(&addr, Duration::from_secs(3)) {
        Ok(_) => Ok(start.elapsed().as_millis().min(i32::MAX as u128) as i32),
        Err(_) => Ok(-1),
    }
}

fn parse_vless(link: &str) -> Result<Node, String> {
    let url = Url::parse(link).map_err(|err| format!("Invalid VLESS URL: {err}"))?;
    if url.scheme() != "vless" {
        return Err("Only VLESS links are supported.".into());
    }
    let id = url.username().to_string();
    let host = url.host_str().ok_or_else(|| "Missing VLESS host.".to_string())?.to_string();
    let port = url.port().ok_or_else(|| "Missing VLESS port.".to_string())?;
    let query = |key: &str| {
        url.query_pairs()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.to_string())
    };
    let network = query("type").unwrap_or_else(|| "tcp".into());
    let security = query("security").unwrap_or_else(|| "reality".into());
    if id.is_empty() || network != "tcp" || security != "reality" {
        return Err("Only VLESS Reality TCP links are supported.".into());
    }
    Ok(Node {
        id,
        host: host.clone(),
        port,
        flow: query("flow"),
        network,
        security,
        public_key: query("pbk").ok_or_else(|| "Missing Reality public key.".to_string())?,
        fingerprint: query("fp").unwrap_or_else(|| "chrome".into()),
        server_name: query("sni").unwrap_or(host),
        short_id: query("sid"),
        spider_x: query("spx"),
    })
}

fn xray_config(node: &Node, request: &StartRequest) -> Value {
    let dns_servers = if request.routing == "smart" {
        json!(["localhost", "8.8.8.8"])
    } else {
        json!(["8.8.8.8", "1.1.1.1"])
    };
    let mut inbounds = vec![
        json!({
            "tag": "socks",
            "listen": "127.0.0.1",
            "port": request.socks_port,
            "protocol": "socks",
            "settings": { "udp": true },
            "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
        }),
        json!({
            "tag": "http",
            "listen": "127.0.0.1",
            "port": request.http_port,
            "protocol": "http",
            "sniffing": { "enabled": true, "destOverride": ["http", "tls"] }
        }),
    ];

    if request.mode == "tun" {
        inbounds.push(json!({
            "tag": "tun",
            "protocol": "tun",
            "settings": {
                "name": format!("utun{}", unix_nanos() % 90 + 10),
                "MTU": 9000,
                "gateway": ["172.18.0.1/30"],
                "dns": ["172.18.0.1"],
                "autoSystemRoutingTable": ["0.0.0.0/0"],
                "autoOutboundsInterface": "auto"
            },
            "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
        }));
    }

    json!({
        "log": { "loglevel": "warning" },
        "dns": {
            "servers": dns_servers
        },
        "inbounds": inbounds,
        "outbounds": [
            {
                "tag": "proxy",
                "protocol": "vless",
                "settings": {
                    "vnext": [{
                        "address": node.host,
                        "port": node.port,
                        "users": [{
                            "id": node.id,
                            "encryption": "none",
                            "flow": node.flow
                        }]
                    }]
                },
                "streamSettings": {
                    "network": node.network,
                    "security": node.security,
                    "realitySettings": {
                        "serverName": node.server_name,
                        "fingerprint": node.fingerprint,
                        "publicKey": node.public_key,
                        "shortId": node.short_id,
                        "spiderX": node.spider_x
                    }
                }
            },
            { "tag": "direct", "protocol": "freedom" },
            { "tag": "block", "protocol": "blackhole" }
        ],
        "routing": {
            "domainStrategy": "IPIfNonMatch",
            "rules": routing_rules(request.routing == "smart")
        }
    })
}

fn routing_rules(smart: bool) -> Vec<Value> {
    let mut rules = vec![
        json!({ "network": "udp", "port": "135,137-139,5353", "outboundTag": "block" }),
        json!({ "ip": ["224.0.0.0/3", "ff00::/8"], "outboundTag": "block" }),
    ];
    if smart {
        rules.push(json!({ "ip": ["geoip:private", "geoip:cn"], "outboundTag": "direct" }));
        rules.push(json!({ "domain": ["geosite:private", "geosite:cn"], "outboundTag": "direct" }));
    }
    rules
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Resolve app data directory failed: {err}"))
}

fn xray_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|err| format!("Resolve resource directory failed: {err}"))?;
    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            vec!["bin/xray-macos-arm64/xray", "bin/xray-macos-64/xray"]
        } else {
            vec!["bin/xray-macos-64/xray", "bin/xray-macos-arm64/xray"]
        }
    } else if cfg!(target_os = "windows") {
        vec!["bin/xray-windows-64/xray.exe"]
    } else {
        vec!["bin/xray"]
    };
    candidates
        .into_iter()
        .flat_map(|name| [resource_dir.join(name), dev_dir.join(name)])
        .find(|path| path.exists())
        .ok_or_else(|| format!("Xray binary is missing under {}.", resource_dir.display()))
}

fn start_tun_xray(
    xray: &Path,
    asset_dir: &Path,
    config_path: &Path,
    log_path: &Path,
    pid_file: &Path,
) -> Result<(), String> {
    let script = format!(
        "cd {} && chmod +x {} && XRAY_LOCATION_ASSET={} nohup {} run -config {} > {} 2>&1 & echo $! > {}",
        sh(asset_dir),
        sh(xray),
        sh(asset_dir),
        sh(xray),
        sh(config_path),
        sh(log_path),
        sh(pid_file)
    );
    run_osascript_admin(&script)
}

fn stop_privileged_pid(pid_file: &Path) -> Result<(), String> {
    let script = format!(
        "if [ -f {} ]; then pid=$(cat {}); kill \"$pid\" 2>/dev/null || true; sleep 1; kill -9 \"$pid\" 2>/dev/null || true; rm -f {}; fi",
        sh(pid_file),
        sh(pid_file),
        sh(pid_file)
    );
    run_osascript_admin(&script)
}

fn wait_for_pid(pid_file: &Path) -> Result<(), String> {
    for _ in 0..30 {
        if pid_file.exists() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("Xray did not create a TUN pid file.".into())
}

fn run_osascript_admin(script: &str) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("TUN mode is currently implemented for macOS only.".into());
    }
    let status = Command::new("osascript")
        .arg("-e")
        .arg(format!(
            "do shell script {} with administrator privileges",
            apple_string(script)
        ))
        .status()
        .map_err(|err| format!("macOS authorization failed: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Administrator authorization was cancelled or failed.".into())
    }
}

fn set_system_proxy(socks_port: u16, http_port: u16) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        for service in network_services()? {
            run_networksetup(&["-setwebproxy", &service, "127.0.0.1", &http_port.to_string()])?;
            run_networksetup(&["-setsecurewebproxy", &service, "127.0.0.1", &http_port.to_string()])?;
            run_networksetup(&["-setsocksfirewallproxy", &service, "127.0.0.1", &socks_port.to_string()])?;
            run_networksetup(&["-setwebproxystate", &service, "on"])?;
            run_networksetup(&["-setsecurewebproxystate", &service, "on"])?;
            run_networksetup(&["-setsocksfirewallproxystate", &service, "on"])?;
        }
    }
    Ok(())
}

fn clear_system_proxy() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        for service in network_services()? {
            let _ = run_networksetup(&["-setwebproxystate", &service, "off"]);
            let _ = run_networksetup(&["-setsecurewebproxystate", &service, "off"]);
            let _ = run_networksetup(&["-setsocksfirewallproxystate", &service, "off"]);
        }
    }
    Ok(())
}

fn network_services() -> Result<Vec<String>, String> {
    let output = Command::new("networksetup")
        .arg("-listallnetworkservices")
        .output()
        .map_err(|err| format!("List network services failed: {err}"))?;
    if !output.status.success() {
        return Err("networksetup could not list network services.".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty() && !line.starts_with('*'))
        .map(|line| line.to_string())
        .collect())
}

fn run_networksetup(args: &[&str]) -> Result<(), String> {
    let status = Command::new("networksetup")
        .args(args)
        .status()
        .map_err(|err| format!("networksetup failed: {err}"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| format!("networksetup {:?} failed.", args))
}

fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_nanos())
        .unwrap_or(0)
}

fn sh(path: &Path) -> String {
    let s = path.to_string_lossy();
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn apple_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::<Option<RuntimeState>>::new(None))
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
