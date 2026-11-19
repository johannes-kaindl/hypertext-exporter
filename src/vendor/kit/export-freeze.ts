// vendored from obsidian-kit@0.103.0, src/pure/export-freeze.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// export-freeze.ts — einen von Obsidian gezeichneten Baum für eine STATISCHE Seite einfrieren: Canvas wird Bild, Bedienelemente und Arbeitsklassen fallen, Kontrollkästchen werden gesperrt, leer gebliebene Blöcke stehen im Befund.
// Kein `obsidian`-Import.
//
// Warum hier und nicht in code-kit (erste Frage aus AGENTS.md): der Vertrag liest Obsidians gerendertes DOM (Messung 4a der Spec hypertext-exporter, 2026-11-18, Obsidian 1.15.1): im Ergebnis stehen der Kopierknopf im Codeblock
// (`button.copy-code-button`) und die Arbeitsklasse `node-insert-event`, Aufgabenlisten tragen bedienbare Kontrollkästchen, ein Plugin-Block (`div.block-language-*`) kann leer bleiben. Dieselbe Art Annahme trägt `pdf/dom-to-ir`.
// Gesehen, nicht übernommen: 3d-codeblocks `viewport.ts` `capturePoster` (Standbild nur für die eigene Anzeige, wirft bei einem Canvas ohne Kontext nicht, liefert aber kein Urteil).
//
// Regeln (Spec 10.2 Schritt 4):
//  - `<canvas>` → `<img src="data:image/png;base64,…">` gleicher Pixelmaße (`width`, `height` aus dem Canvas, nicht aus dem Stil), `class`, `style` und `aria-label` (als `alt`) wandern mit. Scheitert `toDataURL` (ein verfärbter Canvas wirft
//    SecurityError; ein Canvas ohne Fläche liefert `data:,`), wird der Canvas ENTFERNT (er bliebe in einer Datei leer) und es steht ein Befund `canvas-failed` da.
//    Gleicht das Bild einer frischen Fläche gleicher Maße (ein WebGL-Puffer ohne `preserveDrawingBuffer` ist nach dem Zeichnen leer), steht `canvas-blank` im Befund und das Bild bleibt (Layout); Abnahme des 3D-Canvas ist „Bild nicht leer“.
//  - Bedienelemente fallen mit ihrem Element: `button.copy-code-button` immer, dazu die Liste unten; Arbeitsklassen (`node-insert-event`, …) fallen von ihrem Element, das Element bleibt.
//  - Kontrollkästchen `input[type=checkbox]` bekommen `disabled`, und ihr Zustand wird vom Eigenschaftswert (`checked`) ins Attribut geschrieben (Obsidian setzt die Eigenschaft; ohne das Attribut zeigt `innerHTML` jede Aufgabe offen).
//  - Leer gebliebene Blöcke (`mermaid` ohne `svg`, `div.block-language-*`, Einbettungen, `pre`, verbliebene Platzhalter `.is-loading`) ohne sichtbaren Text und ohne Bild, `svg`, `canvas`, `video`, `audio`, `table`, `iframe`, `object` stehen im Befund
//    `empty-block` (der Block bleibt stehen: ihn zu löschen verschwiege den Verlust).
// Idempotent. Das Bild entsteht über den Port `createEl` (Obsidian-Global `createEl`; `document.createElement` verletzt die Store-Regel `prefer-create-el`).

import { errorMessage } from "./error-message";

export interface ExportFreezePorts {
  /** Ein neues Element: `img` für das Bild, `canvas` für den Vergleich mit einer leeren Fläche gleicher Maße. */
  createEl(tag: "img" | "canvas"): HTMLElement;
}

export interface ExportFreezeOptions {
  /** Weitere Selektoren, deren Treffer samt Inhalt fallen (zusätzlich zu `FREEZE_CONTROL_SELECTORS`). */
  controlSelectors?: string[];
  /** Weitere Arbeitsklassen, die vom Element fallen (zusätzlich zu `FREEZE_WORK_CLASSES`); nur einfache Namen (Buchstaben, Ziffern, `_`, `-`), andere werden übergangen. */
  workClasses?: string[];
}

export type ExportFreezeFinding =
  /** Der Canvas konnte nicht in ein Bild gewandelt werden; er ist entfernt. `reason` ist die Meldung der Ausnahme oder `empty`. */
  | { kind: "canvas-failed"; reason: string }
  /** Das Bild ist leer: es gleicht Pixel für Pixel einer frischen Fläche gleicher Maße (ein WebGL-Puffer ohne `preserveDrawingBuffer` ist nach dem Zeichnen so leer). Das Bild bleibt stehen, damit die Seite ihr Layout behält. */
  | { kind: "canvas-blank"; width: number; height: number }
  /** Ein Block ist leer geblieben. `what`: `mermaid`, `plugin-block`, `embed`, `code`, `placeholder`; `hint` ist die Klassenliste des Elements. */
  | { kind: "empty-block"; what: "mermaid" | "plugin-block" | "embed" | "code" | "placeholder"; hint: string };

export interface ExportFreezeResult {
  canvases: number;
  /** Wie viele Bedienelemente (samt Inhalt) entfernt wurden; ein Element in einem entfernten zählt mit. */
  removed: number;
  /** Wie viele Kontrollkästchen gesperrt wurden. */
  checkboxes: number;
  findings: ExportFreezeFinding[];
}

