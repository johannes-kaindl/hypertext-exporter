import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportResult, Finding } from '../../src/core/types';

// Das echte share-export zieht `confirm` (Modal) mit; der Test ersetzt das Modul und prüft nur den Aufruf.
const { shareExport } = vi.hoisted(() => ({ shareExport: vi.fn() }));
vi.mock('../../src/vendor/kit-obsidian/share-export', () => ({
  shareExport,
  SHARE_EXPORT_STRINGS_EN: { failed: 'en' },
  SHARE_EXPORT_STRINGS_DE: { failed: 'de' },
}));

import { writeExport, type OutputHost } from '../../src/obsidian/output';
import { appOf, listing, makeDisk, text, type FakeDisk } from './fake-adapter';

const HTML = '<!DOCTYPE html>\n<html lang="de"><body><p>Grüße \u{1F600}</p></body></html>\n';
const ok = (extra: Partial<ExportResult> = {}): ExportResult => ({
  ok: true,
  html: HTML,
  fileName: 'bericht.html',
  findings: [{ severity: 'info', code: 'output.size', args: [1024, '1 KB'] }],
  stats: { notes: 2, bytes: HTML.length, mediaBytes: {} },
  ...extra,
});
const broken = (findings: Finding[] = [{ severity: 'error', code: 'recipe.invalid', args: ['hypertext', 'kaputt'] }]): ExportResult => ({
  ok: false,
  fileName: 'bericht.html',
  findings,
  stats: { notes: 0, bytes: 0, mediaBytes: {} },
});

function host(disk: FakeDisk, destination: OutputHost['settings']['destination'] = 'beside-entry'): OutputHost {
  return { app: appOf(disk), settings: { destination, destinationFolder: 'exports' } };
}

beforeEach(() => {
  shareExport.mockReset();
  shareExport.mockResolvedValue({ outcome: 'shared', path: '.hypertext-export/bericht.html' });
});

describe('writeExport: beside-entry', () => {
  it('nennt die Seite wie die Einstiegsnotiz plus .html und legt die Ergebnisdatei daneben', async () => {
    const disk = makeDisk({ 'focus/bericht.md': '# Bericht' });
    const json = await writeExport(host(disk), ok(), 'focus/bericht.md');
    expect(listing(disk)).toEqual(['focus/bericht.export.json', 'focus/bericht.html', 'focus/bericht.md']);
    expect(text(disk, 'focus/bericht.html')).toBe(HTML);
    expect(JSON.parse(json)).toMatchObject({ ok: true, path: 'focus/bericht.html', errors: 0, warnings: 0, infos: 1 });
    expect(text(disk, 'focus/bericht.export.json')).toBe(json);
  });

  it('schreibt die Seite als UTF-8 mit unverändertem Zeilenende', async () => {
    const disk = makeDisk();
    await writeExport(host(disk), ok(), 'bericht.md');
    expect([...(disk.files.get('bericht.html') ?? [])]).toEqual([...new TextEncoder().encode(HTML)]);
  });

  it('bereinigt den Namen mit der Kit-Regel (kein Pfadzeichen im Dateinamen) und arbeitet an der Vault-Wurzel', async () => {
    const disk = makeDisk();
    await writeExport(host(disk), ok(), 'Notiz: Teil 1?.md');
    const names = listing(disk);
    expect(names).toHaveLength(2);
    const stem = (names[0] ?? '').replace(/\.export\.json$/, '');
    expect(names).toEqual([`${stem}.export.json`, `${stem}.html`]);
    expect(stem).not.toMatch(/[:?/]/);
  });

  it('ersetzt eine vorhandene Seite und räumt liegengebliebene .tmp und .prev weg', async () => {
    const disk = makeDisk({
      'focus/bericht.html': 'ALT',
      'focus/bericht.html.tmp': 'halb geschriebe',
      'focus/bericht.html.prev': 'noch älter',
      'focus/bericht.export.json': '{"ok":false}\n',
    });
    await writeExport(host(disk), ok(), 'focus/bericht.md');
    expect(listing(disk)).toEqual(['focus/bericht.export.json', 'focus/bericht.html']);
    expect(text(disk, 'focus/bericht.html')).toBe(HTML);
    expect(JSON.parse(text(disk, 'focus/bericht.export.json') ?? '')).toMatchObject({ ok: true });
  });

  it('ein zweiter Lauf ist byte-gleich, obwohl Seite und Ergebnisdatei schon im Ordner liegen', async () => {
    const disk = makeDisk({ 'focus/bericht.md': '# Bericht', 'focus/anhang.md': 'Text' });
    const first = await writeExport(host(disk), ok(), 'focus/bericht.md');
    const afterFirst = new Map([...disk.files].map(([k, v]) => [k, [...v]]));
    const second = await writeExport(host(disk), ok(), 'focus/bericht.md');
    expect(second).toBe(first);
    expect(new Map([...disk.files].map(([k, v]) => [k, [...v]]))).toEqual(afterFirst);
    // Die Menge des nächsten Laufs sind die Markdown-Dateien; die Ausgabe fügt keine hinzu.
    expect(listing(disk).filter((p) => p.endsWith('.md'))).toEqual(['focus/anhang.md', 'focus/bericht.md']);
  });

  it('die Ergebnisdatei ist bei zwei Läufen mit umgeordneten Befunden gleich', async () => {
    const a: Finding = { severity: 'warning', code: 'link.outside', args: ['a'], notePath: 'a.md' };
    const b: Finding = { severity: 'warning', code: 'embed.missing', args: ['b'], notePath: 'b.md' };
    const disk = makeDisk();
    await writeExport(host(disk), ok({ findings: [a, b] }), 'bericht.md');
    const first = text(disk, 'bericht.export.json');
    await writeExport(host(disk), ok({ findings: [b, a] }), 'bericht.md');
    expect(text(disk, 'bericht.export.json')).toBe(first);
  });
});

