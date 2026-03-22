use pdfium_render::prelude::*;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use thiserror::Error;

#[derive(Error, Debug)]
#[allow(clippy::enum_variant_names)]
pub enum PdfParserError {
    #[error("Failed to open PDF file: {0}")]
    FileOpenError(String),
    #[error("Failed to extract text from PDF: {0}")]
    ExtractionError(String),
    #[error("Invalid PDF format")]
    #[allow(dead_code)]
    InvalidFormat,
    #[error("Failed to load pdfium library: {0}")]
    PdfiumLibraryError(String),
    #[error("Failed to render page screenshot: {0}")]
    ScreenshotError(String),
    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct ExtractedPage {
    pub page_number: i64,
    pub raw_text: String,
    pub screenshot_path: String,
}

/// Extract text and generate screenshots from PDF
pub fn extract_pages(
    file_path: &str,
    document_id: &str,
    app_data_dir: &Path,
    app_handle: &AppHandle,
) -> Result<Vec<ExtractedPage>, PdfParserError> {
    // Create screenshots directory under a dedicated pages subfolder
    let pages_dir = app_data_dir
        .join("documents")
        .join(document_id)
        .join("pages");
    fs::create_dir_all(&pages_dir)?;

    // Read the entire PDF into memory
    let bytes = fs::read(file_path).map_err(|e| PdfParserError::FileOpenError(e.to_string()))?;

    // Load PDF with pdfium for both text extraction and screenshot generation
    let pdfium = bind_pdfium(app_handle)?;

    let document = pdfium
        .load_pdf_from_byte_slice(&bytes, None)
        .map_err(|e| PdfParserError::PdfiumLibraryError(e.to_string()))?;

    let page_count = document.pages().len() as usize;
    if page_count == 0 {
        return Ok(Vec::new());
    }

    let mut extracted_pages = Vec::with_capacity(page_count);

    // Process every PDF page so page metadata/count stays accurate even for empty-text pages.
    for idx in 0..page_count {
        let page_number = (idx + 1) as i64;

        let page = document.pages().get(idx as u16).map_err(|e| {
            PdfParserError::ScreenshotError(format!("Failed to get page {}: {}", idx + 1, e))
        })?;

        // Extract text via pdfium; fall back to empty string on any encoding issue rather than
        // propagating an error that would fail the entire document.
        let raw_text = page
            .text()
            .map(|t| t.all())
            .unwrap_or_default()
            .trim()
            .to_string();

        let render_config = PdfRenderConfig::new()
            .set_target_width(1200)
            .rotate_if_landscape(PdfPageRenderRotation::None, true);

        let bitmap = page.render_with_config(&render_config).map_err(|e| {
            PdfParserError::ScreenshotError(format!("Failed to render page {}: {}", page_number, e))
        })?;

        // Save screenshot as JPEG
        let screenshot_filename = screenshot_filename(page_number);
        let screenshot_path = pages_dir.join(&screenshot_filename);
        save_bitmap_as_jpeg(&bitmap, &screenshot_path, page_number)?;

        // Store relative path for database
        let relative_path = screenshot_relative_path(document_id, &screenshot_filename);

        extracted_pages.push(ExtractedPage {
            page_number,
            raw_text,
            screenshot_path: relative_path,
        });
    }

    Ok(extracted_pages)
}

fn screenshot_filename(page_number: i64) -> String {
    format!("page_{}.jpg", page_number)
}

fn screenshot_relative_path(document_id: &str, screenshot_filename: &str) -> String {
    format!("documents/{}/pages/{}", document_id, screenshot_filename)
}

fn save_bitmap_as_jpeg(
    bitmap: &PdfBitmap<'_>,
    screenshot_path: &Path,
    page_number: i64,
) -> Result<(), PdfParserError> {
    let rgb = bitmap.as_image().to_rgb8();
    log::debug!(
        "Saving page {} screenshot as JPEG at {}",
        page_number,
        screenshot_path.display()
    );

    rgb.save(screenshot_path).map_err(|e| {
        PdfParserError::ScreenshotError(format!(
            "Failed to save page {} screenshot as JPEG: {}",
            page_number, e
        ))
    })
}

fn bind_pdfium(app_handle: &AppHandle) -> Result<Pdfium, PdfParserError> {
    let mut attempted_paths = Vec::new();

    for candidate in candidate_pdfium_paths(app_handle) {
        let display_path = candidate.display().to_string();

        if !candidate.exists() {
            attempted_paths.push(format!("{display_path} (not found)"));
            continue;
        }

        match Pdfium::bind_to_library(&candidate) {
            Ok(bindings) => return Ok(Pdfium::new(bindings)),
            Err(error) => attempted_paths.push(format!("{display_path} (load failed: {error})")),
        }
    }

    match Pdfium::bind_to_system_library() {
        Ok(bindings) => Ok(Pdfium::new(bindings)),
        Err(system_error) => Err(PdfParserError::PdfiumLibraryError(format!(
            "Unable to load Pdfium. Tried bundled/library paths:\n{}\nSystem fallback failed: {}\n\
             Rebuild the app to trigger bundled Pdfium download, or install a compatible system Pdfium library.",
            attempted_paths.join("\n"),
            system_error
        ))),
    }
}

fn candidate_pdfium_paths(app_handle: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let library_filename = pdfium_library_filename();
    let target_subdir = pdfium_target_subdir();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("resources")
                .join("pdfium")
                .join(target_subdir)
                .join(library_filename),
        );
        candidates.push(resource_dir.join(library_filename));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join(library_filename));
    }

    let mut seen = HashSet::new();
    candidates.retain(|path| seen.insert(path.clone()));
    candidates
}

fn pdfium_library_filename() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "libpdfium.dylib"
    }
    #[cfg(target_os = "linux")]
    {
        "libpdfium.so"
    }
    #[cfg(target_os = "windows")]
    {
        "pdfium.dll"
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        "libpdfium"
    }
}

fn pdfium_target_subdir() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "macos-aarch64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "macos-x86_64"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x86_64"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "windows-x86_64"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    {
        "unsupported"
    }
}

#[cfg(test)]
mod tests {
    use super::{
        pdfium_library_filename, pdfium_target_subdir, screenshot_filename,
        screenshot_relative_path,
    };

    #[test]
    fn test_pdfium_library_filename() {
        let name = pdfium_library_filename();
        #[cfg(target_os = "macos")]
        assert_eq!(name, "libpdfium.dylib");
        #[cfg(target_os = "linux")]
        assert_eq!(name, "libpdfium.so");
        #[cfg(target_os = "windows")]
        assert_eq!(name, "pdfium.dll");
    }

    #[test]
    fn test_pdfium_target_subdir_is_supported() {
        assert_ne!(pdfium_target_subdir(), "unsupported");
    }

    #[test]
    fn test_screenshot_filename_uses_jpg() {
        assert_eq!(screenshot_filename(7), "page_7.jpg");
    }

    #[test]
    fn test_screenshot_relative_path_uses_pages_subfolder() {
        assert_eq!(
            screenshot_relative_path("doc-123", "page_7.jpg"),
            "documents/doc-123/pages/page_7.jpg"
        );
    }
}
