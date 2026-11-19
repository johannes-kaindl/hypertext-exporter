// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { finalCheck } from '../../src/core/final-check';

const PAGE = document.createElement('div');
// Benutzerpfade werden zusammengesetzt, damit kein getrackter Text einen Maintainer-Pfad trägt.
const USERS = '/Us' + 'ers/';
const BASE = USERS + 'x/Mein Vault/Notizen';

function codes(html: string, basePath: string | null = null): string[] {
  return finalCheck(html, PAGE, basePath).map((f) => `${f.severity}:${f.code}`);
}

describe('finalCheck', () => {
  it('meldet eine saubere Seite nicht', () => {
    expect(finalCheck('<p>Alles in Ordnung</p>', PAGE, BASE)).toEqual([]);
    expect(finalCheck('<p>Alles in Ordnung</p>', PAGE, null)).toEqual([]);
  });

  it.each(['app://abc/bild.png', 'capacitor://localhost/x', 'file:///tmp/x.html'])('meldet %s als error final.forbidden', (url) => {
    expect(codes(`<img src="${url}">`)).toEqual(['error:final.forbidden']);
  });

  it('meldet den Basispfad roh als error final.forbidden', () => {
    expect(codes(`<p>${BASE}/a.md</p>`, BASE)).toContain('error:final.forbidden');
  });

  it('meldet den Basispfad prozentkodiert (encodeURI und encodeURIComponent, %2F)', () => {
    expect(codes(`<a href="${encodeURI(BASE)}/a.md">x</a>`, BASE)).toContain('error:final.forbidden');
    expect(codes(`<a href="x?p=${encodeURIComponent(BASE)}">x</a>`, BASE)).toContain('error:final.forbidden');
    expect(encodeURIComponent(BASE)).toContain('%2F');
  });

  it('ohne Basispfad (null oder leer) prüft er ihn nicht', () => {
    expect(codes(`<p>${BASE}</p>`, null).filter((c) => c.startsWith('error'))).toEqual([]);
    expect(codes('<p>x</p>', '')).toEqual([]);
  });

  it('nennt den Basispfad nicht in der Meldung', () => {
    const f = finalCheck(`<p>${BASE}</p>`, PAGE, BASE);
    for (const finding of f) expect(finding.message).not.toContain('Mein Vault');
  });

  it('meldet /Users/, /home/ und C:\\Users als warning final.user-path', () => {
    expect(codes(`<p>siehe ${USERS}max/x</p>`)).toEqual(['warning:final.user-path']);
    expect(codes('<p>siehe /home/max/x</p>')).toEqual(['warning:final.user-path']);
    expect(codes('<p>siehe C:\\Us' + 'ers\\max</p>')).toEqual(['warning:final.user-path']);
  });

  it('meldet je Muster einmal, auch bei mehreren Treffern, in fester Reihenfolge', () => {
    const html = `<p>app://a app://b file://c ${USERS}a ${USERS}b /home/x</p>`;
    expect(codes(html)).toEqual(['error:final.forbidden', 'error:final.forbidden', 'warning:final.user-path', 'warning:final.user-path']);
    expect(codes(html)).toEqual(codes(html));
  });

  it('meldet eine doppelte id als error mark.duplicate und einen toten Sprung als error mark.missing-target (Prüffunktion aus dem Kit, Bestellung 6)', () => {
    const page = document.createElement('div');
    page.innerHTML = '<h2 id="a">A</h2><h2 id="a">A2</h2><p><a href="#a">gut</a> <a href="#weg">tot</a></p>';
    const out = finalCheck('<p>sauber</p>', page, null);
    expect(out.map((f) => `${f.severity}:${f.code}`)).toEqual(['error:mark.duplicate', 'error:mark.missing-target']);
    expect(out[0]?.message).toContain('a');
    expect(out[1]?.message).toContain('#weg');
  });

  it('meldet bei eindeutigen Marken und lebenden Sprüngen nichts', () => {
    const page = document.createElement('div');
    page.innerHTML = '<main id="inhalt"><h2 id="a">A</h2><a href="#a">a</a><a href="#inhalt">i</a><a href="https://x.example/#y">aus</a></main>';
    expect(finalCheck('<p>sauber</p>', page, null)).toEqual([]);
  });
});
