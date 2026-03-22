use flate2::read::GzDecoder;
use reqwest::blocking::Client;
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tar::Archive;
use zip::ZipArchive;

const PDFIUM_VERSION: &str = "7543";

// llama.cpp server pinned build
const LLAMA_BUILD: &str = "b8263";

// Nomic embed model
const NOMIC_EMBED_MODEL: &str = "nomic-embed-text-v1.5.Q5_K_M.gguf";
const NOMIC_EMBED_URL: &str = "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q5_K_M.gguf";

// Nomic embed tokenizer (BERT WordPiece vocab, ~600 KB)
const NOMIC_TOKENIZER_FILE: &str = "tokenizer.json";
const NOMIC_TOKENIZER_URL: &str =
    "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/tokenizer.json";

struct TargetConfig {
    id: &'static str,
    library_filename: &'static str,
    asset_filenames: &'static [&'static str],
}

struct LlamaTarget {
    /// Tauri sidecar target triple (used for binary naming)
    triple: &'static str,
    /// GitHub release asset filename
    asset_filename: &'static str,
    /// Name of the `llama-server` (or `llama-server.exe`) inside the archive
    binary_name: &'static str,
    /// Shared library extensions to also extract alongside the binary (e.g. ".so", ".dylib").
    /// On Linux the Ubuntu release ships libllama.so / libggml*.so next to the binary.
    lib_extensions: &'static [&'static str],
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    if let Err(error) = ensure_pdfium_binary() {
        panic!("Failed to provision Pdfium binary: {error}");
    }

    if let Err(error) = ensure_llama_server_binary() {
        panic!("Failed to provision llama-server binary: {error}");
    }

    if let Err(error) = ensure_nomic_embed_model() {
        panic!("Failed to provision nomic-embed-text model: {error}");
    }

    if let Err(error) = ensure_nomic_tokenizer() {
        panic!("Failed to provision nomic-embed-text tokenizer: {error}");
    }

    tauri_build::build();
}

fn ensure_pdfium_binary() -> Result<(), String> {
    let target_os = env::var("CARGO_CFG_TARGET_OS")
        .map_err(|e| format!("Missing CARGO_CFG_TARGET_OS environment variable: {e}"))?;
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH")
        .map_err(|e| format!("Missing CARGO_CFG_TARGET_ARCH environment variable: {e}"))?;
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR")
            .map_err(|e| format!("Missing CARGO_MANIFEST_DIR environment variable: {e}"))?,
    );

    let target = resolve_target_config(&target_os, &target_arch).ok_or_else(|| {
        format!(
            "Unsupported target platform {target_os}/{target_arch}. Supported targets: \
             macOS (aarch64, x86_64), Windows (x86_64), Linux (x86_64)."
        )
    })?;

    let target_dir = manifest_dir
        .join("resources")
        .join("pdfium")
        .join(target.id);
    let target_library_path = target_dir.join(target.library_filename);

    if target_library_path.exists() {
        println!(
            "cargo:warning=Using cached Pdfium binary at {}",
            target_library_path.display()
        );
        return Ok(());
    }

    fs::create_dir_all(&target_dir).map_err(|e| {
        format!(
            "Failed to create Pdfium resource directory '{}': {e}",
            target_dir.display()
        )
    })?;

    let out_dir = PathBuf::from(
        env::var("OUT_DIR").map_err(|e| format!("Missing OUT_DIR environment variable: {e}"))?,
    );
    let download_dir = out_dir.join("pdfium-download");
    let extract_dir = out_dir.join("pdfium-extract");

    if download_dir.exists() {
        fs::remove_dir_all(&download_dir).map_err(|e| {
            format!(
                "Failed to clear temporary download directory '{}': {e}",
                download_dir.display()
            )
        })?;
    }
    if extract_dir.exists() {
        fs::remove_dir_all(&extract_dir).map_err(|e| {
            format!(
                "Failed to clear temporary extract directory '{}': {e}",
                extract_dir.display()
            )
        })?;
    }

    fs::create_dir_all(&download_dir).map_err(|e| {
        format!(
            "Failed to create temporary download directory '{}': {e}",
            download_dir.display()
        )
    })?;
    fs::create_dir_all(&extract_dir).map_err(|e| {
        format!(
            "Failed to create temporary extract directory '{}': {e}",
            extract_dir.display()
        )
    })?;

    let base_url = format!(
        "https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F{}",
        PDFIUM_VERSION
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to construct HTTP client for Pdfium download: {e}"))?;

    let mut download_errors = Vec::new();

    for asset_name in target.asset_filenames {
        let url = format!("{base_url}/{asset_name}");
        let archive_path = download_dir.join(asset_name);

        match download_file(&client, &url, &archive_path) {
            Ok(()) => {
                if let Err(error) = extract_archive(&archive_path, &extract_dir) {
                    download_errors
                        .push(format!("Downloaded {url} but extraction failed: {error}"));
                    continue;
                }

                if let Some(found_library) =
                    find_file_recursive(&extract_dir, OsStr::new(target.library_filename))
                {
                    fs::copy(&found_library, &target_library_path).map_err(|e| {
                        format!(
                            "Failed to copy '{}' to '{}': {e}",
                            found_library.display(),
                            target_library_path.display()
                        )
                    })?;
                    println!(
                        "cargo:warning=Downloaded Pdfium {} for {}/{} to {}",
                        PDFIUM_VERSION,
                        target_os,
                        target_arch,
                        target_library_path.display()
                    );
                    return Ok(());
                }

                download_errors.push(format!(
                    "Downloaded {url} but '{}' was not found in extracted contents",
                    target.library_filename
                ));
            }
            Err(error) => {
                download_errors.push(format!("{url} => {error}"));
            }
        }
    }

    Err(format!(
        "Unable to download a compatible Pdfium binary.\n\
         Target: {}/{}\n\
         Expected library: {}\n\
         Tried assets: {}\n\
         Details:\n{}\n\
         Build is configured to fail if Pdfium cannot be provisioned.\n\
         Check network/proxy settings and retry.",
        target_os,
        target_arch,
        target.library_filename,
        target.asset_filenames.join(", "),
        download_errors.join("\n")
    ))
}

