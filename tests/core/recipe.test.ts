import { describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { DEFAULT_RECIPE, notYetFindings, parseRecipe, recipeYaml } from '../../src/core/recipe';
import type { NoteInput, Recipe } from '../../src/core/types';
import { textOf } from './text-of';

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

describe('parseRecipe', () => {
  const only = (raw: unknown) => parseRecipe(raw).findings;

  it('undefined (kein Block) ergibt DEFAULT_RECIPE und keine Befunde', () => {
    expect(parseRecipe(undefined)).toEqual({ recipe: DEFAULT_RECIPE, findings: [] });
    expect(parseRecipe(null)).toEqual({ recipe: DEFAULT_RECIPE, findings: [] });
  });

  it('der deutsche Block ergibt dieselbe Recipe wie der englische', () => {
    const en = {
      version: 1,
      title: 'Bericht',
      lang: 'de',
      sources: ['../../runs/a', { path: '../../runs/b', key: 'lauf-b', title: 'Lauf B' }],
      sections: [
        { folder: 'themen', title: 'Themen', order: 'mention', group_by: ['lauf', 'folder'], overview: ['frage', { header: 'Pro', template: '{a} von {b}' }], summary_line: ['frage'], open: true },
        { note: 'schluss.md' },
      ],
      fields: { title: 'name', order: 'rang', exclude: 'weg' },
      fold: { headings_from: 3, linked_summary: true },
      theme: 'default',
      output: 'file',
      output_limit_mb: 5,
      embeds: 'static',
      blocks: 'all',
      remote_images: 'skip',
      stamp: 'full',
    };
    const de = {
      version: 1,
      titel: 'Bericht',
      sprache: 'de',
      quellen: ['../../runs/a', { pfad: '../../runs/b', key: 'lauf-b', titel: 'Lauf B' }],
      bereiche: [
        { ordner: 'themen', titel: 'Themen', reihenfolge: 'mention', gruppen: ['lauf', 'folder'], uebersicht: ['frage', { ueberschrift: 'Pro', vorlage: '{a} von {b}' }], zusatzzeile: ['frage'], offen: true },
        { datei: 'schluss.md' },
      ],
      felder: { titel: 'name', reihenfolge: 'rang', ausschliessen: 'weg' },
      aufklappen: { ueberschrift_ab: 3, zusatzzeile_aus_link: true },
      thema: 'default',
      ausgabe: 'file',
      output_limit_mb: 5,
      einbettungen: 'static',
      bloecke: 'all',
      fernbilder: 'skip',
      stempel: 'full',
    };
    const a = parseRecipe(en);
    const b = parseRecipe(de);
    expect(a.findings).toEqual([]);
    expect(b.findings).toEqual([]);
    expect(b.recipe).toEqual(a.recipe);
    expect(a.recipe.title).toBe('Bericht');
    expect(a.recipe.sections[0]).toEqual({
      kind: 'folder',
      path: 'themen',
      title: 'Themen',
      order: { kind: 'mention' },
      groupBy: ['lauf', 'folder'],
      overview: [{ header: 'frage', field: 'frage' }, { header: 'Pro', template: '{a} von {b}' }],
      summaryLine: [{ header: 'frage', field: 'frage' }],
      open: true,
    });
    expect(a.recipe.sections[1]).toEqual({ kind: 'note', path: 'schluss.md', order: { kind: 'name' }, groupBy: [], overview: [], summaryLine: [], open: false });
    expect(a.recipe.fold).toEqual({ headingsFrom: 3, linkedSummary: true });
    expect(a.recipe.fields).toEqual({ title: 'name', order: 'rang', exclude: 'weg' });
    expect(a.recipe.outputLimitMb).toBe(5);
  });

  it('tolerant gegen Groß-/Kleinschreibung, _ und - im Schlüssel', () => {
    expect(parseRecipe({ 'Output-Limit_MB': 7, REMOTE_images: 'embed' }).recipe).toMatchObject({ outputLimitMb: 7, remoteImages: 'embed' });
  });

  it('eine Quelle ohne key bekommt den Slug des letzten Pfadteils', () => {
    const { recipe, findings } = parseRecipe({ sources: ['../../runs/Lauf Zwei/', { path: 'x/Größe' }] });
    expect(findings).toEqual([]);
    expect(recipe.sources).toEqual([
      { path: '../../runs/Lauf Zwei/', key: 'lauf-zwei' },
      { path: 'x/Größe', key: 'groesse' },
    ]);
  });

  it('embeds: live ist ein Fehler recipe.value-later und der Text nennt embeds', () => {
    const f = only({ embeds: 'live' });
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('error');
    expect(f[0]?.code).toBe(CODES.recipeValueLater);
    expect(textOf(f[0])).toContain('embeds');
    expect(textOf(f[0])).toContain('later version');
    expect(f[0]?.recipePath).toBe('embeds');
    // der Alias meldet unter dem festen Namen
    expect(only({ einbettungen: 'live' })[0]?.recipePath).toBe('embeds');
  });

  it('ein Tippfehler-Schlüssel ist eine Warnung recipe.unknown-key mit recipePath', () => {
    const { recipe, findings } = parseRecipe({ sectons: [{ folder: 'a' }], title: 'T' });
    expect(findings).toEqual([expect.objectContaining({ severity: 'warning', code: CODES.recipeUnknownKey, recipePath: 'sectons' })]);
    expect(recipe.title).toBe('T');
    expect(recipe.sections).toEqual([]);
  });

  it('ein unbekannter Schlüssel in einem Bereich nennt den Ort', () => {
    const f = only({ sections: [{ folder: 'a' }, { folder: 'b', oepn: true }] });
    expect(f).toEqual([expect.objectContaining({ severity: 'warning', code: CODES.recipeUnknownKey, recipePath: 'sections[1].oepn' })]);
  });

  it('Spalte mit Vorlage und Spalte als Text', () => {
    const { recipe, findings } = parseRecipe({ sections: [{ folder: 'a', overview: [{ header: 'Pro', template: '{a} von {b}' }, 'frage', { header: 'F', field: 'frage.x' }, { field: 'nur' }] }] });
    expect(findings).toEqual([]);
    expect(recipe.sections[0]?.overview).toEqual([
      { header: 'Pro', template: '{a} von {b}' },
      { header: 'frage', field: 'frage' },
      { header: 'F', field: 'frage.x' },
      { header: 'nur', field: 'nur' },
    ]);
  });

  it('eine Spalte mit field und template oder mit keinem von beiden ist ein Fehler recipe.invalid', () => {
    const both = only({ sections: [{ folder: 'a', overview: [{ header: 'H', field: 'x', template: '{x}' }] }] });
    expect(both).toEqual([expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sections[0].overview[0]' })]);
    const none = only({ sections: [{ folder: 'a', overview: [{ header: 'H' }] }] });
    expect(none[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid });
    const noHeader = only({ sections: [{ folder: 'a', summary_line: [{ template: '{x}' }] }] });
    expect(noHeader[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sections[0].summary_line[0]' });
  });

  it('ein Bereich braucht genau eines von folder, note, source', () => {
    expect(only({ sections: [{ title: 'x' }] })[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sections[0]' });
    expect(only({ sections: [{ folder: 'a', note: 'b.md' }] })[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sections[0]' });
    expect(parseRecipe({ sections: [{ source: 'lauf-a' }] }).recipe.sections[0]).toMatchObject({ kind: 'source', path: 'lauf-a' });
  });

  it('version: 2 ist ein Fehler recipe.version', () => {
    const f = only({ version: 2 });
    expect(f).toEqual([expect.objectContaining({ severity: 'error', code: CODES.recipeVersion, recipePath: 'version' })]);
    expect(only({ version: 1 })).toEqual([]);
  });

  it('output_limit_mb: 0 und negative Werte sind ein Fehler recipe.invalid', () => {
    expect(only({ output_limit_mb: 0 })).toEqual([expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'output_limit_mb' })]);
    expect(only({ output_limit_mb: -3 })[0]?.code).toBe(CODES.recipeInvalid);
    expect(only({ output_limit_mb: 'viel' })[0]?.code).toBe(CODES.recipeInvalid);
    expect(parseRecipe({ output_limit_mb: 0.5 }).recipe.outputLimitMb).toBe(0.5);
  });

  it('falsche Typen und unzulässige Werte sind Fehler recipe.invalid mit Pfad, nie ein stiller Standardwert', () => {
    expect(only({ blocks: 'viele' })[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'blocks' });
    expect(only({ lang: 'fr' })[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'lang' });
    expect(only({ sections: 'a' })[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sections' });
    expect(only({ fold: { headings_from: 9 } })[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'fold.headings_from' });
    expect(only('hypertext')[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid });
    expect(parseRecipe({ blocks: 'viele' }).recipe.blocks).toBe('core');
  });

  it('order: mention und name sind Regeln, jeder andere Text ist ein Feldname, field:name das Feld name', () => {
    const rule = (order: string) => parseRecipe({ sections: [{ folder: 'a', order }] }).recipe.sections[0]?.order;
    expect(rule('mention')).toEqual({ kind: 'mention' });
    expect(rule('name')).toEqual({ kind: 'name' });
    expect(rule('rang')).toEqual({ kind: 'field', field: 'rang' });
    expect(rule('field:name')).toEqual({ kind: 'field', field: 'name' });
    expect(rule('field:mention')).toEqual({ kind: 'field', field: 'mention' });
  });

  it('das Raster wird gelesen und bleibt ein recipe.not-yet für notYetFindings', () => {
    const { recipe, findings } = parseRecipe({ grids: { states: { ok: ['ja', 'ok'], no: ['nein'] }, group_columns: 'header-prefix', row_note: 'parentheses' } });
    expect(findings).toEqual([]);
    expect(recipe.grids).toEqual({ states: { ok: ['ja', 'ok'], no: ['nein'] }, groupColumns: 'header-prefix', rowNote: 'parentheses' });
    expect(notYetFindings(recipe).map((x) => x.recipePath)).toEqual(['grids']);
    expect(parseRecipe({ raster: { states: { ok: 'ja' } } }).recipe.grids).toEqual({ states: { ok: ['ja'] }, groupColumns: null, rowNote: null });
    expect(only({ grids: { states: { ok: 5 } } })[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid });
    expect(only({ grids: { states: { ok: 'ja' }, stats: {} } })).toEqual([expect.objectContaining({ severity: 'warning', code: CODES.recipeUnknownKey, recipePath: 'grids.stats' })]);
  });

  it('Befunde (als Menge) und Ergebnis hängen nicht von der Reihenfolge der Schlüssel ab', () => {
    const a = parseRecipe({ blocks: 'viele', embeds: 'live', sectons: 1, title: 'T' });
    const b = parseRecipe({ title: 'T', sectons: 1, embeds: 'live', blocks: 'viele' });
    expect(new Set(a.findings.map((x) => `${x.code}|${x.recipePath ?? ''}`))).toEqual(new Set(b.findings.map((x) => `${x.code}|${x.recipePath ?? ''}`)));
    expect(a.recipe).toEqual(b.recipe);
  });
});

describe('parseRecipe: Obergruppe, Spaltennamen, Gruppentitel (Vertragslücken focus-crew)', () => {
  const only = (raw: unknown): ReturnType<typeof parseRecipe>['findings'] => parseRecipe(raw).findings;

  it('sources in einem Bereich ist eine Obergruppe über mehrere Quellen, mit Titel und dem Alias quellen', () => {
    const { recipe, findings } = parseRecipe({ sections: [{ sources: ['a', 'b'], title: 'Interviews', group_by: ['persona'] }] });
    expect(findings).toEqual([]);
    expect(recipe.sections[0]).toMatchObject({ kind: 'sources', path: '', sources: ['a', 'b'], title: 'Interviews', groupBy: ['persona'] });
    const de = parseRecipe({ bereiche: [{ quellen: ['a', 'b'], titel: 'Interviews', gruppen: ['persona'] }] });
    expect(de.recipe.sections).toEqual(recipe.sections);
  });

  it('eine Obergruppe ohne Titel oder mit leerer Liste ist ein Fehler, der Bereich fällt weg', () => {
    const noTitle = parseRecipe({ sections: [{ sources: ['a'] }] });
    expect(noTitle.findings).toEqual([expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, variant: 'section-sources-title', recipePath: 'sections[0]' })]);
    expect(noTitle.recipe.sections).toEqual([]);
    const empty = parseRecipe({ sections: [{ sources: [], title: 'X' }] });
    expect(empty.findings).toEqual([expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, variant: 'section-sources-empty', recipePath: 'sections[0].sources' })]);
    expect(empty.recipe.sections).toEqual([]);
  });

  it('source und sources zugleich ist ein Fehler recipe.invalid one-of', () => {
    expect(only({ sections: [{ source: 'a', sources: ['b'], title: 'X' }] })[0]).toMatchObject({ severity: 'error', code: CODES.recipeInvalid, variant: 'one-of', recipePath: 'sections[0]' });
  });

  it('label (Alias beschriftung) gilt in summary_line; in overview ist es ein unbekannter Schlüssel', () => {
    const { recipe, findings } = parseRecipe({ sections: [{ folder: 'a', summary_line: [{ field: 'stelle', label: 'Stelle' }, { header: 'B', template: '{n} Befunde', beschriftung: 'Befunde' }, 'frage'] }] });
    expect(findings).toEqual([]);
    expect(recipe.sections[0]?.summaryLine).toEqual([
      { header: 'stelle', field: 'stelle', label: 'Stelle' },
      { header: 'B', template: '{n} Befunde', label: 'Befunde' },
      { header: 'frage', field: 'frage' },
    ]);
    const inOverview = parseRecipe({ sections: [{ folder: 'a', overview: [{ field: 'x', label: 'X' }] }] });
    expect(inOverview.findings).toEqual([expect.objectContaining({ severity: 'warning', code: CODES.recipeUnknownKey, recipePath: 'sections[0].overview[0].label' })]);
    expect(inOverview.recipe.sections[0]?.overview).toEqual([{ header: 'x', field: 'x' }]);
  });

  it('title_from (Alias titel_aus) läuft mit group_by; mehr Felder als Ebenen ist eine Warnung, die übrigen fallen weg', () => {
    const { recipe, findings } = parseRecipe({ sections: [{ folder: 'a', group_by: ['lauf', 'persona'], title_from: ['lauf_name', 'vorname'] }] });
    expect(findings).toEqual([]);
    expect(recipe.sections[0]?.titleFrom).toEqual(['lauf_name', 'vorname']);
    expect(parseRecipe({ sections: [{ folder: 'a', gruppen: ['persona'], titel_aus: ['vorname'] }] }).recipe.sections[0]?.titleFrom).toEqual(['vorname']);
    const extra = parseRecipe({ sections: [{ folder: 'a', group_by: ['persona'], title_from: ['vorname', 'x'] }] });
    expect(extra.findings).toEqual([expect.objectContaining({ severity: 'warning', code: CODES.recipeInvalid, variant: 'title-from-extra', args: ['sections[0].title_from', 2, 1] })]);
    expect(extra.recipe.sections[0]?.titleFrom).toEqual(['vorname']);
  });

  it('eine Bauanleitung ohne die neuen Schlüssel liest sich wie vorher: kein titleFrom, kein label, kein sources am Bereich', () => {
    const { recipe } = parseRecipe({ sections: [{ folder: 'a', group_by: ['p'], summary_line: ['x'], overview: ['y'] }, { source: 'q' }, { note: 'n.md' }] });
    for (const s of recipe.sections) {
      expect(s).not.toHaveProperty('titleFrom');
      expect(s).not.toHaveProperty('sources');
      for (const c of [...s.overview, ...s.summaryLine]) expect(c).not.toHaveProperty('label');
    }
  });
});
