// vendored from obsidian-kit@0.103.0, src/pure/export-prepare.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// export-prepare.ts — Notizkörper vor `MarkdownRenderer.render` für einen Export vorbereiten: rohe Rahmen ersetzen, Codeblöcke nach Stellung herausnehmen, Inline-Abfragen brechen. Kein `obsidian`-Import.
//
// Warum hier und nicht in code-kit (erste Frage aus AGENTS.md): der Vertrag trägt Obsidian-Annahmen, die code-kit nicht kennt: `app:`-, relative und `file:`-Ziele eines rohen Rahmens öffnen in Obsidian 1.15.1 einen Fehlerdialog des
// Hauptprozesses (Messung der Spec hypertext-exporter 12), und Dataview liest eine Code-Spanne, die mit `=` oder `$=` beginnt, als Abfrage. Die Zaun-Leser kommen aus code-kit (`listAllFences`, 0.83.0); gesehen, nicht übernommen:
// `neutralizeRemoteResources` (code-kit `safe-markdown`) schaltet Fernquellen aus und lässt `app:`-Ziele und relative Rahmen stehen, `extractCodeBlocks` (`pdf/code-blocks`) liest nur Zäune am Zeilenanfang. Dieses Modul ersetzt beide
// nicht, es steht VOR dem Rendern und fragt etwas anderes: was darf in einem Export überhaupt laufen. Danach bleibt `neutralizeRemoteResources` vor dem Rendern und `freezeRenderedDom` danach.
//
// Regeln (Spec 10.2 Schritt 2b):
//  · Rahmen: `<iframe>`, `<frame>`, `<object>`, `<embed>`, `<webview>`, `<portal>` (öffnend, schließend, in jeder Schreibweise) außerhalb von Code werden zu einem Platzhalter (Vorgabe `\[iframe\]`), der öffnende samt seinen Attributen
//    bis zum Ende des Tags (Anführungszeichen beachtet; wird eine Quote nie geschlossen, gilt das erste `>`), das schließende entfällt. Egal ob in Absatz, Liste, Zitat, Callout oder Tabelle, egal welches Ziel. Was zwischen den Tags steht,
//    bleibt Text. In einem Codeblock oder einer Code-Spanne bleibt der Rahmen stehen: er ist dort Beispieltext.
//  · Codeblöcke (`codeBlocks`): `none` nimmt alle heraus, `core` alle außer `mermaid`, `all` keinen. Jeder herausgenommene (auch einer in Zitat, Callout, Liste, aus Tilden, und einer, der nie schließt) wird eine eigene Zeile mit
//    `prefix` und Nummer (`codePlaceholder`), die Zeilen des Blocks entfallen; die Zeile behält den Präfix aus Zitat- und Listenzeichen und ist von Leerzeilen (im Zitat `>`) umgeben, damit sie ein eigener Absatz wird. Zurück
//    kommen Sprache, Text und der Quelltext als Markdown (`source`) zum Wiedereinsetzen als maskierter Quelltext.
//  · Inline-Abfragen: eine Code-Spanne, deren Inhalt (nach Leerraum) mit `=` oder `$=` beginnt, bekommt ein unsichtbares Zeichen (U+200B) vor den Inhalt; Dataview prüft den Anfang des Texts und findet die Abfrage nicht mehr.
//    Spannen in Codeblöcken zählen nicht.
// Vertrag: rein, idempotent (ein zweiter Lauf ändert nichts und findet nichts), linear (Spannen über eine Tabelle „nächster gleich langer Lauf“, Tag-Ende höchstens 4000 Zeichen weit, Zäune von `listAllFences`). Das Zeilenende
// (LF oder CRLF) bleibt. Die Stellung ist ein Parameter, kein Plugin-Typ.
// Grenzen: eingerückter Code (vier Leerzeichen) wird nicht als Codeblock gelesen und deshalb nicht herausgenommen; ein Rahmen darin würde ersetzt, eine Abfrage darin gebrochen (beides unschädlich). Eine Code-Spanne über eine
// Zitatgrenze wird mit dem `>` der Folgezeile gelesen. Dataview mit anderem Präfix als `=`/`$=` (Einstellung) wird nicht erkannt; der Aufrufer kann `inlinePrefixes` setzen.

import { listAllFences, type ListedFence } from "./fences";
import { codePlaceholder } from "./pdf/code-blocks";

export type CodeBlockPolicy = "none" | "core" | "all";

export interface ExportPrepareOptions {
  /** Welche Codeblöcke bleiben im Text: `none` keiner, `core` nur `mermaid` bleibt, `all` alle. Vorgabe `none` (der sichere Wert). */
  codeBlocks?: CodeBlockPolicy;
  /** Präfix der Platzhalter für herausgenommene Codeblöcke (`${prefix}${i}`); der Aufrufer wählt etwas, das im Text nicht vorkommt. Vorgabe `OKITEXPORTCODE`. */
  prefix?: string;
  /** Der Text, der an die Stelle eines Rahmens tritt (Markdown). Vorgabe `\[<tag>\]`. */
  frameText?: (tag: string) => string;
  /** Anfänge einer Inline-Abfrage. Vorgabe `["=", "$="]` (Dataview). */
  inlinePrefixes?: readonly string[];
}