fn ensure_llama_server_binary() -> Result<(), String> {
    let target_os =
        env::var("CARGO_CFG_TARGET_OS").map_err(|e| format!("Missing CARGO_CFG_TARGET_OS: {e}"))?;
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH")
        .map_err(|e| format!("Missing CARGO_CFG_TARGET_ARCH: {e}"))?;
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").map_err(|e| format!("Missing CARGO_MANIFEST_DIR: {e}"))?,
    );

    let llama_target = resolve_llama_target(&target_os, &target_arch).ok_or_else(|| {
        format!(
            "llama-server: unsupported target {target_os}/{target_arch}. \
             Supported: macOS aarch64/x86_64, Linux x86_64, Windows x86_64."
        )
    })?;

    // Tauri sidecars live at src-tauri/binaries/
    let binaries_dir = manifest_dir.join("binaries");
    let ext = if target_os == "windows" { ".exe" } else { "" };
    let sidecar_name = format!("llama-server-{}{}", llama_target.triple, ext);
    let sidecar_path = binaries_dir.join(&sidecar_name);

    if sidecar_path.exists() {
        // For targets that ship companion shared libraries, also verify at least
        // one lib is present. If the binary exists but libs are missing (e.g. from
        // a partial prior extraction), fall through to re-download.
        let libs_ok = if llama_target.lib_extensions.is_empty() {
            true
        } else {
            // Check that at least one companion lib exists in binaries/
            fs::read_dir(&binaries_dir)
                .map(|mut entries| {
                    entries.any(|e| {
                        e.ok()
                            .and_then(|e| e.file_name().into_string().ok())
                            .map(|name| {
                                llama_target
                                    .lib_extensions
                                    .iter()
                                    .any(|ext| name.contains(ext))
                            })
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false)
        };

        if libs_ok {
            println!(
                "cargo:warning=Using cached llama-server at {}",
                sidecar_path.display()
            );
            // Even on cache hit we must ensure the .so/.dylib files are present
            // next to the sidecar binary in target/{profile}/ for dev mode.
            copy_libs_to_target_dir(&binaries_dir, llama_target.lib_extensions)?;
            return Ok(());
        }
        println!("cargo:warning=llama-server binary exists but companion libs are missing — re-extracting");
    }

    fs::create_dir_all(&binaries_dir).map_err(|e| format!("Failed to create binaries dir: {e}"))?;

    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(|e| format!("Missing OUT_DIR: {e}"))?);
    let download_dir = out_dir.join("llama-download");
    let extract_dir = out_dir.join("llama-extract");

    for d in [&download_dir, &extract_dir] {
        if d.exists() {
            fs::remove_dir_all(d).ok();
        }
        fs::create_dir_all(d).map_err(|e| format!("Failed to create temp dir: {e}"))?;
    }

    let url = format!(
        "https://github.com/ggml-org/llama.cpp/releases/download/{build}/{asset}",
        build = LLAMA_BUILD,
        asset = llama_target.asset_filename,
    );

    println!("cargo:warning=Downloading llama-server from {url}");

    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let archive_path = download_dir.join(llama_target.asset_filename);
    download_file(&client, &url, &archive_path)
        .map_err(|e| format!("Download failed for {url}: {e}"))?;

    extract_archive(&archive_path, &extract_dir).map_err(|e| format!("Extraction failed: {e}"))?;

    // Find llama-server binary inside extracted contents
    let binary_os_name = OsStr::new(llama_target.binary_name);
    let found = find_file_recursive(&extract_dir, binary_os_name).ok_or_else(|| {
        format!(
            "llama-server binary '{}' not found in extracted archive",
            llama_target.binary_name
        )
    })?;

    fs::copy(&found, &sidecar_path).map_err(|e| {
        format!(
            "Failed to copy llama-server to {}: {e}",
            sidecar_path.display()
        )
    })?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&sidecar_path)
            .map_err(|e| format!("Failed to read permissions: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&sidecar_path, perms)
            .map_err(|e| format!("Failed to set executable permissions: {e}"))?;
    }

    // Copy companion shared libraries (.so / .dylib) into binaries/ so the
    // dynamic linker can find them next to the sidecar at runtime.
    if !llama_target.lib_extensions.is_empty() {
        let lib_dir = found
            .parent()
            .ok_or("llama-server binary has no parent directory")?;
        let entries = fs::read_dir(lib_dir)
            .map_err(|e| format!("Failed to read extract dir {}: {e}", lib_dir.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
                let is_lib = llama_target
                    .lib_extensions
                    .iter()
                    .any(|ext| name.contains(ext));
                if is_lib {
                    let dest = binaries_dir.join(name);
                    fs::copy(&path, &dest)
                        .map_err(|e| format!("Failed to copy lib {} to binaries/: {e}", name))?;
                    println!("cargo:warning=Copied companion lib {} to binaries/", name);
                }
            }
        }
    }

    println!(
        "cargo:warning=Downloaded llama-server {} for {}/{} to {}",
        LLAMA_BUILD,
        target_os,
        target_arch,
        sidecar_path.display()
    );

    // Copy .so/.dylib/.dll files into target/{profile}/ so that when Tauri dev
    // mode resolves the sidecar binary to target/debug/llama-server, the
    // companion shared libraries are in the same directory.  This is needed
    // because ggml_backend_load_all() uses dlopen() with a path relative to
    // the executable, not LD_LIBRARY_PATH.
    copy_libs_to_target_dir(&binaries_dir, llama_target.lib_extensions)?;

    // On macOS, fix dylib install names to use @loader_path instead of absolute paths.
    // This is required because SIP strips DYLD_LIBRARY_PATH from signed applications.
    #[cfg(target_os = "macos")]
    fix_macos_dylib_paths(&binaries_dir, llama_target.triple)?;

    Ok(())
}

/// Copy companion shared libraries (`.so`, `.dylib`, `.dll`) from `source_dir`
/// into the Cargo target output directory (e.g. `target/debug/`) so that the
/// `llama-server` sidecar binary can find them via relative `dlopen()` calls
/// (used by `ggml_backend_load_all()`).
///
/// The target directory is derived by walking up from `OUT_DIR` to find the
/// `target/{profile}/` ancestor.
fn copy_libs_to_target_dir(source_dir: &Path, lib_extensions: &[&str]) -> Result<(), String> {
    if lib_extensions.is_empty() {
        return Ok(());
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(|e| format!("Missing OUT_DIR: {e}"))?);

    // OUT_DIR is typically .../target/{profile}/build/{crate}-{hash}/out
    // Walk up until we find a directory whose name is "debug" or "release"
    // and whose parent is named "target".
    let target_dir = find_target_profile_dir(&out_dir).ok_or_else(|| {
        format!(
            "Could not locate target/{{profile}}/ directory from OUT_DIR={}",
            out_dir.display()
        )
    })?;

    let entries = fs::read_dir(source_dir)
        .map_err(|e| format!("Failed to read binaries dir {}: {e}", source_dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(OsStr::to_str) {
            Some(n) => n.to_owned(),
            None => continue,
        };
        let is_lib = lib_extensions.iter().any(|ext| name.contains(ext));
        if !is_lib {
            continue;
        }
        let dest = target_dir.join(&name);
        if dest.exists() {
            // Skip if already up-to-date (same size is a cheap heuristic).
            let src_len = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let dst_len = fs::metadata(&dest).map(|m| m.len()).unwrap_or(1);
            if src_len == dst_len {
                continue;
            }
        }
        fs::copy(&path, &dest)
            .map_err(|e| format!("Failed to copy {name} to {}: {e}", target_dir.display()))?;
        println!("cargo:warning=Copied {} to {}", name, target_dir.display());
    }

    Ok(())
}

/// Walk up from `start` to find the `target/{profile}/` directory.
///
/// Handles both native builds:
///   `target/{profile}/build/{crate}/out`  → parent of `{profile}` is `target`
/// and cross-compilation builds:
///   `target/{triple}/{profile}/build/{crate}/out`  → grandparent of `{profile}` is `target`
fn find_target_profile_dir(start: &Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        let name = current.file_name()?.to_str()?;
        if name == "debug" || name == "release" {
            // Native: target/{profile}/
            if let Some(parent) = current.parent() {
                if parent.file_name().and_then(|n| n.to_str()) == Some("target") {
                    return Some(current);
                }
                // Cross-compile: target/{triple}/{profile}/
                if let Some(grandparent) = parent.parent() {
                    if grandparent.file_name().and_then(|n| n.to_str()) == Some("target") {
                        return Some(current);
                    }
                }
            }
        }
        current = current.parent()?.to_path_buf();
    }
}

fn resolve_llama_target(target_os: &str, target_arch: &str) -> Option<LlamaTarget> {
    match (target_os, target_arch) {
        ("macos", "aarch64") => Some(LlamaTarget {
            triple: "aarch64-apple-darwin",
            asset_filename: "llama-b8263-bin-macos-arm64.tar.gz",
            binary_name: "llama-server",
            lib_extensions: &[".dylib"],
        }),
        ("macos", "x86_64") => Some(LlamaTarget {
            triple: "x86_64-apple-darwin",
            asset_filename: "llama-b8263-bin-macos-x64.tar.gz",
            binary_name: "llama-server",
            lib_extensions: &[".dylib"],
        }),
        ("linux", "x86_64") => Some(LlamaTarget {
            triple: "x86_64-unknown-linux-gnu",
            asset_filename: "llama-b8263-bin-ubuntu-x64.tar.gz",
            binary_name: "llama-server",
            lib_extensions: &[".so"],
        }),
        ("windows", "x86_64") => Some(LlamaTarget {
            triple: "x86_64-pc-windows-msvc",
            asset_filename: "llama-b8263-bin-win-cpu-x64.zip",
            binary_name: "llama-server.exe",
            lib_extensions: &[".dll"],
        }),
        _ => None,
    }
}

fn ensure_nomic_embed_model() -> Result<(), String> {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").map_err(|e| format!("Missing CARGO_MANIFEST_DIR: {e}"))?,
    );

    let models_dir = manifest_dir.join("resources").join("models");
    let model_path = models_dir.join(NOMIC_EMBED_MODEL);

    if model_path.exists() {
        println!(
            "cargo:warning=Using cached nomic-embed model at {}",
            model_path.display()
        );
        return Ok(());
    }

    fs::create_dir_all(&models_dir).map_err(|e| format!("Failed to create models dir: {e}"))?;

    println!("cargo:warning=Downloading nomic-embed-text model (99 MB)...");

    let client = Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    download_file(&client, NOMIC_EMBED_URL, &model_path)
        .map_err(|e| format!("Failed to download nomic model: {e}"))?;

    println!(
        "cargo:warning=Downloaded nomic-embed-text model to {}",
        model_path.display()
    );

    Ok(())
}

