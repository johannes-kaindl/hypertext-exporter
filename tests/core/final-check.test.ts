// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { finalCheck, finalGuard } from '../../src/core/final-check';
import { buildPage, pageScript } from '../../src/core/page';
import { guardExportTree } from '../../src/vendor/kit/export-guard';
import { textOf } from './text-of';

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
    for (const finding of f) expect(textOf(finding)).not.toContain('Mein Vault');
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

  describe('Schreibweisen, die der Browser gleich liest (Sicherheits-Review Etappe 10, Befund 5)', () => {
    it.each([
      ['Großschreibung APP://', '<img src="APP://abc/x.png">'],
      ['gemischt Capacitor://', '<img src="Capacitor://localhost/_capacitor_file_/x">'],
      ['FILE://', '<a href="FILE:///etc/passwd">x</a>'],
      ['app:%2F%2F', '<img src="app:%2F%2Fabc/x.png">'],
      ['Prozent klein app:%2f%2f', '<img src="app:%2f%2fabc/x.png">'],
      ['app:&#47;&#47;', '<img src="app:&#47;&#47;abc/x.png">'],
      ['app:&#x2f;&#x2F;', '<img src="app:&#x2f;&#x2F;abc/x.png">'],
      ['Entity ohne Semikolon app:&#47&#47', '<img src="app:&#47&#47abc/x.png">'],
      ['app:&sol;&sol;', '<img src="app:&sol;&sol;abc/x.png">'],
      ['app&colon;//', '<img src="app&colon;//abc/x.png">'],
      ['&#97;pp://', '<img src="&#97;pp://abc">'],
      ['Tab im Schema app:/&Tab;/', '<a href="app:/&Tab;/abc">x</a>'],
      ['Zeilenumbruch im Schema ap&NewLine;p://', '<a href="ap&NewLine;p://abc">x</a>'],
      ['file:/ mit einem Schrägstrich', '<a href="file:/etc/passwd">x</a>'],
      ['file:\\ Windows', '<a href="file:\\\\C:\\x">x</a>'],
      ['Entität und Prozent zusammen app&colon;%2F%2F', '<img src="app&colon;%2F%2Fabc">'],
    ])('meldet %s als error final.forbidden', (_name, html) => {
      expect(codes(html)).toEqual(['error:final.forbidden']);
    });

    it('meldet den Basispfad maskiert (&amp; im Serialisat)', () => {
      const base = USERS + 'x/A&B Vault';
      expect(codes(`<img alt="${USERS}x/A&amp;B Vault/x.png">`, base)).toContain('error:final.forbidden');
      expect(codes(`<img alt="${USERS}x/A&#38;B Vault/x.png">`, base)).toContain('error:final.forbidden');
    });

    it('meldet den Basispfad in NFC und in NFD, gleich in welcher Form die Seite ihn trägt', () => {
      const nfc = (USERS + 'x/Ünterlagen').normalize('NFC');
      const nfd = nfc.normalize('NFD');
      expect(nfc).not.toBe(nfd);
      expect(codes(`<p>${nfd}</p>`, nfc)).toContain('error:final.forbidden');
      expect(codes(`<p>${nfc}</p>`, nfd)).toContain('error:final.forbidden');
      expect(codes(`<a href="${encodeURI(nfd)}">x</a>`, nfc)).toContain('error:final.forbidden');
    });

    it('meldet den Basispfad ohne Rücksicht auf Groß und Klein (Dateisysteme am Mac)', () => {
      expect(codes(`<p>${BASE.toUpperCase()}</p>`, BASE)).toContain('error:final.forbidden');
    });

    it('meldet den Basispfad mit Entities und Prozent dazwischen', () => {
      expect(codes(`<p>${BASE.replace(/\//g, '&#47;')}</p>`, BASE)).toContain('error:final.forbidden');
      expect(codes(`<p>${BASE.replace(/\//g, '%2f')}</p>`, BASE)).toContain('error:final.forbidden');
    });

    it('Gegenprobe: harmlose Wörter, https:// und ein Pfad mit Prozent geben keinen Befund', () => {
      expect(codes('<p>Happ und Whatsapp, Profil, file und capacitor</p>', BASE)).toEqual([]);
      expect(codes('<a href="https://example.org/app/x">x</a><a href="http://example.org/file">y</a>', BASE)).toEqual([]);
      expect(codes('<a href="https://example.org/?q=a%2Fb&amp;c=%C3%A4">x</a>', BASE)).toEqual([]);
      expect(codes('<p>app: nicht ganz, app:/ kein Adresse, 100% sicher, &amp; &lt;b&gt;</p>', BASE)).toEqual([]);
      expect(codes('<p>app:%ZZ//x und %E0%A4%A</p>', BASE)).toEqual([]);
    });

    it('der Text einer Notiz darf /Users/ als Warnung behalten, auch neben kodierten Schreibweisen', () => {
      expect(codes(`<p>siehe ${USERS}max/x</p>`)).toEqual(['warning:final.user-path']);
      expect(codes(`<p>siehe ${USERS}max/x &amp; app&#58;//x</p>`)).toEqual(['error:final.forbidden', 'warning:final.user-path']);
    });
  });

  it('meldet eine doppelte id als error mark.duplicate und einen toten Sprung als error mark.missing-target (Prüffunktion aus dem Kit, Bestellung 6)', () => {
    const page = document.createElement('div');
    page.innerHTML = '<h2 id="a">A</h2><h2 id="a">A2</h2><p><a href="#a">gut</a> <a href="#weg">tot</a></p>';
    const out = finalCheck('<p>sauber</p>', page, null);
    expect(out.map((f) => `${f.severity}:${f.code}`)).toEqual(['error:mark.duplicate', 'error:mark.missing-target']);
    expect(textOf(out[0])).toContain('a');
    expect(textOf(out[1])).toContain('#weg');
  });

  it('meldet bei eindeutigen Marken und lebenden Sprüngen nichts', () => {
    const page = document.createElement('div');
    page.innerHTML = '<main id="inhalt"><h2 id="a">A</h2><a href="#a">a</a><a href="#inhalt">i</a><a href="https://x.example/#y">aus</a></main>';
    expect(finalCheck('<p>sauber</p>', page, null)).toEqual([]);
  });
});

