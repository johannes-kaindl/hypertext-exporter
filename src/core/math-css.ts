// MathJax-Stile für die Seite filtern und ordnen (Bauplan Task 10, Spec 4b "MathJax-Stile", 10.8).
// Regel (Etappe 0, Zusatzmessung 5): feste Reihenfolge; Regeln mit Codepunkt-Selektoren (`.mjx-c<HEX>`) nur für benutzte Codepunkte;
// `@font-face` nur für Schriftfamilien, die eine behaltene Regel nennt. Das Einbetten der Schriften als `data:` ist nicht Teil dieses
// Moduls (es braucht `requestUrl`): ein `@font-face` mit einer Adresse, die nicht `data:` ist, bleibt draußen (die Seite lädt nichts nach; gemessen 2026-11-19 am Beispielordner: sonst 24 blockierte
// Schriftanfragen und 24 CSP-Verletzungen), je Adresse meldet ein Befund `math.font-url`. Formeln zeigen bis zum Einbetten die Ersatzschrift.
// Ein Elementfilter (Befund 2026-11-24): eine Regel, deren Selektoren nur `mjx-<name>`-Elemente nennen, die die Seite nicht trägt, fällt weg; so hängen die Bytes nicht an den Regeln, die MathJax für andere Formeln der Sitzung per `insertRule` angehängt hat.
// Rein: kein obsidian-Import. Zerlegt wird vom CSS-Zerleger des Kits (Bestellung 24, `css-rules`); hier steht nur, was dem Plugin gehört: der Filter nach `mjx-c<HEX>`, die Schriftfamilien und die Reihenfolge.
import { parseCssRules, readCssUrls, splitCssList, type CssRule } from '../vendor/kit/css-rules';
import { compareCodePoints } from '../vendor/kit/name-order';
import { CODES } from './finding-codes';
import type { Finding } from './types';

type Item =
  | { t: 'rule'; text: string; fonts: string[] }
  | { t: 'face'; text: string; family: string | null }
  | { t: 'group'; prelude: string; items: Item[] };

/** @-Regeln, deren Körper selbst Regeln trägt und deshalb mitgefiltert wird. */
const GROUPING_AT_RULES = new Set(['media', 'supports', 'layer', 'container', 'document']);
/** Tiefer verschachtelte Gruppen bleiben unverändert (schützt vor quadratischem Aufwand bei böswilliger Eingabe). */
const MAX_GROUP_DEPTH = 4;

const CODEPOINT_CLASS = /\.mjx-c([0-9A-Fa-f]+)(?![0-9A-Za-z_-])/g;

function unquote(name: string): string {
  const t = name.trim();
  const q = t[0];
  if ((q === '"' || q === "'") && t.length >= 2 && t.endsWith(q)) return t.slice(1, -1).trim();
  return t;
}

