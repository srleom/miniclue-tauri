# macOS DYLD_LIBRARY_PATH Issue - Investigation & Fix

## Problem

System Integrity Protection (SIP) on macOS strips `DYLD_LIBRARY_PATH` from signed applications, which means our production .dmg builds fail to load companion dylibs (`libllama.dylib`, `libggml*.dylib`).

**Current code** (src-tauri/src/services/llama_server.rs:334-350):
```rust
#[cfg(target_os = "macos")]
let cmd = {
    let lib_dir = app_handle
        .path()
        .resource_dir()
        .map(|d| d.join("binaries"))
        .ok();
    log::debug!("[spawn_sidecar] DYLD_LIBRARY_PATH={:?}", lib_dir);
    match lib_dir {
        Some(dir) => sidecar_cmd.args(args).env("DYLD_LIBRARY_PATH", dir),
        None => sidecar_cmd.args(args),
    }
};
```

**Status**: ✅ Works in dev mode, ❌ Fails in signed production builds

---

## Root Cause

When downloading llama-server from GitHub releases, the dylibs have absolute paths baked into their install names:

```bash
$ otool -L llama-server
    /path/to/build/libllama.dylib (compatibility version 0.0.0)
    /path/to/build/libggml.dylib (compatibility version 0.0.0)
```

The dynamic linker tries to load from these hardcoded paths, which don't exist on user systems. Normally, DYLD_LIBRARY_PATH overrides this, but SIP strips it.

---

## Solution: Use `install_name_tool` to Fix Rpath

We need to modify the dylibs at build time to use `@rpath` or `@loader_path` instead of absolute paths.

### Implementation in `build.rs`

Add this function after `ensure_llama_server_binary()`:

```rust
#[cfg(target_os = "macos")]
fn fix_macos_dylib_paths(binaries_dir: &Path) -> Result<(), String> {
    use std::process::Command;

    // Find all .dylib files
    let entries = fs::read_dir(binaries_dir)
        .map_err(|e| format!("Failed to read binaries dir: {e}"))?;

    let mut dylibs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("dylib") {
            dylibs.push(path);
        }
    }

    // Fix each dylib's install name and dependencies
    for dylib in &dylibs {
        let dylib_name = dylib.file_name().and_then(|s| s.to_str()).unwrap_or("");

        // 1. Fix the dylib's own install name to use @rpath
        let install_name_status = Command::new("install_name_tool")
            .arg("-id")
            .arg(format!("@rpath/{}", dylib_name))
            .arg(dylib)
            .status()
            .map_err(|e| format!("Failed to run install_name_tool: {e}"))?;

        if !install_name_status.success() {
            println!(
                "cargo:warning=install_name_tool -id failed for {}",
                dylib.display()
            );
        }

        // 2. Fix references to other dylibs in this dylib
        for other_dylib in &dylibs {
            let other_name = other_dylib
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");

            // Change absolute paths to @loader_path (relative to loading binary)
            let change_status = Command::new("install_name_tool")
                .arg("-change")
                .arg(format!("/usr/local/lib/{}", other_name)) // Common build path
                .arg(format!("@loader_path/{}", other_name))
                .arg(dylib)
                .status();

            // Ignore errors - the dylib might not reference this particular lib
            let _ = change_status;
        }
    }

    // 3. Fix llama-server binary to use @loader_path for dylibs
    let sidecar = binaries_dir.join("llama-server-aarch64-apple-darwin");
    if sidecar.exists() {
        for dylib in &dylibs {
            let dylib_name = dylib.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let _ = Command::new("install_name_tool")
                .arg("-change")
                .arg(format!("/usr/local/lib/{}", dylib_name))
                .arg(format!("@loader_path/{}", dylib_name))
                .arg(&sidecar)
                .status();
        }
    }

    println!("cargo:warning=Fixed macOS dylib paths using install_name_tool");
    Ok(())
}
```

### Call it in `ensure_llama_server_binary()`

After copying dylibs to `binaries/`, add:

```rust
// Fix macOS dylib paths for production builds
#[cfg(target_os = "macos")]
fix_macos_dylib_paths(&binaries_dir)?;
```

### Remove DYLD_LIBRARY_PATH from runtime code

Since dylibs now use `@loader_path`, we can remove the `DYLD_LIBRARY_PATH` logic from `llama_server.rs`:

```rust
// BEFORE (lines 334-350)
#[cfg(target_os = "macos")]
let cmd = {
    let lib_dir = app_handle
        .path()
        .resource_dir()
        .map(|d| d.join("binaries"))
        .ok();
    log::debug!("[spawn_sidecar] DYLD_LIBRARY_PATH={:?}", lib_dir);
    match lib_dir {
        Some(dir) => sidecar_cmd.args(args).env("DYLD_LIBRARY_PATH", dir),
        None => sidecar_cmd.args(args),
    }
};

// AFTER (remove it entirely, use default)
#[cfg(not(target_os = "linux"))]
let cmd = sidecar_cmd.args(args);
```

---

## Testing Steps (on macOS)

1. **Apply the fix** to `build.rs`
2. **Clean build**: `rm -rf src-tauri/binaries && cargo clean`
3. **Rebuild**: `bun run build`
4. **Install the .dmg** to `/Applications/`
5. **Run from Applications** (NOT from terminal)
6. **Try to start embedding or chat** - check logs for dylib errors
7. **Verify Metal acceleration** works (GPU is detected)

---

## Alternative: Static Linking (Future)

If `install_name_tool` doesn't work or is too complex, the ultimate solution is static linking (which we decided to defer in favor of keeping llama.cpp downloads).

---

## Status

- [x] Research completed
- [ ] Fix implemented in build.rs
- [ ] Tested on macOS production build
- [ ] DYLD_LIBRARY_PATH code removed from llama_server.rs

**Next step**: Implement the fix and test on macOS.
