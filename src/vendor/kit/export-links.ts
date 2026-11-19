// vendored from obsidian-kit@0.106.0, src/pure/export-links.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// export-links.ts — die Links einer gerenderten Notiz für eine Seite umschreiben, die eine MENGE von Notizen trägt. Kein `obsidian`-Import; rein bis auf die Änderung des übergebenen Baums.
//
// Warum hier und nicht in code-kit (erste Frage aus AGENTS.md): der Vertrag trägt zwei Annahmen über Obsidians gerendertes DOM (Messung 4a der Spec hypertext-exporter, 2026-11-18, Obsidian 1.15.1): `a.internal-link` trägt `href`
// gleich dem GESCHRIEBENEN Linktext (Wikilink wie relativer Markdown-Link, Anker und Prozentkodierung eingeschlossen), ungelöste Links sind nicht markiert, jedes `<a>` trägt `target="_blank"`, Tags sind `a.tag`. Dieselbe Art
// Annahme trägt `pdf/dom-to-ir`. Der Auflöser kommt von außen hinein (Obsidians `getFirstLinkpathDest` gegen die Quellnotiz): die Funktion selbst kennt weder Vault noch App; das ist der einzige Auflöser (Spec 10.7), damit die Seite dorthin
// springt, wohin der Link im Vault führt. Das ältere code-kit `pure/link-resolver` verwirft `#Anker` und wird hier bewusst nicht benutzt.
//
// Regeln (Spec 10.7): Ziel in der Menge → `href="#marke"` (Notiz oder Überschrift); Ziel außerhalb der Menge, ungelöstes Ziel und jedes andere Schema als http, https, mailto → Text, das Ziel in Klammern, ein Befund; `target` fällt bei jedem Link;
// Links nach außen behalten `rel` mit `noopener`; Tags (`a.tag`) werden Text mit eigener Klasse. Zusätze, mit Grund: (1) steht im Linktext schon das Ziel, kommt es nicht noch einmal in Klammern („Fern (Fern)“ liest sich wie ein Fehler);
// (2) eine Überschrift, die es in der Notiz nicht gibt, springt zur Notiz und steht im Befund (kein toter Anker, kein Verlust des Links); (3) `#^block` springt zur Notiz (Blöcke haben keine Marke); (4) ein Link ohne Schema, auch ohne die
// Klasse `internal-link` (rohes `<a href="a.md">`), geht denselben Weg wie ein interner, weil ein relativer Pfad im Export sonst ins Leere zeigte; (5) `//host` ist kein erlaubtes Schema. Das Schema wird so gelesen, wie der Browser die URL liest
// (`trimUrlLikeBrowser`: Steuerzeichen am Rand und Tab/Zeilenumbruch innen fallen), damit `java\nscript:` nicht als relativer Pfad durchgeht. Idempotent: ein umgeschriebener Link trägt `data-export-link`, ein zweiter Lauf lässt ihn stehen.

import { trimUrlLikeBrowser } from "./safe-markdown";

/** Was die Funktion von der Außenwelt braucht. Alles synchron und ohne Nebenwirkung. */
export interface ExportLinkPorts {
  /** Der geschriebene Linktext OHNE Anker und ohne Prozentkodierung (`Themen/Auswahl.md`, `Auswahl`; leer bei `[[#Überschrift]]`: die Quellnotiz selbst) → Pfad der Datei, oder `null` (ungelöst). */
  resolve(linkpath: string): string | null;
  /** Marke der Notiz, wenn sie zur Menge gehört, sonst `null`. */
  noteMark(path: string): string | null;
  /** Marke der Überschrift, so geschrieben wie im Link; `null`, wenn die Notiz keine solche hat. */
  headingMark(path: string, heading: string): string | null;
  /** Ein neues `<span>`. Als Port hineingegeben, weil `createSpan` ein Obsidian-Global ist (hier in pure/ nicht verfügbar) und `document.createElement` die Store-Regel `prefer-create-el` verletzt; das Plugin liefert `() => createSpan()`. */
  createSpan(): HTMLElement;
}

export interface ExportLinkOptions {
  /** Klasse des Ersatzes für einen Link, der Text wird. Vorgabe `export-link-text`. */
  textClass?: string;
  /** Klasse des Ersatzes für einen Tag. Vorgabe `export-tag`. */
  tagClass?: string;
}

