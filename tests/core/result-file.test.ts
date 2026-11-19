import { describe, expect, it } from 'vitest';
import { exportOk, resultJson } from '../../src/core/result-file';
import type { ExportResult, Finding } from '../../src/core/types';

const stats = { notes: 3, bytes: 100, mediaBytes: {} };
const result = (ok: boolean, findings: Finding[]): ExportResult => ({ ok, fileName: 'bericht.html', findings, stats });

describe('resultJson', () => {
  it('schreibt Schlüssel und Befund-Felder in fester Reihenfolge und endet mit Zeilenumbruch', () => {
    const text = resultJson(
      result(true, [
        { severity: 'warning', code: 'link.outside', message: 'Link außerhalb', notePath: 'a.md' },
        { severity: 'info', code: 'output.size', message: '1 KB' },
        { severity: 'warning', code: 'recipe.unknown-key', message: 'Tippfehler', recipePath: 'sectons' },
      ]),
      'exports/bericht.html',
    );
    expect(text).toBe(
      '{"ok":true,"path":"exports/bericht.html","errors":0,"warnings":2,"infos":1,"findings":['
      + '{"severity":"warning","code":"recipe.unknown-key","message":"Tippfehler","recipePath":"sectons"},'
      + '{"severity":"warning","code":"link.outside","message":"Link außerhalb","notePath":"a.md"},'
      + '{"severity":"info","code":"output.size","message":"1 KB"}]}\n',
    );
  });

  it('ist bei zweimaligem Aufruf und bei umgeordneter Eingabe byte-gleich', () => {
    const a: Finding = { severity: 'warning', code: 'x', message: 'm', notePath: 'a.md' };
    const b: Finding = { severity: 'error', code: 'y', message: 'n' };
    const c: Finding = { severity: 'info', code: 'z', message: 'o', notePath: 'b.md' };
    const first = resultJson(result(false, [a, b, c]), null);
    expect(resultJson(result(false, [a, b, c]), null)).toBe(first);
    expect(resultJson(result(false, [c, a, b]), null)).toBe(first);
    expect(resultJson(result(false, [b, c, a]), null)).toBe(first);
  });

  it('setzt path auf null, wenn der Lauf nicht ok ist, auch bei übergebenem Pfad', () => {
    const text = resultJson(result(false, [{ severity: 'error', code: 'recipe.invalid', message: 'kaputt' }]), 'alt/bericht.html');
    expect(JSON.parse(text)).toMatchObject({ ok: false, path: null, errors: 1 });
  });

  it('meldet ok:false, wenn trotz ok-Flag ein Fehlerbefund vorliegt', () => {
    const r = result(true, [{ severity: 'error', code: 'final.forbidden', message: 'app://' }]);
    expect(exportOk(r)).toBe(false);
    expect(JSON.parse(resultJson(r, 'x.html'))).toMatchObject({ ok: false, path: null });
  });

  it('lässt fehlende Notiz- und Anleitungspfade weg und maskiert Anführungszeichen als JSON', () => {
    const text = resultJson(result(true, [{ severity: 'info', code: 'k', message: 'sagt "hallo"\nzweite Zeile' }]), 'b.html');
    const parsed = JSON.parse(text) as { findings: Array<Record<string, string>> };
    expect(parsed.findings[0]).toEqual({ severity: 'info', code: 'k', message: 'sagt "hallo"\nzweite Zeile' });
    expect(text.split('\n')).toHaveLength(2);
  });

  it('ohne Befunde: leere Liste', () => {
    expect(resultJson(result(true, []), 'b.html')).toBe('{"ok":true,"path":"b.html","errors":0,"warnings":0,"infos":0,"findings":[]}\n');
  });
});
