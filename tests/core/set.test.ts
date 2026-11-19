import { describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { DEFAULT_RECIPE } from '../../src/core/recipe';
import { buildSet, resolveSourcePaths } from '../../src/core/set';
import type { ExportScope, ExportSet, NoteInput, Recipe, SectionSpec, SetGroup, SetNode, SetNote } from '../../src/core/types';

const note = (path: string, frontmatter: Record<string, unknown> = {}, body = 'Text.\n', links: string[] = []): NoteInput => ({ path, frontmatter, body, links });
const folderScope = (folder: string, entryPath = ''): ExportScope => ({ kind: 'folder', folder, entryPath });
const withRecipe = (patch: Partial<Recipe>): Recipe => ({ ...DEFAULT_RECIPE, ...patch });
const section = (patch: Partial<SectionSpec> & Pick<SectionSpec, 'kind' | 'path'>): SectionSpec => ({ order: { kind: 'name' }, groupBy: [], overview: [], summaryLine: [], open: false, ...patch });
const paths = (set: ExportSet): string[] => set.notesInOrder.map((n) => n.path);
const isGroup = (n: SetNode): n is SetGroup => 'children' in n;
/** Der Baum als Text: Gruppen als `[Titel]`, Notizen als Pfad; einrücken mit Tiefe. */
const outline = (nodes: SetNode[], depth = 0): string[] => nodes.flatMap((n) => (isGroup(n) ? [`${'  '.repeat(depth)}[${n.title}]`, ...outline(n.children, depth + 1)] : [`${'  '.repeat(depth)}${n.path}`]));
const notesOf = (nodes: SetNode[]): SetNote[] => nodes.flatMap((n) => (isGroup(n) ? notesOf(n.children) : [n]));

const BASE: NoteInput[] = [
  note('beispiel/beispiel.md', {}, '# Beispiel\n\nEinstieg.\n'),
  note('beispiel/b/zwei.md'),
  note('beispiel/a/eins.md'),
  note('beispiel/lose.md'),
];

describe('Einstieg', () => {
  it('der im Dialog gewählte Einstieg gewinnt vor der Ordnernotiz', () => {
    const { set } = buildSet(folderScope('beispiel', 'beispiel/lose.md'), BASE, DEFAULT_RECIPE);
    expect(set.entry.path).toBe('beispiel/lose.md');
    expect(paths(set)).toEqual(['beispiel/lose.md', 'beispiel/beispiel.md', 'beispiel/a/eins.md', 'beispiel/b/zwei.md']);
    expect(set.entry.depth).toBe(0);
  });

  it('sonst die Ordnernotiz (heißt wie der Ordner), nicht noch einmal unter den Bereichen', () => {
    const { set } = buildSet(folderScope('beispiel'), BASE, DEFAULT_RECIPE);
    expect(set.entry.path).toBe('beispiel/beispiel.md');
    expect(set.entry.title).toBe('Beispiel');
    expect(paths(set).filter((p) => p === 'beispiel/beispiel.md')).toHaveLength(1);
    expect(notesOf(set.nodes).map((n) => n.path)).not.toContain('beispiel/beispiel.md');
  });

  it('sonst die erste Notiz der Reihenfolge; ein angegebener, aber fehlender Einstieg fällt auf die Rangfolge zurück', () => {
    const notes = BASE.filter((n) => n.path !== 'beispiel/beispiel.md');
    // Lesereihenfolge: Gruppen a und b stehen vor der losen Notiz (Namensordnung), also ist die erste Notiz a/eins.md
    expect(buildSet(folderScope('beispiel'), notes, DEFAULT_RECIPE).set.entry.path).toBe('beispiel/a/eins.md');
    expect(buildSet(folderScope('beispiel', 'beispiel/gibtsnicht.md'), notes, DEFAULT_RECIPE).set.entry.path).toBe('beispiel/a/eins.md');
  });

  it('der gewählte Einstieg bleibt, auch wenn er ausgeschlossen, versteckt oder ohne Körper ist', () => {
    const notes = [note('o/0 Plan.md', { exclude: true }, ''), note('o/x.md')];
    const { set, findings } = buildSet(folderScope('o', 'o/0 Plan.md'), notes, DEFAULT_RECIPE);
    expect(set.entry.path).toBe('o/0 Plan.md');
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(paths(set)).toEqual(['o/0 Plan.md', 'o/x.md']);
  });

  it('der Titel der Seite ist der Titel der Bauanleitung, sonst der Titel des Einstiegs', () => {
    expect(buildSet(folderScope('beispiel'), BASE, DEFAULT_RECIPE).set.title).toBe('Beispiel');
    expect(buildSet(folderScope('beispiel'), BASE, withRecipe({ title: 'Bericht' })).set.title).toBe('Bericht');
  });

  it('ohne eine Notiz in der Menge ein Fehler (der Lauf bricht ab) und ein Platzhalter-Einstieg', () => {
    const { set, findings } = buildSet(folderScope('leer'), [note('woanders/x.md')], DEFAULT_RECIPE);
    expect(findings).toEqual([expect.objectContaining({ severity: 'error', code: CODES.setEmpty })]);
    expect(set.notesInOrder).toEqual([]);
    expect(set.nodes).toEqual([]);
  });
});

describe('Einzelnotiz', () => {
  it('ergibt eine Menge aus genau dieser Notiz ohne Gruppen, auch ohne Körper', () => {
    const notes = [note('a/n.md', { title: 'Der Titel' }, ''), note('a/andere.md')];
    const { set, findings } = buildSet({ kind: 'note', entryPath: 'a/n.md' }, notes, DEFAULT_RECIPE);
    expect(findings).toEqual([]);
    expect(set.nodes).toEqual([]);
    expect(set.notesInOrder).toEqual([set.entry]);
    expect(set.entry).toMatchObject({ path: 'a/n.md', title: 'Der Titel', depth: 0 });
    expect(set.title).toBe('Der Titel');
  });

  it('eine fehlende Notiz ist ein Fehler', () => {
    const { set, findings } = buildSet({ kind: 'note', entryPath: 'a/fehlt.md' }, [note('a/n.md')], DEFAULT_RECIPE);
    expect(findings).toEqual([expect.objectContaining({ severity: 'error', code: CODES.setEmpty })]);
    expect(set.notesInOrder).toEqual([]);
  });
});

describe('Gruppen und Ordnung (vom Kit-Ordnerbaum)', () => {
  it('leeres sections ergibt je Unterordner eine Gruppe in Namensordnung, lose Notizen als Notiz', () => {
    const notes = [
      note('p/p.md'),
      note('p/10 Zehn/a.md'),
      note('p/2 Zwei/a.md'),
      note('p/b/a.md'),
      note('p/a/tief/z.md'),
      note('p/a/y.md'),
      note('p/lose.md'),
    ];
    const { set } = buildSet(folderScope('p'), notes, DEFAULT_RECIPE);
    expect(outline(set.nodes)).toEqual([
      '[Zwei]', '  p/2 Zwei/a.md',
      '[Zehn]', '  p/10 Zehn/a.md',
      '[a]', '  [tief]', '    p/a/tief/z.md', '  p/a/y.md',
      '[b]', '  p/b/a.md',
      'p/lose.md',
    ]);
    const groups = set.nodes.filter(isGroup);
    expect(groups.every((g) => !g.open && g.overview.length === 0 && g.summaryLine.length === 0)).toBe(true);
    expect(notesOf(set.nodes).find((n) => n.path === 'p/a/tief/z.md')?.depth).toBe(2);
    expect(notesOf(set.nodes).find((n) => n.path === 'p/lose.md')?.depth).toBe(0);
  });

  it('Zahlenpräfix ordnet vor dem Namen, ohne Präfix nach Codepunkt (Grundlagen vor Größe)', () => {
    const notes = [note('o/o.md'), note('o/Größe.md'), note('o/Grundlagen.md'), note('o/3 Drei.md'), note('o/1 Eins.md')];
    expect(paths(buildSet(folderScope('o'), notes, DEFAULT_RECIPE).set)).toEqual(['o/o.md', 'o/1 Eins.md', 'o/3 Drei.md', 'o/Grundlagen.md', 'o/Größe.md']);
  });

  it('die Titel verlieren das Zahlenpräfix', () => {
    const { set } = buildSet(folderScope('o'), [note('o/o.md'), note('o/01 Einleitung.md')], DEFAULT_RECIPE);
    expect(set.notesInOrder[1]?.title).toBe('Einleitung');
  });

  it('0 Entwurf.md (Ordnungszahl 0) kommt nicht in die Menge, ohne Befund', () => {
    const notes = [note('o/o.md'), note('o/0 Entwurf.md'), note('o/00 Skizze.md'), note('o/0 Ordner/x.md'), note('o/1 Fertig.md')];
    const { set, findings } = buildSet(folderScope('o'), notes, DEFAULT_RECIPE);
    expect(paths(set)).toEqual(['o/o.md', 'o/1 Fertig.md']);
    expect(findings).toEqual([]);
  });

  it('bei gleichem Ordnungsschlüssel entscheidet der volle Pfad nach Codepunkt (01 A und 1 A)', () => {
    const notes = [note('o/o.md'), note('o/1 A.md'), note('o/01 A.md')];
    const forward = buildSet(folderScope('o'), notes, DEFAULT_RECIPE).set;
    expect(paths(forward)).toEqual(['o/o.md', 'o/01 A.md', 'o/1 A.md']);
    expect(buildSet(folderScope('o'), [...notes].reverse(), DEFAULT_RECIPE).set).toEqual(forward);
  });

  it('das Feld order ordnet vor dem Namen (und das Alias reihenfolge)', () => {
    const notes = [note('o/o.md'), note('o/a.md'), note('o/b.md', { order: 2 }), note('o/c.md', { Reihenfolge: '1' })];
    expect(paths(buildSet(folderScope('o'), notes, DEFAULT_RECIPE).set)).toEqual(['o/o.md', 'o/c.md', 'o/b.md', 'o/a.md']);
  });

  it('die Menge ist der Ordner samt Unterordnern; Notizen außerhalb und Namensvettern (Notizen-alt) gehören nicht dazu', () => {
    const notes = [note('Notizen/n.md'), note('Notizen/u/x.md'), note('Notizen-alt/y.md'), note('anderswo/z.md')];
    expect(paths(buildSet(folderScope('Notizen'), notes, DEFAULT_RECIPE).set)).toEqual(['Notizen/n.md', 'Notizen/u/x.md']);
  });

  it('gleiche Eingabe in umgekehrter Reihenfolge ergibt dieselbe ExportSet und dieselben Befunde', () => {
    const notes = [
      note('p/p.md', {}, '# P\n', ['p/b/x.md', 'p/a/x.md']),
      note('p/a/x.md'), note('p/b/x.md', { exclude: 'ja' }), note('p/c/leer.md', {}, ''), note('p/c/y.md', {}, '# Y\n'), note('p/2 z.md'), note('p/10 z.md'), note('p/Größe.md'), note('p/Grundlagen.md'),
    ];
    const recipe = withRecipe({ sections: [section({ kind: 'folder', path: 'c', title: 'Cee', order: { kind: 'mention' } }), section({ kind: 'folder', path: 'a', order: { kind: 'mention' } })] });
    for (const r of [DEFAULT_RECIPE, recipe]) {
      const a = buildSet(folderScope('p'), notes, r);
      const b = buildSet(folderScope('p'), [...notes].reverse(), r);
      expect(b.set).toEqual(a.set);
      expect(b.findings).toEqual(a.findings);
    }
  });
});

describe('Titel', () => {
  it('Titelfeld (mit Alias titel) vor erster h1 vor Dateiname', () => {
    const notes = [
      note('o/o.md'),
      note('o/a.md', { title: 'Feldtitel' }, '# Überschrift\n'),
      note('o/b.md', { Titel: 'Alias' }),
      note('o/c.md', {}, 'Vorspann\n\n# Erste h1\n\n# Zweite\n'),
      note('o/d.md', {}, '```\n# kein Titel\n```\nText\n'),
    ];
    const titles = Object.fromEntries(buildSet(folderScope('o'), notes, DEFAULT_RECIPE).set.notesInOrder.map((n) => [n.path, n.title]));
    expect(titles).toMatchObject({ 'o/a.md': 'Feldtitel', 'o/b.md': 'Alias', 'o/c.md': 'Erste h1', 'o/d.md': 'd' });
  });

  it('fields: {title: name} nimmt das Feld name', () => {
    const notes = [note('o/o.md', { name: 'Der Einstieg' }), note('o/a.md', { name: 'Nach Feld', title: 'Altes Feld' })];
    const { set } = buildSet(folderScope('o'), notes, withRecipe({ fields: { title: 'name' } }));
    expect(set.entry.title).toBe('Der Einstieg');
    expect(set.notesInOrder[1]?.title).toBe('Nach Feld');
  });

  it('fields: {order} und {exclude} ordnen die Felder zu; die festen Aliase gelten daneben', () => {
    const notes = [note('o/o.md'), note('o/a.md', { rang: 2 }), note('o/b.md', { rang: 1 }), note('o/c.md', { weg: true }), note('o/d.md', { exclude: true })];
    const { set } = buildSet(folderScope('o'), notes, withRecipe({ fields: { order: 'rang', exclude: 'weg' } }));
    expect(paths(set)).toEqual(['o/o.md', 'o/b.md', 'o/a.md']);
  });
});

describe('Ausschluss und leere Dateien', () => {
  it('leere README.md und Dateien ohne Körper fehlen und ergeben info set.empty-file; der Export läuft weiter', () => {
    const notes = [note('o/o.md'), note('o/README.md', {}, ''), note('o/u/README.md', {}, ' \n\t\n'), note('o/u/x.md')];
    const { set, findings } = buildSet(folderScope('o'), notes, DEFAULT_RECIPE);
    expect(paths(set)).toEqual(['o/o.md', 'o/u/x.md']);
    expect(findings).toEqual([
      expect.objectContaining({ severity: 'info', code: CODES.setEmptyFile, notePath: 'o/README.md' }),
      expect.objectContaining({ severity: 'info', code: CODES.setEmptyFile, notePath: 'o/u/README.md' }),
    ]);
  });

  it('eine leere Ordnernotiz wird nicht Einstieg, die erste Notiz der Reihenfolge ist es', () => {
    const { set } = buildSet(folderScope('o'), [note('o/o.md', {}, ''), note('o/a.md')], DEFAULT_RECIPE);
    expect(set.entry.path).toBe('o/a.md');
  });

  it('ein Ordner, in dem nur leere Dateien liegen, ergibt keine Gruppe', () => {
    const { set } = buildSet(folderScope('o'), [note('o/o.md'), note('o/leer/README.md', {}, '')], DEFAULT_RECIPE);
    expect(set.nodes).toEqual([]);
  });

  it('exclude: true und das Alias ausschliessen: ja schließen aus und ergeben info set.excluded', () => {
    const notes = [note('o/o.md'), note('o/a.md', { exclude: true }), note('o/b.md', { ausschliessen: 'ja' }), note('o/c.md')];
    const { set, findings } = buildSet(folderScope('o'), notes, DEFAULT_RECIPE);
    expect(paths(set)).toEqual(['o/o.md', 'o/c.md']);
    expect(findings).toEqual([
      expect.objectContaining({ severity: 'info', code: CODES.setExcluded, notePath: 'o/a.md' }),
      expect.objectContaining({ severity: 'info', code: CODES.setExcluded, notePath: 'o/b.md' }),
    ]);
  });

  it('wahr sind true und die Texte true, ja, yes, 1 ohne Groß/Klein; alles andere nicht', () => {
    const truthy: unknown[] = [true, 'true', 'TRUE', 'Ja', 'JA', 'yes', 'Yes', '1', ' ja ', 1];
    const falsy: unknown[] = [false, 'false', 'nein', 'no', '0', 0, 2, '', 'vielleicht', 'jaja', null, [], ['ja'], {}];
    const notes = [note('o/o.md')];
    truthy.forEach((v, i) => notes.push(note(`o/t${i}.md`, { exclude: v })));
    falsy.forEach((v, i) => notes.push(note(`o/f${i}.md`, { exclude: v })));
    const kept = new Set(paths(buildSet(folderScope('o'), notes, DEFAULT_RECIPE).set));
    truthy.forEach((_, i) => expect(kept.has(`o/t${i}.md`)).toBe(false));
    falsy.forEach((_, i) => expect(kept.has(`o/f${i}.md`)).toBe(true));
  });
});

describe('sections', () => {
  const NOTES = [
    note('p/p.md', {}, '# P\n', ['p/themen/c.md', 'p/themen/a.md']),
    note('p/themen/a.md', { rang: 2, titel: 'A' }), note('p/themen/b.md', { rang: 1 }), note('p/themen/c.md'),
    note('p/themen/themen.md', {}, '# Themenüberblick\n'),
    note('p/interviews/i1.md'),
    note('p/anhang.md', {}, '# Anhang\n'),
    note('p/unberuehrt/u.md'),
  ];

  it('ist die Liste, die die Seite ordnet: nur genannte Bereiche, in der genannten Reihenfolge, mit Titel, offen, Übersicht und Zusatzzeile', () => {
    const overview = [{ header: 'Rang', field: 'rang' }];
    const recipe = withRecipe({
      sections: [
        section({ kind: 'note', path: 'anhang.md', title: 'Zum Schluss' }),
        section({ kind: 'folder', path: 'themen', title: 'Die Themen', open: true, overview, summaryLine: overview }),
        section({ kind: 'folder', path: 'interviews' }),
      ],
    });
    const { set, findings } = buildSet(folderScope('p'), NOTES, recipe);
    expect(findings).toEqual([]);
    expect(outline(set.nodes)).toEqual(['p/anhang.md', '[Die Themen]', '  p/themen/themen.md', '  p/themen/a.md', '  p/themen/b.md', '  p/themen/c.md', '[interviews]', '  p/interviews/i1.md']);
    const note0 = set.nodes[0] as SetNote;
    expect(note0.title).toBe('Zum Schluss');
    const themen = set.nodes[1] as SetGroup;
    expect(themen).toMatchObject({ open: true, overview, summaryLine: overview, key: 'p/themen' });
    expect(set.nodes[2]).toMatchObject({ open: false });
    expect(notesOf(set.nodes).find((n) => n.path === 'p/themen/a.md')?.depth).toBe(1);
    expect(paths(set)).not.toContain('p/unberuehrt/u.md');
  });

  it('der Ordner des Bereichs ist relativ zum Ordner der Menge; ein fehlender Ordner oder eine fehlende Notiz ist ein Fehler recipe.invalid', () => {
    const recipe = withRecipe({ sections: [section({ kind: 'folder', path: 'gibtsnicht' }), section({ kind: 'note', path: 'fehlt.md' })] });
    const { findings } = buildSet(folderScope('p'), NOTES, recipe);
    expect(findings).toEqual([
      expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sections[0]' }),
      expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sections[1]' }),
    ]);
  });

  it('order mention: erwähnte Notizen des Bereichs in der Reihenfolge der Einstiegsnotiz, übrige danach nach Namen', () => {
    const recipe = withRecipe({ sections: [section({ kind: 'folder', path: 'themen', order: { kind: 'mention' } })] });
    const { set } = buildSet(folderScope('p'), NOTES, recipe);
    expect(notesOf(set.nodes).map((n) => n.path)).toEqual(['p/themen/themen.md', 'p/themen/c.md', 'p/themen/a.md', 'p/themen/b.md']);
  });

  it('order nach Feld: Zahlen aufsteigend vor den Notizen ohne Wert, die in der Namensordnung bleiben', () => {
    const notes = [note('p/p.md'), note('p/t/a.md', { rang: 2 }), note('p/t/b.md', { rang: 1 }), note('p/t/c.md'), note('p/t/d.md', { rang: 1 }), note('p/t/e.md', { rang: 'x' })];
    const recipe = withRecipe({ sections: [section({ kind: 'folder', path: 't', order: { kind: 'field', field: 'rang' } })] });
    expect(notesOf(buildSet(folderScope('p'), notes, recipe).set.nodes).map((n) => n.path)).toEqual(['p/t/b.md', 'p/t/d.md', 'p/t/a.md', 'p/t/e.md', 'p/t/c.md']);
  });

  it('eine Notiz, die ein früherer Bereich schon trägt, steht nur dort und ergibt eine Warnung', () => {
    const recipe = withRecipe({ sections: [section({ kind: 'folder', path: 'themen' }), section({ kind: 'note', path: 'themen/a.md' })] });
    const { set, findings } = buildSet(folderScope('p'), NOTES, recipe);
    expect(paths(set).filter((x) => x === 'p/themen/a.md')).toHaveLength(1);
    expect(findings).toEqual([expect.objectContaining({ severity: 'warning', code: CODES.recipeInvalid, recipePath: 'sections[1]' })]);
  });

  it('der Einstieg steht in keinem Bereich', () => {
    const recipe = withRecipe({ sections: [section({ kind: 'note', path: 'p.md' }), section({ kind: 'folder', path: '' })] });
    const { set } = buildSet(folderScope('p'), NOTES, recipe);
    expect(paths(set).filter((x) => x === 'p/p.md')).toHaveLength(1);
  });
});

describe('group_by', () => {
  const INTERVIEWS: NoteInput[] = [
    note('p/p.md'),
    note('p/iv/1.md', { lauf: 'Lauf 2', persona: 'Zoe' }),
    note('p/iv/2.md', { lauf: 'Lauf 10', persona: 'Alma' }),
    note('p/iv/3.md', { lauf: 'Lauf 2', persona: 'Alma' }),
    note('p/iv/4.md', { lauf: 'Lauf 2', persona: 'Zoe' }),
    note('p/iv/5.md', { persona: 'Alma' }),
    note('p/iv/6.md', { lauf: 'Lauf 2' }),
    note('p/iv/sub/7.md', { lauf: 'Lauf 10', persona: 'Alma' }),
  ];
  const recipe = withRecipe({ sections: [section({ kind: 'folder', path: 'iv', title: 'Interviews', groupBy: ['lauf', 'persona'] })] });

  it('bildet verschachtelte Gruppen in Namensordnung (Lauf 2 vor Lauf 10); der Bereich ist die äußerste Gruppe, die Notizen liegen in der innersten', () => {
    const { set } = buildSet(folderScope('p'), INTERVIEWS, recipe);
    expect(outline(set.nodes)).toEqual([
      '[Interviews]',
      '  [Lauf 2]', '    [Alma]', '      p/iv/3.md', '    [Zoe]', '      p/iv/1.md', '      p/iv/4.md', '    [—]', '      p/iv/6.md',
      '  [Lauf 10]', '    [Alma]', '      p/iv/2.md', '      p/iv/sub/7.md',
      '  [—]', '    [Alma]', '      p/iv/5.md',
    ]);
  });

  it('depth zählt die Gruppen darüber: Bereich plus zwei Feldgruppen sind 3', () => {
    const { set } = buildSet(folderScope('p'), INTERVIEWS, recipe);
    expect(notesOf(set.nodes).map((n) => n.depth)).toEqual(notesOf(set.nodes).map(() => 3));
  });

  it('eine Notiz ohne Gruppenwert kommt in die Gruppe „—“ am Ende und erzeugt info set.no-group-value je Notiz und Feld', () => {
    const { findings } = buildSet(folderScope('p'), INTERVIEWS, recipe);
    expect(findings.map((f) => `${f.severity} ${f.code} ${f.notePath}`)).toEqual([
      `info ${CODES.setNoGroupValue} p/iv/5.md`,
      `info ${CODES.setNoGroupValue} p/iv/6.md`,
    ]);
  });

  it('der Wert folder steht für den Ordner der Notiz', () => {
    const r = withRecipe({ sections: [section({ kind: 'folder', path: 'iv', groupBy: ['folder'] })] });
    const { set } = buildSet(folderScope('p'), INTERVIEWS.filter((n) => n.path !== 'p/iv/5.md'), r);
    expect(outline(set.nodes)).toEqual(['[iv]', '  [iv]', '    p/iv/1.md', '    p/iv/2.md', '    p/iv/3.md', '    p/iv/4.md', '    p/iv/6.md', '  [sub]', '    p/iv/sub/7.md']);
  });

  it('die Reihenfolge der Notizen in einer Feldgruppe folgt der Ordnung des Bereichs (mention)', () => {
    const entry = note('p/p.md', {}, 'Text.\n', ['p/iv/4.md', 'p/iv/1.md']);
    const r = withRecipe({ sections: [section({ kind: 'folder', path: 'iv', groupBy: ['persona'], order: { kind: 'mention' } })] });
    const { set } = buildSet(folderScope('p'), [entry, ...INTERVIEWS.slice(1)], r);
    expect(outline(set.nodes).slice(0, 9)).toEqual(['[iv]', '  [Alma]', '    p/iv/2.md', '    p/iv/3.md', '    p/iv/5.md', '    p/iv/sub/7.md', '  [Zoe]', '    p/iv/4.md', '    p/iv/1.md']);
  });

  it('Werte, die kein Text, keine Zahl und kein Wahrheitswert sind, zählen als fehlend', () => {
    const r = withRecipe({ sections: [section({ kind: 'folder', path: 'iv', groupBy: ['lauf'] })] });
    const notes = [note('p/p.md'), note('p/iv/a.md', { lauf: ['x', 'y'] }), note('p/iv/b.md', { lauf: 3 })];
    const { set, findings } = buildSet(folderScope('p'), notes, r);
    expect(outline(set.nodes)).toEqual(['[iv]', '  [3]', '    p/iv/b.md', '  [—]', '    p/iv/a.md']);
    expect(findings).toHaveLength(1);
  });
});

describe('sources', () => {
  const NOTES = [
    note('auswertungen/a/bericht.md', {}, '# Bericht\n'),
    note('auswertungen/a/lokal.md'),
    note('runs/zwei/r.md', {}, '# Zwei\n'),
    note('runs/eins/s.md'),
    note('runs/eins/t.md'),
    note('runs/andere/u.md'),
  ];
  const sources = [{ path: '../../runs/zwei', key: 'zwei', title: 'Lauf Zwei' }, { path: '../../runs/eins', key: 'eins' }];

  it('ohne sections hängen die Quellen in Listenreihenfolge hinter dem Ordner, jede Notiz mit sourceKey', () => {
    const { set, findings } = buildSet(folderScope('auswertungen/a', 'auswertungen/a/bericht.md'), NOTES, withRecipe({ sources }));
    expect(findings).toEqual([]);
    expect(outline(set.nodes)).toEqual(['auswertungen/a/lokal.md', '[Lauf Zwei]', '  runs/zwei/r.md', '[eins]', '  runs/eins/s.md', '  runs/eins/t.md']);
    expect(notesOf(set.nodes).map((n) => n.sourceKey)).toEqual([undefined, 'zwei', 'eins', 'eins']);
    expect(set.nodes[1]).toMatchObject({ key: 'zwei' });
    expect(notesOf(set.nodes)[1]?.depth).toBe(1);
  });

  it('die Reihenfolge der Liste ist die Reihenfolge der Quellen, nicht die Namensordnung', () => {
    const swapped = buildSet(folderScope('auswertungen/a', 'auswertungen/a/bericht.md'), NOTES, withRecipe({ sources: [...sources].reverse() })).set;
    expect(outline(swapped.nodes).filter((l) => l.startsWith('['))).toEqual(['[eins]', '[Lauf Zwei]']);
  });

  it('mit sections steht eine Quelle dort, wo ein Bereich source nennt; eine nicht genannte folgt am Ende', () => {
    const recipe = withRecipe({ sources, sections: [section({ kind: 'source', path: 'eins', title: 'Eins vorn' }), section({ kind: 'note', path: 'lokal.md' })] });
    const { set } = buildSet(folderScope('auswertungen/a', 'auswertungen/a/bericht.md'), NOTES, recipe);
    expect(outline(set.nodes)).toEqual(['[Eins vorn]', '  runs/eins/s.md', '  runs/eins/t.md', 'auswertungen/a/lokal.md', '[Lauf Zwei]', '  runs/zwei/r.md']);
  });

  it('ein Bereich source mit unbekanntem Schlüssel ist ein Fehler recipe.invalid', () => {
    const { findings } = buildSet(folderScope('auswertungen/a', 'auswertungen/a/bericht.md'), NOTES, withRecipe({ sources, sections: [section({ kind: 'source', path: 'drei' })] }));
    expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sections[0]' }));
  });

  it('eine Quelle, die der Ordner schon trägt, steht nur in der Quelle', () => {
    const notes = [note('p/p.md'), note('p/lauf/x.md'), note('p/y.md')];
    const { set } = buildSet(folderScope('p', 'p/p.md'), notes, withRecipe({ sources: [{ path: 'lauf', key: 'lauf' }] }));
    expect(outline(set.nodes)).toEqual(['p/y.md', '[lauf]', '  p/lauf/x.md']);
    expect(paths(set).filter((x) => x === 'p/lauf/x.md')).toHaveLength(1);
  });

  it('eine Quelle über die Vault-Wurzel hinaus ist ein Fehler recipe.invalid, die übrigen laufen', () => {
    const { set, findings } = buildSet(folderScope('auswertungen/a', 'auswertungen/a/bericht.md'), NOTES, withRecipe({ sources: [{ path: '../../../x', key: 'x' }, ...sources] }));
    expect(findings).toEqual([expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sources[0]' })]);
    expect(outline(set.nodes).filter((l) => l.startsWith('['))).toEqual(['[Lauf Zwei]', '[eins]']);
  });
});

describe('resolveSourcePaths', () => {
  it('../../runs/x aus auswertungen/a/bericht.md ist runs/x', () => {
    const { folders, findings } = resolveSourcePaths('auswertungen/a/bericht.md', [{ path: '../../runs/x', key: 'x', title: 'Lauf X' }, { path: 'unter/ordner/', key: 'u' }, { path: '../b', key: 'b' }]);
    expect(findings).toEqual([]);
    expect(folders).toEqual([
      { key: 'x', folder: 'runs/x', title: 'Lauf X' },
      { key: 'u', folder: 'auswertungen/a/unter/ordner' },
      { key: 'b', folder: 'auswertungen/b' },
    ]);
  });

  it('bis zur Vault-Wurzel ist erlaubt, darüber hinaus recipe.invalid (mit recipePath sources[i])', () => {
    expect(resolveSourcePaths('a/b.md', [{ path: '..', key: 'w' }]).findings).toEqual([expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sources[0]' })]);
    const r = resolveSourcePaths('a/b.md', [{ path: '../x', key: 'x' }, { path: '../../x', key: 'y' }]);
    expect(r.folders).toEqual([{ key: 'x', folder: 'x' }]);
    expect(r.findings).toEqual([expect.objectContaining({ code: CODES.recipeInvalid, recipePath: 'sources[1]' })]);
  });

  it('eine Notiz an der Wurzel löst relativ zur Wurzel auf; ein absoluter Pfad ist ungültig', () => {
    expect(resolveSourcePaths('n.md', [{ path: 'runs/x', key: 'x' }]).folders).toEqual([{ key: 'x', folder: 'runs/x' }]);
    expect(resolveSourcePaths('n.md', [{ path: '/runs/x', key: 'x' }]).findings).toHaveLength(1);
  });

  it('ein doppelter Schlüssel ist ein Fehler recipe.invalid, die erste Quelle gilt', () => {
    const r = resolveSourcePaths('n.md', [{ path: 'a', key: 'k' }, { path: 'b', key: 'k' }]);
    expect(r.folders).toEqual([{ key: 'k', folder: 'a' }]);
    expect(r.findings).toEqual([expect.objectContaining({ severity: 'error', code: CODES.recipeInvalid, recipePath: 'sources[1]' })]);
  });
});