describe('writeExport: folder', () => {
  it('schreibt in den Zielordner der Einstellungen und legt ihn an', async () => {
    const disk = makeDisk();
    const json = await writeExport(host(disk, 'folder'), ok(), 'focus/bericht.md');
    expect(listing(disk)).toEqual(['exports/bericht.export.json', 'exports/bericht.html']);
    expect(JSON.parse(json)).toMatchObject({ ok: true, path: 'exports/bericht.html' });
  });
});

describe('writeExport: ok:false', () => {
  it('schreibt keine Seite, aber die Ergebnisdatei mit ok:false und path:null', async () => {
    const disk = makeDisk();
    const json = await writeExport(host(disk), broken(), 'focus/bericht.md');
    expect(listing(disk)).toEqual(['focus/bericht.export.json']);
    expect(JSON.parse(json)).toMatchObject({ ok: false, path: null, errors: 1 });
    expect(text(disk, 'focus/bericht.export.json')).toBe(json);
  });

  it('lässt eine alte ok:true nie liegen: die Ergebnisdatei wird ersetzt, die alte Seite bleibt unberührt', async () => {
    const disk = makeDisk();
    await writeExport(host(disk), ok(), 'bericht.md');
    expect(JSON.parse(text(disk, 'bericht.export.json') ?? '')).toMatchObject({ ok: true });
    await writeExport(host(disk), broken(), 'bericht.md');
    expect(JSON.parse(text(disk, 'bericht.export.json') ?? '')).toMatchObject({ ok: false, path: null });
    expect(text(disk, 'bericht.html')).toBe(HTML);
  });

  it('ein Lauf mit ok-Flag, aber einem Fehlerbefund (etwa nach dem Zeichnen) schreibt ebenfalls keine Seite', async () => {
    const disk = makeDisk();
    const json = await writeExport(host(disk), ok({ findings: [{ severity: 'error', code: 'final.forbidden', args: ['app://'] }] }), 'bericht.md');
    expect(listing(disk)).toEqual(['bericht.export.json']);
    expect(JSON.parse(json)).toMatchObject({ ok: false, path: null });
  });

  it('ein Abbruch ohne Seitentext (ok:true, aber html fehlt) gilt als gescheitert', async () => {
    const disk = makeDisk();
    const { html: _html, ...withoutHtml } = ok();
    const json = await writeExport(host(disk), withoutHtml, 'bericht.md');
    expect(listing(disk)).toEqual(['bericht.export.json']);
    expect(JSON.parse(json)).toMatchObject({ ok: false, path: null });
  });
});

