// @vitest-environment jsdom
import type { App } from 'obsidian';
import { beforeAll, describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { DEFAULT_RECIPE } from '../../src/core/recipe';
import type { RunControl, SetNote } from '../../src/core/types';
import { renderNote, translateFreezeFinding, type RenderDeps } from '../../src/obsidian/render';
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

describe('translateFreezeFinding', () => {
  it('canvas-failed: Präfix freeze., Warnung, notePath', () => {
    const f = translateFreezeFinding({ kind: 'canvas-failed', reason: 'SecurityError' }, note.path);
    expect(f).toMatchObject({ severity: 'warning', code: 'freeze.canvas-failed', notePath: note.path });
    expect(f.message).toContain('SecurityError');
  });
  it('canvas-blank: Präfix freeze., Maße im Text', () => {
    const f = translateFreezeFinding({ kind: 'canvas-blank', width: 300, height: 150 }, note.path);
    expect(f).toMatchObject({ severity: 'warning', code: 'freeze.canvas-blank', notePath: note.path });
    expect(f.message).toContain('300');
  });
  it('empty-block: freeze.empty-block, Art und Klassen im Text', () => {
    const f = translateFreezeFinding({ kind: 'empty-block', what: 'plugin-block', hint: 'block-language-dataview' }, note.path);
    expect(f).toMatchObject({ severity: 'warning', code: CODES.freezeEmptyBlock, notePath: note.path });
    expect(f.message).toContain('block-language-dataview');
  });
  it('alle Codes tragen das Präfix freeze.', () => {
    const kinds = [
      translateFreezeFinding({ kind: 'canvas-failed', reason: '' }, 'p'),
      translateFreezeFinding({ kind: 'canvas-blank', width: 1, height: 1 }, 'p'),
      translateFreezeFinding({ kind: 'empty-block', what: 'code', hint: '' }, 'p'),
    ];
    expect(kinds.every((f) => f.code.startsWith('freeze.'))).toBe(true);
  });
});

describe('renderNote: Einfrieren', () => {
  it('entfernt den Kopierknopf, sperrt Kontrollkästchen und meldet einen leeren Plugin-Block mit notePath', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<pre><code>a</code><button class="copy-code-button">Copy</button></pre>'
      + '<input type="checkbox" class="task-list-item-checkbox">'
      + '<div class="block-language-dataview"></div>';
    const out = await renderNote(app, note, DEFAULT_RECIPE, run, drawInto(host));
    expect(out.root.querySelector('.copy-code-button')).toBeNull();
    expect(out.root.querySelector('input')?.hasAttribute('disabled')).toBe(true);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ severity: 'warning', code: CODES.freezeEmptyBlock, notePath: note.path });
    expect(out.root.querySelector('.block-language-dataview')).not.toBeNull();
  });

  it('meldet eine Einbettung ohne Ziel nicht ein zweites Mal als leeren Block', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<span class="internal-embed mod-empty" src="weg"></span><span class="internal-embed markdown-embed" src="da"></span>';
    const out = await renderNote(app, note, DEFAULT_RECIPE, run, drawInto(host));
    // Die leere Einbettung mit Ziel bleibt ein Befund, die ohne Ziel gehört dem Zeichner.
    expect(out.findings.map((f) => f.code)).toEqual([CODES.freezeEmptyBlock]);
    expect(out.findings[0]?.message).toContain('markdown-embed');
  });

  it('friert am angehängten Baum ein: der Canvas hängt noch am Dokument, wenn er gelesen wird; ein Fehlschlag steht als freeze.canvas-failed da', async () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    let attachedWhenRead: boolean | null = null;
    canvas.toDataURL = (): string => { attachedWhenRead = canvas.isConnected; throw new Error('tainted'); };
    const out = await renderNote(app, note, DEFAULT_RECIPE, run, drawInto(host));
    expect(attachedWhenRead).toBe(true);
    expect(out.findings.map((f) => f.code)).toEqual(['freeze.canvas-failed']);
    expect(out.findings[0]?.notePath).toBe(note.path);
    expect(out.root.querySelector('canvas')).toBeNull();
  });
});
