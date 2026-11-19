// @vitest-environment jsdom
import type { App } from 'obsidian';
import { beforeAll, describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { DEFAULT_RECIPE } from '../../src/core/recipe';
import type { Recipe, SetNote } from '../../src/core/types';
import { embedMedia } from '../../src/obsidian/media';
import type { ImageAnswer, InlineImagesPorts } from '../../src/vendor/kit-obsidian/inline-images';
import { installObsidianDom } from './dom-polyfill';

beforeAll(installObsidianDom);

const app = {} as App;
const note: SetNote = { path: 'beispiel/anhang/bilder.md', title: 'Bilder', frontmatter: {}, body: '', depth: 0 };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GOOD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#2563eb"/></svg>';
const BAD_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Ports aus einer Tabelle; was fehlt, antwortet mit 404, `boom` wirft. */
function portsFrom(table: Record<string, ImageAnswer | 'boom'>): InlineImagesPorts & { calls: string[] } {
  const calls: string[] = [];
  const answer = (src: string): Promise<ImageAnswer> => {
    calls.push(src);
    const hit = table[src];
    if (hit === 'boom') return Promise.reject(new Error('Netz weg'));
    return Promise.resolve(hit ?? { ok: false, bytes: new Uint8Array(0), contentType: '' });
  };
  return { fetchLocal: answer, fetchRemote: answer, calls };
}

function root(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

const embedImg = (file: string, src: string): string =>
  `<span class="internal-embed image-embed" src="${file}" alt="${file}"><img src="${src}"></span>`;

describe('embedMedia', () => {
  it('bettet ein Vault-Bild als data: ein und zählt die Bytes je MIME-Typ', async () => {
    const r = root(embedImg('medien/bild.png', 'app://abc/Users/jay/Vault/medien/bild.png?1'));
    const ports = portsFrom({ 'app://abc/Users/jay/Vault/medien/bild.png?1': { ok: true, bytes: PNG, contentType: 'image/png' } });
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, ports);
    const img = r.querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(out.findings).toEqual([]);
    expect(out.mediaBytes).toEqual({ 'image/png': PNG.length });
  });

  it('zählt die Bytes je Art getrennt (PNG, JPEG, SVG)', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    const r = root(
      embedImg('a.png', 'app://x/a.png') + embedImg('b.png', 'app://x/b.png') + embedImg('c.jpg', 'app://x/c.jpg') + embedImg('d.svg', 'app://x/d.svg'),
    );
    const ports = portsFrom({
      'app://x/a.png': { ok: true, bytes: PNG, contentType: 'image/png' },
      'app://x/b.png': { ok: true, bytes: PNG, contentType: 'image/png' },
      'app://x/c.jpg': { ok: true, bytes: jpeg, contentType: 'image/jpeg' },
      'app://x/d.svg': { ok: true, bytes: enc(GOOD_SVG), contentType: 'image/svg+xml' },
    });
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, ports);
    expect(out.findings).toEqual([]);
    expect(out.mediaBytes['image/png']).toBe(PNG.length * 2);
    expect(out.mediaBytes['image/jpeg']).toBe(jpeg.length);
    const svgImg = r.querySelectorAll('img')[3];
    const svgBytes = out.mediaBytes['image/svg+xml'] ?? 0;
    expect(svgBytes).toBeGreaterThan(0);
    const b64 = svgImg?.getAttribute('src')?.split(',')[1] ?? '';
    expect(atob(b64)).toContain('<rect');
    expect(atob(b64).length).toBe(svgBytes);
  });

  it('ersetzt ein fehlgeschlagenes Bild durch einen Hinweis mit Dateiname, ohne app://', async () => {
    const r = root(embedImg('medien/fehlt.png', 'app://abc/Users/jay/Vault/medien/fehlt.png'));
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, portsFrom({}));
    const miss = r.querySelector('.ht-media-missing');
    expect(miss?.textContent).toContain('fehlt.png');
    expect(r.querySelector('img')).toBeNull();
    expect(r.innerHTML).not.toContain('app://');
    expect(r.innerHTML).not.toContain('/Users/');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ severity: 'warning', code: CODES.mediaNotEmbedded, notePath: note.path });
    expect(out.mediaBytes).toEqual({});
  });

  it('nimmt den Dateinamen aus alt, wenn keine Einbettung umgibt, und nie aus der app://-Adresse', async () => {
    const r = root('<img src="app://abc/Users/jay/geheim/x.png" alt="Skizze"><img src="app://abc/Users/jay/geheim/y.png">');
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, portsFrom({ 'app://abc/Users/jay/geheim/x.png': 'boom' }));
    const texts = Array.from(r.querySelectorAll('.ht-media-missing')).map((e) => e.textContent ?? '');
    expect(texts[0]).toContain('Skizze');
    expect(texts[1]).not.toContain('y.png');
    expect(texts[1]).not.toContain('geheim');
    expect(r.innerHTML).not.toContain('app://');
    expect(out.findings.map((f) => f.code)).toEqual([CODES.mediaNotEmbedded, CODES.mediaNotEmbedded]);
  });

  it('kein app:// im Ergebnis-HTML nach einem Fehlschlag, auch bei Fehler im Port und Frist', async () => {
    const r = root(embedImg('a.png', 'app://h/a.png') + embedImg('b.png', 'app://h/b.png') + embedImg('c.png', 'app://h/c.png'));
    const ports = portsFrom({ 'app://h/a.png': 'boom', 'app://h/b.png': { ok: false, bytes: new Uint8Array(0), contentType: '' } });
    await embedMedia(app, r, note, DEFAULT_RECIPE, ports);
    expect(r.innerHTML).not.toMatch(/app:\/\/|capacitor:\/\/|file:\/\//);
    expect(r.querySelectorAll('.ht-media-missing')).toHaveLength(3);
  });

  it('remote_images skip macht ein https-Bild zum Link mit Hinweis und lädt es nicht', async () => {
    const r = root('<img src="https://example.org/x.png" alt="Fern">');
    const ports = portsFrom({ 'https://example.org/x.png': { ok: true, bytes: PNG, contentType: 'image/png' } });
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, ports);
    expect(ports.calls).toEqual([]);
    expect(r.querySelector('img')).toBeNull();
    const a = r.querySelector('.ht-media-remote a');
    expect(a?.getAttribute('href')).toBe('https://example.org/x.png');
    expect(a?.getAttribute('rel')).toBe('noopener');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ severity: 'info', code: CODES.mediaRemoteSkipped });
    expect(out.mediaBytes).toEqual({});
  });

  it('remote_images embed lädt das Bild aus dem Netz', async () => {
    const r = root('<img src="https://example.org/x.png">');
    const ports = portsFrom({ 'https://example.org/x.png': { ok: true, bytes: PNG, contentType: 'image/png' } });
    const recipe: Recipe = { ...DEFAULT_RECIPE, remoteImages: 'embed' };
    const out = await embedMedia(app, r, note, recipe, ports);
    expect(r.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(out.mediaBytes).toEqual({ 'image/png': PNG.length });
  });

  it('macht video, audio und andere Anhänge zu einem Hinweis mit Dateiname und info media.later', async () => {
    const r = root(
      '<span class="internal-embed media-embed" src="medien/film.mp4"><video src="app://h/film.mp4" controls></video></span>' +
        '<span class="internal-embed media-embed" src="medien/ton.mp3"><audio src="app://h/ton.mp3"></audio></span>' +
        '<span class="internal-embed pdf-embed" src="anlagen/bericht.pdf"></span>',
    );
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, portsFrom({}));
    expect(out.findings.map((f) => f.code)).toEqual([CODES.mediaLater, CODES.mediaLater, CODES.mediaLater]);
    expect(out.findings.every((f) => f.severity === 'info')).toBe(true);
    const texts = Array.from(r.querySelectorAll('.ht-media-later')).map((e) => e.textContent ?? '');
    expect(texts[0]).toContain('film.mp4');
    expect(texts[1]).toContain('ton.mp3');
    expect(texts[2]).toContain('bericht.pdf');
    expect(r.querySelector('video, audio')).toBeNull();
    expect(r.innerHTML).not.toContain('app://');
  });

  it('lässt eingebettete Notizen (markdown-embed) unberührt', async () => {
    const r = root('<div class="internal-embed markdown-embed" src="kapitel/01 Grundlagen.md"><p>Text</p></div>');
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, portsFrom({}));
    expect(r.querySelector('.markdown-embed p')?.textContent).toBe('Text');
    expect(out.findings).toEqual([]);
  });

  it('meldet eine ungelöste Anhang-Einbettung als nicht eingebettet', async () => {
    const r = root('<span class="internal-embed is-unresolved" src="medien/weg.png"></span>');
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, portsFrom({}));
    expect(r.querySelector('.ht-media-missing')?.textContent).toContain('weg.png');
    expect(out.findings[0]).toMatchObject({ severity: 'warning', code: CODES.mediaNotEmbedded });
  });

  it('nimmt ein SVG nach checkSvg als img mit data:image/svg+xml;base64', async () => {
    const r = root(embedImg('medien/bild.svg', 'app://h/bild.svg'));
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, portsFrom({ 'app://h/bild.svg': { ok: true, bytes: enc(GOOD_SVG), contentType: 'image/svg+xml' } }));
    const src = r.querySelector('img')?.getAttribute('src') ?? '';
    expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(out.findings).toEqual([]);
  });

  it('lehnt ein SVG mit Skript ab: Hinweis mit Dateiname, warning media.svg-rejected, kein Markup', async () => {
    const r = root(embedImg('medien/boese.svg', 'app://h/boese.svg'));
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, portsFrom({ 'app://h/boese.svg': { ok: true, bytes: enc(BAD_SVG), contentType: 'image/svg+xml' } }));
    expect(r.querySelector('img')).toBeNull();
    expect(r.querySelector('script')).toBeNull();
    expect(r.querySelector('.ht-media-missing')?.textContent).toContain('boese.svg');
    expect(r.innerHTML).not.toContain('app://');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ severity: 'warning', code: CODES.mediaSvgRejected, notePath: note.path });
    expect(out.mediaBytes).toEqual({});
  });

  it('übergeht ein schon eingebettetes data:-Bild und zählt es nicht', async () => {
    const r = root('<img src="data:image/png;base64,AAAA">');
    const ports = portsFrom({});
    const out = await embedMedia(app, r, note, DEFAULT_RECIPE, ports);
    expect(ports.calls).toEqual([]);
    expect(out.mediaBytes).toEqual({});
    expect(out.findings).toEqual([]);
  });

  it('setzt die Hinweistexte nach lang der Bauanleitung, nicht nach der Umgebung', async () => {
    const r = root(embedImg('medien/fehlt.png', 'app://h/fehlt.png'));
    await embedMedia(app, r, note, { ...DEFAULT_RECIPE, lang: 'de' }, portsFrom({}));
    expect(r.querySelector('.ht-media-missing')?.textContent).toBe('Nicht eingebettet: fehlt.png');
  });
});
