// vendored from obsidian-kit@0.102.0, src/pure/export-fold.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// export-fold.ts — Aufklapp-Umbau eines gerenderten Baums für den Export: Callouts mit Faltzeichen, Überschriftsabschnitte und beliebige Bereiche werden `<details>` mit `<summary>`. Kein `obsidian`-Import.
//
// Warum hier und nicht in code-kit (erste Frage aus AGENTS.md): der Vertrag liest Obsidians gerendertes Callout-DOM (Messung 4a der Spec hypertext-exporter, 2026-11-18, Obsidian 1.15.1): ein eingeklappter Callout rendert seinen Inhalt
// VOLLSTÄNDIG, versteckt nur durch `style="display: none;"` am `.callout-content`; Kennzeichen `data-callout-fold="-"` oder `"+"`, Klassen `is-collapsible`, `is-collapsed`; Titel in `.callout-title` (`.callout-icon`, `.callout-title-inner`,
// `.callout-fold`); die Überschriften haben keine Hüllen um ihre Abschnitte. Das ist dieselbe Art Annahme wie in `pdf/dom-to-ir`. Gesehen, nicht übernommen: epub-exporter und slide-deck (`deck-core`) verwerfen den Faltzustand;
// Randfall „verschachteltes Falten“ aus navigable-html-export (`web-template.ts`, fremd, nur gelesen): hier gilt jeder Callout und jeder Abschnitt für sich, ein Abschnitt in einem Abschnitt wird ein `<details>` im `<details>`.
// `pure/callout.ts` (`wrapCallout`) SCHREIBT Callout-Markdown und liest nichts; die Fold-Lesart gab es im Kit nicht.
//
// Regeln (Spec 10.5): Callout mit `-` oder `+` → `<details>` (zu, bei `+` mit `open`), der Titel wird `<summary>`, `display: none` am Inhalt fällt; Callout ohne Zeichen bleibt ein fester Kasten; rohes `<details>` im Text bleibt, wie es ist;
// Überschriften in `<summary>` bleiben echte Überschriften (die Überschrift selbst zieht in die `<summary>`, nicht ihr Text); alles ist ohne Skript bedienbar, denn `<details>` ist es. Das Chevron `.callout-fold` fällt: es gehört Obsidians Skript,
// die Seite zeichnet ihr eigenes Zeichen. Elemente erzeugt der Aufrufer (Port `createEl`: `createEl` ist ein Obsidian-Global und `document.createElement` verletzt die Store-Regel `prefer-create-el`). Idempotent: ein umgebauter Callout ist kein
// `div.callout` mehr, ein Abschnitt trägt `data-export-fold`.

export interface ExportFoldPorts {
  /** Ein neues Element des Namens; das Plugin liefert `(tag) => createEl(tag)`. */
  createEl(tag: "details" | "summary"): HTMLElement;
}

export const EXPORT_FOLD_ATTR = "data-export-fold";

/** Baut ein `<details>`: `summary` (Knoten oder Text) in der `<summary>`, danach `content`. Die Knoten werden verschoben, nicht kopiert. */
export function wrapInDetails(ports: ExportFoldPorts, parts: { summary: Array<Node | string>; content: Node[]; open?: boolean; className?: string }): HTMLElement {
  const details = ports.createEl("details");
  if (parts.className) details.setAttribute("class", parts.className);
  if (parts.open === true) details.setAttribute("open", "");
  const summary = ports.createEl("summary");
  for (const p of parts.summary) summary.append(p);
  details.append(summary);
  for (const c of parts.content) details.append(c);
  return details;
}

/** Ein Element-Knoten? (`instanceof Element` trägt nicht über Fenstergrenzen: ein Popout-Fenster hat eigene Klassen.) */
const isEl = (n: Node): n is HTMLElement => n.nodeType === 1;

function dropHiddenStyle(el: HTMLElement): void {
  if (el.style.display === "none") {
    el.style.removeProperty("display");
    if (el.getAttribute("style")?.trim() === "") el.removeAttribute("style");
  }
}