fn ensure_nomic_tokenizer() -> Result<(), String> {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").map_err(|e| format!("Missing CARGO_MANIFEST_DIR: {e}"))?,
    );

    let models_dir = manifest_dir.join("resources").join("models");
    let tokenizer_path = models_dir.join(NOMIC_TOKENIZER_FILE);

    if tokenizer_path.exists() {
        println!(
            "cargo:warning=Using cached nomic-embed tokenizer at {}",
            tokenizer_path.display()
        );
        return Ok(());
    }

    fs::create_dir_all(&models_dir).map_err(|e| format!("Failed to create models dir: {e}"))?;

    println!("cargo:warning=Downloading nomic-embed-text tokenizer.json (~600 KB)...");

    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    download_file(&client, NOMIC_TOKENIZER_URL, &tokenizer_path)
        .map_err(|e| format!("Failed to download nomic tokenizer: {e}"))?;

    println!(
        "cargo:warning=Downloaded nomic-embed-text tokenizer to {}",
        tokenizer_path.display()
    );

    Ok(())
}

fn resolve_target_config(target_os: &str, target_arch: &str) -> Option<TargetConfig> {
    match (target_os, target_arch) {
        ("macos", "aarch64") => Some(TargetConfig {
            id: "macos-aarch64",
            library_filename: "libpdfium.dylib",
            asset_filenames: &["pdfium-mac-arm64.tgz", "pdfium-mac-arm64.zip"],
        }),
        ("macos", "x86_64") => Some(TargetConfig {
            id: "macos-x86_64",
            library_filename: "libpdfium.dylib",
            asset_filenames: &["pdfium-mac-x64.tgz", "pdfium-mac-x64.zip"],
        }),
        ("windows", "x86_64") => Some(TargetConfig {
            id: "windows-x86_64",
            library_filename: "pdfium.dll",
            asset_filenames: &["pdfium-win-x64.tgz", "pdfium-win-x64.zip"],
        }),
        ("linux", "x86_64") => Some(TargetConfig {
            id: "linux-x86_64",
            library_filename: "libpdfium.so",
            asset_filenames: &["pdfium-linux-x64.tgz", "pdfium-linux-x64.zip"],
        }),
        _ => None,
    }
}

