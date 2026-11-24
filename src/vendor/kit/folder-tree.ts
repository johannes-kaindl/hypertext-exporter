// vendored from code-kit@0.88.0, src/ts/pure/folder-tree.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: epub-exporter@5c2c2a5 src/core/folder-tree.ts (`buildBookTree`, `flattenPages`, `collectDirs`, `buildLevel`), lifted and changed (Welle 36, h1b,
// order 5 of the hypertext-exporter design, spec sections 7.2, 10.3 and 14). The carrier stays as it is until the breadth moves it; its tests are copied into
// tests/folder-tree.test.ts behind a thin adapter (the carrier's `FolderFileInput` becomes a frontmatter object, its `chapter` a `group`) and pass against this version.
//
// What it does: build a tree from note paths and their frontmatter. A folder under the root is a **group**, a `.md` file is a **page**; pages and groups of one
// level are ordered by the naming rule of `name-order` (a number in front of the name, `0` hides), a page's title comes from a frontmatter field, the first heading
// or the file name, and a note can be left out by a field. The result depends on the SET of files, never on their order, never on the host's locale.
//
// Differences from the carrier, each with its reason (the design asks for the first two):
//   * the branch without a number prefix used `localeCompare(..., { numeric: true, sensitivity: "base" })`, whose result depends on the host's locale and ICU build
//     (a different order on the Mac and on the phone). It is `compareOrderedNames` of a name with an empty key now: digit runs by value, anything else lower-cased and
//     compared by code point. Visible change: `ä` sorts behind `z` (it was next to `a`), and a punctuation mark no longer sorts by ICU weight. The test "Grundlagen
//     before Größe" names the case; both orders are fixed, neither follows the file system.
//   * the selection used `path.startsWith(root + "/")` on the text as given. It is `isInFolder(path, root, { root: true })` now: names in NFC (a decomposed umlaut from
//     macOS is the same folder), `\` and `//` read as `/`, a path with `..` in no folder, whole segments (`Notizen/` does not hold `Notizen-alt/x.md`; the carrier
//     already tested that, by the trailing slash). An empty root is the vault root.
//   * the names of the tree are NFC: `ü` as one code point or as `u` + U+0308 is one group, not two. `folderPath` is the NFC spelling; a page keeps the path it was given.
//   * the field names are parameters (`fields`), read with `getField`, so `Titel` and `chapter title` are found when the caller lists them. The carrier read the exact
//     keys `chapter_title` and `epub_exclude` and had no order field. A field with no name listed is not read at all (the kit has no default key of its own).
//   * the order field is new (spec 10.3: "das Feld `order` ordnet vor dem Namen"): a pages with a number there sorts before the pages without one and among themselves
//     by that number; groups have no frontmatter and take part by name only. Then the name rule, then the NFC path by code point (`compareCodePoints`, as the design asks) so equal
//     names do not depend on the input order; reached when only the prefix differs (`01 \uFFFD A` and `01 😀 A` are both key 1, title "A").
//   * the exclusion test is `isExcluded(value)`, default `value === true` as in the carrier (a text `"true"` is not excluded: Obsidian gives a real boolean). The caller
//     whose rule is wider (`ja`, `yes`, `1`) hands in its own; it is called with a value that exists, never with `undefined`, and must not throw.
//   * the intro names are compared with `foldCase`, not `toLowerCase` (`Straße` is `STRASSE`), the same fold as `frontmatter-field` and `folder-scope`.
//   * "chapter" is "group" and "book" is "tree": the module knows nothing of EPUB.
//   * the walk is a loop, not a recursion: a path with 30 000 segments is a deep tree, not a stack overflow.
//   * an unreadable root (`..`, NUL) and an unreadable file path give an empty tree and a skipped file; nothing throws. A path given twice (or twice after NFC) is one
//     page, the first one counts; the caller owns the order of contradicting duplicates.
//
// Pure, no import of a host, no I/O. Linear in the total length of the paths plus the sort of each level (n log n); the group map is keyed by the segment, no list is searched.

