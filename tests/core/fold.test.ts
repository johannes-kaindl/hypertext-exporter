// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { structure } from '../../src/core/structure';
import { CODES } from '../../src/core/finding-codes';
import type { SetGroup, SetNote } from '../../src/core/types';
import { FOLDER, group, makeSet, note, noExtras, recipe, resolver, tree } from './structure-helpers';

const none = resolver({});

describe('Callouts', () => {
  function callouts() {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const html =
      '<div class="callout" data-callout="note" data-callout-fold="-"><div class="callout-title"><div class="callout-icon"></div><div class="callout-title-inner">Zu</div><div class="callout-fold"></div></div><div class="callout-content" style="display: none;"><p>versteckt</p></div></div>' +
      '<div class="callout" data-callout="tip" data-callout-fold="+"><div class="callout-title"><div class="callout-title-inner">Offen</div></div><div class="callout-content"><p>sichtbar</p></div></div>' +
      '<div class="callout" data-callout="info"><div class="callout-title"><div class="callout-title-inner">Kasten</div></div><div class="callout-content"><p>fest</p></div></div>' +
      '<details><summary>roh</summary><p>bleibt</p></details>';
    return structure(makeSet(entry, []), new Map([[entry.path, tree(html)]]), recipe(), none.resolve, noExtras, FOLDER).body;
  }

  it('[!note]- wird details ohne open, der Titel summary, display:none fällt', () => {
    const d = callouts().querySelector('details[data-callout="note"]')!;
    expect(d.hasAttribute('open')).toBe(false);
    expect(d.querySelector('summary')?.textContent).toBe('Zu');
    expect(d.querySelector('.callout-content')?.hasAttribute('style')).toBe(false);
  });

  it('[!tip]+ wird details mit open', () => {
    expect(callouts().querySelector('details[data-callout="tip"]')?.hasAttribute('open')).toBe(true);
  });

  it('[!info] bleibt ein fester Kasten, rohes details bleibt', () => {
    const body = callouts();
    expect(body.querySelector('div.callout[data-callout="info"]')).not.toBeNull();
    expect(body.querySelector('details:not([data-callout]) summary')?.textContent).toBe('roh');
  });

  it('Callouts in Notiz-Bereichen werden ebenso umgebaut', () => {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const a = note(`${FOLDER}/a.md`, 'A');
    const html = '<div class="callout" data-callout="note" data-callout-fold="-"><div class="callout-title"><div class="callout-title-inner">Zu</div></div><div class="callout-content"><p>x</p></div></div>';
    const body = structure(makeSet(entry, [a]), new Map([[a.path, tree(html)]]), recipe(), none.resolve, noExtras, FOLDER).body;
    expect(body.querySelector('details[data-ht-note] details[data-callout="note"]')).not.toBeNull();
  });
});

