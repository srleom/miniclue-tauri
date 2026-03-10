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

            match spawn_embed_server(&app_handle).await {
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

    /// Start the chat server for the given model path.
    ///
    /// Waits up to 120 s for the server to become ready.
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

        match spawn_chat_server(app_handle, model_path).await {
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

async fn spawn_embed_server(app_handle: &AppHandle) -> Result<Option<u32>, String> {
    let model_path = resolve_embed_model_path(app_handle)?;

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
        "--log-disable".to_string(),
        "-ngl".to_string(),
        "99".to_string(),
    ];

    spawn_sidecar(app_handle, &args).await
}

async fn spawn_chat_server(
    app_handle: &AppHandle,
    model_path: &str,
) -> Result<Option<u32>, String> {
    let args = vec![
        "--model".to_string(),
        model_path.to_string(),
        "--port".to_string(),
        CHAT_PORT.to_string(),
        "--ctx-size".to_string(),
        "4096".to_string(),
        "--log-disable".to_string(),
        "-ngl".to_string(),
        "99".to_string(),
    ];

    spawn_sidecar(app_handle, &args).await
}

async fn spawn_sidecar(app_handle: &AppHandle, args: &[String]) -> Result<Option<u32>, String> {
    let shell = app_handle.shell();
    let sidecar_cmd = shell
        .sidecar("llama-server")
        .map_err(|e| format!("Failed to create llama-server sidecar command: {e}"))?;

    let cmd = sidecar_cmd.args(args);

    let (_rx, child) = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn llama-server: {e}"))?;

    let pid = child.pid();
    Ok(Some(pid))
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