import { foldCase } from "./fold-case";
import { isInFolder } from "./folder-scope";
import { buildFmIndex, getField, type FmIndex } from "./frontmatter-field";
import { compareCodePoints, compareOrderedNames, parseOrderedName, type OrderedName } from "./name-order";
import { normalizeRelPath } from "./rel-path";

/** One note: its path, its frontmatter (any value; only a plain object is read) and the plain text of its first heading (`firstHeadingText`), if the caller has it. */
export interface FolderTreeFile {
  path: string;
  frontmatter?: unknown;
  headingTitle?: string | null;
}

/** The frontmatter keys to read, each an alias list in priority order (`getField`: case, `_`, `-` and blanks do not matter). An empty or missing list: not read. */
export interface FolderTreeFields {
  /** A non-empty text there is the page's title and beats the heading and the name. */
  title?: readonly string[];
  /** A finite number, or a text that is one (`"3"`, `"-1.5"`): pages with it sort first, ascending. */
  order?: readonly string[];
  /** A value there for which `isExcluded` answers true: the note is not in the tree, and is not counted as hidden. */
  exclude?: readonly string[];
}

export interface FolderTreeOptions {
  /** Default `false`. `true`: a number in front of a name orders it and `0` hides it, and the title loses the prefix. `false`: the full name is title and natural order. */
  numberPrefix?: boolean;
  /** Default none. Names (no extension, case-folded, `{{folder_name}}` allowed) of the page that opens a group; the first that matches, in list order, then sort order. */
  introNames?: readonly string[];
  /** Default `true`. A page's title is its first heading; `false`: its (prefix-stripped) name. */
  titleFromHeading?: boolean;
  fields?: FolderTreeFields;
  /** Default `(v) => v === true`. */
  isExcluded?: (value: unknown) => boolean;
}

export interface FolderTreePage {
  kind: "page";
  path: string;
  title: string;
}

export interface FolderTreeGroup {
  kind: "group";
  title: string;
  /** NFC spelling of the folder, root included. */
  folderPath: string;
  intro: FolderTreePage | null;
  children: FolderTreeNode[];
}

export type FolderTreeNode = FolderTreePage | FolderTreeGroup;

export interface FolderTree {
  /** The root folder's name (without the prefix when `numberPrefix`). */
  title: string;
  intro: FolderTreePage | null;
  children: FolderTreeNode[];
  /** Items hidden by the name rule (a hidden folder counts once, not per page). Excluded notes do not count. */
  hiddenCount: number;
}

interface Dir {
  name: string;
  path: string;
  files: PlacedFile[];
  dirs: Map<string, Dir>;
  result: Level | null;
}

interface PlacedFile {
  input: FolderTreeFile;
  /** File name without `.md`, NFC. */
  name: string;
  /** Full NFC path, for the last tie-break. */
  sortPath: string;
}

interface Level {
  intro: FolderTreePage | null;
  children: FolderTreeNode[];
  hidden: number;
}

/** One sortable item of a level. */
interface Entry {
  name: string;
  sortPath: string;
  rule: OrderedName;
  order: number | null;
  node: FolderTreeNode;
}

const FOLDER_NAME = "{{folder_name}}";
const NUMBER_TEXT = /^[+-]?\d+(?:\.\d+)?$/;
const MD = /\.md$/i;

const emptyTree = (): FolderTree => ({ title: "", intro: null, children: [], hiddenCount: 0 });

function newDir(name: string, path: string): Dir {
  return { name, path, files: [], dirs: new Map(), result: null };
}