describe('finalGuard (zweiter Schutzdurchgang auf dem neu gelesenen Text der Seite)', () => {
  const MXSS = '<math><mtext><table><mglyph><style><img src=x onerror="document.title=1">';
  const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

  /** Die Nutzlast des Reviews, wie der erste Durchgang sie sieht: ein Baum aus dem Zeichner, danach der Text der Seite. */
  function serializedPage(payload: string): { firstPass: number; html: string } {
    const doc = parse(`<!doctype html><body><div id="r">${payload}</div>`);
    const root = doc.getElementById('r') as HTMLElement;
    const firstPass = guardExportTree(root).length;
    return { firstPass, html: `<!doctype html><html><body><nav></nav><main id="inhalt">${root.innerHTML}</main></body></html>` };
  }

  it('seit code-kit 0.89.0 liest der erste Durchgang den Baum noch einmal: die Nutzlast ist gemeldet, die Seite trägt kein Ereignis-Attribut', () => {
    const { firstPass, html } = serializedPage(MXSS);
    expect(firstPass).toBeGreaterThan(0);
    expect(parse(html).querySelectorAll('[onerror]').length).toBe(0);
  });

  it('meldet einen Text der Seite, den erst das Lesen zu einem Ereignis-Attribut macht, als error final.guard (zweite Linie, auch wenn der erste Durchgang sie nicht kannte)', () => {
    // Die Nutzlast ungeschützt in den Text der Seite: so sähe sie ein Plugin mit einem älteren Kit.
    const html = `<!doctype html><html><body><nav></nav><main id="inhalt">${MXSS}</main></body></html>`;
    expect(parse(html).querySelectorAll('[onerror]').length).toBe(0);
    const out = finalGuard(parse(html));
    expect(out.map((f) => `${f.severity}:${f.code}`)).toEqual(['error:final.guard']);
    expect(textOf(out[0])).toContain('#tree');
  });

  it('meldet, was ein Baum mit gelesenem Ereignis-Attribut trägt, als error final.guard (und nennt Element und Attribut)', () => {
    const out = finalGuard(parse('<!doctype html><body><main id="inhalt"><img src="x" onerror="document.title=1"></main></body>'));
    expect(out.map((f) => `${f.severity}:${f.code}`)).toEqual(['error:final.guard']);
    expect(textOf(out[0])).toContain('img[onerror]');
  });

  it('meldet eine saubere Seite nicht (Gegenprobe), auch nicht mit Bild, Tabelle, Inline-SVG und eigenem Stil im Kopf', () => {
    const html =
      '<!doctype html><html><head><style>a::after { content: " (" attr(href) ")"; }</style></head><body><nav><a href="#inhalt">x</a></nav>' +
      '<main id="inhalt"><p><img src="data:image/png;base64,AAAA" alt=""></p><table><tr><td>1</td></tr></table>' +
      '<svg width="5" height="5" viewBox="0 0 5 5"><rect width="5" height="5"></rect></svg><a href="https://example.org/">x</a></main></body></html>';
    expect(finalGuard(parse(html))).toEqual([]);
  });

  it('lässt ein eingebettetes SVG-Bild stehen, das checkSvg besteht, und meldet eines mit Skript', () => {
    const b64 = (svg: string): string => btoa(svg);
    const good = '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5" viewBox="0 0 5 5"><rect width="5" height="5"/></svg>';
    const bad = '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"><script>1</script></svg>';
    const page = (svg: string): Document => parse(`<!doctype html><body><main><img alt="" src="data:image/svg+xml;base64,${b64(svg)}"></main></body>`);
    expect(finalGuard(page(good))).toEqual([]);
    const out = finalGuard(page(bad));
    expect(out.map((f) => f.code)).toEqual(['final.guard']);
    expect(textOf(out[0])).toContain('img[src]');
    // als Link- oder Rahmenziel ist data:image/svg+xml weiter ein Befund
    expect(finalGuard(parse(`<!doctype html><body><a href="data:image/svg+xml;base64,${b64(good)}">x</a></body>`))).toHaveLength(1);
  });

  it('fasst viele Stellen zu einem Befund zusammen', () => {
    const html = '<!doctype html><body><main>' + '<a href="javascript:1" onclick="x()">a</a>'.repeat(30) + '</main></body>';
    const out = finalGuard(parse(html));
    expect(out).toHaveLength(1);
    expect(out[0]?.code).toBe('final.guard');
    expect(textOf(out[0])).toContain('×30');
  });
});

