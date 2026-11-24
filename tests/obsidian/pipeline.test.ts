// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { resultJson } from '../../src/core/result-file';
import type { ExportResult, ExportScope, Finding } from '../../src/core/types';
import { writeExport } from '../../src/obsidian/output';
import { checkExport, exportApi, runExport, scopeForEntry } from '../../src/obsidian/pipeline';
import { listing, makeDisk, text } from './fake-adapter';
import { installObsidianDom } from './dom-polyfill';
import { BEISPIEL_HYPERTEXT, depsOf, fakeRun, fixtureVault, hostOf, makeVault } from './pipeline-helpers';

beforeAll(installObsidianDom);

const BEISPIEL: ExportScope = { kind: 'folder', folder: 'beispiel', entryPath: 'beispiel/beispiel.md' };
const beispielFm = { 'beispiel/beispiel.md': { hypertext: BEISPIEL_HYPERTEXT } };
const codes = (findings: Finding[]): string[] => findings.map((f) => f.code);
const count = (findings: Finding[], code: string): number => findings.filter((f) => f.code === code).length;
const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

function small(files: Record<string, string>, fm: Record<string, Record<string, unknown>> = {}) {
  const vault = makeVault(files, fm);
  return { vault, host: hostOf(vault), deps: depsOf(vault) };
}

const NOTE = '---\ntitle: Bericht\n---\n\n# Bericht\n\nEin Absatz.\n';

describe('runExport: Dateiname und Einstieg', () => {
  it('nennt die Ausgabe wie die Einstiegsnotiz plus .html (focus-crew: bericht.html)', async () => {
    const { host, deps } = small({ 'a/bericht.md': NOTE });
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), deps);
    expect(result.ok).toBe(true);
    expect(result.fileName).toBe('bericht.html');
    expect(result.entryPath).toBe('a/bericht.md');
  });

  it('bestimmt den Einstieg selbst, wenn der Nutzer keinen wählt, und meldet ihn im Ergebnis', async () => {
    const { host, deps } = small({ 'a/b.md': '---\ntitle: B\n---\n\nText B.\n', 'a/a.md': '---\ntitle: A\n---\n\nText A.\n' });
    const result = await runExport(host, { kind: 'folder', folder: 'a', entryPath: '' }, fakeRun(), deps);
    expect(result.ok).toBe(true);
    expect(result.entryPath).toBe('a/a.md');
    expect(result.fileName).toBe('a.html');
  });

  it('liest die Bauanleitung der Einstiegsnotiz (lang bestimmt das Wurzelelement der Seite)', async () => {
    const { host, deps } = small({ 'a/bericht.md': NOTE }, { 'a/bericht.md': { hypertext: { version: 1, lang: 'de' } } });
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), deps);
    expect(parse(result.html ?? '').documentElement.getAttribute('lang')).toBe('de');
  });
});

