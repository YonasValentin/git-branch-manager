// Pure CSS builder for the webview <style> block.
// Lives outside extension.ts so it can be unit-tested without mocking vscode.Webview.
//
// Token values, keyframes, scrollbars, focus-ring, and @font-face all live here.
// extension.ts wires this into getWebviewContent's HTML template via webview-resolved font URIs.

export function buildWebviewCss(fontUri: (filename: string) => string): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; }

    /* Geist — bundled at media/fonts/. font-display: swap falls back cleanly to system fonts if assets are missing. */
    @font-face { font-family: 'Geist'; font-weight: 300; font-display: swap; font-style: normal; src: url('${fontUri('Geist-Light.woff2')}') format('woff2'); }
    @font-face { font-family: 'Geist'; font-weight: 400; font-display: swap; font-style: normal; src: url('${fontUri('Geist-Regular.woff2')}') format('woff2'); }
    @font-face { font-family: 'Geist'; font-weight: 500; font-display: swap; font-style: normal; src: url('${fontUri('Geist-Medium.woff2')}') format('woff2'); }
    @font-face { font-family: 'Geist'; font-weight: 600; font-display: swap; font-style: normal; src: url('${fontUri('Geist-SemiBold.woff2')}') format('woff2'); }
    @font-face { font-family: 'Geist'; font-weight: 700; font-display: swap; font-style: normal; src: url('${fontUri('Geist-Bold.woff2')}') format('woff2'); }
    @font-face { font-family: 'Geist Mono'; font-weight: 400; font-display: swap; font-style: normal; src: url('${fontUri('GeistMono-Regular.woff2')}') format('woff2'); }
    @font-face { font-family: 'Geist Mono'; font-weight: 500; font-display: swap; font-style: normal; src: url('${fontUri('GeistMono-Medium.woff2')}') format('woff2'); }
    @font-face { font-family: 'Geist Mono'; font-weight: 600; font-display: swap; font-style: normal; src: url('${fontUri('GeistMono-SemiBold.woff2')}') format('woff2'); }

    /* Design tokens — dark theme default */
    :root, [data-theme="dark"] {
      --bg:           #0a0a0b;
      --bg-elevated:  #111114;
      --bg-raised:    #17171b;
      --bg-hover:     #1c1c22;
      --bg-input:     #0f0f12;
      --bg-selected:  rgba(52, 211, 153, 0.07);

      --border:       #1f1f25;
      --border-strong:#2a2a32;
      --border-focus: var(--accent);

      --fg:           #ededee;
      --fg-strong:    #fafafa;
      --fg-muted:     #a1a1a8;
      --fg-subtle:    #6e6e76;
      --fg-faint:     #4a4a52;

      --accent:       #34d399;
      --accent-strong:#10b981;
      --accent-soft:  rgba(52, 211, 153, 0.12);
      --accent-ring:  rgba(52, 211, 153, 0.35);

      --healthy:      #34d399;
      --warning:      #f59e0b;
      --critical:     #fb923c;
      --danger:       #f43f5e;
      --info:         #60a5fa;
      --pr:           #a78bfa;

      --scrollbar:       #2a2a32;
      --scrollbar-hover: #3a3a44;

      --shadow-toast:    0 12px 40px -8px rgba(0,0,0,0.7);
      --shadow-popover:  0 8px 30px -8px rgba(0,0,0,0.6), 0 2px 6px -2px rgba(0,0,0,0.4);
      --shadow-drawer:   -8px 0 30px -10px rgba(0,0,0,0.6);

      --row-py: 10px;
      --row-px: 14px;
      --row-h:  44px;
      --gap-y:  2px;

      --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      --font-mono: "Geist Mono", ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;

      color-scheme: dark;
    }

    [data-theme="light"] {
      --bg:           #fafaf9;
      --bg-elevated:  #ffffff;
      --bg-raised:    #ffffff;
      --bg-hover:     #f4f4f3;
      --bg-input:     #ffffff;
      --bg-selected:  rgba(16, 185, 129, 0.08);

      --border:       #ececea;
      --border-strong:#dcdcd9;
      --border-focus: var(--accent-strong);

      --fg:           #1c1c1f;
      --fg-strong:    #0a0a0b;
      --fg-muted:     #5b5b62;
      --fg-subtle:    #84848c;
      --fg-faint:     #b5b5bc;

      --accent:       #10b981;
      --accent-strong:#059669;
      --accent-soft:  rgba(16, 185, 129, 0.10);
      --accent-ring:  rgba(16, 185, 129, 0.30);

      --healthy:      #059669;
      --warning:      #d97706;
      --critical:     #ea580c;
      --danger:       #e11d48;
      --info:         #2563eb;
      --pr:           #7c3aed;

      --scrollbar:       #d4d4d2;
      --scrollbar-hover: #b8b8b5;

      --shadow-toast:    0 12px 40px -8px rgba(0,0,0,0.2);
      --shadow-popover:  0 8px 30px -8px rgba(0,0,0,0.18), 0 2px 6px -2px rgba(0,0,0,0.08);
      --shadow-drawer:   -8px 0 30px -10px rgba(0,0,0,0.12);

      color-scheme: light;
    }

    body {
      background: var(--bg, var(--vscode-editor-background));
      color: var(--fg, var(--vscode-editor-foreground));
      font-family: var(--font-sans);
      font-feature-settings: "ss01", "ss03", "cv11";
      font-size: 13.5px;
      line-height: 1.45;
      letter-spacing: -0.005em;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      overflow: hidden;
    }
    button, input, textarea, select { font-family: inherit; }
    button { cursor: pointer; }

    /* Scrollbars */
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 6px; border: 2px solid transparent; background-clip: content-box; }
    ::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); background-clip: content-box; border: 2px solid transparent; }

    /* Focus ring — applied via className="focus-ring" on interactive elements. */
    .focus-ring:focus-visible {
      outline: 2px solid var(--accent-ring);
      outline-offset: 2px;
      border-radius: 6px;
    }

    /* Animations */
    @keyframes fade-in        { from { opacity: 0 } to { opacity: 1 } }
    @keyframes slide-up       { from { transform: translateY(8px); opacity: 0 } to { transform: none; opacity: 1 } }
    @keyframes slide-in-right { from { transform: translateX(16px); opacity: 0 } to { transform: none; opacity: 1 } }
    @keyframes toast-in       { from { transform: translateX(32px); opacity: 0 } to { transform: none; opacity: 1 } }
    @keyframes pulse-dot      { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
    @keyframes spin           { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;
}
