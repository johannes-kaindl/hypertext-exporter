// Vault → Eingabe für src/core/set.ts (Bauplan Task 5, Spec 10.1): die Notizen der Menge mit Frontmatter (typisiert, aus dem metadataCache), Körper und aufgelösten Links.
// Liest nur; schreibt nichts. Die Auswahl hier ist grob (Ordner, Quellen, gewählter Einstieg), die Menge im Einzelnen entscheidet `buildSet`.
import type { App, TFile } from 'obsidian';
import { resolveSourcePaths } from '../core/set';
import type { ExportScope, NoteInput, Recipe } from '../core/types';
import { isInFolder } from '../vendor/kit/folder-scope';
import { locateFrontmatter } from '../vendor/kit/frontmatter';
import { compareCodePoints } from '../vendor/kit/name-order';

/** Die Dateien, die zur Menge gehören können: der Ordner samt Unterordnern, die Ordner der Quellen und der gewählte Einstieg (auch wenn er außerhalb liegt). Bei einer Einzelnotiz nur diese. */
function candidates(app: App, scope: ExportScope, recipe: Recipe): TFile[] {
  const files = app.vault.getMarkdownFiles();
  const entry = scope.entryPath.normalize('NFC');
  const isEntry = (f: TFile): boolean => scope.entryPath !== '' && f.path.normalize('NFC') === entry;
  let chosen: TFile[];
  if (scope.kind === 'note') chosen = files.filter(isEntry);
  else {
    // Quellen sind relativ zur Einstiegsnotiz; ohne gewählte Einstiegsnotiz gilt der Ordner (die Bauanleitung steht dann in einer Notiz dieses Ordners).
    const base = scope.entryPath !== '' ? scope.entryPath : scope.folder === '' ? 'x.md' : `${scope.folder}/x.md`;
    const sources = resolveSourcePaths(base, recipe.sources).folders;
    chosen = files.filter((f) => isEntry(f) || isInFolder(f.path, scope.folder, { root: true }) || sources.some((s) => isInFolder(f.path, s.folder, { root: true })));
  }
  return chosen.sort((a, b) => compareCodePoints(a.path.normalize('NFC'), b.path.normalize('NFC')));
}

export async function collectInputs(app: App, scope: ExportScope, recipe: Recipe): Promise<NoteInput[]> {
  const out: NoteInput[] = [];
  for (const file of candidates(app, scope, recipe)) {
    const cache = app.metadataCache.getFileCache(file);
    const text = await app.vault.cachedRead(file);
    // Der Körper beginnt hinter dem Frontmatter-Block; nur so (nie über die Position im Cache), damit Vorschau und Export denselben Text lesen.
    const body = text.slice(locateFrontmatter(text)?.bodyFrom ?? 0);
    const links: string[] = [];
    for (const link of cache?.links ?? []) {
      const linkpath = link.link.split('#')[0] ?? '';
      if (linkpath === '') continue;
      const target = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
      if (target !== null) links.push(target.path);
    }
    out.push({ path: file.path, frontmatter: { ...(cache?.frontmatter ?? {}) }, body, links });
  }
  return out;
}
