// Bauanleitung (Spec 10.10): Standardwerte, Lesen mit deutschen Aliasen und Befunden, Hinweise auf Noch-nicht-Gebautes, Block für „Insert export recipe“.
// Das Lesen benutzt zwei Kit-Bausteine: `inputIssues` (Schemaprüfung, verschachtelt, Aliase, `unknownFields: 'warn'`) und `readField` (Wert unter Name oder Alias).
import { foldCase } from '../vendor/kit/fold-case';
import { normFieldKey, readField } from '../vendor/kit/frontmatter-field';
import { quoteScalar } from '../vendor/kit/frontmatter';
import { compareCodePoints, compareOrderedNames, parseOrderedName } from '../vendor/kit/name-order';
import { normalizeRelPath } from '../vendor/kit/rel-path';
import { slugify } from '../vendor/kit/slug';
import { inputIssues, type FieldSchema, type NestedObjectSchema, type ObjectSchema, type ValidationIssue } from '../vendor/kit/validate-input';
import { CODES } from './finding-codes';
import type { Column, Finding, FindingArg, GridRule, NoteInput, OrderRule, Recipe, SectionSpec, SourceSpec } from './types';

export const DEFAULT_RECIPE: Recipe = {
  version: 1,
  lang: 'en',
  sources: [],
  sections: [],
  fields: {},
  fold: { headingsFrom: null, linkedSummary: false },
  grids: null,
  theme: 'default',
  output: 'auto',
  outputLimitMb: 20,
  embeds: 'static',
  blocks: 'core',
  remoteImages: 'skip',
  stamp: 'minimal',
};

/** Schlüssel, die die Bauanleitung kennt, die diese Version aber noch nicht umsetzt: je eine Warnung. */
export function notYetFindings(recipe: Recipe): Finding[] {
  const notYet = (key: string): Finding => ({
    severity: 'warning',
    code: CODES.recipeNotYet,
    args: [key],
    recipePath: key,
  });
  const out: Finding[] = [];
  if (recipe.grids !== null) out.push(notYet('grids'));
  if (recipe.theme !== 'default') out.push(notYet('theme'));
  if (recipe.output === 'package') out.push(notYet('output'));
  if (recipe.remoteImages === 'embed') out.push(notYet('remote_images'));
  return out;
}

/** Namensordnung des Kits; gleiche Namen (nur Groß/Klein verschieden) fallen auf die Reihenfolge nach Codepunkt, damit die Ausgabe nie von der Eingabe abhängt. */
function compareFolderNames(a: string, b: string): number {
  const byRule = compareOrderedNames(parseOrderedName(a), parseOrderedName(b));
  if (byRule !== 0) return byRule;
  return compareCodePoints(a, b);
}

/**
 * Der Block, den „Insert export recipe“ in die Einstiegsnotiz schreibt (Spec 10.10): die Zeilen UNTER dem Schlüssel `hypertext:`, zwei Leerzeichen eingerückt.
 * Nur `version`, `lang` (`de`, wenn die Obsidian-Sprache `de` ist, sonst `en`) und `sections` mit je einem `folder`-Eintrag je unmittelbarem Unterordner von `folder`
 * in Namensordnung; alle anderen Schlüssel bleiben weg, es gelten die Standardwerte. Ein Ordner ohne Unterordner schreibt kein `sections` (der Standard ist derselbe).
 */