describe('die fertige Seite mit Werkzeug-Block und Skript (Etappe 7)', () => {
  function body(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  }
  function pageOf(html: string, lang: 'en' | 'de' = 'de'): { text: string; doc: HTMLElement } {
    const text = buildPage({ title: 'T', lang, toc: [{ anchor: 'a', title: 'A' }], body: body(html), css: 'body{margin:0}', mathCss: '', stamp: '' });
    return { text, doc: new DOMParser().parseFromString(text, 'text/html').documentElement };
  }

  it('besteht Endprüfung und Schutzdurchgang ohne Befund: Werkzeug-Block (Eingabefeld, Schaltflächen) und das eigene Skript sind kein fremder aktiver Inhalt', () => {
    const { text, doc } = pageOf('<h1 id="a">Titel</h1><details data-ht-note="a" open><summary>A</summary><p>Text</p></details>');
    expect(finalCheck(text, doc, null)).toEqual([]);
    expect(finalGuard(doc, pageScript('de'))).toEqual([]);
  });

  it('meldet ein fremdes Skript im Inhalt, auch wenn die Seite ein eigenes trägt (Gegenprobe: ohne ownScript meldet der Durchgang das eigene)', () => {
    const { doc } = pageOf('<p>x</p><script>alert(1)</script>');
    const found = finalGuard(doc, pageScript('de'));
    expect(found.map((f) => f.code)).toEqual(['final.guard']);
    expect(textOf(found[0])).toContain('script');
    const own = pageOf('<p>x</p>');
    expect(finalGuard(own.doc).map((f) => f.code)).toEqual(['final.guard']);
  });

  it.each(['suche', 'werkzeug', 'werkzeug--auf'])('Clobbering: ein id="%s" aus dem Notiztext ist als doppelte Marke ein error mark.duplicate, der Export schreibt nichts', (id) => {
    const { text, doc } = pageOf(`<p id="${id}">fremd</p>`);
    const found = finalCheck(text, doc, null).filter((f) => f.code === 'mark.duplicate');
    expect(found.map((f) => f.severity)).toEqual(['error']);
    expect(textOf(found[0])).toContain(`“${id}”`);
  });

  it('Clobbering: ein Element mit name="suche" oder name="getElementById" ändert den Werkzeug-Block nicht (das Skript liest nichts vom Dokument ab)', () => {
    const { text, doc } = pageOf('<img name="getElementById"><form name="querySelector"><input name="addEventListener"></form>');
    expect(finalCheck(text, doc, null).filter((f) => f.code === 'mark.duplicate')).toEqual([]);
    expect(pageScript('de')).toContain('DP.getElementById');
    expect(pageScript('de')).not.toMatch(/document\.(getElementById|querySelector)/);
  });
});
