//! Lifecycle manager for the bundled `llama-server` sidecar.
//!
//! Two server instances are managed:
//!  - **Embed server** (port 28881) — always-on, starts in background after window opens.
//!  - **Chat server**  (port 28882) — on-demand, started/stopped as needed.
//!
//! Uses `tauri-plugin-shell` to spawn the sidecar binary so Tauri tracks and
//! kills child processes when the app exits.

use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;
use tokio::time::sleep;

pub const EMBED_PORT: u16 = 28881;
pub const CHAT_PORT: u16 = 28882;

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerStatus {
    /// Not yet started (or intentionally stopped).
    Stopped,
    /// Spawned but health-check not yet passed.
    Starting,
    /// Health-check passed — accepting requests.
    Running,
    /// Process exited unexpectedly or failed to start.
    Failed,
}

struct ServerInstance {
    status: ServerStatus,
    /// PID of the running process (for logging only; Tauri owns the kill).
    pid: Option<u32>,
}

impl ServerInstance {
    fn new() -> Self {
        Self {
            status: ServerStatus::Stopped,
            pid: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

pub struct LlamaServerManager {
    embed: Arc<Mutex<ServerInstance>>,
    chat: Arc<Mutex<ServerInstance>>,
}

impl LlamaServerManager {
    pub fn new() -> Self {
        Self {
            embed: Arc::new(Mutex::new(ServerInstance::new())),
            chat: Arc::new(Mutex::new(ServerInstance::new())),
        }
    }

    // -----------------------------------------------------------------------
    // Embed server
    // -----------------------------------------------------------------------

    /// Start the embed server in the background (non-blocking).
    ///
    /// Returns immediately; the server warms up asynchronously.  It is safe to
    /// call this multiple times — subsequent calls are no-ops if the server is
    /// already starting or running.
    pub fn start_embed_server_background(&self, app_handle: AppHandle) {
        let embed = Arc::clone(&self.embed);
        tauri::async_runtime::spawn(async move {
            let already_up = {
                let guard = embed.lock().await;
                matches!(guard.status, ServerStatus::Starting | ServerStatus::Running)
            };
            if already_up {
                return;
            }

            {
                embed.lock().await.status = ServerStatus::Starting;
            }

            match spawn_embed_server(&app_handle, Arc::clone(&embed)).await {
                Ok(pid) => {
                    embed.lock().await.pid = pid;
                    log::info!("llama embed server spawned (pid={pid:?}), waiting for readiness…");
                    match wait_for_server(EMBED_PORT, 60).await {
                        Ok(()) => {
                            embed.lock().await.status = ServerStatus::Running;
                            log::info!("llama embed server ready on port {EMBED_PORT}");
                        }
                        Err(e) => {
                            embed.lock().await.status = ServerStatus::Failed;
                            log::error!("llama embed server failed to become ready: {e}");
                        }
                    }
                }
                Err(e) => {
                    embed.lock().await.status = ServerStatus::Failed;
                    log::error!("Failed to spawn llama embed server: {e}");
                }
            }
        });
    }

    /// Returns the current status of the embed server.
    #[allow(dead_code)]
    pub async fn embed_status(&self) -> ServerStatus {
        self.embed.lock().await.status
    }

    // -----------------------------------------------------------------------
    // Chat server
    // -----------------------------------------------------------------------

    /// Start the chat server for the given model path in the background (non-blocking).
    ///
    /// Returns immediately; the server warms up asynchronously.  It is safe to
    /// call this multiple times — subsequent calls are no-ops if the server is
    /// already starting or running.
    pub fn start_chat_server_background(&self, app_handle: AppHandle, model_path: String) {
        let chat = Arc::clone(&self.chat);
        let app_handle_clone = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let already_up = {
                let guard = chat.lock().await;
                matches!(guard.status, ServerStatus::Starting | ServerStatus::Running)
            };
            if already_up {
                return;
            }

            {
                chat.lock().await.status = ServerStatus::Starting;
            }

            match spawn_chat_server(&app_handle_clone, &model_path, Arc::clone(&chat)).await {
                Ok(pid) => {
                    chat.lock().await.pid = pid;
                    log::info!("llama chat server spawned (pid={pid:?}), waiting for readiness…");
                    match wait_for_server(CHAT_PORT, 120).await {
                        Ok(()) => {
                            chat.lock().await.status = ServerStatus::Running;
                            log::info!("llama chat server ready on port {CHAT_PORT}");
                        }
                        Err(e) => {
                            chat.lock().await.status = ServerStatus::Failed;
                            log::error!("llama chat server failed to become ready: {e}");
                        }
                    }
                }
                Err(e) => {
                    chat.lock().await.status = ServerStatus::Failed;
                    log::error!("Failed to spawn llama chat server: {e}");
                }
            }
        });
    }

    /// Start the chat server for the given model path (blocking — waits up to 120 s).
    pub async fn start_chat_server(
        &self,
        app_handle: &AppHandle,
        model_path: &str,
    ) -> Result<(), String> {
        {
            let guard = self.chat.lock().await;
            if matches!(guard.status, ServerStatus::Starting | ServerStatus::Running) {
                return Ok(());
            }
        }

        self.chat.lock().await.status = ServerStatus::Starting;

        match spawn_chat_server(app_handle, model_path, Arc::clone(&self.chat)).await {
            Ok(pid) => {
                self.chat.lock().await.pid = pid;
                log::info!("llama chat server spawned (pid={pid:?}), waiting for readiness…");
                wait_for_server(CHAT_PORT, 120).await.inspect_err(|_| {
                    tauri::async_runtime::block_on(async {
                        self.chat.lock().await.status = ServerStatus::Failed;
                    });
                })?;
                self.chat.lock().await.status = ServerStatus::Running;
                log::info!("llama chat server ready on port {CHAT_PORT}");
                Ok(())
            }
            Err(e) => {
                self.chat.lock().await.status = ServerStatus::Failed;
                Err(e)
            }
        }
    }

    /// Returns the current status of the chat server.
    #[allow(dead_code)]
    pub async fn chat_status(&self) -> ServerStatus {
        self.chat.lock().await.status
    }

    /// Returns a combined status string suitable for the frontend.
    pub async fn status_summary(&self) -> LlamaStatus {
        LlamaStatus {
            embed: format!("{:?}", self.embed.lock().await.status),
            chat: format!("{:?}", self.chat.lock().await.status),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LlamaStatus {
    pub embed: String,
    pub chat: String,
}

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

async fn spawn_embed_server(
    app_handle: &AppHandle,
    instance: Arc<Mutex<ServerInstance>>,
) -> Result<Option<u32>, String> {
    let model_path = resolve_embed_model_path(app_handle)?;
    log::debug!("[embed_server] resolved model path: {}", model_path);

    let args = vec![
        "--model".to_string(),
        model_path,
        "--port".to_string(),
        EMBED_PORT.to_string(),
        "--embedding".to_string(),
        "--ctx-size".to_string(),
        "8192".to_string(),
        "--batch-size".to_string(),
        "512".to_string(),
        "--rope-scaling".to_string(),
        "yarn".to_string(),
        "--rope-freq-scale".to_string(),
        "0.75".to_string(),
        "-ngl".to_string(),
        "99".to_string(),
    ];

    spawn_sidecar(app_handle, &args, instance).await
}

async fn spawn_chat_server(
    app_handle: &AppHandle,
    model_path: &str,
    instance: Arc<Mutex<ServerInstance>>,
) -> Result<Option<u32>, String> {
    log::debug!("[chat_server] spawning with model path: {}", model_path);
    let args = vec![
        "--model".to_string(),
        model_path.to_string(),
        "--port".to_string(),
        CHAT_PORT.to_string(),
        "--ctx-size".to_string(),
        "4096".to_string(),
        "-ngl".to_string(),
        "99".to_string(),
    ];

    spawn_sidecar(app_handle, &args, instance).await
}

async fn spawn_sidecar(
    app_handle: &AppHandle,
    args: &[String],
    instance: Arc<Mutex<ServerInstance>>,
) -> Result<Option<u32>, String> {
    let shell = app_handle.shell();
    let sidecar_cmd = shell
        .sidecar("llama-server")
        .map_err(|e| format!("Failed to create llama-server sidecar command: {e}"))?;

    // On Linux, set LD_LIBRARY_PATH to the directory containing the sidecar so
    // the companion shared libraries (libllama.so, libggml*.so) can be found.
    // Tauri resolves sidecars relative to the binary's own directory in production,
    // or src-tauri/binaries/ in dev mode.
    #[cfg(target_os = "linux")]
    let cmd = {
        let lib_dir = resolve_sidecar_lib_dir(app_handle);
        log::debug!("[spawn_sidecar] LD_LIBRARY_PATH={:?}", lib_dir);
        match lib_dir {
            Some(dir) => sidecar_cmd.args(args).env("LD_LIBRARY_PATH", dir),
            None => sidecar_cmd.args(args),
        }
    };

    #[cfg(not(target_os = "linux"))]
    let cmd = sidecar_cmd.args(args);

    let (rx, child) = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn llama-server: {e}"))?;

    let pid = child.pid();

    // Drain stdout/stderr and watch for process termination.
    // When the process exits, reset the instance status to Stopped so the next
    // start_chat_server / start_embed_server call will re-spawn it.
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        let mut rx = rx;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    if let Ok(s) = String::from_utf8(line) {
                        log::debug!("[llama-server stdout] {}", s.trim_end());
                    }
                }
                CommandEvent::Stderr(line) => {
                    if let Ok(s) = String::from_utf8(line) {
                        log::warn!("[llama-server stderr] {}", s.trim_end());
                    }
                }
                CommandEvent::Error(e) => {
                    log::error!("[llama-server error] {}", e);
                }
                CommandEvent::Terminated(status) => {
                    log::warn!(
                        "[llama-server] process terminated: code={:?} signal={:?}",
                        status.code,
                        status.signal
                    );
                    // Reset status so the server can be restarted on the next request.
                    instance.lock().await.status = ServerStatus::Stopped;
                    instance.lock().await.pid = None;
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(Some(pid))
}

/// On Linux, return the directory that contains the llama-server companion .so files.
///
/// In dev mode Tauri resolves sidecars from `{CARGO_MANIFEST_DIR}/binaries/`.
/// In a production bundle the sidecar sits next to the main binary.
/// We use `std::env::current_exe()` as the anchor: the sidecar is in the same
/// directory as the app binary in production, or we fall back to the source tree.
#[cfg(target_os = "linux")]
fn resolve_sidecar_lib_dir(app_handle: &AppHandle) -> Option<String> {
    // Production: sidecar lives in the same dir as the app binary
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("libllama.so");
            if candidate.exists() {
                return Some(dir.to_string_lossy().into_owned());
            }
        }
    }

    // Dev mode: sidecar lives in src-tauri/binaries/ inside the source tree.
    // Tauri stores the resource dir near the source tree during dev.
    let _ = app_handle; // unused in this branch but keep signature consistent
    let dev_binaries = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if dev_binaries.join("libllama.so").exists() {
        return Some(dev_binaries.to_string_lossy().into_owned());
    }

    log::warn!("[spawn_sidecar] could not locate libllama.so — llama-server may fail to start");
    None
}

/// Resolve the path to the bundled nomic-embed-text model.
fn resolve_embed_model_path(app_handle: &AppHandle) -> Result<String, String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?;

    let model_path = resource_dir
        .join("resources")
        .join("models")
        .join("nomic-embed-text-v1.5.Q5_K_M.gguf");

    // In dev mode, try the source tree path as a fallback
    if !model_path.exists() {
        let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("models")
            .join("nomic-embed-text-v1.5.Q5_K_M.gguf");
        if dev_path.exists() {
            return Ok(dev_path.to_string_lossy().into_owned());
        }
        return Err(format!(
            "nomic-embed model not found at {} (run `cargo build` to download it)",
            model_path.display()
        ));
    }

    Ok(model_path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/// Poll `http://127.0.0.1:{port}/health` until it returns 200 or timeout.
async fn wait_for_server(port: u16, timeout_secs: u64) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/health");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "llama-server on port {port} did not become ready within {timeout_secs}s"
            ));
        }

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => {}
        }

        sleep(Duration::from_millis(500)).await;
    }
}