fn download_file(client: &Client, url: &str, destination: &Path) -> Result<(), String> {
    let mut response = client
        .get(url)
        .send()
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Unexpected HTTP status {}", response.status()));
    }

    let mut file = fs::File::create(destination)
        .map_err(|e| format!("Failed to create '{}': {e}", destination.display()))?;

    io::copy(&mut response, &mut file)
        .map_err(|e| format!("Failed to write '{}': {e}", destination.display()))?;

    Ok(())
}

fn extract_archive(archive_path: &Path, extract_dir: &Path) -> Result<(), String> {
    let archive_name = archive_path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| format!("Invalid archive file name '{}'", archive_path.display()))?;

    if archive_name.ends_with(".tgz") || archive_name.ends_with(".tar.gz") {
        let archive_file = fs::File::open(archive_path)
            .map_err(|e| format!("Failed to open '{}': {e}", archive_path.display()))?;
        let decoder = GzDecoder::new(archive_file);
        let mut archive = Archive::new(decoder);
        archive
            .unpack(extract_dir)
            .map_err(|e| format!("Failed to unpack tar.gz '{}': {e}", archive_path.display()))?;
        return Ok(());
    }

    if archive_name.ends_with(".zip") {
        let archive_file = fs::File::open(archive_path)
            .map_err(|e| format!("Failed to open '{}': {e}", archive_path.display()))?;
        let mut zip_archive = ZipArchive::new(archive_file)
            .map_err(|e| format!("Failed to read zip '{}': {e}", archive_path.display()))?;

        for index in 0..zip_archive.len() {
            let mut entry = zip_archive
                .by_index(index)
                .map_err(|e| format!("Failed to read zip entry #{index}: {e}"))?;
            let entry_path = entry.enclosed_name().ok_or_else(|| {
                format!("Zip entry '{}' has invalid path traversal", entry.name())
            })?;
            let output_path = extract_dir.join(entry_path);

            if entry.name().ends_with('/') {
                fs::create_dir_all(&output_path).map_err(|e| {
                    format!(
                        "Failed to create directory '{}': {e}",
                        output_path.display()
                    )
                })?;
                continue;
            }

            if let Some(parent_dir) = output_path.parent() {
                fs::create_dir_all(parent_dir).map_err(|e| {
                    format!("Failed to create directory '{}': {e}", parent_dir.display())
                })?;
            }

            let mut output_file = fs::File::create(&output_path)
                .map_err(|e| format!("Failed to create '{}': {e}", output_path.display()))?;
            io::copy(&mut entry, &mut output_file)
                .map_err(|e| format!("Failed to extract '{}': {e}", output_path.display()))?;
        }

        return Ok(());
    }

    Err(format!(
        "Unsupported archive format for '{}'",
        archive_path.display()
    ))
}

