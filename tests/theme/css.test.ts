import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
import { describe, expect, it } from "vitest";
import { BASE_CSS } from "../../src/theme/base-css";
import { DEFAULT_THEME_CSS, DEFAULT_THEME_KEY } from "../../src/theme/default-theme";

extend([a11yPlugin]);

/** Spec 10.13: genau diese Namen, Präfix `--ht-`. */
const COLOR_TOKENS = [
  "ground", "surface", "text", "text-dim", "border", "accent", "on-accent", "focus", "highlight",
  "signal-info", "signal-ok", "signal-warn", "signal-error",
  "cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6",
].map((name) => `--ht-${name}`);
const OTHER_TOKENS = [
  "font-display", "font-body", "font-mono", "size-base", "leading",
  "size-h1", "size-h2", "size-h3", "size-h4", "space", "radius", "measure",
].map((name) => `--ht-${name}`);
const ALL_TOKENS = [...COLOR_TOKENS, ...OTHER_TOKENS];

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

function themeBlocks(): { light: Map<string, string>; dark: Map<string, string> } {
  const lightMatch = /^:root\s*\{([^}]*)\}/m.exec(DEFAULT_THEME_CSS);
  const darkMatch = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(DEFAULT_THEME_CSS);
  expect(lightMatch, ":root block").not.toBeNull();
  expect(darkMatch, "dark block").not.toBeNull();
  return { light: declarations(lightMatch![1]), dark: declarations(darkMatch![1]) };
}

const flat = (css: string) => css.replace(/\s+/g, " ");
const beforePrint = BASE_CSS.slice(0, BASE_CSS.indexOf("@media print"));
const printBlock = BASE_CSS.slice(BASE_CSS.indexOf("@media print"));

