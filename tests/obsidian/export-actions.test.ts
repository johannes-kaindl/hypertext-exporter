// @vitest-environment jsdom
import { Notice } from 'obsidian';
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import type { Finding } from '../../src/core/types';
import { createExportActions, type ActionsHost } from '../../src/obsidian/export-actions';
import type { ExportProgressRun } from '../../src/obsidian/progress';
import { registerI18n } from '../../src/i18n/strings';
import { setLang } from '../../src/vendor/kit/i18n';
import { installObsidianDom } from './dom-polyfill';
import { makeDisk, text, type FakeDisk } from './fake-adapter';
import { depsOf, fakeRun, hostOf, makeVault, type FakeRun } from './pipeline-helpers';

beforeAll(() => {
  installObsidianDom();
  registerI18n();
});
beforeEach(() => {
  setLang('en');
  (Notice as unknown as { messages: string[] }).messages = [];
});

const NOTE = '---\ntitle: Bericht\n---\n\n# Bericht\n\nEin Absatz.\n';
const messages = (): string[] => (Notice as unknown as { messages: string[] }).messages;

interface Setup {
  disk: FakeDisk;
  shown: Finding[][];
  progress: { run: FakeRun; beginWriting: Mock; end: Mock; writtenAtBegin: boolean[] };
  actions: ReturnType<typeof createExportActions>;
  host: ActionsHost;
}

function setup(files: Record<string, string> = { 'a/bericht.md': NOTE }, opts: { abortAt?: number | null; settings?: Partial<ActionsHost['settings']>; draw?: unknown; frontmatter?: Record<string, Record<string, unknown>> } = {}): Setup {
  const disk = makeDisk();
  const vault = makeVault(files, opts.frontmatter ?? {}, disk);
  const shown: Finding[][] = [];
  const base = hostOf(vault, opts.settings);
  const host: ActionsHost = { ...base, showFindings: (f) => { shown.push(f); return Promise.resolve(); } };
  const run = fakeRun(opts.abortAt ?? null);
  const writtenAtBegin: boolean[] = [];
  const beginWriting: Mock = vi.fn(() => { writtenAtBegin.push(disk.files.has('a/bericht.html')); });
  const end: Mock = vi.fn((_failure?: string) => (run.aborted ? 'cancelled' : _failure !== undefined ? 'failed' : 'done'));
  const startProgress = (): ExportProgressRun => ({ control: run, beginWriting, end: end as unknown as ExportProgressRun['end'] });
  const pipeline = depsOf(vault, opts.draw !== undefined ? { render: { draw: opts.draw as never } } : {});
  return { disk, shown, progress: { run, beginWriting, end, writtenAtBegin }, host, actions: createExportActions(host, { startProgress, pipeline }) };
}

describe('exportNote', () => {
  it('schreibt Seite und Ergebnisdatei, meldet den Pfad und zeigt die Befunde; beginWriting vor dem Schreiben, end im finally', async () => {
    const s = setup();
    await s.actions.exportNote('a/bericht.md');
    expect(text(s.disk, 'a/bericht.html')).toContain('<main id="inhalt">');
    expect(JSON.parse(text(s.disk, 'a/bericht.export.json') ?? '{}')).toMatchObject({ ok: true, path: 'a/bericht.html' });
    expect(messages()).toEqual(['Page saved: a/bericht.html']);
    expect(s.progress.beginWriting).toHaveBeenCalledTimes(1);
    expect(s.progress.writtenAtBegin).toEqual([false]);
    expect(s.progress.end).toHaveBeenCalledTimes(1);
    expect(s.progress.end).toHaveBeenCalledWith(undefined);
    expect(s.shown).toHaveLength(1);
    expect(s.shown[0]?.map((f) => f.code)).toContain(CODES.outputSize);
  });

  it('nimmt den Ordner der Notiz, wenn sie eine Bauanleitung trägt', async () => {
    const s = setup({ 'a/bericht.md': NOTE, 'a/zwei.md': '---\ntitle: Zwei\n---\n\nText.\n' }, { frontmatter: { 'a/bericht.md': { hypertext: { version: 1 } } } });
    await s.actions.exportNote('a/bericht.md');
    expect(text(s.disk, 'a/bericht.html')).toContain('data-ht-note="zwei"');
  });

  it('ein Fehler im Lauf: keine Seite, Ergebnisdatei ok:false, Notice mit der Zahl der Fehler, Befunde zeigen den Fehler', async () => {
    const s = setup({ 'a/bericht.md': NOTE }, { frontmatter: { 'a/bericht.md': { hypertext: { version: 2 } } } });
    await s.actions.exportNote('a/bericht.md');
    expect(s.disk.files.has('a/bericht.html')).toBe(false);
    expect(JSON.parse(text(s.disk, 'a/bericht.export.json') ?? '{}')).toMatchObject({ ok: false, path: null });
    expect(messages()).toEqual(['The export stopped with 1 error(s). No page was written. See the findings.']);
    expect(s.shown[0]?.map((f) => f.code)).toContain(CODES.recipeVersion);
  });

  it('ein Abbruch: keine Seite, Ergebnisdatei ok:false (eine alte ok:true wird ersetzt), Notice „abgebrochen“, kein beginWriting', async () => {
    const s = setup(undefined, { abortAt: 0 });
    s.disk.files.set('a/bericht.export.json', new TextEncoder().encode('{"ok":true,"path":"a/bericht.html"}\n'));
    await s.actions.exportNote('a/bericht.md');
    expect(s.disk.files.has('a/bericht.html')).toBe(false);
    expect(JSON.parse(text(s.disk, 'a/bericht.export.json') ?? '{}')).toMatchObject({ ok: false, path: null });
    expect(messages()).toEqual(['Export cancelled. No page was written.']);
    expect(s.progress.beginWriting).not.toHaveBeenCalled();
    expect(s.progress.end).toHaveBeenCalledTimes(1);
    expect(s.shown).toHaveLength(1);
  });

  it('wirft nie: ein Absturz im Zeichner endet als Notice, end mit dem Fehlertext und Ergebnisdatei ok:false', async () => {
    const s = setup(undefined, { draw: () => Promise.reject(new Error('Absturz im Zeichner')) });
    await expect(s.actions.exportNote('a/bericht.md')).resolves.toBeUndefined();
    expect(messages()).toEqual(['The export failed: Absturz im Zeichner']);
    expect(s.progress.end).toHaveBeenCalledWith('Absturz im Zeichner');
    expect(JSON.parse(text(s.disk, 'a/bericht.export.json') ?? '{}')).toMatchObject({ ok: false, path: null });
    expect(s.shown[0]?.map((f) => f.code)).toEqual([CODES.exportFailed]);
  });
});