export function recipeYaml(folder: string, notes: NoteInput[], obsidianLang: string): string {
  // Die Schreibweise der Namen bleibt, wie der Vault sie führt (kein Falten auf Groß/Klein wie beim Dateisystem-Lesen von `filesystemPath`).
  const read = (path: string): string[] | null => {
    const r = normalizeRelPath(path, { absolute: 'strip', allowEmpty: true });
    return r.ok ? r.segments : null;
  };
  const base = read(folder);
  const subfolders = new Set<string>();
  if (base !== null) {
    for (const n of notes) {
      const segments = read(n.path);
      if (segments === null || segments.length < base.length + 2 || !base.every((seg, i) => segments[i] === seg)) continue;
      const name = segments[base.length];
      if (name !== undefined) subfolders.add(name);
    }
  }
  const lines = ['  version: 1', `  lang: ${obsidianLang === 'de' ? 'de' : 'en'}`];
  if (subfolders.size > 0) {
    lines.push('  sections:');
    for (const name of Array.from(subfolders).sort(compareFolderNames)) lines.push(`    - folder: ${quoteScalar(name)}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Lesen

/** Der Hinweis, den das Kit in seine Meldung setzt, wenn ein Wert in einer späteren Fassung gilt (Spec 10.10); `findingOf` erkennt daran `recipe.value-later`, der Satz dazu steht in `strings.ts`. */
const LATER = 'is available from a later version';

const text = (aliases: string[], extra: { enum?: string[]; futureValues?: Record<string, string> } = {}): FieldSchema => ({ type: 'string', aliases, ...extra });
const textList = (aliases: string[]): FieldSchema => ({ type: 'array', aliases, items: { type: 'string' } });

/** Eine Spalte (Spec 10.6): ein Feldname als Text, oder ein Objekt mit genau einem von `field` und `template` (`header` fehlt nur bei `field`, dann heißt die Spalte wie das Feld). */
const COLUMN: NestedObjectSchema = {
  type: 'object',
  properties: { header: text(['ueberschrift']), field: text(['feld']), template: text(['vorlage']) },
  exactlyOne: ['field', 'template'],
};
const COLUMNS = (aliases: string[]): FieldSchema => ({ type: 'array', aliases, items: [{ type: 'string' }, COLUMN] });

const SOURCE: NestedObjectSchema = {
  type: 'object',
  properties: { path: text(['pfad']), key: text(['schluessel']), title: text(['titel']) },
  required: ['path'],
};

const SECTION: NestedObjectSchema = {
  type: 'object',
  properties: {
    folder: text(['ordner']),
    note: text(['datei']),
    source: text(['quelle']),
    title: text(['titel']),
    order: text(['reihenfolge']),
    group_by: textList(['gruppen']),
    overview: COLUMNS(['uebersicht']),
    summary_line: COLUMNS(['zusatzzeile']),
    open: { type: 'boolean', aliases: ['offen'] },
  },
  exactlyOne: ['folder', 'note', 'source'],
};

const FIELDS: NestedObjectSchema = {
  type: 'object',
  aliases: ['felder'],
  properties: { title: text(['titel']), order: text(['reihenfolge']), exclude: text(['ausschliessen']) },
};

const FOLD: NestedObjectSchema = {
  type: 'object',
  aliases: ['aufklappen'],
  properties: {
    headings_from: { type: 'integer', aliases: ['ueberschrift_ab'], minimum: 1, maximum: 6 },
    linked_summary: { type: 'boolean', aliases: ['zusatzzeile_aus_link'] },
  },
};

/**
 * Das Schema der Bauanleitung. `grids` steht ohne Unterschlüssel da: Die Zustände sind eine Abbildung mit freien Schlüsseln, die das Kit-Schema nicht ausdrücken kann;
 * `readGrids` prüft sie selbst, und die Warnungen des Kits über „unbekannte“ Unterschlüssel von `grids` werden verworfen.
 */
const SCHEMA: ObjectSchema & { properties: Record<string, FieldSchema> } = {
  type: 'object',
  properties: {
    version: { type: 'integer', aliases: [] },
    title: text(['titel']),
    lang: text(['sprache'], { enum: ['en', 'de'] }),
    sources: { type: 'array', aliases: ['quellen'], items: [{ type: 'string' }, SOURCE] },
    sections: { type: 'array', aliases: ['bereiche'], items: SECTION },
    fields: FIELDS,
    fold: FOLD,
    grids: { type: 'object', aliases: ['raster'] },
    theme: text(['thema']),
    output: text(['ausgabe'], { enum: ['auto', 'file', 'package'] }),
    output_limit_mb: { type: 'number', aliases: [] },
    embeds: text(['einbettungen'], { enum: ['static'], futureValues: { live: LATER } }),
    blocks: text(['bloecke'], { enum: ['none', 'core', 'all'] }),
    remote_images: text(['fernbilder'], { enum: ['skip', 'embed'] }),
    stamp: text(['stempel'], { enum: ['minimal', 'full'] }),
  },
};

/** Die Prüfarten des Kits, für die es einen eigenen Satz gibt (`finding.recipe.invalid.<art>`); jede andere Art zeigt die englische Meldung des Kits (`finding.recipe.invalid`). */
const ISSUE_VARIANTS: ReadonlySet<string> = new Set(['missing', 'type', 'too-short', 'not-in-enum', 'below-minimum', 'above-maximum', 'duplicate-key', 'format']);

function findingOf(issue: ValidationIssue): Finding {
  const path = issue.path;
  // Der Block heißt in der Notiz `hypertext`; er ist der Ort, wenn der Fehler die Wurzel selbst trifft.
  const where = path === '' ? 'hypertext' : path;
  const later = issue.code === 'not-in-enum' && issue.message.includes('is not available yet');
  const oneOf = issue.code === 'one-of' ? /(?:exactly|only) one of ([^ ]+(?:, [^ ]+)*)/.exec(issue.message)?.[1] : undefined;
  const severity = issue.severity === 'warning' ? 'warning' : 'error';
  const recipePath = path === '' ? {} : { recipePath: path };
  if (issue.code === 'unknown-field') return { severity, code: CODES.recipeUnknownKey, args: [where], ...recipePath };
  if (later) return { severity, code: CODES.recipeValueLater, args: [where], ...recipePath };
  if (oneOf !== undefined) return { severity, code: CODES.recipeInvalid, variant: 'one-of', args: [where, oneOf], ...recipePath };
  if (issue.code === 'not-object') return { severity, code: CODES.recipeInvalid, variant: 'not-object', args: [], ...recipePath };
  if (ISSUE_VARIANTS.has(issue.code)) return { severity, code: CODES.recipeInvalid, variant: issue.code, args: [where], ...recipePath };
  return { severity, code: CODES.recipeInvalid, args: [where, issue.message], ...recipePath };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => x !== undefined) : []);

type Schemed = { properties?: Record<string, FieldSchema> };
/** Der Wert eines Schlüssels unter seinem Namen oder einem seiner Aliase aus dem Schema (das Kit benennt nichts um). */
function pick(source: unknown, schema: Schemed, name: string): unknown {
  const def = schema.properties?.[name] as { aliases?: string[] } | undefined;
  return readField(source, name, def?.aliases ?? []);
}

/** `mention` und `name` sind Regeln, `field:<name>` das Feld mit diesem Namen, jeder andere Text ein Feldname. */
function orderRule(raw: string | undefined): OrderRule {
  if (raw === undefined) return { kind: 'name' };
  const folded = foldCase(raw);
  if (folded === 'mention') return { kind: 'mention' };
  if (folded === 'name') return { kind: 'name' };
  if (folded.startsWith('field:') && raw.slice(6).trim() !== '') return { kind: 'field', field: raw.slice(6).trim() };
  return { kind: 'field', field: raw };
}

function columnsOf(value: unknown, path: string, problems: Finding[]): Column[] {
  if (!Array.isArray(value)) return [];
  const out: Column[] = [];
  value.forEach((item: unknown, i) => {
    const at = `${path}[${i}]`;
    if (typeof item === 'string') {
      const f = str(item);
      if (f !== undefined) out.push({ header: f, field: f });
      return;
    }
    if (!isObject(item)) return;
    const header = str(pick(item, COLUMN, 'header'));
    const field = str(pick(item, COLUMN, 'field'));
    const template = str(pick(item, COLUMN, 'template'));
    if (field !== undefined && template === undefined) out.push({ header: header ?? field, field });
    else if (template !== undefined && field === undefined) {
      if (header === undefined) problems.push({ severity: 'error', code: CODES.recipeInvalid, variant: 'column-header', args: [at], recipePath: at });
      else out.push({ header, template });
    }
  });
  return out;
}

function sectionsOf(value: unknown, problems: Finding[]): SectionSpec[] {
  if (!Array.isArray(value)) return [];
  const out: SectionSpec[] = [];
  value.forEach((item: unknown, i) => {
    if (!isObject(item)) return;
    const given = (['folder', 'note', 'source'] as const).flatMap((kind) => {
      const path = str(pick(item, SECTION, kind));
      return path === undefined ? [] : [{ kind, path }];
    });
    const only = given.length === 1 ? given[0] : undefined;
    if (only === undefined) return;
    const title = str(pick(item, SECTION, 'title'));
    out.push({
      kind: only.kind,
      path: only.path,
      ...(title !== undefined ? { title } : {}),
      order: orderRule(str(pick(item, SECTION, 'order'))),
      groupBy: strList(pick(item, SECTION, 'group_by')),
      overview: columnsOf(pick(item, SECTION, 'overview'), `sections[${i}].overview`, problems),
      summaryLine: columnsOf(pick(item, SECTION, 'summary_line'), `sections[${i}].summary_line`, problems),
      open: pick(item, SECTION, 'open') === true,
    });
  });
  return out;
}

/** Ohne `key` ist der Schlüssel der Slug des letzten Pfadteils (`quelle`, wenn davon nichts bleibt). */
function sourceKey(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p !== '' && p !== '.' && p !== '..');
  return slugify(parts[parts.length - 1] ?? '', { fallback: 'quelle' });
}

function sourcesOf(value: unknown): SourceSpec[] {
  if (!Array.isArray(value)) return [];
  const out: SourceSpec[] = [];
  for (const item of value as unknown[]) {
    const path = typeof item === 'string' ? str(item) : isObject(item) ? str(pick(item, SOURCE, 'path')) : undefined;
    if (path === undefined) continue;
    if (!isObject(item)) {
      out.push({ path, key: sourceKey(path) });
      continue;
    }
    const title = str(pick(item, SOURCE, 'title'));
    out.push({ path, key: str(pick(item, SOURCE, 'key')) ?? sourceKey(path), ...(title !== undefined ? { title } : {}) });
  }
  return out;
}

const GRID_KEYS = new Set(['states', 'groupcolumns', 'rownote']);
const OFF = new Set(['off', 'none', 'aus']);

/** Die Regel für das Zustandsraster (Spec 10.12): `states` ist eine Abbildung Zustand → Wörter (ein Text zählt als ein Wort), die beiden anderen Schlüssel sind ein Wert oder aus. */
function readGrids(value: unknown, problems: Finding[]): GridRule | null {
  if (value === undefined) return null;
  const bad = (path: string, variant: string, args: readonly FindingArg[] = []): void => { problems.push({ severity: 'error', code: CODES.recipeInvalid, variant, args: [path, ...args], recipePath: path }); };
  if (!isObject(value)) {
    bad('grids', 'grids-object');
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!GRID_KEYS.has(normFieldKey(key))) problems.push({ severity: 'warning', code: CODES.recipeUnknownKey, args: [`grids.${key}`], recipePath: `grids.${key}` });
  }
  const rawStates = readField(value, 'states', []);
  const states: Record<string, string[]> = {};
  if (!isObject(rawStates)) bad('grids.states', rawStates === undefined ? 'grids-states-missing' : 'grids-states-shape');
  else {
    for (const state of Object.keys(rawStates)) {
      const words = rawStates[state];
      const list = typeof words === 'string' ? [words] : Array.isArray(words) && words.every((w): w is string => typeof w === 'string') ? words : null;
      if (list === null) bad(`grids.states.${state}`, 'grids-state-words');
      else states[state] = list;
    }
  }
  const choice = <T extends string>(name: string, allowed: T): T | null => {
    const v = readField(value, name, []);
    if (v === undefined || v === false || (typeof v === 'string' && OFF.has(foldCase(v.trim())))) return null;
    if (v === allowed) return allowed;
    bad(`grids.${name}`, 'grids-choice', [allowed]);
    return null;
  };
  return { states, groupColumns: choice('group_columns', 'header-prefix'), rowNote: choice('row_note', 'parentheses') };
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Liest die Bauanleitung (den Wert des Schlüssels `hypertext` im Frontmatter der Einstiegsnotiz, oder `undefined`) in eine `Recipe`.
 * Deutsche Aliase gelten wie die englischen Schlüssel (Groß/Klein, `_` und `-` zählen nicht). Ein unbekannter Schlüssel ist eine Warnung `recipe.unknown-key`;
 * ein unbekannter Wert eines bekannten Schlüssels ein Fehler (`recipe.value-later`, wenn er in einer späteren Fassung gilt, sonst `recipe.invalid`), `version` ungleich 1 ein Fehler `recipe.version`.
 * Ein fehlerhafter Wert fällt in der `Recipe` auf den Standardwert (der Fehler bricht den Lauf ab, siehe `hasError`); nichts wird still angenommen. Wirft nie.
 */
export function parseRecipe(raw: unknown): { recipe: Recipe; findings: Finding[] } {
  if (raw === undefined || raw === null) return { recipe: DEFAULT_RECIPE, findings: [] };
  const findings: Finding[] = inputIssues(SCHEMA, raw, { unknownFields: 'warn' })
    .filter((issue) => !issue.path.startsWith('grids.'))
    .map(findingOf);
  if (!isObject(raw)) return { recipe: DEFAULT_RECIPE, findings };

  const version = pick(raw, SCHEMA, 'version');
  if (typeof version === 'number' && Number.isInteger(version) && version !== 1) {
    findings.push({ severity: 'error', code: CODES.recipeVersion, args: [version], recipePath: 'version' });
  }
  const limit = pick(raw, SCHEMA, 'output_limit_mb');
  if (typeof limit === 'number' && Number.isFinite(limit) && limit <= 0) {
    findings.push({ severity: 'error', code: CODES.recipeInvalid, variant: 'output-limit', args: [], recipePath: 'output_limit_mb' });
  }

  const fields = pick(raw, SCHEMA, 'fields');
  const fold = pick(raw, SCHEMA, 'fold');
  const fieldsOf = (name: 'title' | 'order' | 'exclude'): { [k in typeof name]?: string } => {
    const v = isObject(fields) ? str(pick(fields, FIELDS, name)) : undefined;
    return v === undefined ? {} : { [name]: v };
  };
  const headingsFrom = isObject(fold) ? pick(fold, FOLD, 'headings_from') : undefined;
  const title = str(pick(raw, SCHEMA, 'title'));

  const recipe: Recipe = {
    version: 1,
    ...(title !== undefined ? { title } : {}),
    lang: pickEnum(pick(raw, SCHEMA, 'lang'), ['en', 'de'], DEFAULT_RECIPE.lang),
    sources: sourcesOf(pick(raw, SCHEMA, 'sources')),
    sections: sectionsOf(pick(raw, SCHEMA, 'sections'), findings),
    fields: { ...fieldsOf('title'), ...fieldsOf('order'), ...fieldsOf('exclude') },
    fold: {
      headingsFrom: typeof headingsFrom === 'number' && Number.isInteger(headingsFrom) && headingsFrom >= 1 && headingsFrom <= 6 ? headingsFrom : null,
      linkedSummary: isObject(fold) && pick(fold, FOLD, 'linked_summary') === true,
    },
    grids: readGrids(pick(raw, SCHEMA, 'grids'), findings),
    theme: str(pick(raw, SCHEMA, 'theme')) ?? DEFAULT_RECIPE.theme,
    output: pickEnum(pick(raw, SCHEMA, 'output'), ['auto', 'file', 'package'], DEFAULT_RECIPE.output),
    outputLimitMb: typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_RECIPE.outputLimitMb,
    embeds: 'static',
    blocks: pickEnum(pick(raw, SCHEMA, 'blocks'), ['none', 'core', 'all'], DEFAULT_RECIPE.blocks),
    remoteImages: pickEnum(pick(raw, SCHEMA, 'remote_images'), ['skip', 'embed'], DEFAULT_RECIPE.remoteImages),
    stamp: pickEnum(pick(raw, SCHEMA, 'stamp'), ['minimal', 'full'], DEFAULT_RECIPE.stamp),
  };
  return { recipe, findings };
}