/** Schriftnamen (klein geschrieben), die die Deklarationen einer Regel nennen: `font-family` genau, `font` als Wortmenge. */
function fontNames(rule: CssRule): string[] {
  const names: string[] = [];
  for (const decl of rule.declarations) {
    if (decl.name === 'font-family') {
      for (const part of splitCssList(decl.value)) names.push(unquote(part).toLowerCase());
    } else if (decl.name === 'font') {
      for (const tok of decl.value.match(/"[^"]*"|'[^']*'|[^\s,"']+/g) ?? []) names.push(unquote(tok).toLowerCase());
    }
  }
  return names;
}

/** Normalisiert einen Codepunkt wie ihn MathJax in den Klassennamen schreibt: Großbuchstaben, ohne führende Nullen. */
function normalizeCodepoint(hex: string): string {
  return hex.toUpperCase().replace(/^0+(?=.)/, '');
}

/** Elementnamen `mjx-<name>` (klein geschrieben), die ein Selektor als Typ nennt: nicht in Zeichenketten, Attributklammern oder `:not(...)`, nie nach `.`, `#`, `:` oder einem Namenszeichen. */
function mjxElements(selector: string): string[] {
  const bare = selector
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/:not\([^)]*\)/gi, ' ');
  return Array.from(bare.matchAll(/(?:^|[^\w.#:\\-])(mjx-[a-z0-9-]+)(?![\w-])/gi), (m) => (m[1] ?? '').toLowerCase());
}

/** Was die Seite trägt: benutzte Codepunkte und, wenn bekannt, die Namen der `mjx-`-Elemente (`null`: kein Elementfilter). */
interface Used {
  codepoints: ReadonlySet<string>;
  elements: ReadonlySet<string> | null;
}

/** Behält die Selektoren, deren Codepunkt-Klassen und `mjx-`-Elemente alle benutzt sind (Selektoren ohne solche immer). `null` heißt: nichts bleibt. */
function filterSelectors(selectors: string[], used: Used): string[] | null {
  const kept = selectors.filter((sel) => {
    for (const m of sel.matchAll(CODEPOINT_CLASS)) if (!used.codepoints.has(normalizeCodepoint(m[1]))) return false;
    if (used.elements !== null) for (const name of mjxElements(sel)) if (!used.elements.has(name)) return false;
    return true;
  });
  return kept.length === 0 ? null : kept;
}

function filterRules(rules: readonly CssRule[], used: Used, depth: number): Item[] {
  const items: Item[] = [];
  for (const rule of rules) {
    // Ein Rest ohne Ende (Block ohne `}`, Anweisung ohne `;`) entfällt.
    if (!rule.closed || (rule.kind === 'statement' && !rule.text.endsWith(';'))) continue;
    if (rule.kind === 'statement') {
      items.push({ t: 'rule', text: rule.text, fonts: [] });
    } else if (rule.kind === 'font-face') {
      items.push({ t: 'face', text: rule.text, family: fontFamilyOf(rule) ?? null });
    } else if (rule.kind === 'group' && GROUPING_AT_RULES.has(rule.name) && depth < MAX_GROUP_DEPTH) {
      items.push({ t: 'group', prelude: rule.prelude, items: filterRules(rule.rules, used, depth + 1) });
    } else if (rule.kind !== 'style') {
      items.push({ t: 'rule', text: rule.text, fonts: [] });
    } else {
      const kept = filterSelectors(rule.selectors, used);
      if (kept === null) continue;
      items.push({ t: 'rule', text: kept.length === rule.selectors.length ? rule.text : `${kept.join(', ')} {${rule.body}}`, fonts: fontNames(rule) });
    }
  }
  return items;
}

/** Der Name aus der ersten `font-family`-Deklaration eines `@font-face`, klein geschrieben. */
function fontFamilyOf(rule: CssRule): string | undefined {
  const decl = rule.declarations.find((d) => d.name === 'font-family');
  return decl === undefined ? undefined : unquote(decl.value).toLowerCase();
}

function collectFonts(items: Item[], into: Set<string>): void {
  for (const it of items) {
    if (it.t === 'rule') for (const f of it.fonts) into.add(f);
    else if (it.t === 'group') collectFonts(it.items, into);
  }
}

/** `dropped` sammelt die Adressen der Schriften, die nicht als `data:` vorliegen: ihr `@font-face` bleibt draußen, weil die Seite nichts nachlädt (Spec 4a, Erwartung 30). */
function render(items: Item[], families: ReadonlySet<string>, dropped: Set<string>): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.t === 'rule') out.push(it.text);
    else if (it.t === 'face') {
      if (it.family === null || !families.has(it.family)) continue;
      const remote = remoteUrls(it.text);
      if (remote.length === 0) out.push(it.text);
      else for (const url of remote) dropped.add(url);
    } else {
      const inner = render(it.items, families, dropped);
      if (inner.length > 0) out.push(`${it.prelude} {\n${inner.join('\n')}\n}`);
    }
  }
  return out;
}

/** Adressen aus `url(...)`, ohne `data:`, in der Reihenfolge des ersten Vorkommens, jede einmal. */
function remoteUrls(css: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const call of readCssUrls(css).calls) {
    if (call.value === '' || /^data:/i.test(call.value) || seen.has(call.value)) continue;
    seen.add(call.value);
    urls.push(call.value);
  }
  return urls;
}

/**
 * Filtert die MathJax-Stile (Regeln des Stylesheets, je Regel `cssText`) auf die benutzten Codepunkte (Hex, wie in `mjx-c<HEX>`; Groß-/Kleinschreibung und führende Nullen sind gleich).
 * Das Ergebnis hängt nur von den Regeln ab, die bleiben: dieselben Codepunkte ergeben dieselbe Zeichenkette, egal welche weiteren Zeichenregeln die Eingabe trägt;
 * die Reihenfolge der Eingabe-Elemente ändert nichts (gleiche Blätter fallen zusammen, die Blätter werden nach Zeichenfolge geordnet).
 * `usedElements` (Namen der `mjx-`-Elemente im gezeichneten Inhalt, klein geschrieben) schaltet den Elementfilter ein; ohne ihn bleiben alle Elementregeln.
 * Befunde: `info` `math.font-url` je Schrift-Adresse, deren `@font-face` draußen bleibt, nach Zeichenfolge, dann je übriger Adresse in Regeln (das Einbetten folgt später).
 */
export function filterMathCss(styles: string[], usedCodepoints: Set<string>, usedElements?: ReadonlySet<string>): { css: string; findings: Finding[] } {
  const used = new Set<string>();
  for (const cp of usedCodepoints) used.add(normalizeCodepoint(cp.trim().replace(/^(?:U\+|0x)/i, '')));

  const elements = usedElements === undefined ? null : new Set(Array.from(usedElements, (n) => n.trim().toLowerCase()));
  const trees = styles.map((s) => filterRules(parseCssRules(s.replace(/\r\n?/g, '\n')).rules, { codepoints: used, elements }, 0));
  const families = new Set<string>();
  for (const tree of trees) collectFonts(tree, families);

  const sheets = new Set<string>();
  const dropped = new Set<string>();
  for (const tree of trees) {
    const text = render(tree, families, dropped).join('\n');
    if (text !== '') sheets.add(text);
  }
  const css = Array.from(sheets).sort(compareCodePoints).join('\n');

  const urls = new Set<string>([...Array.from(dropped).sort(compareCodePoints), ...remoteUrls(css)]);
  const findings: Finding[] = Array.from(urls).map((url) => ({
    severity: 'info',
    code: CODES.mathFontUrl,
    args: [url],
  }));
  return { css, findings };
}
