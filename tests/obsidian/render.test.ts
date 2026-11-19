// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import type { App } from 'obsidian';
import { beforeAll, describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { DEFAULT_RECIPE } from '../../src/core/recipe';
import type { RunControl, SetNote } from '../../src/core/types';
import { RENDER_HOST_CSS, assertWindowVisible, renderNote, type RenderDeps } from '../../src/obsidian/render';
import { RENDER_NOTE_CSS, type RenderNoteFinding, type RenderedNote, type RenderNoteOptions } from '../../src/vendor/kit-obsidian/render-note';
import { installObsidianDom } from './dom-polyfill';

beforeAll(installObsidianDom);

const note: SetNote = { path: 'a/bericht.md', title: 'Bericht', frontmatter: {}, body: '# Hallo\n\nText', depth: 0 };
const run = (aborted = false): RunControl => ({ aborted, pause: () => Promise.resolve(), progress: () => {} });

interface FakeFile { path: string; extension: string }
interface FakeCache { headings?: Array<{ heading: string }>; blocks?: Record<string, unknown> }

/** App mit einer Tabelle Linktext -> Datei und Datei -> Index; `sources` merkt, gegen welchen Pfad aufgelöst wurde. */
function fakeApp(files: Record<string, FakeFile>, caches: Record<string, FakeCache | null> = {}): App & { sources: string[] } {
  const sources: string[] = [];
  const byPath = (p: string): FakeFile | null => Object.values(files).find((f) => f.path === p) ?? null;
  return {
    sources,
    vault: { getFileByPath: byPath },
    metadataCache: {
      getFirstLinkpathDest: (link: string, source: string) => { sources.push(`${link}@${source}`); return files[link] ?? null; },
      getFileCache: (f: FakeFile) => (f.path in caches ? caches[f.path] : {}),
    },
  } as unknown as App & { sources: string[] };
}

/** Ersatz für `withRenderedNote`: baut den Host aus `html`, ruft `use` mit den Befunden und merkt die Aufrufe. */
function fakeDraw(html: string, findings: RenderNoteFinding[] = []): { deps: RenderDeps; calls: RenderNoteOptions[]; host: HTMLElement } {
  const calls: RenderNoteOptions[] = [];
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  const draw = async <T>(opts: RenderNoteOptions, use: (n: RenderedNote) => T | Promise<T>): Promise<T> => {
    calls.push(opts);
    try { return await use({ root: host, findings }); } finally { host.remove(); }
  };
  return { deps: { draw: draw as RenderDeps['draw'] }, calls, host };
}

const embed = (src: string, extra = ''): string => `<span class="internal-embed markdown-embed${extra}" src="${src}"><p>eingebettet</p></span>`;

describe('assertWindowVisible', () => {
  it('meldet ein verdecktes Fenster als Fehler mit dem Satz zum Minimieren', () => {
    const f = assertWindowVisible({ visibilityState: 'hidden' });
    expect(f?.severity).toBe('error');
    expect(f?.code).toBe(CODES.renderHiddenWindow);
    expect(f?.message).toContain('Obsidian-Fenster nicht minimieren');
  });
  it('meldet nichts bei einem sichtbaren Fenster', () => {
    expect(assertWindowVisible({ visibilityState: 'visible' })).toBeNull();
  });
});

describe('renderNote: Zeichnen über das Kit', () => {
  it('reicht Körper und Pfad der Notiz an den Zeichner und liefert einen losgelösten Baum', async () => {
    const d = fakeDraw('<h1>Hallo</h1><p>Text</p>');
    const out = await renderNote(fakeApp({}), note, DEFAULT_RECIPE, run(), d.deps);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.markdown).toBe(note.body);
    expect(d.calls[0]?.sourcePath).toBe(note.path);
    expect(out.root.parentNode).toBeNull();
    expect(out.root.innerHTML).toBe('<h1>Hallo</h1><p>Text</p>');
    expect(out.findings).toEqual([]);
    expect(d.host.isConnected).toBe(false);
  });

  it('übersetzt den Fristablauf in render.timeout mit notePath', async () => {
    const d = fakeDraw('<p>halb</p>', [{ kind: 'render-timeout', ms: 10000 }]);
    const out = await renderNote(fakeApp({}), note, DEFAULT_RECIPE, run(), d.deps);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ severity: 'warning', code: CODES.renderTimeout, notePath: note.path });
    expect(out.root.innerHTML).toBe('<p>halb</p>');
  });

  it('übersetzt window-hidden in einen Fehler render.hidden-window und liefert keinen Inhalt', async () => {
    const d = fakeDraw('<p>Rest</p>', [{ kind: 'window-hidden' }]);
    const out = await renderNote(fakeApp({}), note, DEFAULT_RECIPE, run(), d.deps);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ severity: 'error', code: CODES.renderHiddenWindow, notePath: note.path });
    expect(out.findings[0]?.message).toContain('Obsidian-Fenster nicht minimieren');
    expect(out.root.childNodes).toHaveLength(0);
  });

  it('übersetzt not-settled, render-failed und mermaid-missing', async () => {
    const d = fakeDraw('<p>x</p>', [
      { kind: 'not-settled', ms: 4000, placeholders: 2 },
      { kind: 'render-failed', message: 'kaputt' },
      { kind: 'mermaid-missing', expected: 3, drawn: 1 },
    ]);
    const out = await renderNote(fakeApp({}), note, DEFAULT_RECIPE, run(), d.deps);
    expect(out.findings.map((f) => f.code)).toEqual([CODES.renderPlaceholder, CODES.renderFailed, CODES.renderMermaidMissing]);
    expect(out.findings.every((f) => f.severity === 'warning' && f.notePath === note.path)).toBe(true);
    expect(out.findings[2]?.message).toContain('2 von 3');
  });

  it('zeichnet nicht, wenn der Lauf abgebrochen ist', async () => {
    const d = fakeDraw('<p>x</p>');
    const out = await renderNote(fakeApp({}), note, DEFAULT_RECIPE, run(true), d.deps);
    expect(d.calls).toHaveLength(0);
    expect(out.findings).toEqual([]);
    expect(out.root.childNodes).toHaveLength(0);
  });

  it('der Vertrag mit styles.css: die Regel des Hosts steht dort wortgleich', () => {
    expect(RENDER_HOST_CSS).toBe(RENDER_NOTE_CSS);
    const css = readFileSync('styles.css', 'utf8');
    expect(css).toContain(RENDER_NOTE_CSS.trim());
  });
});

