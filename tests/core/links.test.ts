// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { structure } from '../../src/core/structure';
import { CODES } from '../../src/core/finding-codes';
import { FOLDER, group, makeSet, note, noExtras, recipe, resolver, tree } from './structure-helpers';

const entry = note(`${FOLDER}/e.md`, 'Einstieg');
const ziel = note(`${FOLDER}/themen/ziel.md`, 'Ziel', 1);
const zwei = note(`${FOLDER}/themen/zwei.md`, 'Zwei', 1);
const set = makeSet(entry, [group(`${FOLDER}/themen`, 'Themen', [ziel, zwei])]);
const table = { 'themen/ziel': ziel.path, 'themen/zwei': zwei.path, 'Ziel': ziel.path, 'Außen': `${FOLDER}/../außen.md`, 'e': entry.path };

function run(html: string, over: { host?: string; extraRoots?: Record<string, string>; resolve?: ReturnType<typeof resolver> } = {}) {
  const res = over.resolve ?? resolver(table);
  const roots = new Map<string, HTMLElement>([
    [entry.path, tree(over.host === undefined ? html : '<p>Einstieg</p>')],
    [ziel.path, tree(over.host === undefined ? '<p>ziel</p>' : html)],
    [zwei.path, tree('<p>zwei</p>')],
  ]);
  for (const [path, body] of Object.entries(over.extraRoots ?? {})) roots.set(path, tree(body));
  const out = structure(set, roots, recipe(), res.resolve, noExtras, FOLDER);
  return { out, res };
}

const a = (href: string, text: string, extra = '') => `<a class="internal-link" data-href="${href}" href="${href}" target="_blank" rel="noopener" ${extra}>${text}</a>`;

describe('Links in der Menge', () => {
  it('Ziel in der Menge wird ein Sprung zur Marke der Notiz; target und data-href fallen', () => {
    const { out } = run(`<p>${a('themen/ziel', 'zum Ziel')}</p>`);
    const link = out.body.querySelector('section a')!;
    expect(link.getAttribute('href')).toBe('#themen-ziel');
    expect(link.hasAttribute('target')).toBe(false);
    expect(link.hasAttribute('data-href')).toBe(false);
    expect(out.findings).toEqual([]);
  });

  it('kein target bleibt irgendwo im Ergebnis, auch nicht an Links nach außen', () => {
    const { out } = run(`<p>${a('themen/ziel', 'x')} <a href="https://example.org" target="_blank">e</a> ${a('Außen', 'y')}</p>`);
    expect(out.body.querySelectorAll('[target]')).toHaveLength(0);
  });

  it('der Auflöser bekommt den geschriebenen Linktext prozentdekodiert und den Pfad der Notiz, in der der Link steht', () => {
    const res = resolver({ 'themen/ziel': ziel.path });
    run(`<p>${a('themen/ziel%20x#Teil', 'x')}</p>`, { resolve: res });
    expect(res.calls).toContainEqual(['themen/ziel x', entry.path]);
    const r2 = resolver({});
    run(`<p>${a('e', 'x')}</p>`, { host: 'ziel', resolve: r2 });
    expect(r2.calls).toContainEqual(['e', ziel.path]);
  });

  it('Link in einer Einbettung wird mit dem Pfad der eingebetteten Notiz aufgelöst', () => {
    const res = resolver({ zwei: zwei.path, rel: ziel.path });
    const html = `<p>vor</p><span class="internal-embed markdown-embed is-loaded" src="zwei#Abschnitt"><div class="markdown-embed-content"><p>${a('rel', 'weiter')}</p></div></span><p>${a('rel', 'draußen')}</p>`;
    const { out } = run(html, { host: 'ziel', resolve: res });
    expect(res.calls).toContainEqual(['zwei', ziel.path]);
    expect(res.calls).toContainEqual(['rel', zwei.path]);
    expect(res.calls).toContainEqual(['rel', ziel.path]);
    expect(out.findings).toEqual([]);
  });

  it('verschachtelte Einbettung: jede Ebene löst gegen die eigene Notiz auf', () => {
    const res = resolver({ zwei: zwei.path, e: entry.path, tief: ziel.path });
    const inner = `<span class="internal-embed" src="e"><p>${a('tief', 'innen')}</p></span>`;
    const html = `<span class="internal-embed" src="zwei"><p>${a('tief', 'mitte')}</p>${inner}</span>`;
    run(html, { host: 'ziel', resolve: res });
    expect(res.calls).toContainEqual(['tief', zwei.path]);
    expect(res.calls).toContainEqual(['tief', entry.path]);
  });

  it('ein Link auf die eigene Überschrift ([[#Überschrift]]) wird gegen die Quellnotiz aufgelöst', () => {
    const { out } = run(`<h2 id="themen-ziel--teil">Teil</h2><p>${a('#Teil', 'oben')}</p>`, { host: 'ziel' });
    const link = out.body.querySelector('details[data-ht-note] a')!;
    expect(link.getAttribute('href')).toBe('#themen-ziel--teil');
  });
});