describe('Aufbau: Einstieg, Gruppen, Notizen', () => {
  const entry = note(`${FOLDER}/e.md`, 'Einstieg');
  const a = note(`${FOLDER}/g/a.md`, 'Alpha', 1);
  const b = note(`${FOLDER}/g/b.md`, 'Beta', 1);
  const lose = note(`${FOLDER}/lose.md`, 'Lose', 0);
  const set = makeSet(entry, [group(`${FOLDER}/g`, 'Gruppe', [a, b]), lose]);
  const roots = () => new Map([
    [entry.path, tree('<p>Willkommen</p>')],
    [a.path, tree('<p>a</p>')],
    [b.path, tree('<p>b</p>')],
    [lose.path, tree('<p>lose</p>')],
  ]);

  it('der Einstieg steht zuerst, offen (kein details), mit dem Titel der Seite als h1', () => {
    const body = structure(set, roots(), recipe(), none.resolve, noExtras, FOLDER).body;
    const first = body.firstElementChild!;
    expect(first.tagName).toBe('SECTION');
    expect(first.id).toBe('e');
    expect(first.querySelector(':scope > h1')?.textContent).toBe('Seitentitel');
    expect(first.textContent).toContain('Willkommen');
    expect(Array.from(body.children).map((c) => c.tagName)).toEqual(['SECTION', 'DETAILS', 'DETAILS']);
  });

  it('Gruppe: details, zu; mit open offen; Titel als Überschrift h2 in der summary', () => {
    const closed = structure(set, roots(), recipe(), none.resolve, noExtras, FOLDER).body.querySelector('details[data-ht-group]')!;
    expect(closed.hasAttribute('open')).toBe(false);
    expect(closed.querySelector(':scope > summary > h2')?.textContent).toBe('Gruppe');
    const open = makeSet(entry, [group(`${FOLDER}/g`, 'Gruppe', [a, b], { open: true }), lose]);
    expect(structure(open, roots(), recipe(), none.resolve, noExtras, FOLDER).body.querySelector('details[data-ht-group]')?.hasAttribute('open')).toBe(true);
  });

  it('Notiz-Bereich: details, zu, Titel als Überschrift der Ebene 2 + depth in der summary', () => {
    const body = structure(set, roots(), recipe(), none.resolve, noExtras, FOLDER).body;
    const alpha = body.querySelector('details[data-ht-note="g-a"]')!;
    expect(alpha.hasAttribute('open')).toBe(false);
    expect(alpha.querySelector(':scope > summary > h3')?.textContent).toBe('Alpha');
    expect(body.querySelector(':scope > details[data-ht-note="lose"] > summary > h2')?.textContent).toBe('Lose');
  });

  it('Reihenfolge der Gruppe: Übersicht zuerst, dann die Notizen in der Reihenfolge der Menge', () => {
    const extras = { summaryOf: () => null, overviewFor: (g: SetGroup) => { const d = document.createElement('div'); d.className = 'ht-table'; d.textContent = g.title; return d; } };
    const g = structure(set, roots(), recipe(), none.resolve, extras, FOLDER).body.querySelector('details[data-ht-group]')!;
    expect(Array.from(g.children).map((c) => c.tagName + (c.className ? `.${c.className}` : ''))).toEqual(['SUMMARY', 'DIV.ht-table', 'DETAILS', 'DETAILS']);
    expect(Array.from(g.querySelectorAll(':scope > details')).map((d) => d.getAttribute('data-ht-note'))).toEqual(['g-a', 'g-b']);
  });

  it('Gruppe mit overview enthält div.ht-table (Übersicht aus overviewFor)', () => {
    const extras = { summaryOf: () => null, overviewFor: (g: SetGroup) => (g.title === 'Gruppe' ? Object.assign(document.createElement('div'), { className: 'ht-table' }) : null) };
    const body = structure(set, roots(), recipe(), none.resolve, extras, FOLDER).body;
    expect(body.querySelectorAll('details[data-ht-group] div.ht-table')).toHaveLength(1);
  });

  it('Zusatzzeile steht als p.ht-summary-line unter dem Titel in der summary; ohne Zeile kein p', () => {
    const extras = { summaryOf: (n: SetNote) => (n.title === 'Alpha' ? 'fertig · 3' : null), overviewFor: () => null };
    const body = structure(set, roots(), recipe(), none.resolve, extras, FOLDER).body;
    const sum = body.querySelector('details[data-ht-note="g-a"] > summary')!;
    expect(Array.from(sum.children).map((c) => c.tagName)).toEqual(['H3', 'P']);
    expect(sum.querySelector('p.ht-summary-line')?.textContent).toBe('fertig · 3');
    expect(body.querySelector('details[data-ht-note="g-b"] > summary p')).toBeNull();
  });

  it('der Inhalt einer Notiz folgt auf die summary; der Baum der Notiz ist danach leer (verschoben, nicht kopiert)', () => {
    const r = roots();
    const body = structure(set, r, recipe(), none.resolve, noExtras, FOLDER).body;
    expect(body.querySelector('details[data-ht-note="g-a"] > p')?.textContent).toBe('a');
    expect(r.get(a.path)!.childNodes).toHaveLength(0);
  });

  it('eine Notiz tiefer als h6 bleibt bei h6 und meldet info heading.capped', () => {
    const deep = note(`${FOLDER}/t.md`, 'Tief', 6);
    const out = structure(makeSet(entry, [deep]), new Map([[deep.path, tree('<p>x</p>')]]), recipe(), none.resolve, noExtras, FOLDER);
    expect(out.body.querySelector('details[data-ht-note] > summary > h6')?.textContent).toBe('Tief');
    expect(out.findings).toEqual([expect.objectContaining({ severity: 'info', code: CODES.headingCapped, notePath: deep.path })]);
  });
});