describe('renderNote: Einbettungen', () => {
  const files = {
    ziel: { path: 'a/ziel.md', extension: 'md' },
    fremd: { path: 'b/fremd.md', extension: 'md' },
    bild: { path: 'a/bild.png', extension: 'png' },
    innen: { path: 'a/innen.md', extension: 'md' },
    'ziel#Gibt es': { path: 'a/ziel.md', extension: 'md' },
  };
  const inSet = (p: string): boolean => p.startsWith('a/');

  it('der Zeichner findet eine Einbettung ohne Ziel selbst (mod-empty): ein Befund embed.missing, keine Doppelmeldung', async () => {
    const d = fakeDraw(embed('gibts-nicht', ' mod-empty'), [{ kind: 'embed-missing', target: 'gibts-nicht' }]);
    const out = await renderNote(fakeApp(files), note, DEFAULT_RECIPE, run(), { ...d.deps, inSet });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ severity: 'warning', code: CODES.embedMissing, notePath: note.path });
    expect(out.findings[0]?.message).toContain('gibts-nicht');
  });

  it('eine Notiz außerhalb der Menge ergibt embed.outside, eine innerhalb nichts, ein Bild nie', async () => {
    const d = fakeDraw(embed('fremd') + embed('ziel') + `<span class="internal-embed image-embed" src="bild"><img></span>`);
    const out = await renderNote(fakeApp({ ...files, bild: { path: 'b/bild.png', extension: 'png' } }), note, DEFAULT_RECIPE, run(), { ...d.deps, inSet });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ severity: 'warning', code: CODES.embedOutside, notePath: note.path });
    expect(out.findings[0]?.message).toContain('b/fremd.md');
  });

  it('löst das Ziel gegen den Pfad der Notiz auf', async () => {
    const app = fakeApp(files);
    const d = fakeDraw(embed('ziel'));
    await renderNote(app, note, DEFAULT_RECIPE, run(), { ...d.deps, inSet });
    expect(app.sources).toEqual([`ziel@${note.path}`]);
  });

  it('fehlende Überschrift: embed.missing-section; vorhandene (ohne Groß/Klein) nicht', async () => {
    const caches = { 'a/ziel.md': { headings: [{ heading: 'Gibt es' }] } };
    const d = fakeDraw(embed('ziel#Fehlt') + embed('ziel#gibt es'));
    const out = await renderNote(fakeApp(files, caches), note, DEFAULT_RECIPE, run(), { ...d.deps, inSet });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ severity: 'warning', code: CODES.embedMissingSection, notePath: note.path });
    expect(out.findings[0]?.message).toContain('#Fehlt');
  });

  it('fehlender Block: embed.missing-section; vorhandener nicht', async () => {
    const caches = { 'a/ziel.md': { blocks: { abc123: {} } } };
    const d = fakeDraw(embed('ziel#^nix') + embed('ziel#^ABC123'));
    const out = await renderNote(fakeApp(files, caches), note, DEFAULT_RECIPE, run(), { ...d.deps, inSet });
    expect(out.findings.map((f) => f.code)).toEqual([CODES.embedMissingSection]);
    expect(out.findings[0]?.message).toContain('#^nix');
  });

  it('ohne Index der Zielnotiz gibt es kein Urteil über den Abschnitt', async () => {
    const d = fakeDraw(embed('ziel#Fehlt'));
    const out = await renderNote(fakeApp(files, { 'a/ziel.md': null }), note, DEFAULT_RECIPE, run(), { ...d.deps, inSet });
    expect(out.findings).toEqual([]);
  });

  it('eine Einbettung in einer eingebetteten Notiz löst gegen die eingebettete Notiz auf', async () => {
    const app = fakeApp(files);
    const nested = `<span class="internal-embed markdown-embed" src="ziel"><span class="internal-embed markdown-embed" src="innen"></span></span>`;
    await renderNote(app, note, DEFAULT_RECIPE, run(), { ...fakeDraw(nested).deps, inSet });
    expect(app.sources).toEqual([`ziel@${note.path}`, 'innen@a/ziel.md']);
  });

  it('ohne inSet entfällt nur die Prüfung auf die Menge', async () => {
    const out = await renderNote(fakeApp(files), note, DEFAULT_RECIPE, run(), fakeDraw(embed('fremd')).deps);
    expect(out.findings).toEqual([]);
  });
});