describe('writeExport: Fehler beim Schreiben', () => {
  it('scheitert das letzte Umbenennen, bleibt die alte Seite stehen, es wird ok:false mit output.write-failed gemeldet, nichts wirft', async () => {
    const disk = makeDisk({ 'bericht.html': 'ALT' });
    disk.failOn.push({ op: 'rename', path: 'bericht.html.tmp', to: 'bericht.html' });
    const json = await writeExport(host(disk), ok(), 'bericht.md');
    expect(text(disk, 'bericht.html')).toBe('ALT');
    const parsed = JSON.parse(json) as { ok: boolean; path: string | null; findings: Array<{ code: string }> };
    expect(parsed.ok).toBe(false);
    expect(parsed.path).toBeNull();
    expect(parsed.findings.map((f) => f.code)).toContain('output.write-failed');
    expect(JSON.parse(text(disk, 'bericht.export.json') ?? '')).toMatchObject({ ok: false, path: null });
  });

  it('ein Adapter, der beim Anlegen des Ordners wirft, ergibt ok:false statt einer Ausnahme', async () => {
    const disk = makeDisk();
    disk.failOn.push({ op: 'mkdir' });
    const json = await writeExport(host(disk, 'folder'), ok(), 'bericht.md');
    expect(JSON.parse(json)).toMatchObject({ ok: false, path: null });
    expect(listing(disk)).toEqual([]);
  });

  it('läuft die Seite durch, scheitert aber die Ergebnisdatei, steht der Hinweis im Rückgabetext und die Seite bleibt', async () => {
    const disk = makeDisk();
    disk.failOn.push({ op: 'writeBinary', path: 'bericht.export.json.tmp' });
    const json = await writeExport(host(disk), ok(), 'bericht.md');
    expect(text(disk, 'bericht.html')).toBe(HTML);
    expect(disk.files.has('bericht.export.json')).toBe(false);
    const parsed = JSON.parse(json) as { ok: boolean; path: string | null; findings: Array<{ code: string; severity: string }> };
    expect(parsed.ok).toBe(true);
    expect(parsed.path).toBe('bericht.html');
    expect(parsed.findings.some((f) => f.code === 'output.write-failed' && f.severity === 'warning')).toBe(true);
  });
});

describe('writeExport: share', () => {
  it('übergibt die Seite an shareExport und schreibt keine Ergebnisdatei', async () => {
    const disk = makeDisk();
    const json = await writeExport(host(disk, 'share'), ok(), 'focus/bericht.md');
    expect(shareExport).toHaveBeenCalledTimes(1);
    const [, bytes, opts] = shareExport.mock.calls[0] as [unknown, Uint8Array, { dir: string; fileName: string; mime: string }];
    expect(new TextDecoder().decode(bytes)).toBe(HTML);
    expect(opts).toMatchObject({ dir: '.hypertext-export', fileName: 'bericht.html', mime: 'text/html' });
    expect(listing(disk)).toEqual([]);
    expect(JSON.parse(json)).toMatchObject({ ok: true, path: null });
  });

  it('ruft bei ok:false nichts auf und schreibt nichts', async () => {
    const disk = makeDisk();
    const json = await writeExport(host(disk, 'share'), broken(), 'bericht.md');
    expect(shareExport).not.toHaveBeenCalled();
    expect(listing(disk)).toEqual([]);
    expect(JSON.parse(json)).toMatchObject({ ok: false, path: null });
  });

  it('ein gescheitertes Teilen wird ok:false mit output.write-failed', async () => {
    shareExport.mockResolvedValue({ outcome: 'failed', path: null, error: new Error('kein Blatt') });
    const json = await writeExport(host(makeDisk(), 'share'), ok(), 'bericht.md');
    const parsed = JSON.parse(json) as { ok: boolean; findings: Array<{ code: string }> };
    expect(parsed.ok).toBe(false);
    expect(parsed.findings.map((f) => f.code)).toContain('output.write-failed');
  });
});
