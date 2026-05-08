import { describe, expect, test } from 'vitest';
import { buildWebviewCss } from './buildWebviewCss';

const fakeFontUri = (f: string) => `https://test.example/fonts/${f}`;

describe('buildWebviewCss', () => {
  test('fixes the --critical token bug (was duplicating --danger)', () => {
    const css = buildWebviewCss(fakeFontUri);
    // Dark theme: critical should be orange, distinct from danger
    expect(css).toContain('--critical:     #fb923c');
    expect(css).not.toContain('--critical:     #f43f5e');
    // Light theme: critical should be its own orange
    expect(css).toContain('--critical:     #ea580c');
  });

  test('defines pulse-dot keyframe used by StatusDot pending state', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toMatch(/@keyframes pulse-dot\s*\{/);
    expect(css).toContain('opacity: 0.5');
    expect(css).toContain('scale(0.8)');
  });

  test('defines spin keyframe', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toMatch(/@keyframes spin\s*\{/);
    expect(css).toContain('rotate(360deg)');
  });

  test('emits @font-face for Geist with all required weights', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toContain("font-family: 'Geist'");
    expect(css).toContain("font-family: 'Geist Mono'");
    // 8 distinct font-face rules — 5 sans (300/400/500/600/700) + 3 mono (400/500/600)
    const fontFaces = css.match(/@font-face/g) ?? [];
    expect(fontFaces.length).toBe(8);
  });

  test('font-face rules use the fontUri callback for src URLs', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toContain("url('https://test.example/fonts/Geist-Regular.woff2')");
    expect(css).toContain("url('https://test.example/fonts/GeistMono-Regular.woff2')");
    expect(css).toContain("url('https://test.example/fonts/Geist-Bold.woff2')");
    expect(css).toContain('format(\'woff2\')');
    expect(css).toContain('font-display: swap');
  });

  test('emits complete light-theme accent + status overrides', () => {
    const css = buildWebviewCss(fakeFontUri);
    // Light-mode accent must override dark — the previous version was missing this entirely
    expect(css).toContain('--accent:       #10b981');
    expect(css).toContain('--accent-strong:#059669');
    expect(css).toContain('--healthy:      #059669');
    expect(css).toContain('--warning:      #d97706');
    expect(css).toContain('--danger:       #e11d48');
    expect(css).toContain('--info:         #2563eb');
    expect(css).toContain('--pr:           #7c3aed');
  });

  test('uses solid (not translucent) backgrounds and borders in dark mode', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toContain('--bg-hover:     #1c1c22');
    expect(css).toContain('--bg-input:     #0f0f12');
    expect(css).toContain('--border:       #1f1f25');
    expect(css).toContain('--border-strong:#2a2a32');
    // The previous version used rgba — make sure none of the old patterns slipped back
    expect(css).not.toContain('--bg-hover:     rgba(255,255,255,0.06)');
  });

  test('emits .focus-ring utility class', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toContain('.focus-ring:focus-visible');
    expect(css).toContain('outline: 2px solid var(--accent-ring)');
  });

  test('emits scrollbar styling tied to design tokens', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toContain('::-webkit-scrollbar');
    expect(css).toContain('background: var(--scrollbar)');
    expect(css).toContain('--scrollbar:       #2a2a32');
    expect(css).toContain('--scrollbar-hover: #3a3a44');
  });

  test('body styles match design typography contract', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toContain("font-feature-settings: \"ss01\", \"ss03\", \"cv11\"");
    expect(css).toContain('font-size: 13.5px');
    expect(css).toContain('line-height: 1.45');
    expect(css).toContain('letter-spacing: -0.005em');
    expect(css).toContain('-webkit-font-smoothing: antialiased');
  });

  test('emits density tokens for cozy mode', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toContain('--row-py: 10px');
    expect(css).toContain('--row-px: 14px');
    expect(css).toContain('--row-h:  44px');
  });

  test('emits color-scheme for both themes (lets browser native UI adapt)', () => {
    const css = buildWebviewCss(fakeFontUri);
    expect(css).toContain('color-scheme: dark');
    expect(css).toContain('color-scheme: light');
  });
});