describe('runExport: Fehler halten den Lauf an', () => {
  it('ein Fehler in Schritt 2 hält vor dem Zeichnen: kein Zeichenaufruf, ok false, keine Seite', async () => {
    const { vault, host, deps } = small({ 'a/bericht.md': NOTE }, { 'a/bericht.md': { hypertext: { version: 2 } } });
    const result = await runExport(host, { kind: 'folder', folder: 'a', entryPath: 'a/bericht.md' }, fakeRun(), deps);
    expect(vault.drawn).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.html).toBeUndefined();
    expect(codes(result.findings)).toContain(CODES.recipeVersion);
  });

  it('ein verdecktes Fenster hält vor dem ersten Zeichnen an', async () => {
    const { vault, host, deps } = small({ 'a/bericht.md': NOTE });
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), { ...deps, visibility: { visibilityState: 'hidden' } });
    expect(vault.drawn).toEqual([]);
    expect(result.ok).toBe(false);
    expect(codes(result.findings)).toContain(CODES.renderHiddenWindow);
  });

  it('ein Fehler nach dem Zeichnen (final.forbidden) ergibt ok false und keine Seite', async () => {
    const { vault, host, deps } = small({ 'a/bericht.md': '---\ntitle: Bericht\n---\n\nSiehe app://irgendwo/datei.\n' });
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), deps);
    expect(vault.drawn).toEqual(['a/bericht.md']);
    expect(result.ok).toBe(false);
    expect(result.html).toBeUndefined();
    expect(result.findings.find((f) => f.code === CODES.finalForbidden)?.severity).toBe('error');
  });

  /** Ein Zeichner, der statt des gerenderten Baums einen festen Text liefert (der Zeichner von Obsidian läuft im Test nicht). */
  const drawing = (html: string, deps: { render?: unknown }): NonNullable<typeof deps.render> => ({
    draw: (async (_opts: unknown, use: (n: { root: HTMLElement; findings: never[] }) => unknown) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      return use({ root, findings: [] });
    }) as unknown,
  });
  const MXSS_ONE = '<math><mtext><table><mglyph><style><img src=x onerror="document.title=1">';
  // Dreifach verschachtelt (Review Etappe 10, Runde 2): der Rundlauf des Kits findet in drei Runden keinen festen Punkt und leert die Wurzel.
  const MXSS_THREE = '<p>SURVIVOR</p>' + '<math><mtext><table><mglyph><style>'.repeat(3) + '<img src=x onerror="document.title=1">';

  it('Mutation-XSS aus dem Review (einfach verschachtelt): der Schutzdurchgang des Kits macht den Baum stabil, die Seite trägt kein Ereignis-Attribut, ein Hinweis guard.reparse als warning', async () => {
    const { host, deps } = small({ 'a/bericht.md': NOTE });
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), { ...deps, render: drawing(MXSS_ONE, deps) } as typeof deps);
    expect(result.ok).toBe(true);
    expect(parse(result.html ?? '').querySelectorAll('[onerror]')).toHaveLength(0);
    expect(result.html).not.toMatch(/onerror/);
    const reparse = result.findings.filter((f) => f.code === CODES.guardReparse);
    expect(reparse).toHaveLength(1);
    expect(reparse[0]).toMatchObject({ severity: 'warning', notePath: 'a/bericht.md' });
    expect(result.findings.some((f) => f.code === CODES.finalGuard)).toBe(false);
  });

  it('Mutation-XSS dreifach verschachtelt: guard.reparse als error mit Notizpfad (die Notiz ist nicht übernommen), ok false, keine Seite', async () => {
    const { host, deps } = small({ 'a/bericht.md': NOTE });
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), { ...deps, render: drawing(MXSS_THREE, deps) } as typeof deps);
    expect(result.ok).toBe(false);
    expect(result.html).toBeUndefined();
    const reparse = result.findings.filter((f) => f.code === CODES.guardReparse);
    expect(reparse).toHaveLength(1);
    expect(reparse[0]).toMatchObject({ severity: 'error', notePath: 'a/bericht.md' });
    expect(reparse[0]?.message).toContain('nicht übernommen');
    // die Ergebnisdatei trägt Code, Pfad und Satz
    const json = JSON.parse(resultJson(result, null)) as { ok: boolean; findings: Array<{ code: string; notePath?: string; message: string }> };
    expect(json.ok).toBe(false);
    expect(json.findings.find((f) => f.code === 'guard.reparse')).toMatchObject({ notePath: 'a/bericht.md', severity: 'error' });
  });

  it('eine doppelte Marke auf der Seite (mark.duplicate) hält den Lauf ebenso an', async () => {
    // Die id im Text der Notiz gleicht der Marke der Notiz („bericht“).
    const { host, deps } = small({ 'a/bericht.md': NOTE });
    const draw = (async (_opts: unknown, use: (n: { root: HTMLElement; findings: never[] }) => unknown) => {
      const root = document.createElement('div');
      root.innerHTML = '<p id="bericht">doppelt</p>';
      return use({ root, findings: [] });
    }) as unknown as NonNullable<typeof deps.render>['draw'];
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), { ...deps, render: { draw } });
    expect(result.ok).toBe(false);
    expect(result.html).toBeUndefined();
    expect(codes(result.findings)).toContain(CODES.markDuplicate);
  });
});