function textField(idx: FmIndex | null, names: readonly string[] | undefined): string | null {
  if (idx === null || !names || names.length === 0) return null;
  const v = getField(idx, names);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function orderField(idx: FmIndex | null, names: readonly string[] | undefined): number | null {
  if (idx === null || !names || names.length === 0) return null;
  const v = getField(idx, names);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && NUMBER_TEXT.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isExcluded(idx: FmIndex | null, names: readonly string[] | undefined, test: (value: unknown) => boolean): boolean {
  if (idx === null || !names || names.length === 0) return false;
  const v = getField(idx, names);
  return v !== undefined && test(v);
}

/** The root and the files below it as a tree of directories; files that are not `.md`, not below the root or unreadable are left out. */
function collectDirs(rootSegments: readonly string[], rootPath: string, files: readonly FolderTreeFile[]): Dir {
  const root = newDir(rootSegments[rootSegments.length - 1] ?? "", rootSegments.join("/"));
  const seen = new Set<string>();
  for (const input of files) {
    const norm = normalizeRelPath(input.path, { absolute: "strip", allowEmpty: true });
    if (!norm.ok || norm.segments.length === 0) continue;
    const last = norm.segments[norm.segments.length - 1] ?? "";
    if (!MD.test(last) || last.length === 3) continue;
    if (!isInFolder(input.path, rootPath, { root: true })) continue;
    const segments = norm.segments.map((s) => s.normalize("NFC"));
    const sortPath = segments.join("/");
    if (seen.has(sortPath)) continue;
    seen.add(sortPath);
    const below = segments.slice(rootSegments.length);
    const name = (below.pop() ?? "").slice(0, -3);
    let dir = root;
    for (const segment of below) {
      let next = dir.dirs.get(segment);
      if (!next) {
        next = newDir(segment, dir.path === "" ? segment : `${dir.path}/${segment}`);
        dir.dirs.set(segment, next);
      }
      dir = next;
    }
    dir.files.push({ input, name, sortPath });
  }
  return root;
}

function compareEntries(a: Entry, b: Entry): number {
  if (a.order !== null && b.order === null) return -1;
  if (a.order === null && b.order !== null) return 1;
  if (a.order !== null && b.order !== null && a.order !== b.order) return a.order < b.order ? -1 : 1;
  const byName = compareOrderedNames(a.rule, b.rule);
  if (byName !== 0) return byName;
  return compareCodePoints(a.sortPath, b.sortPath);
}

interface Resolved {
  numberPrefix: boolean;
  introNames: readonly string[];
  titleFromHeading: boolean;
  fields: FolderTreeFields;
  excludedTest: (value: unknown) => boolean;
}

function resolve(options: FolderTreeOptions): Resolved {
  return {
    numberPrefix: options.numberPrefix === true,
    introNames: Array.isArray(options.introNames) ? (options.introNames as readonly string[]).filter((n) => typeof n === "string") : [],
    titleFromHeading: options.titleFromHeading !== false,
    fields: options.fields ?? {},
    excludedTest: typeof options.isExcluded === "function" ? options.isExcluded : (v) => v === true,
  };
}

function titleOf(name: string, parsed: OrderedName, o: Resolved): string {
  return o.numberPrefix ? parsed.title : name;
}

/** The rule an entry is ordered by: its parsed name, or with the number prefix off the full name as one natural-order title. */
function ruleOf(name: string, parsed: OrderedName, o: Resolved): OrderedName {
  return o.numberPrefix ? parsed : { key: [], title: name, hidden: false };
}

function buildLevel(dir: Dir, o: Resolved): Level {
  let hidden = 0;
  const entries: Entry[] = [];
  const folderTitle = titleOf(dir.name, parseOrderedName(dir.name), o);

  for (const file of dir.files) {
    const input = file.input;
    const idx = o.fields.title || o.fields.order || o.fields.exclude ? buildFmIndex(input.frontmatter) : null;
    if (isExcluded(idx, o.fields.exclude, o.excludedTest)) continue;
    const parsed = parseOrderedName(file.name);
    if (o.numberPrefix && parsed.hidden) {
      hidden++;
      continue;
    }
    const heading = o.titleFromHeading && typeof input.headingTitle === "string" && input.headingTitle !== "" ? input.headingTitle : null;
    const title = textField(idx, o.fields.title) ?? heading ?? titleOf(file.name, parsed, o);
    entries.push({
      name: file.name,
      sortPath: file.sortPath,
      rule: ruleOf(file.name, parsed, o),
      order: orderField(idx, o.fields.order),
      node: { kind: "page", path: input.path, title },
    });
  }

  for (const sub of dir.dirs.values()) {
    const parsed = parseOrderedName(sub.name);
    if (o.numberPrefix && parsed.hidden) {
      hidden++;
      continue;
    }
    // The sub-folder was built before this level (children are processed first).
    const level = sub.result ?? { intro: null, children: [], hidden: 0 };
    hidden += level.hidden;
    // A folder with nothing left to show is not a group.
    if (level.intro === null && level.children.length === 0) continue;
    const title = titleOf(sub.name, parsed, o);
    entries.push({
      name: sub.name,
      sortPath: sub.path,
      rule: ruleOf(sub.name, parsed, o),
      order: null,
      node: { kind: "group", title, folderPath: sub.path, intro: level.intro, children: level.children },
    });
  }

  entries.sort(compareEntries);

  let intro: FolderTreePage | null = null;
  for (const raw of o.introNames) {
    const wanted = foldCase(raw.replaceAll(FOLDER_NAME, folderTitle));
    const hit = entries.find((e) => e.node.kind === "page" && foldCase(titleOfEntry(e, o)) === wanted);
    if (hit) {
      intro = hit.node as FolderTreePage;
      break;
    }
  }

  const children = entries.map((e) => e.node).filter((n) => n !== intro);
  return { intro, children, hidden };
}

/** The name an intro list is compared with: the file name, without the number prefix when that rule is on. */
function titleOfEntry(e: Entry, o: Resolved): string {
  return o.numberPrefix ? e.rule.title : e.name;
}

/** Builds the tree of the folder `rootPath` (`""` is the vault root) from `files`: every `.md` below it, ordered and titled by `options`. Folders come from the paths.
 *  A root that cannot be read (a `..` or a NUL in it) gives an empty tree. */
export function buildFolderTree(rootPath: string, files: readonly FolderTreeFile[], options: FolderTreeOptions = {}): FolderTree {
  const norm = normalizeRelPath(rootPath, { absolute: "strip", allowEmpty: true });
  if (!norm.ok || !Array.isArray(files)) return emptyTree();
  const o = resolve(options);
  const rootSegments = norm.segments.map((s) => s.normalize("NFC"));
  const root = collectDirs(rootSegments, rootPath, files);

  // Pre-order; reversed, every directory comes after all its sub-directories.
  const order: Dir[] = [];
  const stack: Dir[] = [root];
  for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
    order.push(dir);
    for (const sub of dir.dirs.values()) stack.push(sub);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const dir = order[i];
    if (dir) dir.result = buildLevel(dir, o);
  }

  const level = root.result ?? { intro: null, children: [], hidden: 0 };
  return {
    title: titleOf(root.name, parseOrderedName(root.name), o),
    intro: level.intro,
    children: level.children,
    hiddenCount: level.hidden,
  };
}

/** Reading order: the root intro first, then depth first with a group's intro before its children. */
export function flattenFolderTree(tree: FolderTree): FolderTreePage[] {
  const pages: FolderTreePage[] = [];
  if (tree.intro) pages.push(tree.intro);
  const stack: FolderTreeNode[] = [];
  for (let i = tree.children.length - 1; i >= 0; i--) {
    const child = tree.children[i];
    if (child) stack.push(child);
  }
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.kind === "page") {
      pages.push(node);
      continue;
    }
    if (node.intro) pages.push(node.intro);
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child) stack.push(child);
    }
  }
  return pages;
}
