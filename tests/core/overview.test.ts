// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildOverview, summaryLine } from '../../src/core/overview';
import type { Column, SetNote } from '../../src/core/types';
import { textOf } from './text-of';

function note(path: string, title: string, frontmatter: Record<string, unknown> = {}): SetNote {
  return { path, title, frontmatter, body: '', depth: 1 };
}

const anchors = new Map<string, string>([
  ['a.md', 'a'],
  ['b.md', 'b'],
]);

const field = (f: string, header = f): Column => ({ header, field: f });

describe('buildOverview', () => {
  it('Behälter div.ht-table mit tabindex 0, Kopf mit scope=col, erste Spalte Titel als Sprung', () => {
    const notes = [note('a.md', 'Alpha', { frage: 'F1' }), note('b.md', 'Beta', { frage: 'F2' })];
    const { table, findings } = buildOverview(notes, [field('frage', 'Frage')], anchors, document);
    expect(findings).toEqual([]);
    expect(table.tagName).toBe('DIV');
    expect(table.classList.contains('ht-table')).toBe(true);
    expect(table.getAttribute('tabindex')).toBe('0');
    const heads = Array.from(table.querySelectorAll('thead th'));
    expect(heads.map((h) => h.getAttribute('scope'))).toEqual(['col', 'col']);
    expect(heads.map((h) => h.textContent)).toEqual(['Title', 'Frage']);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    const link = rows[0]!.querySelector('td a');
    expect(link?.getAttribute('href')).toBe('#a');
    expect(link?.textContent).toBe('Alpha');
    expect(rows[1]!.querySelectorAll('td')[1]!.textContent).toBe('F2');
  });

  it('Überschrift der Titelspalte folgt der Sprache der Seite', () => {
    const { table } = buildOverview([note('a.md', 'Alpha')], [], anchors, document, 'de');
    expect(table.querySelector('thead th')?.textContent).toBe('Titel');
  });

  it('fehlt die Marke, steht der Titel als Text ohne Sprung', () => {
    const { table } = buildOverview([note('x.md', 'Ohne Marke')], [], anchors, document);
    const cell = table.querySelector('tbody td')!;
    expect(cell.querySelector('a')).toBeNull();
    expect(cell.textContent).toBe('Ohne Marke');
  });

  it('jede Zeile trägt data-ht-<slug> mit dem Wert als Text (A1)', () => {
    const notes = [note('a.md', 'Alpha', { 'Befund Zahl': 3, tags: ['x', 'y'], datum: new Date('2024-01-15T00:00:00.000Z') })];
    const { table } = buildOverview(notes, [field('Befund Zahl'), field('tags'), field('datum')], anchors, document);
    const row = table.querySelector('tbody tr')!;
    expect(row.getAttribute('data-ht-befund-zahl')).toBe('3');
    expect(row.getAttribute('data-ht-tags')).toBe('x, y');
    expect(row.getAttribute('data-ht-datum')).toBe('2024-01-15T00:00:00.000Z');
    const cells = Array.from(row.querySelectorAll('td')).map((c) => c.textContent);
    expect(cells).toEqual(['Alpha', '3', 'x, y', '2024-01-15T00:00:00.000Z']);
  });

  it('Punkt-Pfad in Feldspalte und Textvorlage', () => {
    const fm = { modelle: { 'verdigado-pro': { personas_genannt: 4, personas_gesamt: 9 } } };
    const columns: Column[] = [
      field('modelle.verdigado-pro.personas_genannt', 'Genannt'),
      { header: 'Personas', template: '{modelle.verdigado-pro.personas_genannt} von {modelle.verdigado-pro.personas_gesamt} Personas' },
    ];
    const { table, findings } = buildOverview([note('a.md', 'Alpha', fm)], columns, anchors, document);
    expect(findings).toEqual([]);
    const cells = Array.from(table.querySelectorAll('tbody td')).map((c) => c.textContent);
    expect(cells).toEqual(['Alpha', '4', '4 von 9 Personas']);
    const row = table.querySelector('tbody tr')!;
    expect(row.getAttribute('data-ht-modelle-verdigado-pro-personas-genannt')).toBe('4');
  });

  it('Spalten mit Vorlage setzen kein data-Attribut', () => {
    const { table } = buildOverview([note('a.md', 'Alpha', { x: 1 })], [{ header: 'H', template: '{x} Stück' }], anchors, document);
    const row = table.querySelector('tbody tr')!;
    expect(row.getAttributeNames().filter((n) => n.startsWith('data-ht-'))).toEqual([]);
  });

  it('fehlendes Feld: Zelle leer, genau ein field.missing je Feld mit Zahl der Notizen', () => {
    const notes = [note('a.md', 'Alpha', { frage: 'F' }), note('b.md', 'Beta', {}), note('c.md', 'Gamma', { frage: '' })];
    const columns: Column[] = [field('frage', 'Frage'), { header: 'T', template: '{frage} / {fehlt}' }];
    const { table, findings } = buildOverview(notes, columns, anchors, document);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows[1]!.querySelectorAll('td')[1]!.textContent).toBe('');
    // eine Vorlage, der ein Feld fehlt, bleibt ganz leer (kein "F / ")
    expect(rows[0]!.querySelectorAll('td')[2]!.textContent).toBe('');
    expect(rows[1]!.getAttribute('data-ht-frage')).toBe('');
    expect(findings.map((f) => [f.code, f.severity])).toEqual([
      ['field.missing', 'warning'],
      ['field.missing', 'warning'],
    ]);
    expect(findings[0]!.args).toEqual(['frage', 2, 3]);
    expect(textOf(findings[0])).toContain('2 of 3');
    expect(findings[1]!.args?.slice(1)).toEqual([3, 3]);
    expect(textOf(findings[1])).toContain('missing');
    expect(textOf(findings[1])).toContain('3 of 3');
  });

  it('Feldwert <b>x</b> erscheint maskiert, auch im Attribut', () => {
    const { table } = buildOverview([note('a.md', 'Alpha', { f: '<b>x</b> "q" & r' })], [field('f')], anchors, document);
    expect(table.querySelector('tbody b')).toBeNull();
    expect(table.querySelectorAll('tbody td')[1]!.textContent).toBe('<b>x</b> "q" & r');
    expect(table.innerHTML).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(table.querySelector('tbody tr')!.getAttribute('data-ht-f')).toBe('<b>x</b> "q" & r');
    // aus dem serialisierten Text wieder gelesen: kein <b>-Element, der Attributwert kommt unverändert zurück
    const again = new DOMParser().parseFromString(table.outerHTML, 'text/html');
    expect(again.querySelector('b')).toBeNull();
    expect(again.querySelector('tbody tr')!.getAttribute('data-ht-f')).toBe('<b>x</b> "q" & r');
  });

  it('Titel wird maskiert', () => {
    const { table } = buildOverview([note('a.md', '<i>Alpha</i>')], [], anchors, document);
    expect(table.querySelector('tbody i')).toBeNull();
    expect(table.querySelector('tbody a')!.textContent).toBe('<i>Alpha</i>');
  });

  it('zwei Felder auf denselben Attributnamen: nur das erste, warning field.attr-collision', () => {
    // `a.b` ist ein Pfad (a, darin b), `a/b` ein flacher Schlüssel: zwei Felder, beide ergeben den Slug `a-b`
    const notes = [note('a.md', 'Alpha', { a: { b: 1 }, 'a/b': 2 })];
    const { table, findings } = buildOverview(notes, [field('a.b'), field('a/b')], anchors, document);
    const row = table.querySelector('tbody tr')!;
    expect(row.getAttribute('data-ht-a-b')).toBe('1');
    expect(findings.filter((f) => f.code === 'field.attr-collision')).toHaveLength(1);
    expect(findings.find((f) => f.code === 'field.attr-collision')!.severity).toBe('warning');
    // die Zelle der zweiten Spalte bleibt trotzdem in der Tabelle
    expect(Array.from(row.querySelectorAll('td')).map((c) => c.textContent)).toEqual(['Alpha', '1', '2']);
  });

  it('Reihenfolge der Zeilen ist die der Eingabe, Reihenfolge der Befunde fest (Kollision, dann fehlende Felder in Spaltenfolge)', () => {
    const notes = [note('a.md', 'Alpha', {})];
    const columns = [field('b.x'), field('b/x'), field('c')];
    const first = buildOverview(notes, columns, anchors, document).findings.map((f) => f.code);
    const second = buildOverview(notes, columns, anchors, document).findings.map((f) => f.code);
    expect(first).toEqual(['field.attr-collision', 'field.missing', 'field.missing', 'field.missing']);
    expect(second).toEqual(first);
  });

  it('ohne Notizen entsteht keine Warnung und eine Tabelle ohne Zeilen', () => {
    const { table, findings } = buildOverview([], [field('x')], anchors, document);
    expect(findings).toEqual([]);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(table.querySelectorAll('thead th')).toHaveLength(2);
  });

  it('gleiche Eingabe ergibt gleiches Markup', () => {
    const notes = [note('a.md', 'Alpha', { f: 1 })];
    const a = buildOverview(notes, [field('f')], anchors, document).table.outerHTML;
    const b = buildOverview(notes, [field('f')], anchors, document).table.outerHTML;
    expect(a).toBe(b);
  });
});