describe('Abbruch', () => {
  it('nach Notiz 3 von 6: keine Seite, Ergebnisdatei mit ok:false, eine alte ok:true bleibt nie liegen', async () => {
    const disk = makeDisk({ 'beispiel/beispiel.export.json': '{"ok":true,"path":"beispiel/beispiel.html"}\n' });
    const vault = makeVault(fixtureVault(), beispielFm, disk);
    const host = hostOf(vault);
    const run = fakeRun(3);
    const result = await runExport(host, BEISPIEL, run, depsOf(vault));
    expect(vault.drawn).toHaveLength(3);
    expect(result.ok).toBe(false);
    expect(result.html).toBeUndefined();
    const json = await writeExport(host, result, result.entryPath ?? '');
    expect(JSON.parse(json)).toMatchObject({ ok: false, path: null });
    expect(JSON.parse(text(disk, 'beispiel/beispiel.export.json') ?? '{}')).toMatchObject({ ok: false, path: null });
    expect(disk.files.has('beispiel/beispiel.html')).toBe(false);
  });

  it('gibt nach jedem Schritt und jeder Notiz einen Haltepunkt und meldet den Fortschritt je Notiz', async () => {
    const vault = makeVault(fixtureVault(), beispielFm);
    const run = fakeRun();
    const result = await runExport(hostOf(vault), BEISPIEL, run, depsOf(vault));
    expect(result.stats.notes).toBe(6);
    expect(run.progressCalls.map(([done]) => done)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(run.progressCalls.every(([, total]) => total === 6)).toBe(true);
    expect(run.pauses).toBeGreaterThanOrEqual(6 + 4);
  });
});

describe('Beispielordner (Abnahmefall 2) bis zur fertigen Seite', () => {
  it('baut die Seite: sechs Notizen, keine app://-Adresse, kein Fehler, die erwarteten Befunde', async () => {
    const vault = makeVault(fixtureVault(), beispielFm);
    const result = await runExport(hostOf(vault), BEISPIEL, fakeRun(), depsOf(vault));
    expect(result.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    const html = result.html ?? '';
    const page = parse(html);
    expect(page.querySelectorAll('[data-ht-note]')).toHaveLength(6);
    expect(page.querySelectorAll('style')).toHaveLength(1);
    expect(page.querySelector('meta[name="ht-plugin-version"]')?.getAttribute('content')).toBe('0.1.0');
    expect(html).not.toContain('app://');
    expect(html).not.toContain('/vault-basis-fuer-tests');
    expect(html.includes('\r')).toBe(false);
    expect(result.stats.bytes).toBe(new TextEncoder().encode(html).length);
    expect(count(result.findings, CODES.setEmptyFile)).toBe(1);
    expect(count(result.findings, CODES.linkOutside)).toBe(2);
    expect(count(result.findings, CODES.linkUnresolved)).toBe(1);
    expect(count(result.findings, CODES.fieldMissing)).toBe(1);
    expect(count(result.findings, CODES.mediaNotEmbedded)).toBe(1);
    expect(count(result.findings, CODES.mediaRemoteSkipped)).toBe(1);
    expect(count(result.findings, CODES.mediaLater)).toBe(2);
    expect(count(result.findings, CODES.outputSize)).toBe(1);
    expect(count(result.findings, CODES.finalGuard)).toBe(0);
    // Satz 18: der rohe Rahmen wird ersetzt, der Befund erscheint einmal (Stufe info, an der Notiz)
    const frame = result.findings.filter((f) => f.code === CODES.prepareFrameReplaced);
    expect(frame).toHaveLength(1);
    expect(frame[0]).toMatchObject({ severity: 'info', notePath: 'beispiel/anhang/blöcke.md' });
    expect(page.querySelectorAll('img[src^="data:"]')).toHaveLength(2);
    expect(page.querySelector('.ht-media-missing')?.textContent).toContain('fehlt.png');
    // Navigation: Einstieg, dann die Gruppen
    const nav = Array.from(page.querySelectorAll('nav li a')).map((a) => a.textContent);
    expect(nav.slice(0, 2)).toEqual(['Beispiel für den Hypertext-Export', 'Kapitel']);
    // Übersicht des Bereichs Kapitel
    expect(page.querySelectorAll('div.ht-table')).toHaveLength(1);
    // Zusatzzeile aus dem Feld status
    expect(page.querySelector('.ht-summary-line')?.textContent).toBe('fertig');
  });

  it('zweimal erzeugt ist die Seite byte-gleich, auch wenn jetzt <basis>.html und <basis>.export.json im Ordner liegen', async () => {
    const disk = makeDisk();
    const vault = makeVault(fixtureVault(), beispielFm, disk);
    const host = hostOf(vault);
    const first = await runExport(host, BEISPIEL, fakeRun(), depsOf(vault));
    const firstJson = await writeExport(host, first, first.entryPath ?? '');
    expect(listing(disk)).toEqual(expect.arrayContaining(['beispiel/beispiel.html', 'beispiel/beispiel.export.json']));
    const second = await runExport(host, BEISPIEL, fakeRun(), depsOf(vault));
    const secondJson = await writeExport(host, second, second.entryPath ?? '');
    expect(second.html).toBe(first.html);
    expect(second.html).toBeDefined();
    expect(secondJson).toBe(firstJson);
    expect(text(disk, 'beispiel/beispiel.html')).toBe(first.html);
    expect(second.stats.notes).toBe(6);
  });
});

describe('Ausgabeform und Größe', () => {
  it('auto wählt in Etappe 5 immer file und meldet die Größe als Hinweis', async () => {
    const { host, deps } = small({ 'a/bericht.md': NOTE });
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), deps);
    const size = result.findings.filter((f) => f.code === CODES.outputSize);
    expect(size).toHaveLength(1);
    expect(size[0]?.severity).toBe('info');
    expect(size[0]?.message).toContain(String(result.stats.bytes));
    expect(codes(result.findings)).not.toContain(CODES.outputOverLimit);
  });

  it('über output_limit_mb kommt zusätzlich die Warnung output.over-limit; die Seite wird trotzdem geschrieben (Paket folgt in Etappe 6)', async () => {
    const { host, deps } = small({ 'a/bericht.md': NOTE }, { 'a/bericht.md': { hypertext: { version: 1, output_limit_mb: 0.0001 } } });
    const result = await runExport(host, { kind: 'folder', folder: 'a', entryPath: 'a/bericht.md' }, fakeRun(), deps);
    expect(result.ok).toBe(true);
    expect(result.findings.find((f) => f.code === CODES.outputOverLimit)?.severity).toBe('warning');
    expect(codes(result.findings)).toContain(CODES.outputSize);
  });
});

