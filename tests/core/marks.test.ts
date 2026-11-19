// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { checkAnchors } from '../../src/vendor/kit/anchor-check';
import { structure } from '../../src/core/structure';
import { FOLDER, group, makeSet, note, noExtras, notesOf, recipe, resolver, tree } from './structure-helpers';

const none = resolver({});

describe('Marken der Notizen (assignNoteMarks)', () => {
  it('Notiz: Pfad unter dem Ordner, ohne .md, Schrägstrich zu Bindestrich, als Slug', () => {
    const entry = note(`${FOLDER}/Einstieg.md`, 'Einstieg');
    const a = note(`${FOLDER}/Themen/Größe 2.md`, 'A', 1);
    const set = makeSet(entry, [group(`${FOLDER}/Themen`, 'Themen', [a])]);
    const out = structure(set, new Map(), recipe(), none.resolve, noExtras, FOLDER);
    expect(out.anchors.get(entry.path)).toBe('einstieg');
    expect(out.anchors.get(a.path)).toBe('themen-groesse-2');
  });

  it('ohne Ordnerangabe zählt der Ordner der Einstiegsnotiz', () => {
    const entry = note('X/Y/Einstieg.md', 'Einstieg');
    const a = note('X/Y/sub/a.md', 'A', 1);
    const out = structure(makeSet(entry, [group('X/Y/sub', 'Sub', [a])]), new Map(), recipe(), none.resolve, noExtras);
    expect(out.anchors.get(a.path)).toBe('sub-a');
  });

  it('Notiz aus einer Quelle: Schlüssel der Quelle und Pfad in der Quelle', () => {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const s = note('Lager/Tief/q.md', 'Q', 1, { sourceKey: 'lager' });
    const rc = recipe({ sources: [{ path: '../Lager', key: 'lager' }] });
    const out = structure(makeSet(entry, [group('lager', 'Lager', [s])]), new Map(), rc, none.resolve, noExtras, FOLDER);
    expect(out.anchors.get(s.path)).toBe('lager-tief-q');
  });

  it('feste Orte der Seite sind vergeben: oben, inhalt, suche, werkzeug bekommen -2', () => {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const nodes = ['oben', 'inhalt', 'suche', 'werkzeug'].map((n) => note(`${FOLDER}/${n}.md`, n));
    const out = structure(makeSet(entry, nodes), new Map(), recipe(), none.resolve, noExtras, FOLDER);
    expect(nodes.map((n) => out.anchors.get(n.path))).toEqual(['oben-2', 'inhalt-2', 'suche-2', 'werkzeug-2']);
  });

  it('gleicher Slug: die erste Notiz behält ihn, die nächste bekommt -2', () => {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const a = note(`${FOLDER}/a b.md`, 'A1');
    const b = note(`${FOLDER}/a-b.md`, 'A2');
    const c = note(`${FOLDER}/a_b.md`, 'A3');
    const out = structure(makeSet(entry, [a, b, c]), new Map(), recipe(), none.resolve, noExtras, FOLDER);
    expect([a, b, c].map((n) => out.anchors.get(n.path))).toEqual(['a-b', 'a-b-2', 'a-b-3']);
  });

  it('leerer Slug wird abschnitt', () => {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const a = note(`${FOLDER}/!!!.md`, 'A');
    const out = structure(makeSet(entry, [a]), new Map(), recipe(), none.resolve, noExtras, FOLDER);
    expect(out.anchors.get(a.path)).toBe('abschnitt');
  });

  it('der Einstieg und jede Notiz der Menge haben eine Marke; der Einstieg ist die erste', () => {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const a = note(`${FOLDER}/a.md`, 'A');
    const set = makeSet(entry, [a]);
    const out = structure(set, new Map(), recipe(), none.resolve, noExtras, FOLDER);
    expect([...out.anchors.keys()]).toEqual(set.notesInOrder.map((n) => n.path));
  });

  it('gleiche Eingabe gibt gleiche Ausgabe (Marken und Text)', () => {
    const build = () => {
      const entry = note(`${FOLDER}/e.md`, 'E');
      const a = note(`${FOLDER}/a.md`, 'A', 1);
      const set = makeSet(entry, [group(`${FOLDER}/g`, 'G', [a])]);
      const roots = new Map([[entry.path, tree('<p>x</p>')], [a.path, tree('<p>y</p>')]]);
      return structure(set, roots, recipe(), none.resolve, noExtras, FOLDER);
    };
    const one = build();
    const two = build();
    expect(one.body.innerHTML).toBe(two.body.innerHTML);
    expect([...one.anchors]).toEqual([...two.anchors]);
  });
});