describe('Titel nicht doppelt', () => {
  const entry = note(`${FOLDER}/e.md`, 'Einstieg');
  const a = note(`${FOLDER}/a.md`, 'Alpha');

  it('steht der Titel der Notiz als erste Überschrift h1 im Körper, fällt sie weg', () => {
    const body = structure(makeSet(entry, [a]), new Map([[a.path, tree('<h1>Alpha</h1><p>Text</p>')]]), recipe(), none.resolve, noExtras, FOLDER).body;
    const det = body.querySelector('details[data-ht-note]')!;
    expect(det.querySelectorAll('h1,h2,h3')).toHaveLength(1);
    expect(det.querySelector('h2')?.textContent).toBe('Alpha');
  });

  it('eine andere h1 oder eine h1, die nicht die erste Überschrift ist, bleibt stehen', () => {
    const other = structure(makeSet(entry, [a]), new Map([[a.path, tree('<h1>Anderes</h1>')]]), recipe(), none.resolve, noExtras, FOLDER).body;
    expect(other.querySelector('details[data-ht-note] > :is(h1,h2,h3,h4,h5,h6)')?.textContent).toBe('Anderes');   // bleibt, nur die Ebene verschiebt der DOM-Läufer
    const later = structure(makeSet(entry, [a]), new Map([[a.path, tree('<h2>Zuerst</h2><h1>Alpha</h1>')]]), recipe(), none.resolve, noExtras, FOLDER).body;
    expect(Array.from(later.querySelectorAll('details[data-ht-note] > :is(h1,h2,h3,h4,h5,h6)')).map((h) => h.textContent)).toEqual(['Zuerst', 'Alpha']);
  });

  it('eine Überschrift in einer Einbettung ist nicht die erste Überschrift der Notiz', () => {
    const html = '<span class="internal-embed" src="x"><h1>Alpha</h1></span><h1>Alpha</h1><p>t</p>';
    const body = structure(makeSet(entry, [a]), new Map([[a.path, tree(html)]]), recipe(), none.resolve, noExtras, FOLDER).body;
    const det = body.querySelector('details[data-ht-note]')!;
    expect(det.querySelectorAll('.internal-embed :is(h1,h2,h3,h4,h5,h6)')).toHaveLength(1);
    expect(det.querySelectorAll(':scope > :is(h1,h2,h3,h4,h5,h6)')).toHaveLength(0);
  });

  it('Einstieg: die h1 der Seite ist genau eine; die Titelüberschrift der Einstiegsnotiz kommt nicht dazu', () => {
    const body = structure(makeSet(entry, []), new Map([[entry.path, tree('<h1>Einstieg</h1><p>Text</p>')]]), recipe(), none.resolve, noExtras, FOLDER).body;
    expect(Array.from(body.querySelectorAll('h1')).map((h) => h.textContent)).toEqual(['Seitentitel']);
  });

  it('der Titel bei gleichem Wortlaut, nur anders geschrieben (Leerraum), zählt als derselbe', () => {
    const body = structure(makeSet(entry, [a]), new Map([[a.path, tree('<h1>  Alpha \n</h1>')]]), recipe(), none.resolve, noExtras, FOLDER).body;
    expect(body.querySelectorAll('details[data-ht-note] h1')).toHaveLength(0);
  });
});

