import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { collectInputs } from '../../src/obsidian/collect';
import { DEFAULT_RECIPE } from '../../src/core/recipe';
import type { Recipe } from '../../src/core/types';

interface FakeFile { path: string; text: string; frontmatter?: Record<string, unknown>; links?: string[] }

/** Ein Vault aus Dateien; `links` sind Linktexte, aufgelöst wird nach Dateiname ohne `.md`. */
function fakeApp(files: FakeFile[]): App {
  const tfiles = files.map((f) => ({ path: f.path }));
  const byFile = new Map(tfiles.map((t, i) => [t, files[i] as FakeFile]));
  return {
    vault: {
      getMarkdownFiles: () => [...tfiles].reverse(),
      cachedRead: (t: { path: string }) => Promise.resolve(byFile.get(t as never)?.text ?? ''),
    },
    metadataCache: {
      getFileCache: (t: { path: string }) => {
        const f = byFile.get(t as never);
        return f === undefined ? null : { frontmatter: f.frontmatter, links: (f.links ?? []).map((link) => ({ link, original: `[[${link}]]`, displayText: link })) };
      },
      getFirstLinkpathDest: (linkpath: string) => tfiles.find((t) => t.path.replace(/\.md$/, '').endsWith(linkpath)) ?? null,
    },
  } as unknown as App;
}

const FILES: FakeFile[] = [
  { path: 'p/p.md', text: '---\ntitle: P\n---\nKörper\n[[b]] [[a#Kopf]] [[#nur-Kopf]] [[fehlt]] [[a]]\n', frontmatter: { title: 'P' }, links: ['b', 'a#Kopf', '#nur-Kopf', 'fehlt', 'a'] },
  { path: 'p/u/a.md', text: 'Ohne Frontmatter\n' },
  { path: 'p/u/b.md', text: '---\n---\nLeerer Block\n', frontmatter: undefined },
  { path: 'q/x.md', text: 'draußen\n' },
  { path: 'runs/eins/r.md', text: 'Quelle\n' },
  { path: 'runs/zwei/s.md', text: 'andere Quelle\n' },
];

describe('collectInputs', () => {
  it('liest den Ordner samt Unterordnern in fester Ordnung, mit Frontmatter, Körper ab bodyFrom und aufgelösten Links in Textreihenfolge', async () => {
    const out = await collectInputs(fakeApp(FILES), { kind: 'folder', folder: 'p', entryPath: '' }, DEFAULT_RECIPE);
    expect(out.map((n) => n.path)).toEqual(['p/p.md', 'p/u/a.md', 'p/u/b.md']);
    expect(out[0]).toEqual({
      path: 'p/p.md',
      frontmatter: { title: 'P' },
      body: 'Körper\n[[b]] [[a#Kopf]] [[#nur-Kopf]] [[fehlt]] [[a]]\n',
      links: ['p/u/b.md', 'p/u/a.md', 'p/u/a.md'],
    });
    expect(out[1]).toMatchObject({ frontmatter: {}, body: 'Ohne Frontmatter\n', links: [] });
    expect(out[2]?.body).toBe('Leerer Block\n');
  });

  it('nimmt die Ordner der Quellen (relativ zur Einstiegsnotiz) und einen Einstieg außerhalb des Ordners mit', async () => {
    const recipe: Recipe = { ...DEFAULT_RECIPE, sources: [{ path: '../runs/eins', key: 'eins' }] };
    const out = await collectInputs(fakeApp(FILES), { kind: 'folder', folder: 'p', entryPath: 'q/x.md' }, recipe);
    expect(out.map((n) => n.path)).toEqual(['p/p.md', 'p/u/a.md', 'p/u/b.md', 'q/x.md', 'runs/eins/r.md']);
  });

  it('ohne gewählten Einstieg gelten Quellen relativ zum Ordner', async () => {
    const out = await collectInputs(fakeApp(FILES), { kind: 'folder', folder: 'p', entryPath: '' }, { ...DEFAULT_RECIPE, sources: [{ path: '../runs/zwei', key: 'zwei' }] });
    expect(out.map((n) => n.path)).toContain('runs/zwei/s.md');
    expect(out.map((n) => n.path)).not.toContain('runs/eins/r.md');
  });

  it('eine Einzelnotiz ergibt genau diese Notiz', async () => {
    const out = await collectInputs(fakeApp(FILES), { kind: 'note', entryPath: 'p/u/a.md' }, DEFAULT_RECIPE);
    expect(out.map((n) => n.path)).toEqual(['p/u/a.md']);
  });

  it('der Wurzelordner nimmt alles; eine fehlende Einzelnotiz ergibt nichts', async () => {
    expect(await collectInputs(fakeApp(FILES), { kind: 'folder', folder: '', entryPath: '' }, DEFAULT_RECIPE)).toHaveLength(FILES.length);
    expect(await collectInputs(fakeApp(FILES), { kind: 'note', entryPath: 'nope.md' }, DEFAULT_RECIPE)).toEqual([]);
  });
});
