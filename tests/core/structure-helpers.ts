// Gemeinsame Bausteine der Tests zu Task 9 (Marken, Links, Aufklappen): kleine Mengen und gezeichnete Bäume von Hand.
import { DEFAULT_RECIPE } from '../../src/core/recipe';
import type { structure } from '../../src/core/structure';
import type { ExportSet, Recipe, SetGroup, SetNote } from '../../src/core/types';

export const FOLDER = 'F';

export function note(path: string, title: string, depth = 0, extra: Partial<SetNote> = {}): SetNote {
  return { path, title, frontmatter: {}, body: '', depth, ...extra };
}

export function group(key: string, title: string, children: Array<SetNote | SetGroup>, extra: Partial<SetGroup> = {}): SetGroup {
  return { key, title, open: false, overview: [], summaryLine: [], children, ...extra };
}

export function notesOf(nodes: Array<SetNote | SetGroup>): SetNote[] {
  const out: SetNote[] = [];
  for (const n of nodes) {
    if ('children' in n) out.push(...notesOf(n.children));
    else out.push(n);
  }
  return out;
}

export function makeSet(entry: SetNote, nodes: Array<SetNote | SetGroup>, title = 'Seitentitel'): ExportSet {
  return { title, entry, nodes, notesInOrder: [entry, ...notesOf(nodes)] };
}

/** Ein gezeichneter Baum: der Wirt, in den Obsidians Renderer die Blöcke setzt. */
export function tree(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

export function recipe(over: Partial<Recipe> = {}): Recipe {
  return { ...DEFAULT_RECIPE, ...over, fold: { ...DEFAULT_RECIPE.fold, ...(over.fold ?? {}) } };
}

/** Auflöser nach einer Tabelle `geschriebener Linktext → Pfad` (Groß- und Kleinschreibung wie geschrieben); merkt sich die Aufrufe. */
export function resolver(table: Record<string, string>): { resolve: (link: string, from: string) => string | null; calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    resolve: (link, from) => {
      calls.push([link, from]);
      return table[link] ?? null;
    },
  };
}

export const noExtras: Parameters<typeof structure>[4] = { summaryOf: () => null, overviewFor: () => null };
