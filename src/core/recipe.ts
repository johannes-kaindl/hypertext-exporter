// Bauanleitung (Spec 10.10). Lesen (`parseRecipe`) wartet auf die Kit-Bestellungen 3 (Alias-Felder) und 12 (inputIssues verschachtelt); hier nur Standardwerte und Hinweise.
import { quoteScalar } from '../vendor/kit/frontmatter';
import { compareCodePoints, compareOrderedNames, parseOrderedName } from '../vendor/kit/name-order';
import { normalizeRelPath } from '../vendor/kit/rel-path';
import { CODES } from './finding-codes';
import type { Finding, NoteInput, Recipe } from './types';

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
    message: `${key} wird in dieser Version noch nicht umgesetzt`,
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
