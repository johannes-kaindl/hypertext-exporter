// Menge, Reihenfolge und Einstieg (Bauplan Task 5, Spec 10.1 und 10.3). Rein: Notizen kommen als `NoteInput` herein (src/obsidian/collect.ts liest sie aus dem Vault).
// Was der Kit-Ordnerbaum (`buildFolderTree`) kann, wird gerufen und nicht nachgebaut: Gruppen je Unterordner, Namensordnung (Zahlenpräfix, `0` versteckt, natürliche Ordnung
// nach Codepunkt), Titel aus Feld, erster Überschrift oder Dateiname. Hier steht, was dem Plugin gehört: Einstieg, Ausschluss (Wahrheitstexte), leere Dateien,
// `sections`, `group_by`, `mention`, `sources`. Das Ergebnis hängt nur von der Menge der Notizen ab, nie von der Reihenfolge der Eingabe.
import { foldCase } from '../vendor/kit/fold-case';
import { isInFolder } from '../vendor/kit/folder-scope';
import {
  buildFolderTree,
  flattenFolderTree,
  type FolderTree,
  type FolderTreeFile,
  type FolderTreeNode,
  type FolderTreePage,
  type FolderTreeOptions,
} from '../vendor/kit/folder-tree';
import { buildFmIndex, getField, readField } from '../vendor/kit/frontmatter-field';
import { firstHeadingText } from '../vendor/kit/heading-title';
import { compareCodePoints, compareOrderedNames, parseOrderedName } from '../vendor/kit/name-order';
import { baseName, resolveRelPath, splitFileName } from '../vendor/kit/rel-path';
import { CODES } from './finding-codes';
import { sortFindings } from './findings';
import { orderByMention } from './mention-order';
import type { Column, ExportScope, ExportSet, Finding, FindingArg, NoteInput, OrderRule, Recipe, SectionSpec, SetGroup, SetNode, SetNote, SourceSpec } from './types';

/** Die festen Aliase der drei Felder, denen das Plugin selbst eine Bedeutung gibt (Spec 10.10); ein zugeordneter Name aus `fields` tritt davor. */
const FIXED = { title: ['title', 'titel'], order: ['order', 'reihenfolge'], exclude: ['exclude', 'ausschliessen'] } as const;
const withMapped = (mapped: string | undefined, fixed: readonly string[]): string[] => (mapped === undefined ? [...fixed] : [mapped, ...fixed]);

const TRUE_WORDS = new Set(['true', 'ja', 'yes', '1']);
/** Wahr sind `true`, die Zahl 1 und die Texte `true`, `ja`, `yes`, `1` ohne Groß/Klein; alles andere nicht. */
const isTrueValue = (v: unknown): boolean => v === true || v === 1 || (typeof v === 'string' && TRUE_WORDS.has(foldCase(v.trim())));

/** Die Gruppe für Notizen ohne Wert im Gruppenfeld; sie steht am Ende. */
const NO_VALUE = '—';

const nfc = (path: string): string => path.normalize('NFC');
const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const lastSegment = (path: string): string => baseName(path);

function note(code: string, severity: Finding['severity'], variant: string | undefined, args: readonly FindingArg[], extra: { notePath?: string; recipePath?: string } = {}): Finding {
  return { severity, code, ...(variant !== undefined ? { variant } : {}), args, ...extra };
}

/** Ein Text-, Zahl- oder Wahrheitswert als Gruppenwert; Listen, Objekte und Leeres sind kein Wert. */
function scalarText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() === '' ? undefined : v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return undefined;
}

/** Wie die Quellen der Bauanleitung auf Ordner im Vault fallen: relativ zum Ordner der Einstiegsnotiz, `..` bis zur Vault-Wurzel, darüber `recipe.invalid`. Ein doppelter Schlüssel ist auch `recipe.invalid`; die erste Quelle gilt. */
export function resolveSourcePaths(entryPath: string, sources: SourceSpec[]): { folders: Array<{ key: string; folder: string; title?: string }>; findings: Finding[] } {
  const baseDir = dirOf(entryPath);
  const folders: Array<{ key: string; folder: string; title?: string }> = [];
  const findings: Finding[] = [];
  const keys = new Set<string>();
  sources.forEach((source, i) => {
    const recipePath = `sources[${i}]`;
    const resolved = resolveRelPath(baseDir, source.path);
    if (!resolved.ok) {
      findings.push(note(CODES.recipeInvalid, 'error', 'source-path', [recipePath, source.path, resolved.problem], { recipePath }));
      return;
    }
    if (keys.has(source.key)) {
      findings.push(note(CODES.recipeInvalid, 'error', 'source-key', [recipePath, source.key], { recipePath }));
      return;
    }
    keys.add(source.key);
    folders.push({ key: source.key, folder: resolved.path, ...(source.title !== undefined ? { title: source.title } : {}) });
  });
  return { folders, findings };
}

