import type { App, TFile } from 'obsidian';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerI18n } from '../../src/i18n/strings';
import { hasRecipeBlock, insertRecipe, insertRecipeCheck } from '../../src/obsidian/insert-recipe';
import { setLang } from '../../src/vendor/kit/i18n';
import { Notice } from '../mocks/obsidian';

beforeEach(() => {
  registerI18n();
  setLang('en');
  Notice.messages.length = 0;
});

interface Probe { app: App; file: TFile; text: () => string; processed: () => number; reads: () => number }

/** App mit einer Datei `Projekt/start.md` und ein paar Notizen im Vault. `appearsLater` ist ein Block, der zwischen Lesen und Schreiben dazukommt. */
function probe(initial: string, appearsLater?: string): Probe {
  let text = initial;
  let processed = 0;
  let reads = 0;
  const file = { path: 'Projekt/start.md', name: 'start.md', extension: 'md', parent: { path: 'Projekt' } } as unknown as TFile;
  const paths = ['Projekt/start.md', 'Projekt/b/x.md', 'Projekt/a/y.md', 'Projekt/Ä/z.md', 'Andere/q.md'];
  const app = {
    vault: {
      read: () => { reads += 1; return Promise.resolve(text); },
      process: (_f: TFile, fn: (d: string) => string) => {
        processed += 1;
        if (appearsLater !== undefined) text = appearsLater;
        text = fn(text);
        return Promise.resolve(text);
      },
      getMarkdownFiles: () => paths.map((path) => ({ path, extension: 'md' })),
    },
    workspace: { getActiveFile: () => file },
  } as unknown as App;
  return { app, file, text: () => text, processed: () => processed, reads: () => reads };
}

const yes = () => Promise.resolve(true);
const no = () => Promise.resolve(false);
const BLOCK = '  version: 1\n  lang: de\n  sections:\n    - folder: a\n    - folder: b\n    - folder: Ä';

describe('hasRecipeBlock', () => {
  it('erkennt den Schlüssel in der obersten Ebene, nicht einen eingerückten oder im Text', () => {
    expect(hasRecipeBlock('---\ntitle: A\nhypertext:\n  version: 1\n---\n')).toBe(true);
    expect(hasRecipeBlock('---\ntitle: A\nandere:\n  hypertext: 1\n---\n')).toBe(false);
    expect(hasRecipeBlock('---\ntitle: A\n---\nhypertext:\n')).toBe(false);
    expect(hasRecipeBlock('kein Frontmatter')).toBe(false);
  });
});

describe('insertRecipe', () => {
  const fm = '---\ntitle:   Mein Titel\ntags: [x,   y]\n# ein Kommentar\naliases:\n  - eins\n---\nText\n\n---\nnoch Text\n';

  it('hängt den Block ans Ende des Frontmatters; jede andere Zeile bleibt byte-gleich', async () => {
    const p = probe(fm);
    expect(await insertRecipe(p.app, p.file, 'de', { confirm: yes })).toBe('inserted');
    expect(p.text()).toBe(fm.replace('aliases:\n  - eins\n---\n', `aliases:\n  - eins\nhypertext:\n${BLOCK}\n---\n`));
    expect(Notice.messages).toEqual(['Export recipe inserted into start.md.']);
  });

  it('eine Notiz ohne Frontmatter bekommt einen Block, der Text bleibt', async () => {
    const p = probe('Nur Text\n');
    expect(await insertRecipe(p.app, p.file, 'fr', { confirm: yes })).toBe('inserted');
    expect(p.text()).toBe(`---\nhypertext:\n${BLOCK.replace('lang: de', 'lang: en')}\n---\nNur Text\n`);
  });

  it('CRLF bleibt CRLF', async () => {
    const p = probe('---\r\ntitle: A\r\n---\r\nText\r\n');
    await insertRecipe(p.app, p.file, 'en', { confirm: yes });
    expect(p.text()).toBe(`---\r\ntitle: A\r\nhypertext:\r\n${BLOCK.replace('lang: de', 'lang: en').replace(/\n/g, '\r\n')}\r\n---\r\nText\r\n`);
  });

  it('ist schon ein hypertext-Block da: Meldung, kein Dialog, kein Schreiben', async () => {
    const text = '---\ntitle: A\nhypertext:\n  version: 1\n---\n';
    const p = probe(text);
    let asked = 0;
    expect(await insertRecipe(p.app, p.file, 'de', { confirm: () => { asked += 1; return Promise.resolve(true); } })).toBe('exists');
    expect(asked).toBe(0);
    expect(p.processed()).toBe(0);
    expect(p.text()).toBe(text);
    expect(Notice.messages).toEqual(['This note already has a hypertext block. Nothing was changed.']);
  });

  it('bei Abbruch im Dialog wird nichts geschrieben', async () => {
    const p = probe(fm);
    expect(await insertRecipe(p.app, p.file, 'de', { confirm: no })).toBe('cancelled');
    expect(p.processed()).toBe(0);
    expect(p.text()).toBe(fm);
  });

  it('ein Block, der zwischen Lesen und Schreiben dazukommt, wird nicht überschrieben', async () => {
    const later = '---\nhypertext:\n  version: 1\n  title: Mein\n---\n';
    const p = probe(fm, later);
    expect(await insertRecipe(p.app, p.file, 'de', { confirm: yes })).toBe('exists');
    expect(p.text()).toBe(later);
  });

  it('ein Frontmatter, das das Kit nicht sicher erweitert, bleibt unverändert und meldet failed', async () => {
    const bad = '﻿---\ntitle: A\n---\nText\n';
    const p = probe(bad);
    expect(await insertRecipe(p.app, p.file, 'de', { confirm: yes })).toBe('failed');
    expect(p.text()).toBe(bad);
    expect(Notice.messages[0]).toContain('could not be inserted');
  });
});

describe('insertRecipeCheck', () => {
  it('gilt nur für die aktive Markdown-Notiz; Prüfen schreibt und fragt nichts', () => {
    const p = probe('Text');
    const check = insertRecipeCheck(p.app, () => 'de');
    expect(check(true)).toBe(true);
    expect(p.reads()).toBe(0);
    const canvas = { ...p.app, workspace: { getActiveFile: () => ({ extension: 'canvas' }) } } as unknown as App;
    expect(insertRecipeCheck(canvas, () => 'de')(true)).toBe(false);
    const none = { ...p.app, workspace: { getActiveFile: () => null } } as unknown as App;
    expect(insertRecipeCheck(none, () => 'de')(true)).toBe(false);
  });
});