describe('renderNote: mit dem echten Zeichner des Kits', () => {
  it('erkennt mod-empty selbst, räumt den Host ab und liefert den Baum losgelöst', async () => {
    (Element.prototype as unknown as Record<string, unknown>).setCssProps = function (this: HTMLElement, props: Record<string, string>) {
      for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
    };
    const deps: RenderDeps = {
      doc: document,
      kit: {
        render: (_md, host) => { host.innerHTML = '<p>da</p><span class="internal-embed mod-empty" src="weg"></span>'; return Promise.resolve(); },
        createComponent: () => ({ unload: () => {} }),
        observe: () => () => {},
        visibility: () => 'visible',
      },
    };
    const out = await renderNote(fakeApp({}), note, DEFAULT_RECIPE, run(), deps);
    expect(out.findings.map((f) => f.code)).toEqual([CODES.embedMissing]);
    expect(out.root.querySelector('p')?.textContent).toBe('da');
    expect(out.root.parentNode).toBeNull();
    expect(document.querySelector('.okit-render-note-host')).toBeNull();
  });

  it('ein verdecktes Fenster wird nicht gezeichnet', async () => {
    let drawn = 0;
    const deps: RenderDeps = {
      doc: document,
      kit: {
        render: () => { drawn += 1; return Promise.resolve(); },
        createComponent: () => ({ unload: () => {} }),
        observe: () => () => {},
        visibility: () => 'hidden',
      },
    };
    const out = await renderNote(fakeApp({}), note, DEFAULT_RECIPE, run(), deps);
    expect(drawn).toBe(0);
    expect(out.findings.map((f) => [f.severity, f.code])).toEqual([['error', CODES.renderHiddenWindow]]);
    expect(out.root.childNodes).toHaveLength(0);
  });
});