describe('Ergebnisdatei', () => {
  it('ist bei zwei Läufen gleich und nennt die Seite', async () => {
    const disk = makeDisk();
    const vault = makeVault({ 'a/bericht.md': NOTE }, {}, disk);
    const host = hostOf(vault);
    const scope: ExportScope = { kind: 'note', entryPath: 'a/bericht.md' };
    const one = await writeExport(host, await runExport(host, scope, fakeRun(), depsOf(vault)), 'a/bericht.md');
    const two = await writeExport(host, await runExport(host, scope, fakeRun(), depsOf(vault)), 'a/bericht.md');
    expect(one).toBe(two);
    expect(JSON.parse(one)).toMatchObject({ ok: true, path: 'a/bericht.html' });
    expect(text(disk, 'a/bericht.export.json')).toBe(one);
  });
});

describe('checkExport', () => {
  async function exported() {
    const disk = makeDisk();
    const vault = makeVault({ 'a/bericht.md': NOTE }, {}, disk);
    const host = hostOf(vault);
    const scope: ExportScope = { kind: 'note', entryPath: 'a/bericht.md' };
    const result = await runExport(host, scope, fakeRun(), depsOf(vault));
    await writeExport(host, result, 'a/bericht.md');
    return { disk, vault, host, scope, result };
  }

  it('meldet same für eine eben geschriebene Datei', async () => {
    const { vault, host, scope } = await exported();
    const check = await checkExport(host, scope, fakeRun(), depsOf(vault));
    expect(check).toMatchObject({ status: 'same', same: true, path: 'a/bericht.html' });
  });

  it('nennt den ersten abweichenden Byte-Index nach einer Änderung von Hand', async () => {
    const { disk, vault, host, scope, result } = await exported();
    const bytes = new TextEncoder().encode(result.html ?? '');
    const at = 40;
    bytes[at] = (bytes[at] ?? 0) === 120 ? 121 : 120;
    disk.files.set('a/bericht.html', bytes);
    const check = await checkExport(host, scope, fakeRun(), depsOf(vault));
    expect(check).toMatchObject({ status: 'differs', same: false, firstDiff: at });
  });

  it('meldet eine verkürzte Datei beim ersten fehlenden Byte', async () => {
    const { disk, vault, host, scope, result } = await exported();
    const bytes = new TextEncoder().encode(result.html ?? '');
    disk.files.set('a/bericht.html', bytes.slice(0, 100));
    const check = await checkExport(host, scope, fakeRun(), depsOf(vault));
    expect(check).toMatchObject({ status: 'differs', firstDiff: 100 });
  });

  it('meldet no-export, wenn es noch keine Ausgabe gibt, und zeichnet dann nichts', async () => {
    const vault = makeVault({ 'a/bericht.md': NOTE });
    const check = await checkExport(hostOf(vault), { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), depsOf(vault));
    expect(check.status).toBe('no-export');
    expect(vault.drawn).toEqual([]);
  });

  it('meldet beim Ziel Teilen „nichts zu vergleichen“ (keine Datei im Vault) und zeichnet nichts', async () => {
    const vault = makeVault({ 'a/bericht.md': NOTE });
    const check = await checkExport(hostOf(vault, { destination: 'share' }), { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), depsOf(vault));
    expect(check.status).toBe('nothing-to-compare');
    expect(check.same).toBe(false);
    expect(vault.drawn).toEqual([]);
  });

  it('meldet failed mit den Befunden, wenn die Seite sich nicht bauen lässt', async () => {
    const { disk } = await exported();
    const bad = makeVault({ 'a/bericht.md': NOTE }, { 'a/bericht.md': { hypertext: { version: 2 } } }, disk);
    const check = await checkExport(hostOf(bad), { kind: 'folder', folder: 'a', entryPath: 'a/bericht.md' }, fakeRun(), depsOf(bad));
    expect(check.status).toBe('failed');
    expect(codes(check.findings)).toContain(CODES.recipeVersion);
  });

  it('meldet cancelled bei einem Abbruch', async () => {
    const { vault, host, scope } = await exported();
    const check = await checkExport(host, scope, fakeRun(0), depsOf(vault));
    expect(check.status).toBe('cancelled');
  });
});

