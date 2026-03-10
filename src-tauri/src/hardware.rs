//! Hardware detection for inferring AI/ML inference capabilities.
//!
//! Detects RAM, CPU architecture/cores, GPU class, and available disk space
//! to help the app decide which models to use and how to configure inference.

use serde::Serialize;
use specta::Type;
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Classification of the GPU available on this machine.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum GpuClass {
    /// Apple Silicon unified-memory GPU (Metal backend).
    AppleSilicon,
    /// Discrete NVIDIA GPU (Vulkan / DX12).
    NvidiaDiscrete,
    /// Discrete AMD GPU (Vulkan / DX12).
    AmdDiscrete,
    /// Intel integrated GPU.
    IntelIntegrated,
    /// Any other integrated GPU not covered above.
    OtherIntegrated,
    /// Any other discrete GPU not covered above.
    OtherDiscrete,
    /// Software / CPU renderer (llvmpipe, WARP, SwiftShader).
    CpuOnly,
    /// No GPU adapter could be enumerated.
    Unknown,
}

/// Snapshot of hardware relevant to LLM inference.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    /// Total system RAM in bytes (encoded as f64 for TypeScript compatibility).
    #[specta(type = f64)]
    pub total_ram_bytes: u64,
    /// Number of physical CPU cores (excludes hyperthreads).
    pub physical_cores: u32,
    /// Number of logical CPU cores (includes hyperthreads).
    pub logical_cores: u32,
    /// CPU brand string, e.g. `"Apple M2 Pro"` or `"Intel Core i9-13900K"`.
    pub cpu_brand: String,
    /// Compile-time CPU architecture: `"aarch64"` or `"x86_64"`.
    pub cpu_arch: String,
    /// Whether this machine is Apple Silicon (aarch64 + macOS).
    pub is_apple_silicon: bool,
    /// Best GPU class detected.
    pub gpu_class: GpuClass,
    /// Human-readable GPU name, empty string if unknown.
    pub gpu_name: String,
    /// Available disk space (bytes) on the app-data volume (encoded as f64 for TypeScript compatibility).
    #[specta(type = f64)]
    pub available_disk_bytes: u64,
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

fn detect_cpu_and_ram() -> (u64, u32, u32, String) {
    let sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_memory(MemoryRefreshKind::nothing().with_ram())
            .with_cpu(CpuRefreshKind::nothing()),
    );

    let total_ram = sys.total_memory();
    let physical = sys.physical_core_count().unwrap_or(1) as u32;
    let logical = sys.cpus().len() as u32;
    let brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();

    (total_ram, physical, logical, brand)
}

fn detect_disk_space(app_data_path: &std::path::Path) -> u64 {
    let disks = Disks::new_with_refreshed_list();
    // Find the disk whose mount point is the longest prefix of app_data_path.
    let mut best_available: u64 = 0;
    let mut best_prefix_len: usize = 0;

    for disk in disks.list() {
        let mount = disk.mount_point();
        if app_data_path.starts_with(mount) {
            let prefix_len = mount.as_os_str().len();
            if prefix_len >= best_prefix_len {
                best_prefix_len = prefix_len;
                best_available = disk.available_space();
            }
        }
    }

    best_available
}

async fn detect_gpu() -> (GpuClass, String) {
    use wgpu::{Backends, DeviceType, Instance, InstanceDescriptor};

    // PCI vendor IDs
    const VENDOR_NVIDIA: u32 = 0x10DE;
    const VENDOR_AMD: u32 = 0x1002;
    const VENDOR_INTEL: u32 = 0x8086;
    const VENDOR_APPLE: u32 = 0x106B;

    let instance = Instance::new(InstanceDescriptor {
        backends: Backends::all(),
        ..Default::default()
    });

    let adapters: Vec<_> = instance.enumerate_adapters(Backends::all());

    // Score adapters: prefer discrete over integrated, hardware over software.
    fn score(info: &wgpu::AdapterInfo) -> i32 {
        match info.device_type {
            DeviceType::DiscreteGpu => 3,
            DeviceType::IntegratedGpu => 2,
            DeviceType::VirtualGpu => 1,
            DeviceType::Cpu => 0,
            DeviceType::Other => 0,
        }
    }

    let best = adapters.iter().map(|a| a.get_info()).max_by_key(score);

    let Some(info) = best else {
        return (GpuClass::Unknown, String::new());
    };

    let gpu_name = info.name.clone();
    let vendor = info.vendor & 0xFFFF; // lower 16 bits are PCI vendor

    let class = match info.device_type {
        DeviceType::Cpu => GpuClass::CpuOnly,
        DeviceType::DiscreteGpu => match vendor {
            VENDOR_NVIDIA => GpuClass::NvidiaDiscrete,
            VENDOR_AMD => GpuClass::AmdDiscrete,
            _ => GpuClass::OtherDiscrete,
        },
        DeviceType::IntegratedGpu => {
            // Apple Silicon: Metal backend, Apple vendor or "Apple" in name
            let is_apple = vendor == VENDOR_APPLE
                || info.name.to_lowercase().contains("apple")
                || info.backend == wgpu::Backend::Metal;
            if is_apple {
                GpuClass::AppleSilicon
            } else if vendor == VENDOR_INTEL {
                GpuClass::IntelIntegrated
            } else {
                GpuClass::OtherIntegrated
            }
        }
        _ => GpuClass::Unknown,
    };

    (class, gpu_name)
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Detect the hardware profile of the current machine.
///
/// `app_data_path` should be the Tauri app-data directory so we can report
/// free space on the correct volume.
pub async fn detect_hardware(app_data_path: &std::path::Path) -> HardwareProfile {
    // Run CPU/RAM (sync) concurrently with GPU (async).
    let (cpu_ram_result, (gpu_class, gpu_name)) = tokio::join!(
        tokio::task::spawn_blocking(detect_cpu_and_ram),
        detect_gpu(),
    );

    let (total_ram, physical_cores, logical_cores, cpu_brand) =
        cpu_ram_result.unwrap_or((0, 1, 1, String::new()));

    let available_disk_bytes = detect_disk_space(app_data_path);

    let cpu_arch = std::env::consts::ARCH.to_string();
    let is_apple_silicon = cfg!(target_os = "macos") && cpu_arch == "aarch64";

    HardwareProfile {
        total_ram_bytes: total_ram,
        physical_cores,
        logical_cores,
        cpu_brand,
        cpu_arch,
        is_apple_silicon,
        gpu_class,
        gpu_name,
        available_disk_bytes,
    }
}