describe("Standard-Thema", () => {
  it("hat den Schlüssel default", () => {
    expect(DEFAULT_THEME_KEY).toBe("default");
  });

  it("setzt jedes Token in :root, die Farben zusätzlich unter prefers-color-scheme: dark", () => {
    const { light, dark } = themeBlocks();
    for (const token of ALL_TOKENS) expect(light.has(token), `${token} in :root`).toBe(true);
    for (const token of COLOR_TOKENS) expect(dark.has(token), `${token} im dunklen Block`).toBe(true);
  });

  it("setzt keine anderen Tokens als die der Tabelle", () => {
    const { light, dark } = themeBlocks();
    for (const name of [...light.keys(), ...dark.keys()]) expect(ALL_TOKENS, name).toContain(name);
  });

  it("benutzt Systemschriften und bettet keine Schrift ein", () => {
    const { light } = themeBlocks();
    expect(light.get("--ht-font-body")).toContain("system-ui");
    expect(light.get("--ht-font-display")).toContain("system-ui");
    expect(light.get("--ht-font-mono")).toContain("ui-monospace");
    expect(DEFAULT_THEME_CSS).not.toMatch(/@font-face|@import|url\(/);
  });

  it("trägt die Direktiven im Kopfkommentar", () => {
    expect(DEFAULT_THEME_CSS).toMatch(/^\/\*[\s\S]*ht-label: Neutral[\s\S]*\*\//);
    expect(DEFAULT_THEME_CSS).toMatch(/ht-sharing: open/);
  });
});

describe("Grundgestaltung", () => {
  it("benutzt außer --ht-* keine Custom Property", () => {
    expect(BASE_CSS).not.toMatch(/--(?!ht-)[a-z]/);
  });

  it("verweist nur auf Tokens der Tabelle", () => {
    for (const m of BASE_CSS.matchAll(/var\((--[a-z0-9-]+)/g)) expect(ALL_TOKENS, m[1]).toContain(m[1]);
  });

  it("benutzt außerhalb des Druckblocks keine Farbe als Literal", () => {
    expect(beforePrint.length).toBeGreaterThan(0);
    expect(beforePrint).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("lädt nichts nach", () => {
    expect(BASE_CSS).not.toMatch(/@import|url\(/);
  });

  it("gestaltet Obsidians gerenderte Elemente und die Klassen der Seite", () => {
    const css = flat(BASE_CSS);
    for (const selector of [
      ".callout", ".callout-title", "data-callout=\"warning\"", ".task-list-item", ".footnotes", "pre code",
      "table", ".mermaid svg", "mjx-container", "mark", ".ht-hit", ".tag", ".ht-tag", ".ht-table",
      ".ht-summary-line", ".ht-media-missing", "details", "summary", "nav", ".ht-skip",
    ]) {
      expect(css, selector).toContain(selector);
    }
    expect(css).toContain(".mermaid svg { max-width: 100%;");
  });

  it("macht Schaltflächen 44 px hoch und gibt dem Fokus einen Rahmen in --ht-focus", () => {
    const css = flat(BASE_CSS);
    expect(css).toMatch(/button, \.ht-button \{[^}]*min-height: 44px/);
    expect(css).toContain(":focus-visible { outline: 2px solid var(--ht-focus);");
  });

  it("legt Tabellen in einen waagerecht scrollbaren Behälter", () => {
    expect(flat(BASE_CSS)).toMatch(/\.ht-table \{[^}]*overflow-x: auto/);
  });

  it("druckt auf weißem Grund, ohne Navigation, mit offenen Bereichen und sichtbaren Adressen", () => {
    const css = flat(printBlock);
    expect(css).toMatch(/html, body \{ background: #ffffff;/);
    expect(css).toMatch(/nav, \.ht-skip \{ display: none; \}/);
    expect(css).toContain('a[href^="http"]::after { content: " (" attr(href) ")";');
    expect(css).toContain("details::details-content { content-visibility: visible; }");
    expect(css).toMatch(/details:not\(\[open\]\) > summary::before/);
  });

  it("sorgt am Handy für eine Spalte ohne waagerechtes Scrollen", () => {
    const css = flat(BASE_CSS);
    expect(css).toMatch(/img, video, svg \{ max-width: 100%;/);
    expect(css).toMatch(/pre \{[^}]*overflow-x: auto/);
    expect(css).toMatch(/body \{[^}]*overflow-wrap: break-word/);
    expect(css).toMatch(/main, nav \{[^}]*max-width: var\(--ht-measure\)/);
  });
});

describe("Kontrast des Standard-Themas", () => {
  const { light, dark } = themeBlocks();
  const modes = [["hell", light], ["dunkel", dark]] as const;
  // Pflicht laut Bauplan (Task 11) und Zusätze, die das Thema zusätzlich hält.
  const pairs: Array<{ fg: string; bg: string; min: number }> = [
    { fg: "text", bg: "ground", min: 4.5 },
    { fg: "text", bg: "surface", min: 4.5 },
    { fg: "text-dim", bg: "ground", min: 4.5 },
    { fg: "focus", bg: "ground", min: 3 },
    { fg: "focus", bg: "surface", min: 3 },
    { fg: "on-accent", bg: "accent", min: 4.5 },
    // zusätzlich
    { fg: "text-dim", bg: "surface", min: 4.5 },
    { fg: "accent", bg: "ground", min: 4.5 },
    { fg: "accent", bg: "surface", min: 4.5 },
    { fg: "text", bg: "highlight", min: 4.5 },
    { fg: "signal-info", bg: "surface", min: 3 },
    { fg: "signal-ok", bg: "surface", min: 3 },
    { fg: "signal-warn", bg: "surface", min: 3 },
    { fg: "signal-error", bg: "surface", min: 3 },
  ];

  for (const [mode, own] of modes) {
    for (const { fg, bg, min } of pairs) {
      it(`${mode}: --ht-${fg} gegen --ht-${bg} mindestens ${min} : 1`, () => {
        const get = (name: string) => own.get(`--ht-${name}`) ?? light.get(`--ht-${name}`)!;
        const ratio = colord(get(fg)).contrast(get(bg));
        if (process.env.HT_CONTRAST_REPORT) console.info(`KONTRAST ${mode} ${fg}/${bg} ${ratio.toFixed(2)}`);
        expect(ratio).toBeGreaterThanOrEqual(min);
      });
    }
  }
});
