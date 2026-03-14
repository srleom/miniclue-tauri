// Polyfill for URL.parse(), introduced in Chrome 126 / Safari 18.2 / Firefox 131.
// Tauri on macOS uses the system WKWebView, which may be on an older WebKit version.
// pdfjs-dist@5.4.296 calls URL.parse() unconditionally, so this must run before any PDF rendering.
if (!('parse' in URL)) {
  (
    URL as unknown as { parse: (url: string, base?: string) => URL | null }
  ).parse = (url: string, base?: string): URL | null => {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  };
}