describe('Marken im Baum', () => {
  function page() {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const a = note(`${FOLDER}/kapitel/a.md`, 'A', 1);
    const b = note(`${FOLDER}/kapitel/b.md`, 'B', 1);
    const loose = note(`${FOLDER}/kapitel.md`, 'Lose');
    const set = makeSet(entry, [group(`${FOLDER}/kapitel`, 'Kapitel', [a, b]), loose]);
    const roots = new Map([
      [entry.path, tree('<p><a class="internal-link" href="a" data-href="a">zu A</a></p>')],
      [a.path, tree('<p>A</p>')],
      [b.path, tree('<p><a class="internal-link" href="e" data-href="e">zurück</a></p>')],
      [loose.path, tree('<p>lose</p>')],
    ]);
    const res = resolver({ a: a.path, e: entry.path });
    return { out: structure(set, roots, recipe(), res.resolve, noExtras, FOLDER), set, entry, a, b, loose };
  }

  it('Notiz-Bereich: details mit id und data-ht-note', () => {
    const { out, a } = page();
    const el = out.body.querySelector(`details[data-ht-note="${out.anchors.get(a.path)}"]`);
    expect(el?.id).toBe(out.anchors.get(a.path));
  });

  it('Gruppe: details mit id und data-ht-group; ihre Marke bleibt aus dem Weg der Notizen (Notiz kapitel und Ordner kapitel)', () => {
    const { out, loose } = page();
    expect(out.anchors.get(loose.path)).toBe('kapitel');
    const g = out.body.querySelector('details[data-ht-group]');
    expect(g?.id).toBe('kapitel-2');
    expect([...out.groupAnchors.values()]).toEqual(['kapitel-2']);
  });

  it('alle id sind eindeutig über den ganzen body, und jedes href="#…" hat ein Ziel (checkAnchors)', () => {
    const { out } = page();
    expect(checkAnchors(out.body)).toEqual([]);
    const ids = Array.from(out.body.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.body.querySelectorAll('a[href^="#"]')).toHaveLength(2);
    expect(out.findings).toEqual([]);
  });

});

