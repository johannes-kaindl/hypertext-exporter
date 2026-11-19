// Gemeinsame Bausteine der Tests zu Task 12 (Ablauf): ein Vault im Speicher mit den Dateien des Beispielordners, ein Zeichner, der Markdown in einfaches HTML wandelt,
// und eine Fake-Platte für die Ausgabe. Der echte Zeichner (Obsidian) ist nicht verfügbar; die Marken, Sprünge und die Seite kommen aus dem echten Ablauf.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { App } from 'obsidian';
import { DEFAULT_SETTINGS } from '../../src/obsidian/settings';
import type { PipelineDeps, PipelineHost } from '../../src/obsidian/pipeline';
import type { RunControl } from '../../src/core/types';
import { parseFrontmatter } from '../../src/vendor/kit/frontmatter';
import type { withRenderedNote } from '../../src/vendor/kit-obsidian/render-note';
import { appOf, makeDisk, type FakeDisk } from './fake-adapter';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');

/** Alle Markdown-Dateien eines Ordners unter dem Vault-Pfad `prefix`. */
function walk(dir: string, prefix: string, out: Record<string, string>): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, `${prefix}/${name}`, out);
    else if (name.endsWith('.md')) out[`${prefix}/${name}`] = readFileSync(full, 'utf8');
  }
}

/** Der Vault der Tests: der Beispielordner unter `beispiel/` und die Notiz außerhalb unter `ausserhalb/`. */
export function fixtureVault(): Record<string, string> {
  const out: Record<string, string> = {};
  walk(join(FIXTURES, 'beispiel'), 'beispiel', out);
  walk(join(FIXTURES, 'ausserhalb'), 'ausserhalb', out);
  return out;
}

/** Die Bauanleitung der Einstiegsnotiz, wie Obsidian sie aus dem Frontmatter liest (typisiert); entspricht dem Block in `tests/fixtures/beispiel/beispiel.md`. */
export const BEISPIEL_HYPERTEXT = {
  version: 1,
  lang: 'de',
  title: 'Beispiel für den Hypertext-Export',
  sections: [
    {
      folder: 'kapitel',
      title: 'Kapitel',
      order: 'name',
      overview: ['status', 'aufwand', { header: 'Stand', template: '{status} (Aufwand {aufwand})' }],
      summary_line: ['status'],
    },
    { ordner: 'anhang', titel: 'Anhang', reihenfolge: 'mention', zusatzzeile: ['status'], offen: true },
    { folder: 'leer', title: 'Leerer Ordner' },
  ],
  fold: { headings_from: 2 },
};

