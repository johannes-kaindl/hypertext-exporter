import { describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { DEFAULT_RECIPE, notYetFindings, recipeYaml } from '../../src/core/recipe';
import type { NoteInput, Recipe } from '../../src/core/types';

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

const noteAt = (path: string): NoteInput => ({ path, frontmatter: {}, body: '', links: [] });

describe('recipeYaml', () => {
  const notes = ['Projekt/b/x.md', 'Projekt/a/y.md', 'Projekt/Ä/z.md', 'Projekt/Ä/w.md', 'Projekt/lose.md', 'Andere/q/x.md', 'Projekt2/c/x.md', 'Projekt/a/tief/n.md'].map(noteAt);

  it('schreibt version, lang und je Unterordner einen folder-Eintrag in Namensordnung (a, b, Ä), nichts sonst', () => {
    expect(recipeYaml('Projekt', notes, 'de')).toBe(
      ['  version: 1', '  lang: de', '  sections:', '    - folder: a', '    - folder: b', '    - folder: Ä'].join('\n'),
    );
  });

  it('die Reihenfolge hängt nicht von der Reihenfolge der Eingabe ab', () => {
    expect(recipeYaml('Projekt', [...notes].reverse(), 'de')).toBe(recipeYaml('Projekt', notes, 'de'));
  });

  it('lang ist de nur bei der Obsidian-Sprache de, sonst en', () => {
    expect(recipeYaml('Projekt', notes, 'de')).toContain('lang: de');
    expect(recipeYaml('Projekt', notes, 'fr')).toContain('lang: en');
    expect(recipeYaml('Projekt', notes, 'fr')).not.toContain('lang: de');
    expect(recipeYaml('Projekt', notes, 'en')).toContain('lang: en');
  });

  it('ordnet Zahlenpräfixe nach Wert, nicht nach Text', () => {
    const n = ['O/10 Zehn/x.md', 'O/2 Zwei/x.md', 'O/1 Eins/x.md'].map(noteAt);
    expect(recipeYaml('O', n, 'en').split('\n').filter((l) => l.includes('folder'))).toEqual(['    - folder: 1 Eins', '    - folder: 2 Zwei', '    - folder: 10 Zehn']);
  });

  it('quotet Ordnernamen, die YAML sonst anders läse', () => {
    const n = ['O/2024/x.md', 'O/a: b/x.md', 'O/true/x.md', 'O/x #y/x.md'].map(noteAt);
    const lines = recipeYaml('O', n, 'en').split('\n').filter((l) => l.includes('folder'));
    expect(lines).toContain('    - folder: "2024"');
    expect(lines).toContain('    - folder: "a: b"');
    expect(lines).toContain('    - folder: "true"');
    expect(lines).toContain('    - folder: "x #y"');
  });

  it('bei gleichem Ordnungsschlüssel entscheidet der volle Name nach Codepunkt (U+FF5E vor U+1F600)', () => {
    // beide Namen lesen sich als Schlüssel 1, Titel "A"; nur das Zeichen im Präfix unterscheidet sie
    const n = ['O/01 \u{1F600} A/x.md', 'O/01 \uFF5E A/x.md'].map(noteAt);
    const lines = (list: NoteInput[]): string[] => recipeYaml('O', list, 'en').split('\n').filter((l) => l.includes('folder'));
    const expected = ['    - folder: 01 \uFF5E A', '    - folder: 01 \u{1F600} A'];
    expect(lines(n)).toEqual(expected);
    expect(lines([...n].reverse())).toEqual(lines(n));
  });

  it('ein Ordner ohne Unterordner schreibt kein sections', () => {
    expect(recipeYaml('Projekt', [noteAt('Projekt/lose.md')], 'en')).toBe('  version: 1\n  lang: en');
  });

  it('der Wurzelordner nimmt die Ordner oberster Ebene', () => {
    expect(recipeYaml('', [noteAt('b/x.md'), noteAt('a/x.md'), noteAt('lose.md')], 'en')).toBe('  version: 1\n  lang: en\n  sections:\n    - folder: a\n    - folder: b');
  });
});