export interface PreparedCode {
  /** Sprache (erstes Wort der Infozeile, klein), leer ohne. */
  lang: string;
  /** Text zwischen den Zäunen. */
  text: string;
  /** Der Block als Markdown ohne Zitat- und Listenzeichen, mit Zäunen (bei einem Zaun, der nie schließt, ohne schließenden). */
  source: string;
  /** Der Platzhalter im Text (`${prefix}${index}`). */
  placeholder: string;
  /** Der Zaun stand hinter einem Zitat- oder Callout-Zeichen oder eingerückt unter einem Listenpunkt. */
  nested: boolean;
  /** Der Zaun schloss nie. */
  closed: boolean;
}

export interface ExportPrepareResult {
  markdown: string;
  /** Die herausgenommenen Blöcke in Dokumentreihenfolge; der Platzhalter `i` gehört zu `codes[i]`. */
  codes: PreparedCode[];
  /** Wie viele Rahmen-Tags ersetzt oder entfernt wurden (öffnende und schließende). */
  frames: number;
  /** Wie viele Inline-Abfragen gebrochen wurden. */
  inlineQueries: number;
}

export const DEFAULT_CODE_PREFIX = "OKITEXPORTCODE";
const FRAME_TAG = /<(\/?)(iframe|frame|object|embed|webview|portal)(?=[\s/>]|$)/gi;
const TAG_END_CAP = 4000;
const ZWSP = "​";

function takes(policy: CodeBlockPolicy, lang: string): boolean {
  return policy === "none" || (policy === "core" && lang !== "mermaid");
}

/** Ende des Tags, das bei `start` (`<`) beginnt: hinter dem `>`, quote-bewusst; schließt eine Quote nie, das erste `>`; findet sich kein `>` in der Reichweite, das Ende des Namens. */
function tagEnd(s: string, start: number, nameEnd: number): number {
  const limit = Math.min(s.length, start + TAG_END_CAP);
  let q = "";
  for (let i = nameEnd; i < limit; i++) {
    const c = s[i];
    if (q) { if (c === q) q = ""; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ">") return i + 1;
  }
  const plain = s.indexOf(">", nameEnd);
  return plain !== -1 && plain < limit ? plain + 1 : nameEnd;
}

interface Span { open: number; close: number; len: number }   // [open, close): beide Läufe eingeschlossen

/** Code-Spannen eines Textstücks (CommonMark): ein Lauf von n Backticks schließt beim nächsten Lauf von genau n; ein Lauf ohne Gegenstück ist Text. Ein Rückstrich vor dem Lauf macht den ersten Backtick zu Text. */
function codeSpans(s: string): Span[] {
  const runs: Array<{ at: number; len: number }> = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "`") continue;
    let j = i;
    while (s[j] === "`") j++;
    let at = i, len = j - i;
    let bs = 0;
    for (let k = i - 1; k >= 0 && s[k] === "\\"; k--) bs++;
    if (bs % 2 === 1) { at += 1; len -= 1; }
    if (len > 0) runs.push({ at, len });
    i = j - 1;
  }
  const next = new Array<number>(runs.length).fill(-1);
  const seen = new Map<number, number>();
  for (let k = runs.length - 1; k >= 0; k--) {
    const r = runs[k];
    if (!r) continue;
    next[k] = seen.get(r.len) ?? -1;
    seen.set(r.len, k);
  }
  const out: Span[] = [];
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    const n = next[k] ?? -1;
    const c = runs[n];
    if (!r || n === -1 || !c) continue;
    out.push({ open: r.at, close: c.at + c.len, len: r.len });
    // Alles zwischen den Läufen gehört zur Spanne: der nächste Lauf, der in Frage kommt, liegt hinter ihr.
    while (k + 1 < runs.length && k + 1 <= n) k++;
  }
  return out;
}

function brokenQuery(content: string, prefixes: readonly string[]): boolean {
  const t = content.replace(/^[ \t\r\n]+/, "");
  return prefixes.some((p) => t.startsWith(p));
}