/** Titel einer Notiz außerhalb des Ordnerbaums (Einstieg, Einzelnotiz, Bereich `note`): Feld, erste Überschrift, Dateiname ohne Zahlenpräfix. Dieselbe Rangfolge wie im Kit-Baum. */
function titleOfNote(n: NoteInput, titleAliases: readonly string[]): string {
  const field = getField(buildFmIndex(n.frontmatter), titleAliases);
  if (typeof field === 'string' && field.trim() !== '') return field.trim();
  return firstHeadingText(n.body) ?? parseOrderedName(splitFileName(lastSegment(n.path)).stem.normalize('NFC')).title;
}

const noteNodes = (nodes: SetNode[]): SetNote[] => nodes.flatMap((n) => ('children' in n ? noteNodes(n.children) : [n]));

interface GroupSpec {
  key: string;
  title: string | undefined;
  open: boolean;
  overview: Column[];
  summaryLine: Column[];
  order: OrderRule;
  groupBy: string[];
  sourceKey?: string;
}

/** Eine Quelle: ihr Baum und ihr Titel, bis ein Bereich oder das Ende der Liste sie in die Seite stellt. */
interface SourceTree { key: string; tree: FolderTree; title: string | undefined; folder: string }

export function buildSet(scope: ExportScope, notes: NoteInput[], recipe: Recipe): { set: ExportSet; findings: Finding[] } {
  const findings: Finding[] = [];
  const titleAliases = withMapped(recipe.fields.title, FIXED.title);
  const orderAliases = withMapped(recipe.fields.order, FIXED.order);
  const excludeAliases = withMapped(recipe.fields.exclude, FIXED.exclude);

  // Eingabe in fester Ordnung (nach Codepunkt), jeder Pfad einmal: nichts hängt von der Reihenfolge der Eingabe ab.
  const byPath = new Map<string, NoteInput>();
  for (const n of [...notes].sort((a, b) => compareCodePoints(nfc(a.path), nfc(b.path)))) {
    if (!byPath.has(nfc(n.path))) byPath.set(nfc(n.path), n);
  }
  const all = Array.from(byPath.values());
  const lookup = (path: string): NoteInput | undefined => byPath.get(nfc(path));

  const finish = (set: ExportSet): { set: ExportSet; findings: Finding[] } => ({ set, findings: sortFindings(findings) });
  const emptySet = (variant: string, args: readonly FindingArg[]): { set: ExportSet; findings: Finding[] } => {
    findings.push(note(CODES.setEmpty, 'error', variant, args));
    const entry: SetNote = { path: '', title: '', frontmatter: {}, body: '', depth: 0 };
    return finish({ title: recipe.title ?? '', entry, nodes: [], notesInOrder: [] });
  };
  const setNoteOf = (n: NoteInput, depth: number, extra: { title?: string; sourceKey?: string } = {}): SetNote => ({
    path: n.path,
    title: extra.title ?? titleOfNote(n, titleAliases),
    frontmatter: n.frontmatter,
    body: n.body,
    ...(extra.sourceKey !== undefined ? { sourceKey: extra.sourceKey } : {}),
    depth,
  });

  // --- Einzelnotiz: die Menge ist diese Notiz, zugleich Einstieg (Spec 10.1).
  if (scope.kind === 'note') {
    const only = lookup(scope.entryPath);
    if (only === undefined) return emptySet('note', [scope.entryPath]);
    const entry = setNoteOf(only, 0);
    return finish({ title: recipe.title ?? entry.title, entry, nodes: [], notesInOrder: [entry] });
  }

  // --- Ordner: der gewählte Einstieg bleibt immer in der Menge (er trägt oft nur die Bauanleitung).
  const explicit = scope.entryPath === '' ? undefined : lookup(scope.entryPath);
  const verdict = new Map<string, boolean>();
  /** Gehört die Notiz zur Menge? Leere Dateien und ausgeschlossene Notizen nicht; jeder Fall wird einmal gemeldet. */
  const usable = (n: NoteInput): boolean => {
    const key = nfc(n.path);
    const known = verdict.get(key);
    if (known !== undefined) return known;
    let ok = true;
    if (n === explicit) ok = true;
    else if (n.body.trim() === '') {
      ok = false;
      findings.push(note(CODES.setEmptyFile, 'info', undefined, [], { notePath: n.path }));
    } else if (isTrueValue(getField(buildFmIndex(n.frontmatter), excludeAliases))) {
      ok = false;
      findings.push(note(CODES.setExcluded, 'info', undefined, [], { notePath: n.path }));
    }
    verdict.set(key, ok);
    return ok;
  };

  const headings = new Map<string, string | null>();
  const treeFile = (n: NoteInput): FolderTreeFile => {
    let heading = headings.get(nfc(n.path));
    if (heading === undefined) {
      heading = firstHeadingText(n.body);
      headings.set(nfc(n.path), heading);
    }
    return { path: n.path, frontmatter: n.frontmatter, headingTitle: heading };
  };
  const treeOptions: FolderTreeOptions = { numberPrefix: true, introNames: ['{{folder_name}}'], titleFromHeading: true, fields: { title: titleAliases, order: orderAliases } };
  const treeOf = (folder: string, files: NoteInput[]): FolderTree => buildFolderTree(folder, files.map(treeFile), treeOptions);

  const baseUsable = all.filter((n) => isInFolder(n.path, scope.folder, { root: true }) && usable(n));

  // Einstieg: gewählt, sonst Ordnernotiz, sonst die erste Notiz der Reihenfolge.
  let entryInput = explicit;
  if (entryInput === undefined) {
    const overall = treeOf(scope.folder, baseUsable);
    const first = overall.intro ?? flattenFolderTree(overall)[0];
    entryInput = first === undefined ? undefined : lookup(first.path);
  }
  if (entryInput === undefined) return emptySet('folder', [scope.folder]);
  const entry = setNoteOf(entryInput, 0);
  const entryNote: NoteInput = entryInput;

  /** Notizen, die schon ihren Platz haben: der Einstieg und die Quellen (still); die Bereiche (mit Warnung). */
  const claimed = new Set<string>([nfc(entry.path)]);
  const placed = new Set<string>();

  // --- Quellen (Ordner außerhalb), relativ zur Einstiegsnotiz.
  const resolved = resolveSourcePaths(entry.path, recipe.sources);
  findings.push(...resolved.findings);
  const sourceTrees: SourceTree[] = [];
  resolved.folders.forEach((source) => {
    const files = all.filter((n) => isInFolder(n.path, source.folder, { root: true }) && !claimed.has(nfc(n.path)) && usable(n));
    const tree = treeOf(source.folder, files);
    for (const page of flattenFolderTree(tree)) claimed.add(nfc(page.path));
    if (files.length === 0) {
      const index = recipe.sources.findIndex((s) => s.key === source.key);
      findings.push(note(CODES.recipeInvalid, 'warning', 'source-folder-empty', [`sources[${index}]`, source.folder], { recipePath: `sources[${index}]` }));
      return;
    }
    sourceTrees.push({ key: source.key, tree, title: source.title, folder: source.folder });
  });

  // --- Bausteine: Baum → Knoten.
  const pageNote = (page: FolderTreePage, depth: number, sourceKey: string | undefined): SetNote => {
    const n = lookup(page.path);
    // Der Baum kennt nur Seiten, die wir ihm gaben.
    return setNoteOf(n ?? { path: page.path, frontmatter: {}, body: '', links: [] }, depth, { title: page.title, ...(sourceKey !== undefined ? { sourceKey } : {}) });
  };

  /** Die Ordnung einer Gruppe nach der Regel des Bereichs. `name` ist die Ordnung des Baums; `mention` und `field` ordnen nach, stabil auf der Baumordnung. */
  const arrange = (nodes: SetNode[], rule: OrderRule, rank: Map<string, number> | null): SetNode[] => {
    if (rule.kind === 'name' || nodes.length < 2) return nodes;
    const indexed = nodes.map((node, index) => ({ node, index }));
    if (rule.kind === 'mention') {
      const rankOf = (node: SetNode): number => {
        const ranks = (rank === null ? [] : noteNodes([node]).map((n) => rank.get(nfc(n.path)) ?? Infinity));
        return ranks.length === 0 ? Infinity : Math.min(...ranks);
      };
      const ranked = indexed.map((e) => ({ ...e, rank: rankOf(e.node) }));
      return ranked.sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank < b.rank ? -1 : 1)).map((e) => e.node);
    }
    // Feld: Zahlen aufsteigend, dann Texte in Namensordnung, dann alles ohne Wert (Gruppen haben kein Frontmatter) in der Ordnung des Baums.
    type Key = { kind: 0; n: number } | { kind: 1; s: string } | { kind: 2 };
    const keyOf = (node: SetNode): Key => {
      if ('children' in node) return { kind: 2 };
      const v = readField(node.frontmatter, rule.field, []);
      if (typeof v === 'number' && Number.isFinite(v)) return { kind: 0, n: v };
      const s = scalarText(v);
      if (s === undefined) return { kind: 2 };
      return /^[+-]?\d+(?:\.\d+)?$/.test(s) ? { kind: 0, n: Number(s) } : { kind: 1, s };
    };
    const keyed = indexed.map((e) => ({ ...e, key: keyOf(e.node) }));
    const compare = (a: (typeof keyed)[number], b: (typeof keyed)[number]): number => {
      if (a.key.kind !== b.key.kind) return a.key.kind - b.key.kind;
      if (a.key.kind === 0 && b.key.kind === 0 && a.key.n !== b.key.n) return a.key.n < b.key.n ? -1 : 1;
      if (a.key.kind === 1 && b.key.kind === 1) {
        const byName = compareOrderedNames(parseOrderedName(a.key.s), parseOrderedName(b.key.s)) || compareCodePoints(a.key.s, b.key.s);
        if (byName !== 0) return byName;
      }
      return a.index - b.index;
    };
    return keyed.sort(compare).map((e) => e.node);
  };

  const convert = (intro: FolderTreePage | null, children: FolderTreeNode[], depth: number, spec: GroupSpec, rank: Map<string, number> | null): SetNode[] => {
    const nodes: SetNode[] = children.map((child): SetNode => {
      if (child.kind === 'page') return pageNote(child, depth, spec.sourceKey);
      return {
        key: child.folderPath,
        title: child.title,
        open: false,
        overview: [],
        summaryLine: [],
        children: convert(child.intro, child.children, depth + 1, spec, rank),
      };
    });
    const arranged = arrange(nodes, spec.order, rank);
    return intro === null ? arranged : [pageNote(intro, depth, spec.sourceKey), ...arranged];
  };

  /** Notizen nach den Werten eines Feldes in verschachtelte Gruppen; fehlt der Wert, kommt die Notiz in „—“ am Ende. */
  const groupPages = (pages: FolderTreePage[], fields: string[], depth: number, parentKey: string, spec: GroupSpec, rank: Map<string, number> | null): SetNode[] => {
    const [field, ...rest] = fields;
    if (field === undefined) return arrange(pages.map((p) => pageNote(p, depth, spec.sourceKey)), spec.order, rank);
    const byFolder = ['folder', 'ordner'].includes(foldCase(field));
    interface Bucket { key: string; title: string; sortName: string; pages: FolderTreePage[] }
    const buckets = new Map<string, Bucket>();
    let missing: Bucket | null = null;
    for (const page of pages) {
      const n = lookup(page.path);
      let bucket: Bucket | undefined;
      if (byFolder) {
        const dir = nfc(dirOf(page.path));
        const name = lastSegment(dir);
        bucket = buckets.get(dir) ?? { key: dir, title: parseOrderedName(name).title, sortName: name, pages: [] };
        buckets.set(dir, bucket);
      } else {
        const value = scalarText(n === undefined ? undefined : readField(n.frontmatter, field, []));
        if (value === undefined) {
          missing ??= { key: NO_VALUE, title: NO_VALUE, sortName: NO_VALUE, pages: [] };
          findings.push(note(CODES.setNoGroupValue, 'info', undefined, [field, NO_VALUE], { notePath: page.path }));
          bucket = missing;
        } else {
          bucket = buckets.get(value) ?? { key: value, title: value, sortName: value, pages: [] };
          buckets.set(value, bucket);
        }
      }
      bucket.pages.push(page);
    }
    const ordered = Array.from(buckets.values()).sort((a, b) => compareOrderedNames(parseOrderedName(a.sortName), parseOrderedName(b.sortName)) || compareCodePoints(a.key, b.key));
    if (missing !== null) ordered.push(missing);
    return ordered.map((bucket): SetNode => {
      const key = `${parentKey}/${bucket.key}`;
      return { key, title: bucket.title, open: false, overview: [], summaryLine: [], children: groupPages(bucket.pages, rest, depth + 1, key, spec, rank) };
    });
  };

  const mentionRank = (pages: FolderTreePage[], spec: GroupSpec): Map<string, number> | null => {
    if (spec.order.kind !== 'mention') return null;
    return new Map(orderByMention(entryNote, pages.map((p) => p.path)).map((p, i) => [nfc(p), i]));
  };

  /** Ein Bereich oder eine Quelle als Gruppe: Titel, offen, Übersicht und Zusatzzeile des Bereichs; Notizen nach `group_by`, sonst in der Ordnung des Baums. */
  const groupOf = (tree: FolderTree, spec: GroupSpec): SetGroup => {
    const pages = flattenFolderTree(tree);
    const rank = mentionRank(pages, spec);
    const children = spec.groupBy.length > 0 ? groupPages(pages, spec.groupBy, 1, spec.key, spec, rank) : convert(tree.intro, tree.children, 1, spec, rank);
    return { key: spec.key, title: spec.title ?? tree.title, open: spec.open, overview: spec.overview, summaryLine: spec.summaryLine, children };
  };
  const plain = (key: string, title: string | undefined, sourceKey?: string): GroupSpec => ({
    key,
    title,
    open: false,
    overview: [],
    summaryLine: [],
    order: { kind: 'name' },
    groupBy: [],
    ...(sourceKey !== undefined ? { sourceKey } : {}),
  });
  const sourceGroup = (source: SourceTree, over: Partial<GroupSpec> = {}): SetGroup => groupOf(source.tree, { ...plain(source.key, source.title, source.key), ...over });
  const claimPages = (tree: FolderTree): number => {
    let skipped = 0;
    for (const page of flattenFolderTree(tree)) {
      if (placed.has(nfc(page.path))) skipped++;
      else placed.add(nfc(page.path));
    }
    return skipped;
  };

  // --- Knoten der Seite.
  let nodes: SetNode[] = [];
  if (recipe.sections.length === 0) {
    const files = baseUsable.filter((n) => !claimed.has(nfc(n.path)));
    const tree = treeOf(scope.folder, files);
    nodes = convert(tree.intro, tree.children, 0, plain(scope.folder, undefined), null);
    for (const source of sourceTrees) nodes.push(sourceGroup(source));
  } else {
    const used = new Set<string>();
    recipe.sections.forEach((section: SectionSpec, i) => {
      const recipePath = `sections[${i}]`;
      const invalid = (variant: string, args: readonly FindingArg[], severity: Finding['severity'] = 'error'): void => { findings.push(note(CODES.recipeInvalid, severity, variant, [recipePath, ...args], { recipePath })); };
      if (section.kind === 'source') {
        const source = sourceTrees.find((s) => s.key === section.path);
        if (source === undefined) {
          if (!resolved.folders.some((f) => f.key === section.path)) invalid('section-source', [section.path]);
          return;
        }
        used.add(source.key);
        nodes.push(sourceGroup(source, { title: section.title ?? source.title, open: section.open, overview: section.overview, summaryLine: section.summaryLine, order: section.order, groupBy: section.groupBy }));
        return;
      }
      const target = resolveRelPath(scope.folder, section.path, { allowEmpty: true });
      if (!target.ok) {
        invalid('section-path', [section.path, target.problem]);
        return;
      }
      if (section.kind === 'note') {
        const n = lookup(target.path);
        if (n === undefined) {
          invalid('section-note-missing', [target.path]);
          return;
        }
        const key = nfc(n.path);
        if (claimed.has(key) || placed.has(key)) {
          invalid('section-note-placed', [n.path], 'warning');
          return;
        }
        if (!usable(n)) return;
        placed.add(key);
        nodes.push(setNoteOf(n, 0, section.title === undefined ? {} : { title: section.title }));
        return;
      }
      if (!all.some((n) => isInFolder(n.path, target.path, { root: true }))) {
        invalid('section-folder-empty', [target.path]);
        return;
      }
      const inFolder = all.filter((n) => isInFolder(n.path, target.path, { root: true }) && !claimed.has(nfc(n.path)) && usable(n));
      const free = inFolder.filter((n) => !placed.has(nfc(n.path)));
      if (free.length < inFolder.length) invalid('section-notes-placed', [inFolder.length - free.length], 'warning');
      const tree = treeOf(target.path, free);
      if (free.length === 0 || flattenFolderTree(tree).length === 0) return;
      claimPages(tree);
      nodes.push(groupOf(tree, { key: target.path, title: section.title, open: section.open, overview: section.overview, summaryLine: section.summaryLine, order: section.order, groupBy: section.groupBy }));
    });
    // Quellen, die kein Bereich nennt, gehören trotzdem zur Menge: sie folgen am Ende in der Reihenfolge der Liste.
    for (const source of sourceTrees) if (!used.has(source.key)) nodes.push(sourceGroup(source));
  }

  const notesInOrder = [entry, ...noteNodes(nodes)];
  return finish({ title: recipe.title ?? entry.title, entry, nodes, notesInOrder });
}
