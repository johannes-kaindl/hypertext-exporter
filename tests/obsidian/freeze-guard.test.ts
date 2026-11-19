// @vitest-environment jsdom
import type { App } from 'obsidian';
import { beforeAll, describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { DEFAULT_RECIPE } from '../../src/core/recipe';
import type { RunControl, SetNote } from '../../src/core/types';
import { renderNote, translateGuardFindings, type RenderDeps } from '../../src/obsidian/render';
import type { ExportGuardFinding } from '../../src/vendor/kit/export-guard';
import type { RenderedNote, RenderNoteOptions } from '../../src/vendor/kit-obsidian/render-note';
import { installObsidianDom } from './dom-polyfill';

beforeAll(installObsidianDom);

const note: SetNote = { path: 'a/bericht.md', title: 'Bericht', frontmatter: {}, body: 'x', depth: 0 };
const run: RunControl = { aborted: false, pause: () => Promise.resolve(), progress: () => {} };
const app = { vault: { getFileByPath: () => null }, metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null } } as unknown as App;

/** Zeichner-Ersatz mit einem am Dokument hängenden Host (wie im Kit). */
function drawInto(host: HTMLElement): RenderDeps {
  document.body.appendChild(host);
  const draw = async <T>(_o: RenderNoteOptions, use: (n: RenderedNote) => T | Promise<T>): Promise<T> => {
    try { return await use({ root: host, findings: [] }); } finally { host.remove(); }
  };
  return { draw: draw as RenderDeps['draw'] };
}

async function render(html: string): ReturnType<typeof renderNote> {
  const host = document.createElement('div');
  host.innerHTML = html;
  return renderNote(app, note, DEFAULT_RECIPE, run, drawInto(host));
}

const guard = (kind: ExportGuardFinding['kind'], element: string, name?: string): ExportGuardFinding => ({ kind, element, ...(name !== undefined ? { name } : {}), detail: 'x' });

describe('translateGuardFindings', () => {
  it('fasst je Art zu einem guard.removed mit Zahl und notePath zusammen', () => {
    const out = translateGuardFindings([
      guard('attribute', 'a', 'onclick'), guard('attribute', 'a', 'onclick'), guard('attribute', 'div', 'onload'),
      guard('element', 'iframe'), guard('declaration', 'p', 'background'),
    ], note.path);
    expect(out.map((f) => f.code)).toEqual([CODES.guardRemoved, CODES.guardRemoved, CODES.guardRemoved]);
    expect(out.every((f) => f.notePath === note.path && f.code.startsWith('guard.'))).toBe(true);
    const attr = out.find((f) => f.message.includes('onclick'));
    expect(attr?.severity).toBe('info');
    expect(attr?.message).toContain('3');
    expect(attr?.message).toContain('onclick an a ×2');
    expect(out.find((f) => f.message.includes('iframe'))?.message).toContain('1');
  });
  it('meldet nichts, wo nichts entfernt wurde', () => {
    expect(translateGuardFindings([], note.path)).toEqual([]);
  });
  it('eine abgelehnte Zeichnung ist eine Warnung, alles andere ein Hinweis', () => {
    const out = translateGuardFindings([guard('svg', 'svg'), guard('comment', '#comment')], note.path);
    expect(out.map((f) => f.severity)).toEqual(['warning', 'info']);
  });
});

describe('renderNote: Schutzdurchgang läuft im Ablauf', () => {
  it('entfernt Ereignis-Attribute, javascript:-Ziele, Rahmen und Skripte und meldet sie je Art mit notePath', async () => {
    const out = await render(
      '<p onclick="x()">a</p>'
      + '<a href="javascript:alert(1)">b</a>'
      + '<a href="https://example.org/">ok</a>'
      + '<iframe src="https://example.org/"></iframe>'
      + '<form action="/x"><input></form>'
      + '<object data="x"></object><embed src="x"><base href="/"><meta http-equiv="refresh" content="0">'
      + '<div style="background:url(https://x/y.png)">c</div>'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="5" height="5"/></svg>',
    );
    const html = out.root.innerHTML;
    expect(html).not.toMatch(/onclick|javascript:|<iframe|<form|<object|<embed|<base|http-equiv|<script|https:\/\/x\//);
    expect(out.root.querySelector('a[href="https://example.org/"]')).not.toBeNull();
    const removed = out.findings.filter((f) => f.code === CODES.guardRemoved);
    expect(removed.length).toBeGreaterThanOrEqual(3);
    expect(removed.every((f) => f.notePath === note.path)).toBe(true);
    expect(removed.map((f) => f.message).join(' ')).toMatch(/iframe/);
  });

  it('lässt ein Bild mit data:, eine harmlose Zeichnung, ein Video und style="color:red" stehen und meldet nichts', async () => {
    const out = await render(
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="">'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>'
      + '<video src="film.mp4"></video>'
      + '<p style="color:red">rot</p>',
    );
    expect(out.root.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/);
    expect(out.root.querySelector('svg rect')).not.toBeNull();
    expect(out.root.querySelector('video')).not.toBeNull();
    expect(out.root.querySelector('p')?.getAttribute('style')).toContain('color');
    expect(out.findings.filter((f) => f.code === CODES.guardRemoved)).toEqual([]);
  });

  it('schützt den losgelösten Baum: der Rückgabebaum trägt nichts Aktives, auch wenn der Host es hatte', async () => {
    const out = await render('<a href="javascript:void(0)" onclick="y()">z</a>');
    expect(out.root.isConnected).toBe(false);
    expect(out.root.querySelector('a')?.attributes.length).toBe(0);
  });
});