fn find_file_recursive(root: &Path, file_name: &OsStr) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }

    let entries = fs::read_dir(root).ok()?;

    for entry in entries {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, file_name) {
                return Some(found);
            }
        } else if path.file_name() == Some(file_name) {
            return Some(path);
        }
    }

    None
}

/// Fix macOS dylib install names to use @loader_path instead of absolute paths.
///
/// This is required because System Integrity Protection (SIP) strips DYLD_LIBRARY_PATH
/// from signed applications, preventing dynamic libraries from being found via environment
/// variables. By using @loader_path, we make paths relative to the llama-server binary.
#[cfg(target_os = "macos")]
fn fix_macos_dylib_paths(binaries_dir: &Path, triple: &str) -> Result<(), String> {
    use std::process::Command;

    println!("cargo:warning=Fixing macOS dylib paths for production builds...");

    // Find all .dylib files
    let entries =
        fs::read_dir(binaries_dir).map_err(|e| format!("Failed to read binaries dir: {e}"))?;

    let mut dylibs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("dylib") {
            dylibs.push(path);
        }
    }

    // Fix each dylib's install name and dependencies
    for dylib in &dylibs {
        let dylib_name = dylib
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Invalid dylib filename")?;

        // 1. Fix the dylib's own install name to use @rpath
        let install_name_result = Command::new("install_name_tool")
            .arg("-id")
            .arg(format!("@rpath/{}", dylib_name))
            .arg(dylib)
            .output();

        match install_name_result {
            Ok(output) if output.status.success() => {
                println!("cargo:warning=Fixed install name for {}", dylib.display());
            }
            Ok(output) => {
                println!(
                    "cargo:warning=install_name_tool -id failed for {}: {}",
                    dylib.display(),
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            Err(e) => {
                println!("cargo:warning=Failed to run install_name_tool: {e}");
            }
        }

        // 2. Get current dependencies to fix them
        let otool_output = Command::new("otool")
            .arg("-L")
            .arg(dylib)
            .output()
            .map_err(|e| format!("Failed to run otool: {e}"))?;

        if otool_output.status.success() {
            let output_str = String::from_utf8_lossy(&otool_output.stdout);
            for line in output_str.lines() {
                let line = line.trim();
                // Look for absolute paths to dylibs
                if line.starts_with('/') && line.contains(".dylib") {
                    // Extract the path (before the version info in parentheses)
                    if let Some(path_end) = line.find(" (compatibility") {
                        let old_path = &line[..path_end].trim();
                        // Get just the filename
                        if let Some(filename) =
                            Path::new(old_path).file_name().and_then(|f| f.to_str())
                        {
                            // Change to @loader_path
                            let _ = Command::new("install_name_tool")
                                .arg("-change")
                                .arg(old_path)
                                .arg(format!("@loader_path/{}", filename))
                                .arg(dylib)
                                .status();
                        }
                    }
                }
            }
        }
    }

    // 3. Fix llama-server binary to use @loader_path for dylibs
    let sidecar_name = format!("llama-server-{}", triple);
    let sidecar = binaries_dir.join(&sidecar_name);

    if sidecar.exists() {
        let otool_output = Command::new("otool")
            .arg("-L")
            .arg(&sidecar)
            .output()
            .map_err(|e| format!("Failed to run otool on sidecar: {e}"))?;

        if otool_output.status.success() {
            let output_str = String::from_utf8_lossy(&otool_output.stdout);
            for line in output_str.lines() {
                let line = line.trim();
                if line.starts_with('/') && line.contains(".dylib") {
                    if let Some(path_end) = line.find(" (compatibility") {
                        let old_path = &line[..path_end].trim();
                        if let Some(filename) =
                            Path::new(old_path).file_name().and_then(|f| f.to_str())
                        {
                            let result = Command::new("install_name_tool")
                                .arg("-change")
                                .arg(old_path)
                                .arg(format!("@loader_path/{}", filename))
                                .arg(&sidecar)
                                .status();

                            if result.is_ok() {
                                println!("cargo:warning=Fixed {} in llama-server", filename);
                            }
                        }
                    }
                }
            }
        }

        println!("cargo:warning=macOS dylib paths fixed successfully");
    } else {
        println!(
            "cargo:warning=Sidecar {} not found, skipping dylib fixes",
            sidecar_name
        );
    }

    Ok(())
}