describe('Links außerhalb und ungelöst', () => {
  it('Ziel außerhalb der Menge wird Text „Titel (pfad)“ und warning link.outside', () => {
    const { out } = run(`<p>${a('Außen', 'Titel')}</p>`);
    const span = out.body.querySelector('section span.ht-link-text')!;
    expect(span.textContent).toBe('Titel (Außen)');
    expect(out.body.querySelector('section a')).toBeNull();
    expect(out.findings).toEqual([expect.objectContaining({ severity: 'warning', code: CODES.linkOutside, notePath: entry.path })]);
  });

  it('steht im Linktext schon das Ziel, kommt es nicht noch einmal in Klammern', () => {
    const { out } = run(`<p>${a('Außen', 'Außen')}</p>`);
    expect(out.body.querySelector('span.ht-link-text')!.textContent).toBe('Außen');
  });

  it('ungelöster Link wird Text und warning link.unresolved', () => {
    const { out } = run(`<p>${a('Gibt es nicht', 'Hinweis')}</p>`);
    expect(out.body.querySelector('section span.ht-link-text')!.textContent).toBe('Hinweis (Gibt es nicht)');
    expect(out.findings).toEqual([expect.objectContaining({ severity: 'warning', code: CODES.linkUnresolved })]);
  });

  it('derselbe Befund steht in einer Notiz nur einmal', () => {
    const { out } = run(`<p>${a('Außen', 'a')} ${a('Außen', 'b')}</p>`);
    expect(out.findings).toHaveLength(1);
  });
});

describe('Überschrift und Block', () => {
  const heads = '<h2 data-heading="Erster Teil">Erster Teil</h2><p>x</p>';   // wie Obsidian zeichnet: ohne id, die setzt der DOM-Läufer

  it('[[Note#Überschrift]] springt zur Marke der Überschrift (gesetzt im gezeichneten Baum)', () => {
    const { out } = run(`<p>${a('Ziel#erster teil', 'dahin')}</p>`, { extraRoots: { [ziel.path]: heads } });
    expect(out.body.querySelector('section a')!.getAttribute('href')).toBe('#themen-ziel--erster-teil');
    expect(out.findings).toEqual([]);
  });

  it('eine Überschrift, die es nicht gibt, springt zur Notiz und steht als info link.heading-missing', () => {
    const { out } = run(`<p>${a('Ziel#Nirgends', 'dahin')}</p>`, { extraRoots: { [ziel.path]: heads } });
    expect(out.body.querySelector('section a')!.getAttribute('href')).toBe('#themen-ziel');
    expect(out.findings).toEqual([expect.objectContaining({ severity: 'info', code: CODES.linkHeadingMissing })]);
  });

  it('Überschriften einer Einbettung zählen nicht als Überschriften der Notiz', () => {
    const emb = '<span class="internal-embed markdown-embed is-loaded" src="x"><div class="markdown-embed-content"><div class="markdown-preview-view"><h2 data-heading="Fremd">Fremd</h2></div></div></span>';
    const { out } = run(`<p>${a('Ziel#Fremd', 'dahin')}</p>`, { extraRoots: { [ziel.path]: emb } });
    expect(out.body.querySelector('section a')!.getAttribute('href')).toBe('#themen-ziel');
  });

  it('[[Note#^block]] wird ein Sprung zur Notiz und ein info link.block', () => {
    const { out } = run(`<p>${a('Ziel#^abc123', 'Block')}</p>`);
    expect(out.body.querySelector('section a')!.getAttribute('href')).toBe('#themen-ziel');
    expect(out.findings).toEqual([expect.objectContaining({ severity: 'info', code: CODES.linkBlock })]);
  });

  it('[[#^block]] in der eigenen Notiz springt zur Notiz', () => {
    const { out } = run(`<p>${a('#^abc', 'hier')}</p>`, { host: 'ziel' });
    expect(out.body.querySelector('details[data-ht-note] a')!.getAttribute('href')).toBe('#themen-ziel');
    expect(out.findings.map((f) => f.code)).toEqual([CODES.linkBlock]);
  });
});

describe('Schemata und Tags', () => {
  it('http, https und mailto bleiben, mit rel="noopener"', () => {
    const { out } = run('<p><a href="http://a.example">a</a> <a href="https://b.example">b</a> <a href="mailto:x@y.example">m</a></p>');
    const links = Array.from(out.body.querySelectorAll('section a'));
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['http://a.example', 'https://b.example', 'mailto:x@y.example']);
    for (const l of links) expect(l.getAttribute('rel')).toContain('noopener');
    expect(out.findings).toEqual([]);
  });

  it('file: und obsidian: werden Text, mit info link.scheme', () => {
    const { out } = run('<p><a href="file:///x/y">Datei</a> <a href="obsidian://open?vault=v">App</a></p>');
    expect(out.body.querySelector('section a')).toBeNull();
    const text = Array.from(out.body.querySelectorAll('section span.ht-link-text')).map((s) => s.textContent);
    expect(text).toEqual(['Datei (file:///x/y)', 'App (obsidian://open?vault=v)']);
    expect(out.findings.map((f) => [f.severity, f.code])).toEqual([['info', CODES.linkScheme], ['info', CODES.linkScheme]]);
  });

  it('Tags werden span.ht-tag, keine Links', () => {
    const { out } = run('<p><a href="#beispiel" class="tag" target="_blank" rel="noopener nofollow">#beispiel</a></p>');
    const tag = out.body.querySelector('section span.ht-tag')!;
    expect(tag.textContent).toBe('#beispiel');
    expect(out.body.querySelector('section a')).toBeNull();
  });
});

describe('Titel einer Notiz als Sprungziel', () => {
  it('[[Note#Titel]] springt zur Marke der Notiz, weil der Titel als Überschrift der Zusammenfassung dort steht', () => {
    const { out } = run(`<p>${a('Ziel#Ziel', 'Titel')}</p>`, { extraRoots: { [ziel.path]: '<h1>Ziel</h1><p>x</p>' } });
    expect(out.body.querySelector('section a')!.getAttribute('href')).toBe('#themen-ziel');
    expect(out.findings).toEqual([]);
  });
});
