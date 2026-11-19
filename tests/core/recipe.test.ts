import { describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { DEFAULT_RECIPE, notYetFindings } from '../../src/core/recipe';
import type { Recipe } from '../../src/core/types';

describe('DEFAULT_RECIPE', () => {
  it('hat genau die Standardwerte aus Spec 10.10 plus lang en', () => {
    expect(DEFAULT_RECIPE).toEqual({
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
    });
  });
});

describe('notYetFindings', () => {
  it('meldet für DEFAULT_RECIPE nichts', () => {
    expect(notYetFindings(DEFAULT_RECIPE)).toEqual([]);
  });

  const cases: Array<[string, Partial<Recipe>]> = [
    ['grids', { grids: { states: { ok: ['x'] }, groupColumns: null, rowNote: null } }],
    ['theme', { theme: 'x' }],
    ['output', { output: 'package' }],
    ['remote_images', { remoteImages: 'embed' }],
  ];
  it.each(cases)('meldet %s als warning recipe.not-yet', (key, patch) => {
    const found = notYetFindings({ ...DEFAULT_RECIPE, ...patch });
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('warning');
    expect(found[0]?.code).toBe(CODES.recipeNotYet);
    expect(found[0]?.recipePath).toBe(key);
  });

  it('meldet stamp full und output file nicht', () => {
    expect(notYetFindings({ ...DEFAULT_RECIPE, stamp: 'full', output: 'file' })).toEqual([]);
  });
});
