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

  // Das Setzen der id an Überschriften und Fußnoten im gezeichneten Baum liefert der DOM-Läufer aus obsidian-kit 0.106.0 (Bestellung 6, Teil obsidian-kit).
  it.todo('eingebettete Notiz mit Fußnote und doppelter Überschrift: alle id eindeutig — wartet auf DOM-Läufer obsidian-kit 0.106.0');
  it.todo('Fußnote der Notiz und der Einbettung springen zur richtigen Stelle (fn-<n>, fnref-<n>) — wartet auf DOM-Läufer obsidian-kit 0.106.0');
  it.todo('Überschriften je Notiz lückenlos: Einstieg h1, Gruppe h2, Notiz 2 + depth, deren h2 eine Ebene tiefer — wartet auf DOM-Läufer obsidian-kit 0.106.0');
  it.todo('über h6 bleibt h6 und info heading.capped aus den Überschriften im Text — wartet auf DOM-Läufer obsidian-kit 0.106.0');
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