describe('scopeForEntry', () => {
  it('nimmt den Ordner der Notiz, wenn sie einen Block hypertext trägt, sonst die Einzelnotiz', () => {
    const vault = makeVault({ 'a/mit.md': NOTE, 'a/ohne.md': NOTE, 'wurzel.md': NOTE }, { 'a/mit.md': { hypertext: { version: 1 } }, 'wurzel.md': { hypertext: null } });
    expect(scopeForEntry(vault.app, 'a/mit.md')).toEqual({ kind: 'folder', folder: 'a', entryPath: 'a/mit.md' });
    expect(scopeForEntry(vault.app, 'a/ohne.md')).toEqual({ kind: 'note', entryPath: 'a/ohne.md' });
    expect(scopeForEntry(vault.app, 'wurzel.md')).toEqual({ kind: 'folder', folder: '', entryPath: 'wurzel.md' });
  });
});

describe('exportApi.exportAndWait', () => {
  it('liefert genau den Text der Ergebnisdatei und schreibt Seite und Ergebnisdatei', async () => {
    const disk = makeDisk();
    const vault = makeVault({ 'a/bericht.md': NOTE }, {}, disk);
    const api = exportApi(hostOf(vault), depsOf(vault));
    const json = await api.exportAndWait('a/bericht.md');
    expect(JSON.parse(json)).toMatchObject({ ok: true, path: 'a/bericht.html' });
    expect(text(disk, 'a/bericht.export.json')).toBe(json);
    expect(text(disk, 'a/bericht.html')).toContain('<main id="inhalt">');
    expect(await api.exportAndWait('a/bericht.md')).toBe(json);
  });

  it('wirft nie: eine unbekannte Notiz und ein Ausnahmefall enden als ok:false', async () => {
    const vault = makeVault({ 'a/bericht.md': NOTE });
    const api = exportApi(hostOf(vault), depsOf(vault));
    const missing = JSON.parse(await api.exportAndWait('a/gibt-es-nicht.md')) as ExportResult & { ok: boolean };
    expect(missing.ok).toBe(false);
    const boom = exportApi(hostOf(vault), { ...depsOf(vault), render: { draw: (() => Promise.reject(new Error('Absturz'))) as never } });
    const out = JSON.parse(await boom.exportAndWait('a/bericht.md')) as { ok: boolean; findings: Finding[] };
    expect(out.ok).toBe(false);
    expect(out.findings.map((f) => f.code)).toContain(CODES.exportFailed);
  });
});

