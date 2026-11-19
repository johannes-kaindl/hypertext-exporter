/**
 * Standard-Thema der erzeugten Seite (Spec 10.13): neutral, Systemschriften, keine eingebettete Schrift.
 * Es setzt nur Tokens (`--ht-*`); alle Regeln stehen in der Grundgestaltung (`base-css.ts`).
 * Die Farben sind hell als Grundwert und dunkel unter `prefers-color-scheme: dark`; die übrigen Tokens gelten in beiden Modi.
 */

export const DEFAULT_THEME_KEY = "default";

export const DEFAULT_THEME_CSS: string = String.raw`/*
 * ht-label: Neutral
 * ht-sharing: open
 */
:root {
  color-scheme: light dark;
  --ht-ground: #ffffff;
  --ht-surface: #f4f5f7;
  --ht-text: #1f2328;
  --ht-text-dim: #565e68;
  --ht-border: #d0d5db;
  --ht-accent: #1c4fb8;
  --ht-on-accent: #ffffff;
  --ht-focus: #0a58d6;
  --ht-highlight: #ffe58a;
  --ht-signal-info: #1c5fc2;
  --ht-signal-ok: #1a7335;
  --ht-signal-warn: #9a5b00;
  --ht-signal-error: #c42235;
  --ht-cat-1: #1c5fc2;
  --ht-cat-2: #b3500a;
  --ht-cat-3: #1a7335;
  --ht-cat-4: #7a45c7;
  --ht-cat-5: #b3347f;
  --ht-cat-6: #565e68;
  --ht-font-display: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --ht-font-body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --ht-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --ht-size-base: 1rem;
  --ht-leading: 1.6;
  --ht-size-h1: 2rem;
  --ht-size-h2: 1.5rem;
  --ht-size-h3: 1.25rem;
  --ht-size-h4: 1.1rem;
  --ht-space: 0.5rem;
  --ht-radius: 6px;
  --ht-measure: 72ch;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ht-ground: #14171a;
    --ht-surface: #1e2328;
    --ht-text: #e6e8eb;
    --ht-text-dim: #a3abb5;
    --ht-border: #3b424a;
    --ht-accent: #7ab0ff;
    --ht-on-accent: #0b1220;
    --ht-focus: #8ab9ff;
    --ht-highlight: #6a5800;
    --ht-signal-info: #7ab0ff;
    --ht-signal-ok: #5fc47e;
    --ht-signal-warn: #e0a042;
    --ht-signal-error: #ff7b86;
    --ht-cat-1: #7ab0ff;
    --ht-cat-2: #f0955a;
    --ht-cat-3: #5fc47e;
    --ht-cat-4: #b794f0;
    --ht-cat-5: #f08fc3;
    --ht-cat-6: #a3abb5;
  }
}
`;
