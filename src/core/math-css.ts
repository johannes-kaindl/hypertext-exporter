// MathJax-Stile für die Seite filtern und ordnen (Bauplan Task 10, Spec 4b "MathJax-Stile", 10.8).
// Regel (Etappe 0, Zusatzmessung 5): feste Reihenfolge; Regeln mit Codepunkt-Selektoren (`.mjx-c<HEX>`) nur für benutzte Codepunkte;
// `@font-face` nur für Schriftfamilien, die eine behaltene Regel nennt. Das Einbetten der Schriften als `data:` ist nicht Teil dieses
// Moduls (es braucht `requestUrl`): die verbleibenden `url(...)` stehen unverändert im Ergebnis, je Adresse meldet ein Befund `math.font-url`.
// Rein: kein obsidian-Import. Der CSS-Zerleger ist absichtlich klein, einmal durch den Text (linear) und nicht exportiert.
import { CODES } from './finding-codes';
import type { Finding } from './types';

/** Eine Regel oder Anweisung der obersten Ebene (oder im Körper einer Gruppen-@-Regel). */
interface RawRule {
  prelude: string;
  /** `null` bei einer Anweisung ohne Block (`@import …;`). */
  body: string | null;
  text: string;
}

type Item =
  | { t: 'rule'; text: string; fonts: string[] }
  | { t: 'face'; text: string; family: string | null }
  | { t: 'group'; prelude: string; items: Item[] };

/** @-Regeln, deren Körper selbst Regeln trägt und deshalb mitgefiltert wird. */
const GROUPING_AT_RULES = new Set(['media', 'supports', 'layer', 'container', 'document']);
/** Tiefer verschachtelte Gruppen bleiben unverändert (schützt vor quadratischem Aufwand bei böswilliger Eingabe). */
const MAX_GROUP_DEPTH = 4;

const CODEPOINT_CLASS = /\.mjx-c([0-9A-Fa-f]+)(?![0-9A-Za-z_-])/g;

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';
}

/** `i` steht auf dem Anführungszeichen; Rückgabe: Index hinter dem schließenden. */
function skipString(s: string, i: number): number {
  const quote = s[i];
  let j = i + 1;
  while (j < s.length) {
    const ch = s[j];
    if (ch === '\\') j += 2;
    else if (ch === quote) return j + 1;
    else j++;
  }
  return s.length;
}

/** `i` steht auf dem Kommentaranfang; Rückgabe: Index hinter dem Kommentarende. */
function skipComment(s: string, i: number): number {
  const end = s.indexOf('*/', i + 2);
  return end < 0 ? s.length : end + 2;
}

/** `open` steht auf `{`; Rückgabe: Index der passenden `}` oder -1. */
function findBlockEnd(s: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'") i = skipString(s, i);
    else if (ch === '/' && s[i + 1] === '*') i = skipComment(s, i);
    else {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
  }
  return -1;
}

/** Zerlegt Text in Regeln und Anweisungen der obersten Ebene. Kommentare dazwischen entfallen; ein unvollständiger Rest am Ende entfällt. */
function splitRules(css: string): RawRule[] {
  const out: RawRule[] = [];
  const n = css.length;
  let i = 0;
  while (i < n) {
    const c = css[i];
    if (isSpace(c) || c === '}') {
      i++;
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      i = skipComment(css, i);
      continue;
    }
    const start = i;
    let nest = 0;
    let done = false;
    while (i < n && !done) {
      const ch = css[i];
      if (ch === '"' || ch === "'") i = skipString(css, i);
      else if (ch === '/' && css[i + 1] === '*') i = skipComment(css, i);
      else if (ch === '(' || ch === '[') {
        nest++;
        i++;
      } else if (ch === ')' || ch === ']') {
        if (nest > 0) nest--;
        i++;
      } else if (nest === 0 && ch === '{') {
        const close = findBlockEnd(css, i);
        if (close < 0) {
          i = n;
          break;
        }
        out.push({ prelude: css.slice(start, i).trim(), body: css.slice(i + 1, close), text: css.slice(start, close + 1).trim() });
        i = close + 1;
        done = true;
      } else if (nest === 0 && ch === ';') {
        out.push({ prelude: css.slice(start, i).trim(), body: null, text: css.slice(start, i + 1).trim() });
        i++;
        done = true;
      } else i++;
    }
  }
  return out;
}

/** Teilt an `sep` auf der obersten Ebene (nicht in Klammern, eckigen Klammern oder Zeichenketten). */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let nest = 0;
  let from = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      i = skipString(s, i);
      continue;
    }
    if (ch === '(' || ch === '[') nest++;
    else if (ch === ')' || ch === ']') {
      if (nest > 0) nest--;
    } else if (nest === 0 && ch === sep) {
      parts.push(s.slice(from, i));
      from = i + 1;
    }
    i++;
  }
  parts.push(s.slice(from));
  return parts;
}

function unquote(name: string): string {
  const t = name.trim();
  const q = t[0];
  if ((q === '"' || q === "'") && t.length >= 2 && t.endsWith(q)) return t.slice(1, -1).trim();
  return t;
}