describe('summaryLine', () => {
  it('Teile mit " · " verbunden, Vorlage mit Punkt-Pfad', () => {
    const fm = { modelle: { m: { a: 4, b: 9 } }, frage: 'Was?', tags: ['x', 'y'] };
    const columns: Column[] = [
      { header: 'Personas', template: '{modelle.m.a} von {modelle.m.b} Personas' },
      field('frage'),
      field('tags'),
    ];
    expect(summaryLine(note('a.md', 'A', fm), columns)).toEqual({ text: '4 von 9 Personas · Was? · x, y', missing: [] });
  });

  it('fehlende Teile fallen weg und stehen in missing (einmal je Feld, in Reihenfolge der ersten Nennung)', () => {
    const columns: Column[] = [field('a'), { header: 'T', template: '{b} und {a}' }, field('c')];
    const r = summaryLine(note('a.md', 'A', { c: 'C' }), columns);
    expect(r.text).toBe('C');
    expect(r.missing).toEqual(['a', 'b']);
  });

  it('eine Spalte, deren Zelle leer ist, erzeugt keinen leeren Teil', () => {
    const r = summaryLine(note('a.md', 'A', { c: 'C' }), [field('a'), field('c')]);
    expect(r.text).toBe('C');
    expect(r.missing).toEqual(['a']);
  });

  it('keine Spalten ergibt leeren Text', () => {
    expect(summaryLine(note('a.md', 'A', { a: 1 }), [])).toEqual({ text: '', missing: [] });
  });

  it('Text bleibt Text: nichts wird maskiert oder als Markup gelesen', () => {
    expect(summaryLine(note('a.md', 'A', { f: '<b>x</b>' }), [field('f')]).text).toBe('<b>x</b>');
  });

  it('Zahl 0 und false sind Werte, keine fehlenden', () => {
    const r = summaryLine(note('a.md', 'A', { n: 0, b: false }), [field('n'), field('b')]);
    expect(r).toEqual({ text: '0 · false', missing: [] });
  });
});