/** Kopierknopf (gemessen 1.15.1, `MarkdownRenderer.render`: ein Knopf je Codeblock, `lucide-copy`) und die Bedienelemente der Lese- und Vorschauansicht, die Obsidians Skript bedient und eine Datei nicht (Namen aus Obsidians `app.css`; die Bases-Namen sind am gerenderten Block gemessen). Pilot `freeze`, 2026-11-19: in `MarkdownRenderer.render` einer Notiz mit Überschriften, verschachtelter Liste, Aufgabenliste, Einbettung und Codeblock steht NUR `copy-code-button`; die übrigen vier Namen kamen nicht vor (sie gehören der Lese-Ansicht, nicht dem Renderer) und stehen als Netz da. */
export const FREEZE_CONTROL_SELECTORS: readonly string[] = [
  "button.copy-code-button", ".edit-block-button", ".collapse-indicator", ".heading-collapse-indicator", ".list-collapse-indicator",
  // Bases (gemessen 1.15.1, Besteller hypertext-exporter, Etappe 0): jeder Block trägt seine ganze Bedienoberfläche (rund 6,5 KB): Kopf mit Toolbar, Suchzeile, Sortierknopf und Spaltengriff. Die Tabelle bleibt;
  // die Zählung „N results“ der Toolbar geht mit (die Zeilen der Tabelle sind sie).
  ".bases-header", ".bases-search-row", ".bases-table-header-sort", ".bases-table-header-resizer",
];
/** Arbeitsklassen (gemessen 1.15.1: `node-insert-event`). */
export const FREEZE_WORK_CLASSES: readonly string[] = ["node-insert-event"];

const VISIBLE_CONTENT = "img, svg, canvas, video, audio, table, iframe, object";

type EmptyWhat = Extract<ExportFreezeFinding, { kind: "empty-block" }>["what"];

function emptyBlockKind(el: Element): EmptyWhat | null {
  const cls = el.classList;
  if (cls.contains("is-loading")) return "placeholder";
  if (cls.contains("mermaid")) return "mermaid";
  if (cls.contains("internal-embed") || cls.contains("markdown-embed")) return "embed";
  if (el.tagName === "PRE") return "code";
  for (const c of Array.from(cls)) if (c.startsWith("block-language-")) return "plugin-block";
  return null;
}

/** Gleicht `url` dem Bild einer frischen Fläche gleicher Maße? Ein Fehler beim Vergleich zählt als „nicht leer“ (kein falscher Alarm). */
function isBlank(ports: ExportFreezePorts, url: string, width: number, height: number): boolean {
  try {
    const ref = ports.createEl("canvas") as HTMLCanvasElement;
    ref.width = width;
    ref.height = height;
    return ref.toDataURL("image/png") === url;
  } catch { return false; }
}

/** Friert den Baum unter `root` ein (Regeln im Kopf). Ändert den Baum. Wirft nicht. Linear in der Zahl der Knoten. */
export function freezeRenderedDom(root: ParentNode, ports: ExportFreezePorts, opts: ExportFreezeOptions = {}): ExportFreezeResult {
  const findings: ExportFreezeFinding[] = [];
  let canvases = 0;
  let removed = 0;
  let checkboxes = 0;

  for (const canvas of Array.from(root.querySelectorAll("canvas"))) {
    let url = "";
    let reason = "";
    try { url = (canvas).toDataURL("image/png"); } catch (e) { reason = errorMessage(e); }
    if (!url.startsWith("data:image/png;base64,") || url.length <= "data:image/png;base64,".length) {
      findings.push({ kind: "canvas-failed", reason: reason || "empty" });
      canvas.remove();
      continue;
    }
    const cw = (canvas).width;
    const ch = (canvas).height;
    if (isBlank(ports, url, cw, ch)) findings.push({ kind: "canvas-blank", width: cw, height: ch });
    const img = ports.createEl("img");
    img.setAttribute("src", url);
    img.setAttribute("width", String((canvas).width));
    img.setAttribute("height", String((canvas).height));
    for (const a of ["class", "style"]) { const v = canvas.getAttribute(a); if (v !== null) img.setAttribute(a, v); }
    img.setAttribute("alt", canvas.getAttribute("aria-label") ?? canvas.getAttribute("title") ?? "");
    canvas.replaceWith(img);
    canvases += 1;
  }

  const controls = [...FREEZE_CONTROL_SELECTORS, ...(opts.controlSelectors ?? [])].join(", ");
  for (const el of Array.from(root.querySelectorAll(controls))) {
    el.remove();
    removed += 1;
  }

  for (const cls of [...FREEZE_WORK_CLASSES, ...(opts.workClasses ?? [])]) {
    if (!/^[\w-]+$/.test(cls)) continue;   // nur einfache Klassennamen: sie gehen in einen Selektor
    for (const el of Array.from(root.querySelectorAll(`.${cls}`))) {
      el.classList.remove(cls);
      if ((el.getAttribute("class") ?? "").trim() === "") el.removeAttribute("class");
    }
  }

  for (const box of Array.from(root.querySelectorAll('input[type="checkbox"]'))) {
    const input = box as HTMLInputElement;
    if (input.checked) input.setAttribute("checked", ""); else input.removeAttribute("checked");
    if (!input.hasAttribute("disabled")) checkboxes += 1;
    input.setAttribute("disabled", "");
  }

  for (const el of Array.from(root.querySelectorAll("pre, .mermaid, .internal-embed, .markdown-embed, .is-loading, [class*='block-language-']"))) {
    const what = emptyBlockKind(el);
    if (what === null) continue;
    if ((el.textContent ?? "").trim() !== "") continue;
    if (what !== "placeholder" && el.querySelector(VISIBLE_CONTENT) !== null) continue;
    findings.push({ kind: "empty-block", what, hint: el.getAttribute("class") ?? "" });
  }
  return { canvases, removed, checkboxes, findings };
}