describe('runExport: Navigation', () => {
  it('führt Einstieg, Gruppe und lose Notiz der obersten Ebene in der Reihenfolge der Seite, jede Marke trifft ihren Bereich', async () => {
    const { host, deps } = small({
      'a/e.md': '---\ntitle: Einstieg\n---\n\nText.\n',
      'a/g/x.md': '---\ntitle: Innen\n---\n\nIn der Gruppe.\n',
      'a/lose.md': '---\ntitle: Lose Notiz\n---\n\nOhne Gruppe.\n',
    });
    const result = await runExport(host, { kind: 'folder', folder: 'a', entryPath: 'a/e.md' }, fakeRun(), deps);
    expect(result.ok).toBe(true);
    const page = parse(result.html ?? '');
    const links = Array.from(page.querySelectorAll('nav ul > li > a'));
    expect(links.map((a) => a.textContent)).toEqual(['Einstieg', 'g', 'Lose Notiz']);
    const main = page.querySelector('main');
    const areas = Array.from(main?.querySelectorAll(':scope > section[id], :scope > details[id]') ?? []);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(areas.map((el) => `#${el.id}`));
  });
});

describe('runExport: stamp full', () => {
  const FILES = { 'a/bericht.md': NOTE };
  const withPlugins = (ids: string[]) => {
    const vault = makeVault(FILES, { 'a/bericht.md': { hypertext: { version: 1, stamp: 'full' } } });
    const manifests: Record<string, { version: string }> = { dataview: { version: '0.5.68' }, banner: { version: '3.1.0' }, templater: { version: '2.0.0' } };
    (vault.app as unknown as { plugins: unknown }).plugins = { enabledPlugins: new Set(ids), manifests };
    return { host: hostOf(vault), deps: depsOf(vault) };
  };
  const run = async (ids: string[]): Promise<string> => {
    const { host, deps } = withPlugins(ids);
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), deps);
    expect(result.ok).toBe(true);
    return result.html ?? '';
  };

  it('schreibt den vollen Stempel mit den aktivierten Plugins nach id geordnet', async () => {
    const html = await run(['templater', 'dataview', 'banner']);
    const metas = Array.from(parse(html).querySelectorAll('meta[name^="ht-"]')).map((m) => `${m.getAttribute('name')}=${m.getAttribute('content')}`);
    expect(metas.filter((m) => m.startsWith('ht-plugin='))).toEqual(['ht-plugin=banner@3.1.0', 'ht-plugin=dataview@0.5.68', 'ht-plugin=templater@2.0.0']);
    expect(metas.slice(0, 8).map((m) => m.split('=')[0])).toEqual(['ht-plugin-version', 'ht-obsidian-version', 'ht-obsidian-lang', 'ht-theme', 'ht-theme-sha256', 'ht-blocks', 'ht-embeds', 'ht-remote-images']);
  });

  it('ohne stamp: full steht kein ht-plugin im Kopf', async () => {
    const { host, deps } = small({ 'a/bericht.md': NOTE });
    const result = await runExport(host, { kind: 'note', entryPath: 'a/bericht.md' }, fakeRun(), deps);
    expect(parse(result.html ?? '').querySelectorAll('meta[name="ht-plugin"]')).toHaveLength(0);
  });

  it('die Seite bleibt über zwei Läufe byte-gleich, auch wenn Obsidian die Plugins in anderer Reihenfolge nennt', async () => {
    const first = await run(['templater', 'dataview', 'banner']);
    const second = await run(['banner', 'templater', 'dataview']);
    expect(second).toBe(first);
    expect(new TextEncoder().encode(second)).toEqual(new TextEncoder().encode(first));
  });
});
