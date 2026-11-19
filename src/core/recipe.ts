// Bauanleitung (Spec 10.10). Lesen (`parseRecipe`) wartet auf die Kit-Bestellungen 3 (Alias-Felder) und 12 (inputIssues verschachtelt); hier nur Standardwerte und Hinweise.
import { CODES } from './finding-codes';
import type { Finding, Recipe } from './types';

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