function foldOf(el: Element): "-" | "+" | null {
  const v = el.getAttribute("data-callout-fold");
  return v === "-" || v === "+" ? v : null;
}

/** Baut jeden Callout mit `data-callout-fold="-"` oder `"+"` unter `root` zu einem `<details>` um und gibt ihre Zahl zurück. Ein Callout ohne Zeichen bleibt, wie er ist. Ändert den Baum. */
export function foldCallouts(root: ParentNode, ports: ExportFoldPorts): number {
  let n = 0;
  for (const callout of Array.from(root.querySelectorAll("div.callout"))) {
    const fold = foldOf(callout);
    if (fold === null) continue;
    const title = Array.from(callout.children).find((c) => c.classList.contains("callout-title")) ?? null;
    const titleNodes: Node[] = title === null ? [] : Array.from(title.childNodes);
    const summaryNodes: Array<Node | string> = titleNodes.filter((t) => !(isEl(t) && t.classList.contains("callout-fold")));
    if (summaryNodes.length === 0) summaryNodes.push(callout.getAttribute("data-callout") ?? "");
    const content = Array.from(callout.childNodes).filter((c) => c !== title);
    for (const c of content) if (isEl(c)) dropHiddenStyle(c);
    const classes = (callout.getAttribute("class") ?? "").split(/\s+/).filter((c) => c !== "" && c !== "is-collapsed");
    const details = wrapInDetails(ports, { summary: summaryNodes, content, open: fold === "+", className: classes.join(" ") });
    if (title !== null) details.firstElementChild?.setAttribute("class", "callout-title");
    for (const a of ["data-callout", "data-callout-fold", "data-callout-metadata"]) {
      const v = callout.getAttribute(a);
      if (v !== null) details.setAttribute(a, v);
    }
    callout.replaceWith(details);
    n += 1;
  }
  return n;
}

export interface FoldSectionsOptions {
  /** Ab welcher Ebene (1 bis 6) ein Abschnitt gefaltet wird. */
  fromLevel: number;
  /** Ob die Abschnitte offen stehen. Vorgabe `false`. */
  open?: boolean;
}

function levelOf(n: Node): number {
  const m = /^H([1-6])$/.exec(n.nodeName);
  return m === null ? 0 : Number(m[1]);
}

/** Faltet in den DIREKTEN Kindern von `root` jeden Abschnitt ab der Ebene `fromLevel`: die Überschrift (selbst, als Überschrift) kommt in die `<summary>`, alles bis zur nächsten gleich hohen oder höheren Überschrift in das `<details>`;
 *  ein tieferer Abschnitt wird ein `<details>` darin. Text vor der ersten Überschrift und Überschriften unter `fromLevel` bleiben. Gibt die Zahl der Abschnitte zurück. Linear. */
export function foldHeadingSections(root: HTMLElement, ports: ExportFoldPorts, opts: FoldSectionsOptions): number {
  const from = Math.min(6, Math.max(1, Math.trunc(opts.fromLevel)));
  const out: Node[] = [];
  const stack: Array<{ level: number; details: HTMLElement }> = [];
  let n = 0;
  const nodes = Array.from(root.childNodes);
  root.replaceChildren();   // erst lösen, dann umhängen: das Entfernen aus einem großen Elternknoten kostet je Knoten (in happy-dom linear) und machte den Umbau quadratisch
  for (const node of nodes) {
    const level = levelOf(node);
    if (level === 0) {
      const open = stack[stack.length - 1]?.details;
      if (open !== undefined) open.append(node); else out.push(node);
      continue;
    }
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    if (level < from) { out.push(node); continue; }
    const details = wrapInDetails(ports, { summary: [node], content: [], open: opts.open === true });
    details.setAttribute(EXPORT_FOLD_ATTR, "section");
    const parent = stack[stack.length - 1]?.details;
    if (parent !== undefined) parent.append(details); else out.push(details);
    stack.push({ level, details });
    n += 1;
  }
  root.replaceChildren(...out);
  return n;
}
