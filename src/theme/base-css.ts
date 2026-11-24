/**
 * Grundgestaltung der erzeugten Seite (Spec 10.13): Aufbau der Seite und Obsidians gerenderte Elemente.
 * Sie benutzt ausschließlich Tokens (`--ht-*`) und keine Farbe als Literal; nur der Druckblock am Ende
 * setzt feste Farben, weil Papier weiß ist, egal was das Thema vorsieht.
 * Das ist die Zeichenkette für das eine `<style>`-Element der Seite, nicht das Stylesheet des Plugins.
 */

/** Callout-Arten von Obsidian (`data-callout`), nach Signalfarbe gruppiert. */
const CALLOUT_SIGNALS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["info", ["note", "info", "todo", "abstract", "summary", "tldr"]],
  ["ok", ["tip", "hint", "important", "success", "check", "done"]],
  ["warn", ["warning", "caution", "attention", "question", "help", "faq"]],
  ["error", ["danger", "error", "failure", "fail", "missing", "bug"]],
];

const calloutKinds = CALLOUT_SIGNALS.map(([signal, kinds]) => {
  const own = (suffix: string) => kinds.map((kind) => `.callout[data-callout="${kind}"]${suffix}`).join(",\n");
  return `${own("")} {
  border-left-color: var(--ht-signal-${signal});
  background: color-mix(in srgb, var(--ht-signal-${signal}) 10%, var(--ht-surface));
}
${own(" > .callout-title .callout-icon")} {
  color: var(--ht-signal-${signal});
}`;
}).join("\n");

const LAYOUT = String.raw`
html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

body {
  margin: 0;
  background: var(--ht-ground);
  color: var(--ht-text);
  font-family: var(--ht-font-body);
  font-size: var(--ht-size-base);
  line-height: var(--ht-leading);
  overflow-wrap: break-word;
}

main,
nav {
  box-sizing: border-box;
  max-width: var(--ht-measure);
  margin: 0 auto;
  padding: var(--ht-space) calc(var(--ht-space) * 2);
}

/* Inhalt der Notizen ist fremder Text: ein style-Attribut darf Layout setzen (style-src-attr), aber ein position:fixed mit inset:0 soll keinen Klick
   außerhalb des Inhaltsbereichs fangen (Navigation, Werkzeuge). contain: paint macht main zum Bezugsrahmen für fixed und beschneidet auf seine Fläche. */
main {
  contain: paint;
}

nav {
  border-bottom: 1px solid var(--ht-border);
}

nav ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0 calc(var(--ht-space) * 2);
  margin: 0;
  padding: 0;
  list-style: none;
}

nav a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}

.ht-skip {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.ht-skip:focus {
  position: static;
  display: inline-flex;
  align-items: center;
  width: auto;
  height: auto;
  min-height: 44px;
  padding: 0 calc(var(--ht-space) * 2);
  overflow: visible;
  clip-path: none;
  background: var(--ht-accent);
  color: var(--ht-on-accent);
}

a {
  color: var(--ht-accent);
  text-underline-offset: 0.15em;
}

:focus-visible {
  outline: 2px solid var(--ht-focus);
  outline-offset: 2px;
}

h1,
h2,
h3,
h4,
h5,
h6 {
  margin: calc(var(--ht-space) * 2) 0 var(--ht-space);
  font-family: var(--ht-font-display);
  line-height: 1.25;
}

h1 { font-size: var(--ht-size-h1); }
h2 { font-size: var(--ht-size-h2); }
h3 { font-size: var(--ht-size-h3); }
h4 { font-size: var(--ht-size-h4); }
h5,
h6 { font-size: var(--ht-size-base); }

p,
ul,
ol,
blockquote {
  margin: var(--ht-space) 0;
}

blockquote {
  padding: 0 calc(var(--ht-space) * 2);
  border-left: 3px solid var(--ht-border);
  color: var(--ht-text-dim);
}

hr {
  border: 0;
  border-top: 1px solid var(--ht-border);
}

img,
video,
svg {
  max-width: 100%;
  height: auto;
}

audio {
  width: 100%;
}

button,
.ht-button {
  box-sizing: border-box;
  min-width: 44px;
  min-height: 44px;
  padding: 0 calc(var(--ht-space) * 2);
  border: 1px solid transparent;
  border-radius: var(--ht-radius);
  background: var(--ht-accent);
  color: var(--ht-on-accent);
  font: inherit;
  cursor: pointer;
}

mark,
.ht-hit {
  background: var(--ht-highlight);
  color: var(--ht-text);
}

.tag,
.ht-tag {
  display: inline-block;
  padding: 0 calc(var(--ht-space) * 0.75);
  border: 1px solid var(--ht-border);
  border-radius: 999px;
  background: var(--ht-surface);
  color: var(--ht-text);
  font-size: 0.9em;
  text-decoration: none;
}
`;