describe('exportFolder', () => {
  it('ohne gewählten Einstieg bestimmt der Lauf ihn und schreibt neben ihn', async () => {
    const s = setup({ 'a/b.md': '---\ntitle: B\n---\n\nText B.\n', 'a/a.md': '---\ntitle: A\n---\n\nText A.\n' });
    await s.actions.exportFolder('a', null);
    expect(s.disk.files.has('a/a.html')).toBe(true);
    expect(s.disk.files.has('a/a.export.json')).toBe(true);
  });

  it('ein Ordner ohne Notiz schreibt nichts (kein Ort für eine Ergebnisdatei) und meldet den Fehler', async () => {
    const s = setup({ 'a/b.md': NOTE });
    await s.actions.exportFolder('leer', null);
    expect(s.disk.files.size).toBe(0);
    expect(messages()).toEqual(['The export stopped with 1 error(s). No page was written. See the findings.']);
    expect(s.shown[0]?.map((f) => f.code)).toContain(CODES.setEmpty);
  });
});

describe('checkExport', () => {
  it('„gleich“ für eine eben geschriebene Seite und „weicht ab ab Byte n“ nach einer Änderung', async () => {
    const s = setup();
    await s.actions.exportNote('a/bericht.md');
    messages().length = 0;
    await s.actions.checkExport('a/bericht.md');
    expect(messages()).toEqual(['The export is the same as a fresh run.']);
    const bytes = s.disk.files.get('a/bericht.html') ?? new Uint8Array();
    bytes[40] = (bytes[40] ?? 0) === 120 ? 121 : 120;
    messages().length = 0;
    await s.actions.checkExport('a/bericht.md');
    expect(messages()).toEqual(['The export differs from a fresh run, starting at byte 40.']);
    expect(s.shown.length).toBe(3);
  });

  it('„noch kein Export“ ohne Ausgabe, ohne Fortschritt und ohne Befunde', async () => {
    const s = setup();
    await s.actions.checkExport('a/bericht.md');
    expect(messages()).toEqual(['No export yet. Export the note or its folder first.']);
    expect(s.progress.end).not.toHaveBeenCalled();
  });

  it('„nichts zu vergleichen“ beim Ziel Teilen', async () => {
    const s = setup(undefined, { settings: { destination: 'share' } });
    await s.actions.checkExport('a/bericht.md');
    expect(messages()).toEqual(['Nothing to compare: the target Share leaves no file in the vault.']);
  });
});

describe('openExport', () => {
  it('meldet „noch kein Export“, wenn die Ausgabe fehlt, und öffnet sie sonst mit der Standard-App', async () => {
    const s = setup();
    const open = vi.fn(() => Promise.resolve());
    (s.host.app as unknown as { openWithDefaultApp: typeof open }).openWithDefaultApp = open;
    await s.actions.openExport('a/bericht.md');
    expect(messages()).toEqual(['No export yet. Export the note or its folder first.']);
    expect(open).not.toHaveBeenCalled();
    await s.actions.exportNote('a/bericht.md');
    await s.actions.openExport('a/bericht.md');
    expect(open).toHaveBeenCalledWith('a/bericht.html');
    expect(s.shown).toHaveLength(1);
  });
});