describe('Marken im gezeichneten Baum (DOM-Läufer obsidian-kit anchor-walk)', () => {
  const fnRef = (n: number, hex: string): string =>
    `<sup class="footnote-ref" data-footnote-id="fnref-${n}-${hex}" id="fnref-${n}-${hex}"><a class="footnote-link" href="#fn-${n}-${hex}">[${n}]</a></sup>`;
  const fnList = (n: number, hex: string, text: string): string =>
    `<section class="footnotes"><ol><li data-footnote-id="fn-${n}-${hex}" id="fn-${n}-${hex}"><p>${text} <a class="footnote-backref" href="#fnref-${n}-${hex}">↩</a></p></li></ol></section>`;
  const HEX_A = 'aaaaaaaaaaaaaaaa';
  const HEX_B = 'bbbbbbbbbbbbbbbb';

  function page() {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const a = note(`${FOLDER}/a.md`, 'A');
    const b = note(`${FOLDER}/b.md`, 'B');
    const set = makeSet(entry, [a, b]);
    const embedB = `<span class="internal-embed markdown-embed is-loaded" src="b"><div class="markdown-embed-content"><div class="markdown-preview-view">`
      + `<h1 data-heading="B">B</h1><p>innen${fnRef(1, HEX_B)}</p>${fnList(1, HEX_B, 'Fußnote B')}</div></div></span>`;
    const roots = new Map([
      [entry.path, tree('<p><a class="internal-link" href="a#Abschnitt" data-href="a#Abschnitt">zu A</a></p>')],
      [a.path, tree(`<h2 data-heading="Abschnitt">Abschnitt</h2><p>Text${fnRef(1, HEX_A)}</p><h2 data-heading="Abschnitt">Abschnitt</h2>`
        + `<p><a class="internal-link" href="#Abschnitt" data-href="#Abschnitt">hoch</a></p>${embedB}${fnList(1, HEX_A, 'Fußnote A')}`)],
      [b.path, tree('<p>B</p>')],
    ]);
    const res = resolver({ a: a.path, b: b.path });
    return { out: structure(set, roots, recipe(), res.resolve, noExtras, FOLDER), entry, a, b };
  }

  it('eingebettete Notiz mit Fußnote und doppelter Überschrift: alle id eindeutig, jedes href="#…" hat ein Ziel, kein Hex bleibt', () => {
    const { out } = page();
    const ids = Array.from(out.body.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(checkAnchors(out.body)).toEqual([]);
    expect(out.body.outerHTML).not.toMatch(/[0-9a-f]{16}/);
    expect(out.findings).toEqual([]);
  });

  it('Fußnote der Notiz und der Einbettung springen zur eigenen Stelle; Links auf eine Überschrift treffen deren Marke', () => {
    const { out, a } = page();
    const section = out.body.querySelector(`[data-ht-note="${out.anchors.get(a.path)}"]`);
    const embed = section?.querySelector('.internal-embed');
    expect(embed).not.toBeNull();
    const [outerRef, innerRef] = Array.from(section?.querySelectorAll('a.footnote-link') ?? []);
    const target = (link: Element | undefined): Element | null => out.body.querySelector(`[id="${(link?.getAttribute('href') ?? '#').slice(1)}"]`);
    expect(target(outerRef)?.textContent).toContain('Fußnote A');
    expect(target(innerRef)?.textContent).toContain('Fußnote B');
    expect(embed?.contains(target(innerRef))).toBe(true);
    expect(embed?.contains(target(outerRef))).toBe(false);
    for (const back of Array.from(section?.querySelectorAll('a.footnote-backref') ?? [])) expect(target(back)?.classList.contains('footnote-ref')).toBe(true);
    const firstHeading = section?.querySelector('[data-heading="Abschnitt"]');
    expect(section?.querySelector('a[href^="#"]:not(.footnote-link):not(.footnote-backref)')?.getAttribute('href')).toBe(`#${firstHeading?.id}`);
    const fromEntry = out.body.querySelector(`section[data-ht-note] a[href^="#"]`);
    expect(fromEntry?.getAttribute('href')).toBe(`#${firstHeading?.id}`);
  });

  it('Überschriften je Notiz lückenlos: Einstieg ab h2, Notiz ab 3 + depth, die Einbettung eine Ebene unter ihrer Überschrift', () => {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const loose = note(`${FOLDER}/lose.md`, 'Lose');
    const a = note(`${FOLDER}/kapitel/a.md`, 'A', 1);
    const set = makeSet(entry, [loose, group(`${FOLDER}/kapitel`, 'Kapitel', [a])]);
    const roots = new Map([
      [entry.path, tree('<h3 data-heading="X">X</h3><p>x</p><h5 data-heading="Y">Y</h5><p>y</p>')],
      [loose.path, tree('<h2 data-heading="N">N</h2><h4 data-heading="M">M</h4>')],
      [a.path, tree('<h3 data-heading="P">P</h3><span class="internal-embed markdown-embed is-loaded" src="lose"><div class="markdown-embed-content"><div class="markdown-preview-view"><h1 data-heading="Q">Q</h1></div></div></span>')],
    ]);
    const out = structure(set, roots, recipe({ fold: { headingsFrom: null, linkedSummary: false } }), resolver({ lose: loose.path }).resolve, noExtras, FOLDER);
    const levels = (path: string): string[] => {
      const el = out.body.querySelector(`[data-ht-note="${out.anchors.get(path)}"]`);
      return Array.from(el?.querySelectorAll('[data-heading]') ?? []).map((h) => `${h.tagName}:${h.getAttribute('data-heading') ?? ''}`);
    };
    expect(levels(entry.path)).toEqual(['H2:X', 'H3:Y']);
    expect(levels(loose.path)).toEqual(['H3:N', 'H4:M']);
    expect(levels(a.path)).toEqual(['H4:P', 'H5:Q']);
    expect(out.findings.filter((f) => f.code === 'heading.capped')).toEqual([]);
  });

  it('über h6 bleibt h6 und info heading.capped an der Notiz', () => {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const a = note(`${FOLDER}/kapitel/a.md`, 'A', 1);
    const set = makeSet(entry, [group(`${FOLDER}/kapitel`, 'Kapitel', [a])]);
    const roots = new Map([
      [entry.path, tree('<p>e</p>')],
      [a.path, tree('<h2 data-heading="P">P</h2><h3 data-heading="Q">Q</h3><h4 data-heading="R">R</h4><h5 data-heading="S">S</h5>')],
    ]);
    const out = structure(set, roots, recipe(), resolver({}).resolve, noExtras, FOLDER);
    const el = out.body.querySelector(`[data-ht-note="${out.anchors.get(a.path)}"]`);
    expect(Array.from(el?.querySelectorAll('[data-heading]') ?? []).map((h) => h.tagName)).toEqual(['H4', 'H5', 'H6', 'H6']);
    const capped = out.findings.filter((f) => f.code === 'heading.capped');
    expect(capped).toHaveLength(1);
    expect(capped[0]).toMatchObject({ severity: 'info', notePath: a.path });
  });
});

describe('Notizen ohne Baum', () => {
  it('fehlt der Baum einer Notiz, steht der Bereich leer da, und die Seite läuft weiter', () => {
    const entry = note(`${FOLDER}/e.md`, 'E');
    const a = note(`${FOLDER}/a.md`, 'A');
    const out = structure(makeSet(entry, [a]), new Map(), recipe(), none.resolve, noExtras, FOLDER);
    expect(notesOf([a])).toHaveLength(1);
    expect(out.body.querySelector('details[data-ht-note]')?.children).toHaveLength(1);
  });
});