function typed(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  return out;
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

function normalize(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

export interface FakeVault {
  files: Record<string, string>;
  disk: FakeDisk;
  app: App;
  /** Wie oft der Zeichner gerufen wurde, mit dem Pfad der Notiz. */
  drawn: string[];
}

interface TFileLike { path: string; extension: string; basename: string; name: string }

/** Ein Vault im Speicher: Markdown-Dateien in `files` (und die `.md` der Platte), alles andere nur auf der Platte. `frontmatter` ersetzt das gelesene Frontmatter einer Notiz (nested). */
export function makeVault(files: Record<string, string>, frontmatter: Record<string, Record<string, unknown>> = {}, disk: FakeDisk = makeDisk()): FakeVault {
  const textOf = (path: string): string | undefined => files[path] ?? (disk.files.has(path) ? new TextDecoder().decode(disk.files.get(path)) : undefined);
  const mdPaths = (): string[] => [...new Set([...Object.keys(files), ...disk.files.keys()])].filter((p) => p.endsWith('.md')).sort();
  const tfile = (path: string): TFileLike => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    return { path, extension: 'md', name, basename: name.replace(/\.md$/, '') };
  };
  const cacheOf = (path: string): Record<string, unknown> | null => {
    const text = textOf(path);
    if (text === undefined) return null;
    const body = parseFrontmatter(text).body;
    const links = [...body.replace(/!\[\[[^\]]*\]\]/g, '').matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => ({ link: m[1] ?? '' }));
    const headings = [...body.matchAll(/^#{1,6} (.+)$/gm)].map((m) => ({ heading: m[1] ?? '' }));
    const blocks: Record<string, unknown> = {};
    for (const m of body.matchAll(/\^([A-Za-z0-9-]+)\s*$/gm)) blocks[(m[1] ?? '').toLowerCase()] = {};
    return { frontmatter: { ...typed(parseFrontmatter(text).data), ...(frontmatter[path] ?? {}) }, links, headings, blocks };
  };
  const dest = (link: string, from: string): TFileLike | null => {
    const candidates = [`${normalize(`${dirOf(from)}/${link}`)}`, normalize(link)];
    for (const c of candidates) {
      for (const p of [c, `${c}.md`]) if (textOf(p) !== undefined && p.endsWith('.md')) return tfile(p);
    }
    // Wie Obsidian bei „kürzester Pfad“: ein Pfadende genügt.
    const tail = normalize(link);
    const hit = mdPaths().find((p) => p === `${tail}.md` || p.endsWith(`/${tail}.md`) || p.endsWith(`/${tail}`));
    return hit === undefined ? null : tfile(hit);
  };
  const drawn: string[] = [];
  const base = appOf(disk) as unknown as { vault: Record<string, unknown> };
  const app = {
    ...base,
    vault: {
      ...base.vault,
      getMarkdownFiles: () => mdPaths().map(tfile),
      cachedRead: (f: TFileLike) => Promise.resolve(textOf(f.path) ?? ''),
      getFileByPath: (p: string) => (textOf(p) === undefined ? null : tfile(p)),
    },
    metadataCache: {
      getFileCache: (f: TFileLike) => cacheOf(f.path),
      getCache: (p: string) => cacheOf(p),
      getFirstLinkpathDest: dest,
    },
  } as unknown as App;
  return { files, disk, app, drawn };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Ein einfaches Markdown: Überschriften, Absätze, Links, Einbettungen, Bilder. Nicht Obsidians Zeichner, aber genug für den Ablauf. */
export function miniRender(vault: FakeVault): (markdown: string) => string {
  const inline = (text: string): string =>
    esc(text)
      .replace(/!\[\[([^\]]+)\]\]/g, (_m, target: string) => embedHtml(target))
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => `<img alt="${alt}" src="${src}">`)
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias: string | undefined) => `<a class="internal-link" data-href="${target}" href="${target}">${alias ?? target}</a>`)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => `<a href="${href}" data-href="${href}">${label}</a>`);
  const embedHtml = (target: string): string => {
    const [name = '', section = ''] = target.split('#');
    const found = Object.keys(vault.files).find((p) => p.endsWith(`/${name}.md`) || p === `${name}.md`);
    if (name.endsWith('.mp3')) return `<span class="internal-embed" src="${target}"><audio src="app://local/${name}"></audio></span>`;
    if (name.endsWith('.mp4')) return `<span class="internal-embed" src="${target}"><video src="app://local/${name}"></video></span>`;
    if (found === undefined) return `<span class="internal-embed" src="${target}"><img alt="${name}" src="app://local/${name}"></span>`;
    const body = parseFrontmatter(vault.files[found] ?? '').body;
    let part = body;
    if (section !== '') {
      const lines = body.split('\n');
      const start = lines.findIndex((l) => l.replace(/^#+ /, '') === section);
      const rest = start < 0 ? [] : lines.slice(start);
      const end = rest.findIndex((l, i) => i > 0 && /^#{1,6} /.test(l));
      part = (end < 0 ? rest : rest.slice(0, end)).join('\n');
    }
    return `<span class="internal-embed markdown-embed" src="${target}">${render(part)}</span>`;
  };
  const render = (markdown: string): string => {
    const out: string[] = [];
    let para: string[] = [];
    const flush = (): void => {
      // Ein Absatz, der nur eine Einbettung trägt, steht ohne <p> (Obsidian setzt sie als Block).
      const alone = para.length === 1 && /^!\[\[[^\]]+\]\]$/.test(para[0] ?? '');
      if (para.length > 0) out.push(alone ? inline(para[0] ?? '') : `<p>${inline(para.join(' '))}</p>`);
      para = [];
    };
    for (const line of markdown.split('\n')) {
      const h = /^(#{1,6}) (.+)$/.exec(line);
      if (h !== null) {
        flush();
        out.push(`<h${h[1]?.length ?? 1}>${inline(h[2] ?? '')}</h${h[1]?.length ?? 1}>`);
      } else if (line.trim() === '') flush();
      else para.push(line.trim());
    }
    flush();
    return out.join('\n');
  };
  return render;
}

/** Ersatz für `withRenderedNote`: wandelt das Markdown und ruft `use` mit dem Wirt. */
export function fakeDraw(vault: FakeVault): typeof withRenderedNote {
  const render = miniRender(vault);
  const draw = async <T>(opts: { markdown: string; sourcePath: string }, use: (n: { root: HTMLElement; findings: never[] }) => T | Promise<T>): Promise<T> => {
    vault.drawn.push(opts.sourcePath);
    const host = document.createElement('div');
    host.innerHTML = render(opts.markdown);
    document.body.appendChild(host);
    try { return await use({ root: host, findings: [] }); } finally { host.remove(); }
  };
  return draw as unknown as typeof withRenderedNote;
}

/** Medien-Ports: lokale Bilder kommen aus `tests/fixtures/beispiel/medien/`, was es dort nicht gibt, scheitert; das Netz liefert nie etwas. */
export const NO_MEDIA = {
  fetchLocal: (src: string) => {
    const name = decodeURIComponent(src.slice(src.lastIndexOf('/') + 1));
    try {
      const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'beispiel', 'medien', name)));
      return Promise.resolve({ ok: true, bytes, contentType: name.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
    } catch {
      return Promise.reject(new Error(`Fake: ${name} fehlt`));
    }
  },
  fetchRemote: () => Promise.reject(new Error('Fake: kein Netz')),
};

export function hostOf(vault: FakeVault, settings: Partial<PipelineHost['settings']> = {}): PipelineHost {
  return { app: vault.app, settings: { ...DEFAULT_SETTINGS, ...settings }, manifest: { version: '0.1.0' } };
}

export function depsOf(vault: FakeVault, over: PipelineDeps = {}): PipelineDeps {
  return {
    render: { draw: fakeDraw(vault) },
    media: NO_MEDIA,
    visibility: { visibilityState: 'visible' },
    mathStyles: () => [],
    obsidianVersion: '1.15.1',
    obsidianLang: 'en',
    basePath: '/vault-basis-fuer-tests',
    ...over,
  };
}

export interface FakeRun extends RunControl {
  progressCalls: Array<[number, number, string]>;
  pauses: number;
}

/** `abortAt`: der Abbruch gilt ab dem Fortschrittsaufruf mit `done === abortAt`. */
export function fakeRun(abortAt: number | null = null): FakeRun {
  let aborted = false;
  const run: FakeRun = {
    progressCalls: [],
    pauses: 0,
    get aborted() { return aborted; },
    pause: () => { run.pauses++; return Promise.resolve(); },
    progress: (done, total, label) => {
      run.progressCalls.push([done, total, label]);
      if (abortAt !== null && done === abortAt) aborted = true;
    },
  };
  return run;
}
