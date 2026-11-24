import { describe, expect, it } from 'vitest';
import { exportOk, resultJson, toResultFinding } from '../../src/core/result-file';
import type { ExportResult, Finding } from '../../src/core/types';
import { DE, EN } from '../../src/i18n/strings';
import { tableTranslate } from './text-of';

const stats = { notes: 3, bytes: 100, mediaBytes: {} };
const result = (ok: boolean, findings: Finding[]): ExportResult => ({ ok, fileName: 'bericht.html', findings, stats });

// Eigene Tabelle: der Test prüft Form und Reihenfolge der Datei, nicht die Sätze des Plugins.
const T = tableTranslate({
  'finding.link.outside': 'Link außerhalb',
  'finding.output.size': '{0} KB',
  'finding.recipe.unknown-key': 'Tippfehler',
  'finding.x': 'm',
  'finding.y': 'n',
  'finding.z': 'o',
  'finding.recipe.invalid': 'kaputt',
  'finding.final.forbidden': 'app://',
  'finding.k': 'sagt "hallo"\n{0}',
});

describe('resultJson', () => {
  it('schreibt Schlüssel und Befund-Felder in fester Reihenfolge und endet mit Zeilenumbruch', () => {
    const text = resultJson(
      result(true, [
        { severity: 'warning', code: 'link.outside', notePath: 'a.md' },
        { severity: 'info', code: 'output.size', args: [1] },
        { severity: 'warning', code: 'recipe.unknown-key', recipePath: 'sectons' },
      ]),
      'exports/bericht.html',
      T,
    );
    expect(text).toBe(
      '{"ok":true,"path":"exports/bericht.html","errors":0,"warnings":2,"infos":1,"findings":['
      + '{"severity":"warning","code":"recipe.unknown-key","message":"Tippfehler","recipePath":"sectons"},'
      + '{"severity":"warning","code":"link.outside","message":"Link außerhalb","notePath":"a.md"},'
      + '{"severity":"info","code":"output.size","message":"1 KB"}]}\n',
    );
  });

  it('ist bei zweimaligem Aufruf und bei umgeordneter Eingabe byte-gleich', () => {
    const a: Finding = { severity: 'warning', code: 'x', notePath: 'a.md' };
    const b: Finding = { severity: 'error', code: 'y' };
    const c: Finding = { severity: 'info', code: 'z', notePath: 'b.md' };
    const first = resultJson(result(false, [a, b, c]), null, T);
    expect(resultJson(result(false, [a, b, c]), null, T)).toBe(first);
    expect(resultJson(result(false, [c, a, b]), null, T)).toBe(first);
    expect(resultJson(result(false, [b, c, a]), null, T)).toBe(first);
  });

  it('setzt path auf null, wenn der Lauf nicht ok ist, auch bei übergebenem Pfad', () => {
    const text = resultJson(result(false, [{ severity: 'error', code: 'recipe.invalid' }]), 'alt/bericht.html', T);
    expect(JSON.parse(text)).toMatchObject({ ok: false, path: null, errors: 1 });
  });

  it('meldet ok:false, wenn trotz ok-Flag ein Fehlerbefund vorliegt', () => {
    const r = result(true, [{ severity: 'error', code: 'final.forbidden' }]);
    expect(exportOk(r)).toBe(false);
    expect(JSON.parse(resultJson(r, 'x.html', T))).toMatchObject({ ok: false, path: null });
  });

  it('lässt fehlende Notiz- und Anleitungspfade weg und maskiert Anführungszeichen als JSON', () => {
    const text = resultJson(result(true, [{ severity: 'info', code: 'k', args: ['zweite Zeile'] }]), 'b.html', T);
    const parsed = JSON.parse(text) as { findings: Array<Record<string, string>> };
    expect(parsed.findings[0]).toEqual({ severity: 'info', code: 'k', message: 'sagt "hallo"\nzweite Zeile' });
    expect(text.split('\n')).toHaveLength(2);
  });

  it('ohne Befunde: leere Liste', () => {
    expect(resultJson(result(true, []), 'b.html', T)).toBe('{"ok":true,"path":"b.html","errors":0,"warnings":0,"infos":0,"findings":[]}\n');
  });
});

describe('Sprache der Sätze (entschieden 2026-11-24: die der Oberfläche, Code bleibt der Vertrag)', () => {
  const findings: Finding[] = [
    { severity: 'warning', code: 'link.outside', args: ['Outside/Camp rules'], notePath: 'a.md' },
    { severity: 'info', code: 'set.empty', variant: 'folder', args: ['Ordner'] },
  ];

  it('dieselben Codes, Pfade und Schweregrade in EN und DE, nur der Satz folgt der Sprache', () => {
    const en = JSON.parse(resultJson(result(true, findings), 'b.html', tableTranslate(EN))) as { findings: Array<Record<string, string>> };
    const de = JSON.parse(resultJson(result(true, findings), 'b.html', tableTranslate(DE))) as { findings: Array<Record<string, string>> };
    const strip = (list: Array<Record<string, string>>): unknown[] => list.map(({ message: _m, ...rest }) => rest);
    expect(strip(en.findings)).toEqual(strip(de.findings));
    expect(en.findings.map((f) => f.message)).toEqual(['The link to “Outside/Camp rules” leads out of the set and stays as text.', 'The folder “Ordner” contains no notes.']);
    expect(de.findings.map((f) => f.message)).toEqual(['Der Link auf „Outside/Camp rules“ führt aus der Menge hinaus und steht als Text.', 'Der Ordner „Ordner“ enthält keine Notiz']);
  });

  it('toResultFinding trägt Pfade nur, wo der Befund sie hat', () => {
    expect(toResultFinding({ severity: 'info', code: 'set.excluded' }, tableTranslate(EN))).toEqual({ severity: 'info', code: 'set.excluded', message: EN['finding.set.excluded'] });
  });
});