/** Rahmen und Abfragen in einem Textstück ohne Zäune. */
function cleanProse(s: string, frameText: (tag: string) => string, prefixes: readonly string[], count: { frames: number; queries: number }): string {
  if (s.indexOf("<") === -1 && s.indexOf("`") === -1) return s;
  const spans = codeSpans(s);
  let out = "";
  let pos = 0;
  const framesOnce = (part: string): string => {
    if (part.indexOf("<") === -1) return part;
    let res = "";
    let at = 0;
    FRAME_TAG.lastIndex = 0;
    for (let m = FRAME_TAG.exec(part); m !== null; m = FRAME_TAG.exec(part)) {
      if (m.index < at) continue;
      const nameEnd = m.index + m[0].length;
      const end = tagEnd(part, m.index, nameEnd);
      res += part.slice(at, m.index) + (m[1] === "/" ? "" : frameText((m[2] ?? "").toLowerCase()));
      count.frames += 1;
      at = end;
      FRAME_TAG.lastIndex = end;
    }
    return res + part.slice(at);
  };
  // Das Entfernen eines schließenden Tags kann zwei Reste zu einem neuen Tag zusammenfügen (`<` + `</iframe>` + `iframe src=x>`): wiederholen, bis nichts mehr ändert, höchstens viermal (je Durchgang linear);
  // was danach noch ein Tag ist, verliert sein `<` (`&lt;`), statt zu bleiben.
  const frames = (from: number, to: number): string => {
    let cur = s.slice(from, to);
    for (let pass = 0; pass < 4; pass++) {
      const next = framesOnce(cur);
      if (next === cur) break;
      cur = next;
    }
    FRAME_TAG.lastIndex = 0;
    return cur.replace(FRAME_TAG, (_m, slash: string, name: string) => `&lt;${slash}${name}`);
  };
  for (const sp of spans) {
    out += frames(pos, sp.open);
    const inner = s.slice(sp.open + sp.len, sp.close - sp.len);
    if (brokenQuery(inner, prefixes)) {
      out += s.slice(sp.open, sp.open + sp.len) + ZWSP + inner + s.slice(sp.close - sp.len, sp.close);
      count.queries += 1;
    } else out += s.slice(sp.open, sp.close);
    pos = sp.close;
  }
  return out + frames(pos, s.length);
}

/** Der Teil einer Zeile vor dem Zaun: Zitat-, Callout- und Listenzeichen samt Einrückung. */
function linePrefix(line: string): string {
  const m = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)*/.exec(line);
  return m ? m[0] : "";
}

/** Bereitet einen Notizkörper für den Export vor (Kopf der Datei). Wirft nie. */
export function prepareExportMarkdown(markdown: string, options: ExportPrepareOptions = {}): ExportPrepareResult {
  const policy = options.codeBlocks ?? "none";
  const prefix = options.prefix ?? DEFAULT_CODE_PREFIX;
  const frameText = options.frameText ?? ((tag: string) => `\\[${tag}\\]`);
  const prefixes = options.inlinePrefixes ?? ["=", "$="];
  const lines = markdown.split("\n");   // ein \r am Zeilenende bleibt an der Zeile
  const fences = listAllFences(markdown);
  const count = { frames: 0, queries: 0 };
  const codes: PreparedCode[] = [];

  // Jede Zeile gehört zu höchstens einem Zaun (die Leser liefern keine überlappenden): [open, close] eingeschlossen.
  const zaunAb = new Map<number, ListedFence>();
  for (const f of fences) zaunAb.set(f.openLine, f);

  const out: string[] = [];
  let prose: string[] = [];
  const flush = (): void => {
    if (prose.length === 0) return;
    const text = prose.join("\n");
    out.push(...cleanProse(text, frameText, prefixes, count).split("\n"));
    prose = [];
  };
  let i = 0;
  while (i < lines.length) {
    const f = zaunAb.get(i);
    if (!f) { prose.push(lines[i] ?? ""); i++; continue; }
    const last = f.closeLine;   // bei einem Zaun, der nie schließt, ist es die letzte Zeile des Texts
    if (!takes(policy, f.lang)) {
      // Der Zaun bleibt: seine Zeilen sind Code, dort wird nichts gelesen. Absätze davor und danach werden einzeln gelesen.
      flush();
      for (let k = i; k <= last; k++) out.push(lines[k] ?? "");
      i = last + 1;
      continue;
    }
    flush();
    const openLine = lines[i] ?? "";
    const pre = linePrefix(openLine);
    const pad = pre.includes(">") ? pre.replace(/[ \t]+$/, "") : "";
    const crlf = openLine.endsWith("\r");
    const eol = crlf ? "\r" : "";
    const padLine = pad + eol;
    const placeholder = codePlaceholder(prefix, codes.length);
    // Der Quelltext: die Zeilen des Blocks ohne Zitat- und Listenzeichen der Öffnungszeile (bei verschachtelten Zäunen trägt `f.body` sie schon nicht mehr).
    const fenceOpen = openLine.slice(pre.length).replace(/\r$/, "");
    const closeText = f.closed ? (lines[f.closeLine] ?? "").replace(/\r$/, "").replace(/^(?:[ \t]*>)*[ \t]*/, "") : null;
    const source = [fenceOpen, ...(f.body === "" && f.openLine + 1 === f.closeLine ? [] : f.body.split("\n")), ...(closeText !== null ? [closeText] : [])].join("\n");
    codes.push({ lang: f.lang, text: f.body, source, placeholder, nested: f.nested, closed: f.closed });
    if (out.length > 0 && (out[out.length - 1] ?? "").replace(/\r$/, "") !== pad) out.push(padLine);
    out.push(pre + placeholder + eol);
    const nextLine = lines[last + 1];
    if (nextLine !== undefined && nextLine.replace(/\r$/, "") !== "" && nextLine.replace(/\r$/, "") !== pad) out.push(padLine);
    i = last + 1;
  }
  flush();
  return { markdown: out.join("\n"), codes, frames: count.frames, inlineQueries: count.queries };
}
