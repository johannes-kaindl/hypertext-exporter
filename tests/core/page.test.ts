// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPage, type PageInput } from '../../src/core/page';
import { sha256Base64Utf8 } from '../../src/vendor/kit/sha256';

function makeBody(html = '<h1 id="a--x">Titel</h1><p>Text</p>'): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

function input(overrides: Partial<PageInput> = {}): PageInput {
  return {
    title: 'Beispiel & <Test>',
    lang: 'de',
    toc: [
      { anchor: 'a', title: 'Erste' },
      { anchor: 'b', title: 'Zweite <b>' },
    ],
    body: makeBody(),
    css: 'body{margin:0}\n.x::before{content:"<"}',
    mathCss: '.mjx{color:red}',
    stamp: '<meta name="ht-plugin-version" content="0.1.0">\n<meta name="ht-theme" content="default">',
    ...overrides,
  };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('buildPage', () => {
  it('setzt lang, viewport und title (maskiert) aus der Eingabe', () => {
    const html = buildPage(input());
    const doc = parse(html);
    expect(doc.documentElement.getAttribute('lang')).toBe('de');
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe('width=device-width, initial-scale=1');
    expect(doc.title).toBe('Beispiel & <Test>');
    expect(html).toContain('<title>Beispiel &amp; &lt;Test&gt;</title>');
    expect(buildPage(input({ lang: 'en' }))).toContain('<html lang="en">');
  });

  it('schreibt genau ein style-Element, Grundgestaltung/Thema vor den MathJax-Stilen', () => {
    const html = buildPage(input());
    expect(html.match(/<style>/g)).toHaveLength(1);
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(style.indexOf('body{margin:0}')).toBeGreaterThanOrEqual(0);
    expect(style.indexOf('.mjx{color:red}')).toBeGreaterThan(style.indexOf('body{margin:0}'));
  });

  it('ohne mathCss steht kein loser Trenner im style-Element', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(buildPage(input({ mathCss: '' })))?.[1] ?? '';
    expect(style).toBe('body{margin:0}\n.x::before{content:"\\3C "}');
  });

  it('trägt in der CSP die SHA-256 des ausgegebenen style-Inhalts, script-src none', () => {
    const html = buildPage(input());
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    const csp = parse(html).querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
    expect(csp).toContain(`style-src 'sha256-${sha256Base64Utf8(style)}'`);
    expect(csp).toContain("script-src 'none'");
    expect(html).not.toContain('<script');
  });

  it('setzt den Sprunglink auf #inhalt aus der festen Tabelle je lang', () => {
    const de = parse(buildPage(input()));
    const skip = de.querySelector('nav a.ht-skip');
    expect(skip?.getAttribute('href')).toBe('#inhalt');
    expect(skip?.textContent).toBe('Zum Inhalt');
    const en = parse(buildPage(input({ lang: 'en' })));
    expect(en.querySelector('nav a.ht-skip')?.textContent).toBe('Skip to content');
  });

  it('listet toc in der Navigation, Inhalt steht in main#inhalt', () => {
    const doc = parse(buildPage(input()));
    const links = Array.from(doc.querySelectorAll('nav ul li a')).map((a) => [a.getAttribute('href'), a.textContent]);
    expect(links).toEqual([['#a', 'Erste'], ['#b', 'Zweite <b>']]);
    expect(doc.querySelectorAll('nav')).toHaveLength(1);
    const main = doc.querySelector('main#inhalt');
    expect(main?.querySelector('h1#a--x')?.textContent).toBe('Titel');
    expect(doc.querySelector('nav')?.contains(main ?? null)).toBe(false);
  });

  it('lässt bei leerem toc die Liste weg, der Sprunglink bleibt', () => {
    const doc = parse(buildPage(input({ toc: [] })));
    expect(doc.querySelector('nav ul')).toBeNull();
    expect(doc.querySelector('nav a.ht-skip')).not.toBeNull();
  });

  it('setzt den Stempel in den Kopf, ohne das style-Element zu berühren', () => {
    const html = buildPage(input());
    const doc = parse(html);
    expect(doc.head.querySelector('meta[name="ht-plugin-version"]')?.getAttribute('content')).toBe('0.1.0');
    expect(doc.head.querySelector('meta[name="ht-theme"]')).not.toBeNull();
    expect(buildPage(input({ stamp: '' }))).not.toContain('ht-plugin-version');
  });

  it('schreibt nur \\n als Zeilenende', () => {
    const html = buildPage(input({ css: 'a{}\r\nb{}\rc{}', body: makeBody('<pre>x\r\ny</pre>') }));
    expect(html).not.toContain('\r');
    expect(html.endsWith('\n')).toBe(true);
  });

  it('liefert bei zwei Aufrufen byte-gleiche Seiten', () => {
    expect(buildPage(input())).toBe(buildPage(input()));
  });

  it('gibt jedem pre tabindex 0, auch bei vorhandenem, und lässt die Eingabe unverändert', () => {
    const body = makeBody('<pre>a</pre><pre tabindex="-1">b</pre><div><pre class="x"><code>c</code></pre></div>');
    const before = body.innerHTML;
    const pres = Array.from(parse(buildPage(input({ body }))).querySelectorAll('main pre'));
    expect(pres).toHaveLength(3);
    for (const pre of pres) expect(pre.getAttribute('tabindex')).toBe('0');
    expect(body.innerHTML).toBe(before);
  });

  it('setzt jede Tabelle einer Notiz in einen Behälter div.ht-table mit tabindex 0, eine schon umschlossene nicht doppelt (Erwartung 25)', () => {
    const body = makeBody('<details><table><tr><td>a</td></tr></table></details><div class="ht-table" tabindex="0"><table><tr><td>b</td></tr></table></div>');
    const before = body.innerHTML;
    const doc = parse(buildPage(input({ body })));
    const tables = Array.from(doc.querySelectorAll('main table'));
    expect(tables).toHaveLength(2);
    for (const t of tables) {
      expect(t.parentElement?.matches('div.ht-table[tabindex="0"]')).toBe(true);
      expect(t.parentElement?.parentElement?.closest('.ht-table')).toBeNull();
    }
    expect(body.innerHTML).toBe(before);
  });
});