describe('Überschriftsabschnitte der Einstiegsnotiz (fold.headings_from)', () => {
  const entry = note(`${FOLDER}/e.md`, 'Einstieg');
  const html = '<p>Vorspann</p><h2>Eins</h2><p>a</p><h3>Eins eins</h3><p>b</p><h2>Zwei</h2><p>c</p>';
  const run = (from: number | null) =>
    structure(makeSet(entry, []), new Map([[entry.path, tree(html)]]), recipe({ fold: { headingsFrom: from, linkedSummary: false } }), none.resolve, noExtras, FOLDER).body;

  it('ohne Angabe bleibt die Einstiegsnotiz ungefaltet', () => {
    expect(run(null).querySelectorAll('details')).toHaveLength(0);
  });

  it('ab Ebene 2: jeder Abschnitt ein details (zu), der tiefere darin; Vorspann bleibt außen', () => {
    const body = run(2);
    const sections = Array.from(body.querySelectorAll('section > details[data-export-fold="section"]'));
    expect(sections.map((s) => s.querySelector(':scope > summary > h2')?.textContent)).toEqual(['Eins', 'Zwei']);
    expect(sections[0]!.querySelector(':scope > details > summary > h3')?.textContent).toBe('Eins eins');
    expect(sections[0]!.hasAttribute('open')).toBe(false);
    expect(body.querySelector('section > p')?.textContent).toBe('Vorspann');
  });

  it('ab Ebene 3: nur die tiefen Überschriften falten, h2 bleiben echte Überschriften außerhalb', () => {
    const body = run(3);
    expect(body.querySelectorAll('section > h2')).toHaveLength(2);
    expect(body.querySelectorAll('details[data-export-fold="section"]')).toHaveLength(1);
  });
});

describe('Zusatzzeile aus dem ersten Link (fold.linked_summary)', () => {
  const entry = note(`${FOLDER}/e.md`, 'Einstieg');
  const t1 = note(`${FOLDER}/t/eins.md`, 'Thema Eins', 1);
  const t2 = note(`${FOLDER}/t/zwei.md`, 'Thema Zwei', 1);
  const set = makeSet(entry, [group(`${FOLDER}/t`, 'Themen', [t1, t2])]);
  const res = resolver({ eins: t1.path, zwei: t2.path });
  const a = (h: string, text: string) => `<a class="internal-link" data-href="${h}" href="${h}">${text}</a>`;
  const html = `<h2>Erstes</h2><p>siehe ${a('eins', 'Eins')} und ${a('zwei', 'Zwei')}</p><h2>Zweites</h2><p>kein Link</p><h2>Drittes</h2><p>${a('zwei#Teil', 'Zwei Teil')}</p>`;
  const extras = { summaryOf: (n: SetNote) => `Zeile ${n.title}`, overviewFor: () => null };
  const run = (linked: boolean, from: number | null = 2) =>
    structure(set, new Map([[entry.path, tree(html)], [t1.path, tree('<p>1</p>')], [t2.path, tree('<p>2</p>')]]), recipe({ fold: { headingsFrom: from, linkedSummary: linked } }), res.resolve, extras, FOLDER).body;

  it('jeder gefaltete Abschnitt trägt die Zusatzzeile der Notiz, auf die sein erster Link zeigt', () => {
    const lines = Array.from(run(true).querySelectorAll('section > details[data-export-fold="section"]')).map((s) => s.querySelector(':scope > summary > p.ht-summary-line')?.textContent ?? null);
    expect(lines).toEqual(['Zeile Thema Eins', null, 'Zeile Thema Zwei']);
  });

  it('ohne linked_summary keine Zeile; ohne Faltung keine Abschnitte, also auch keine Zeile', () => {
    expect(run(false).querySelectorAll('section summary > p.ht-summary-line')).toHaveLength(0);
    expect(run(true, null).querySelectorAll('section > details')).toHaveLength(0);
  });

  it('die Überschrift bleibt in der summary vor der Zeile', () => {
    const sum = run(true).querySelector('section > details[data-export-fold="section"] > summary')!;
    expect(Array.from(sum.children).map((c) => c.tagName)).toEqual(['H2', 'P']);
  });
});