/** Schriftnamen (klein geschrieben), die die Deklarationen eines Regelkörpers nennen: `font-family` genau, `font` als Wortmenge. */
function fontNames(body: string): string[] {
  const names: string[] = [];
  for (const decl of splitTopLevel(body, ';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).replace(/!important\s*$/i, '').trim();
    if (prop === 'font-family') {
      for (const part of splitTopLevel(value, ',')) names.push(unquote(part).toLowerCase());
    } else if (prop === 'font') {
      for (const tok of value.match(/"[^"]*"|'[^']*'|[^\s,"']+/g) ?? []) names.push(unquote(tok).toLowerCase());
    }
  }
  return names;
}

/** Normalisiert einen Codepunkt wie ihn MathJax in den Klassennamen schreibt: Großbuchstaben, ohne führende Nullen. */
function normalizeCodepoint(hex: string): string {
  return hex.toUpperCase().replace(/^0+(?=.)/, '');
}

/** Behält die Selektoren, deren Codepunkt-Klassen alle benutzt sind (Selektoren ohne solche Klassen immer). `null` heißt: nichts bleibt. */
function filterSelectors(prelude: string, used: ReadonlySet<string>): string | null {
  const selectors = splitTopLevel(prelude, ',');
  const kept = selectors.filter((sel) => {
    for (const m of sel.matchAll(CODEPOINT_CLASS)) if (!used.has(normalizeCodepoint(m[1]))) return false;
    return true;
  });
  if (kept.length === 0) return null;
  if (kept.length === selectors.length) return prelude;
  return kept.map((s) => s.trim()).join(', ');
}

function filterRules(rules: RawRule[], used: ReadonlySet<string>, depth: number): Item[] {
  const items: Item[] = [];
  for (const rule of rules) {
    if (rule.prelude.startsWith('@')) {
      const name = (/^@([A-Za-z-]+)/.exec(rule.prelude)?.[1] ?? '').toLowerCase();
      if (rule.body === null) {
        items.push({ t: 'rule', text: rule.text, fonts: [] });
      } else if (name === 'font-face') {
        items.push({ t: 'face', text: rule.text, family: fontFamilyOf(rule.body) ?? null });
      } else if (GROUPING_AT_RULES.has(name) && depth < MAX_GROUP_DEPTH) {
        const inner = filterRules(splitRules(rule.body), used, depth + 1);
        items.push({ t: 'group', prelude: rule.prelude, items: inner });
      } else {
        items.push({ t: 'rule', text: rule.text, fonts: [] });
      }
      continue;
    }
    const prelude = filterSelectors(rule.prelude, used);
    if (prelude === null || rule.body === null) continue;
    const text = prelude === rule.prelude ? rule.text : `${prelude} {${rule.body}}`;
    items.push({ t: 'rule', text, fonts: fontNames(rule.body) });
  }
  return items;
}

/** Der Name aus der `font-family`-Deklaration eines `@font-face`-Körpers, klein geschrieben. */
function fontFamilyOf(body: string): string | undefined {
  for (const decl of splitTopLevel(body, ';')) {
    const colon = decl.indexOf(':');
    if (colon >= 0 && decl.slice(0, colon).trim().toLowerCase() === 'font-family') {
      return unquote(decl.slice(colon + 1).replace(/!important\s*$/i, '')).toLowerCase();
    }
  }
  return undefined;
}

function collectFonts(items: Item[], into: Set<string>): void {
  for (const it of items) {
    if (it.t === 'rule') for (const f of it.fonts) into.add(f);
    else if (it.t === 'group') collectFonts(it.items, into);
  }
}

function render(items: Item[], families: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.t === 'rule') out.push(it.text);
    else if (it.t === 'face') {
      if (it.family !== null && families.has(it.family)) out.push(it.text);
    } else {
      const inner = render(it.items, families);
      if (inner.length > 0) out.push(`${it.prelude} {\n${inner.join('\n')}\n}`);
    }
  }
  return out;
}

/** Adressen aus `url(...)`, ohne `data:`, in der Reihenfolge des ersten Vorkommens, jede einmal. */
function remoteUrls(css: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi)) {
    const addr = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (addr === '' || /^data:/i.test(addr) || seen.has(addr)) continue;
    seen.add(addr);
    urls.push(addr);
  }
  return urls;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Filtert die MathJax-Stile (Inhalte der `<style>`-Elemente) auf die benutzten Codepunkte (Hex, wie in `mjx-c<HEX>`; Groß-/Kleinschreibung und führende Nullen sind gleich).
 * Das Ergebnis hängt nur von den Regeln ab, die bleiben: dieselben Codepunkte ergeben dieselbe Zeichenkette, egal welche weiteren Zeichenregeln die Eingabe trägt;
 * die Reihenfolge der Eingabe-Elemente ändert nichts (gleiche Blätter fallen zusammen, die Blätter werden nach Zeichenfolge geordnet).
 * Befunde: `info` `math.font-url` je verbleibender Schrift-Adresse (das Einbetten folgt später).
 */
export function filterMathCss(styles: string[], usedCodepoints: Set<string>): { css: string; findings: Finding[] } {
  const used = new Set<string>();
  for (const cp of usedCodepoints) used.add(normalizeCodepoint(cp.trim().replace(/^(?:U\+|0x)/i, '')));

  const trees = styles.map((s) => filterRules(splitRules(s.replace(/\r\n?/g, '\n')), used, 0));
  const families = new Set<string>();
  for (const tree of trees) collectFonts(tree, families);

  const sheets = new Set<string>();
  for (const tree of trees) {
    const text = render(tree, families).join('\n');
    if (text !== '') sheets.add(text);
  }
  const css = Array.from(sheets).sort(compareCodeUnits).join('\n');

  const findings: Finding[] = remoteUrls(css).map((url) => ({
    severity: 'info',
    code: CODES.mathFontUrl,
    message: `Mathe-Schrift noch nicht eingebettet: ${url}`,
  }));
  return { css, findings };
}