export type ExportLinkFinding =
  /** Das Ziel ist aufgelöst, gehört aber nicht zur Menge. */
  | { kind: "outside"; target: string }
  | { kind: "unresolved"; target: string }
  /** Ein anderes Schema als http, https, mailto (oder `//`): `scheme` ist das gelesene Schema in Kleinbuchstaben, leer bei `//`. */
  | { kind: "scheme"; target: string; scheme: string }
  /** Die Notiz ist in der Menge, die Überschrift gibt es nicht; der Link springt zur Notiz. */
  | { kind: "heading-missing"; target: string; heading: string };

export interface ExportLinkResult {
  /** Wie viele Links ein Sprung zu einer Marke wurden. */
  jumps: number;
  findings: ExportLinkFinding[];
}

export const EXPORT_LINK_TEXT_CLASS = "export-link-text";
export const EXPORT_TAG_CLASS = "export-tag";
/** Marker an einem umgeschriebenen Sprung (Idempotenz). */
export const EXPORT_LINK_MARK_ATTR = "data-export-link";
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto"]);
const SCHEME = /^([a-z][a-z0-9+.-]*):/;

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Ersetzt `a` durch ein `span` mit denselben Kindern (nichts geht verloren: Bilder, Auszeichnung) und hängt, wenn gewünscht, das Ziel an. */
function toText(a: Element, makeSpan: () => HTMLElement, cls: string, suffix: string | null): void {
  const span = makeSpan();
  span.setAttribute("class", cls);
  while (a.firstChild) span.appendChild(a.firstChild);
  if (suffix !== null) span.appendChild(a.ownerDocument.createTextNode(` (${suffix})`));
  a.replaceWith(span);
}

/** Schreibt jedes `<a>` unter `root` nach den Regeln im Kopf um. Ändert den Baum; wirft nicht (der Auflöser darf es). Linear in der Zahl der Links. */
export function rewriteExportLinks(root: ParentNode, ports: ExportLinkPorts, opts: ExportLinkOptions = {}): ExportLinkResult {
  const textClass = opts.textClass ?? EXPORT_LINK_TEXT_CLASS;
  const tagClass = opts.tagClass ?? EXPORT_TAG_CLASS;
  const makeSpan = (): HTMLElement => ports.createSpan();
  const findings: ExportLinkFinding[] = [];
  let jumps = 0;
  for (const a of Array.from(root.querySelectorAll("a"))) {
    a.removeAttribute("target");
    if (a.hasAttribute(EXPORT_LINK_MARK_ATTR)) continue;
    if (a.classList.contains("tag")) { toText(a, makeSpan, tagClass, null); continue; }
    const written = a.getAttribute("data-href") ?? a.getAttribute("href");
    if (written === null) continue;   // ein Anker ohne href (name, id) ist kein Link
    const trimmed = trimUrlLikeBrowser(written);
    const scheme = SCHEME.exec(trimmed.toLowerCase())?.[1];
    if (scheme !== undefined || trimmed.startsWith("//")) {
      if (scheme !== undefined && ALLOWED_SCHEMES.has(scheme)) {
        const rel = new Set((a.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean));
        rel.add("noopener");
        a.setAttribute("rel", [...rel].join(" "));
        continue;
      }
      findings.push({ kind: "scheme", target: written, scheme: scheme ?? "" });
      toText(a, makeSpan, textClass, a.textContent.trim() === written ? null : written);
      continue;
    }
    // intern: geschriebener Linktext, Anker abtrennen, Prozentkodierung lösen
    const hash = written.indexOf("#");
    const pathPart = safeDecode(hash < 0 ? written : written.slice(0, hash));
    const anchorRaw = hash < 0 ? "" : safeDecode(written.slice(hash + 1));
    const heading = anchorRaw.startsWith("^") ? "" : (anchorRaw.split("#").pop() ?? "");
    const target = safeDecode(written);
    const showTarget = a.textContent.trim() === target ? null : target;
    const file = ports.resolve(pathPart);
    if (file === null) { findings.push({ kind: "unresolved", target }); toText(a, makeSpan, textClass, showTarget); continue; }
    const mark = ports.noteMark(file);
    if (mark === null) { findings.push({ kind: "outside", target }); toText(a, makeSpan, textClass, showTarget); continue; }
    let href = mark;
    if (heading !== "") {
      const hm = ports.headingMark(file, heading);
      if (hm === null) findings.push({ kind: "heading-missing", target, heading });
      else href = hm;
    }
    a.setAttribute("href", `#${href}`);
    a.setAttribute(EXPORT_LINK_MARK_ATTR, "jump");
    a.removeAttribute("data-href");
    a.removeAttribute("rel");
    jumps += 1;
  }
  return { jumps, findings };
}