const FOLDING = String.raw`
details {
  margin: var(--ht-space) 0;
  border: 1px solid var(--ht-border);
  border-radius: var(--ht-radius);
}

details[open] {
  background: var(--ht-surface);
}

summary {
  box-sizing: border-box;
  min-height: 44px;
  padding: calc(var(--ht-space) * 0.5) calc(var(--ht-space) * 1.5);
  cursor: pointer;
  list-style: none;
}

summary::-webkit-details-marker {
  display: none;
}

summary::before {
  content: "\25B8";
  display: inline-block;
  margin-right: var(--ht-space);
  color: var(--ht-accent);
}

details[open] > summary::before {
  content: "\25BE";
}

summary > h1,
summary > h2,
summary > h3,
summary > h4,
summary > h5,
summary > h6 {
  display: inline;
  margin: 0;
}

details > :not(summary) {
  margin-right: calc(var(--ht-space) * 1.5);
  margin-left: calc(var(--ht-space) * 1.5);
}

details[open] > summary {
  border-bottom: 1px solid var(--ht-border);
}

.ht-summary-line {
  margin: 0;
  color: var(--ht-text-dim);
  font-size: 0.9em;
}

.ht-media-missing {
  display: inline-block;
  padding: 0 var(--ht-space);
  border: 1px dashed var(--ht-border);
  border-radius: var(--ht-radius);
  color: var(--ht-text-dim);
  font-family: var(--ht-font-mono);
  font-size: 0.9em;
}
`;

const OBSIDIAN_ELEMENTS = String.raw`
.callout {
  margin: var(--ht-space) 0;
  padding: 0;
  border: 1px solid var(--ht-border);
  border-left: 4px solid var(--ht-signal-info);
  border-radius: var(--ht-radius);
  background: var(--ht-surface);
}

.callout-title {
  display: flex;
  align-items: center;
  gap: var(--ht-space);
  padding: var(--ht-space) calc(var(--ht-space) * 1.5);
  font-weight: 600;
}

.callout-icon {
  display: inline-flex;
  flex: none;
  width: 1.25em;
  height: 1.25em;
}

.callout-icon svg {
  width: 100%;
  height: 100%;
}

.callout-title-inner {
  flex: 1;
  min-width: 0;
}

.callout-fold {
  display: none;
}

.callout-content {
  padding: 0 calc(var(--ht-space) * 1.5) var(--ht-space);
}

details.callout > summary {
  border-bottom: 0;
}

details.callout > summary::before {
  content: none;
}

details.callout > :not(summary) {
  margin-right: 0;
  margin-left: 0;
}

details.callout[open] > summary + * {
  border-top: 1px solid var(--ht-border);
}
${calloutKinds}

ul.contains-task-list,
.task-list-item {
  list-style: none;
}

ul.contains-task-list {
  padding-left: calc(var(--ht-space) * 0.5);
}

.task-list-item-checkbox {
  margin-right: var(--ht-space);
}

.task-list-item.is-checked,
.task-list-item[data-task="x"] {
  color: var(--ht-text-dim);
  text-decoration: line-through;
}

sup.footnote-ref {
  line-height: 0;
}

.footnotes {
  margin-top: calc(var(--ht-space) * 4);
  padding-top: var(--ht-space);
  border-top: 1px solid var(--ht-border);
  color: var(--ht-text-dim);
  font-size: 0.9em;
}

.footnotes hr {
  display: none;
}

pre {
  max-width: 100%;
  margin: var(--ht-space) 0;
  padding: var(--ht-space) calc(var(--ht-space) * 1.5);
  overflow-x: auto;
  border: 1px solid var(--ht-border);
  border-radius: var(--ht-radius);
  background: var(--ht-surface);
}

code {
  font-family: var(--ht-font-mono);
  font-size: 0.9em;
}

:not(pre) > code {
  padding: 0 calc(var(--ht-space) * 0.5);
  border-radius: calc(var(--ht-radius) / 2);
  background: var(--ht-surface);
}

pre code {
  white-space: pre;
}

.token.comment {
  color: var(--ht-text-dim);
  font-style: italic;
}

.token.keyword {
  color: var(--ht-accent);
  font-weight: 600;
}

table {
  border-collapse: collapse;
  max-width: 100%;
}

th,
td {
  padding: calc(var(--ht-space) * 0.5) var(--ht-space);
  border: 1px solid var(--ht-border);
  text-align: left;
  vertical-align: top;
}

th {
  background: var(--ht-surface);
}

.ht-table {
  max-width: 100%;
  margin: var(--ht-space) 0;
  overflow-x: auto;
}

.mermaid {
  max-width: 100%;
  overflow-x: auto;
}

.mermaid svg {
  max-width: 100%;
}

mjx-container {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}

mjx-container[display="true"] {
  display: block;
  margin: var(--ht-space) 0;
  text-align: center;
}
`;

const PRINT = String.raw`
@media print {
  :root:root {
    --ht-ground: #ffffff;
    --ht-surface: #f2f2f2;
    --ht-text: #000000;
    --ht-text-dim: #404040;
    --ht-border: #808080;
    --ht-accent: #000000;
    --ht-on-accent: #ffffff;
    --ht-highlight: #e0e0e0;
  }

  html,
  body {
    background: #ffffff;
    color: #000000;
  }

  nav,
  .ht-skip {
    display: none;
  }

  main {
    max-width: none;
    padding: 0;
    contain: none;
  }

  a[href^="http"]::after {
    content: " (" attr(href) ")";
    overflow-wrap: anywhere;
  }

  details::details-content {
    content-visibility: visible;
  }

  details:not([open]) > summary::before {
    content: "\25BE";
  }

  summary {
    cursor: auto;
  }

  details,
  pre,
  .callout,
  tr,
  img {
    break-inside: avoid;
  }

  .ht-table,
  pre,
  .mermaid,
  mjx-container {
    overflow: visible;
  }
}
`;

export const BASE_CSS: string = `${LAYOUT}${FOLDING}${OBSIDIAN_ELEMENTS}${PRINT}`.replace(/^\n/, "");
