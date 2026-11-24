// Marken, Links und Aufklappen zusammensetzen (Bauplan Task 9, Spec 10.3 bis 10.5 und 10.7).
// Allgemeines kommt aus dem Kit und wird hier nur gerufen: Marken der Notizen allein `assignNoteMarks` und `createNoteMarks` (anchor-marks), Links allein `rewriteExportLinks`
// (export-links), Aufklappen allein `foldCallouts` und `foldHeadingSections` (export-fold). Hier steht, was dem Plugin gehört (plugin-eigene Typen): die Reihenfolge der Schritte,
// der Aufbau von Einstieg, Gruppen und Notiz-Bereichen und die Übersetzung der Kit-Befunde in Befunde der Seite.
//
// Reihenfolge je Lauf (jede Stufe über alle Notizen, bevor die nächste beginnt, weil Links über Notizen hinweg zeigen):
//   1. Marken der Notizen, dann der Gruppen (Gruppen halten sich aus dem Weg der Notizen).
//   2. je Notiz: Titelüberschrift, die der Bereich schon trägt, weglassen; beim Einstieg die Überschriftsabschnitte falten; Naht zum DOM-Läufer (`markRenderedNote`).
//   3. Links umschreiben (Einbettungen löst der Wirt gegen die eingebettete Notiz auf).
//   4. Callouts falten; Zusatzzeile aus dem ersten Link (`fold.linked_summary`).
//   5. Zusammenbau: Einstieg, Gruppen, Notiz-Bereiche.
// Die Bäume in `roots` werden verbraucht: ihre Kinder ziehen in den `body`.
import { assignNoteMarks, createNoteMarks, EMPTY_SLUG, RESERVED_MARKS, type NoteMarks, type NoteRef } from '../vendor/kit/anchor-marks';
import { foldCallouts, foldHeadingSections, type ExportFoldPorts } from '../vendor/kit/export-fold';
import { rewriteExportLinks, type ExportLinkFinding, type ExportLinkPorts } from '../vendor/kit/export-links';
import { walkAnchors } from '../vendor/kit/anchor-walk';
import { slugify } from '../vendor/kit/slug';
import { CODES } from './finding-codes';
import { sortFindings } from './findings';
import { resolveSourcePaths } from './set';
import type { ExportSet, Finding, FindingArg, Recipe, SetGroup, SetNode, SetNote } from './types';

/** Was der Aufrufer zu Notizen und Gruppen beisteuert (beides baut `overview.ts` aus dem Frontmatter). */
export interface StructureExtras {
  /** Die Zusatzzeile einer Notiz oder `null`. */
  summaryOf(note: SetNote): string | null;
  /** Die Übersicht einer Gruppe (`div.ht-table`) oder `null`; `anchors` ist die Tabelle Pfad → Marke, die erst `structure` vergibt (die Übersicht braucht sie für die Sprünge). */
  overviewFor(group: SetGroup, anchors: Map<string, string>): HTMLElement | null;
}

export interface StructureResult {
  /** Einstieg (offen), danach je Gruppe und je Notiz ein `<details>`; die Seite setzt ihn in `<main>`. */
  body: HTMLElement;
  /** Pfad der Notiz → Marke (auch der Einstieg). */
  anchors: Map<string, string>;
  /** Gruppe → Marke (für die Navigation); Schlüssel ist das Objekt der Menge, weil Schlüssel von Gruppen keine Pfade sein müssen. */
  groupAnchors: Map<SetGroup, string>;
  findings: Finding[];
}

const HEADINGS = 'h1,h2,h3,h4,h5,h6';
const EMBED = '.internal-embed';
const JUMP_ATTR = 'data-export-link';

/** Klassen der Seite, die das Thema (Task 11) stylt. */
const LINK_TEXT_CLASS = 'ht-link-text';
const TAG_CLASS = 'ht-tag';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().normalize('NFC');
const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** `path` ohne den Ordner davor, oder `null`, wenn er nicht darin liegt. */
function below(path: string, folder: string): string | null {
  if (folder === '') return path;
  return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : null;
}

/**
 * Naht zum DOM-Läufer von obsidian-kit: setzt im gezeichneten Baum einer Notiz die `id` der Überschriften (`marks.heading(text)`, in Dokumentreihenfolge, Einbettungen mit `marks.embed(n)`),
 * schreibt Obsidians Fußnoten-`id` und -`href` (`fn-1-<hex>`, `fnref-1-<hex>`) auf `marks.footnote(n)` und `marks.footnoteRef(n)` um und verschiebt die Überschriftsebenen der Notiz lückenlos ab `headingBase`
 * (Einstieg 2, Notiz `3 + depth`: über dem Bereich steht die Überschrift der summary). Seine Befunde gehen über `flag` hinaus (über h6 gehalten: `heading.capped`).
 *
 * Der Läufer (obsidian-kit `anchor-walk`, Bestellung 6) läuft genau einmal je Notiz, nach dem Weglassen der Titelüberschrift und vor dem Umschreiben der Links, weil `headingMark` die `id` der
 * Überschriften im Baum liest. Die Sprünge, die er selbst gesetzt hat (Fußnoten, `#Überschrift` in derselben Notiz, `href="#<marke>--…"`), tragen danach `data-export-link="jump"`, damit der
 * Link-Umschreiber sie stehen lässt; was er nicht auflösen konnte (`#^block`, eine fehlende Überschrift), bleibt für den Umschreiber und dessen Befunde.
 */
function markRenderedNote(root: HTMLElement, marks: NoteMarks, headingBase: number, flag: (severity: Finding['severity'], code: string, variant: string | undefined, args: readonly FindingArg[]) => void): void {
  const doc = root.ownerDocument;
  const walked = walkAnchors(root, marks, { createEl: (tag) => doc.createElement(tag) }, { baseLevel: headingBase });
  const own = `#${marks.mark}--`;
  for (const a of Array.from(root.querySelectorAll('a[href^="#"]'))) {
    if (!(a.getAttribute('href') ?? '').startsWith(own) || a.hasAttribute(JUMP_ATTR)) continue;
    a.setAttribute(JUMP_ATTR, 'jump');
    a.removeAttribute('data-href');
  }
  for (const f of walked.findings) {
    if (f.kind === 'heading-level-clamped') flag('info', CODES.headingCapped, undefined, [f.count]);
    else if (f.kind === 'heading-id-replaced') flag('info', CODES.markDuplicate, 'heading-id', [f.text, f.id]);
    else if (f.kind === 'footnote-id-collision') flag('warning', CODES.markDuplicate, 'footnote-id', [f.id, f.mark]);
    else if (f.kind === 'footnote-form-unknown') flag('warning', CODES.markMissingTarget, 'footnote-form', [f.id]);
    else if (f.kind === 'footnote-target-missing') flag('warning', CODES.markMissingTarget, 'footnote-target', [f.href]);
    else if (f.kind === 'embed-not-loaded') flag('info', CODES.embedMissing, 'not-loaded', [f.mark]);
    // fragment-link-unresolved: der Link-Umschreiber meldet ihn (link.heading-missing, link.block)
  }
}

/** Die erste Überschrift des Baums (ohne die in Einbettungen); ist sie eine `h1` mit dem Titel, fällt sie weg. Gibt den Titel zurück, wenn sie weggefallen ist. */
function dropTitleHeading(root: HTMLElement, titles: readonly string[]): string | null {
  const first = Array.from(root.querySelectorAll(HEADINGS)).find((h) => h.closest(EMBED) === null);
  if (first === undefined || first.tagName !== 'H1') return null;
  const text = norm(first.textContent);
  if (!titles.some((t) => norm(t) === text)) return null;
  first.remove();
  return text;
}

/** Die geschriebene Adresse eines Links, prozentdekodiert (Obsidian schreibt sie in `data-href`, sonst steht sie im `href`). */
function writtenHref(a: Element): string {
  return safeDecode(a.getAttribute('data-href') ?? a.getAttribute('href') ?? '');
}

export function structure(
  set: ExportSet,
  roots: Map<string, HTMLElement>,
  recipe: Recipe,
  resolve: (link: string, fromPath: string) => string | null,
  extras: StructureExtras,
  scopeFolder?: string,
): StructureResult {
  const findings: Finding[] = [];
  const anchors = new Map<string, string>();
  const groupAnchors = new Map<SetGroup, string>();
  const doc = documentOf(set, roots);
  const body = doc.createElement('div');
  if (set.notesInOrder.length === 0) return { body, anchors, groupAnchors, findings };

  // --- 1. Marken
  const folder = scopeFolder ?? dirOf(set.entry.path);
  const sourceFolders = new Map<string, string>(resolveSourcePaths(set.entry.path, recipe.sources).folders.map((f) => [f.key, f.folder]));
  const relative = (path: string): string => {
    const own = below(path, folder);
    if (own !== null) return own;
    for (const f of sourceFolders.values()) {
      const inSource = below(path, f);
      if (inSource !== null) return inSource;
    }
    return path;
  };
  const noteRefs: NoteRef[] = set.notesInOrder.map((n) => {
    if (n.sourceKey === undefined) return { path: below(n.path, folder) ?? n.path };
    const src = sourceFolders.get(n.sourceKey);
    return { path: (src === undefined ? null : below(n.path, src)) ?? n.path, source: n.sourceKey };
  });
  const noteMarks = assignNoteMarks(noteRefs);
  set.notesInOrder.forEach((n, i) => anchors.set(n.path, noteMarks[i] ?? EMPTY_SLUG));

  const groups: SetGroup[] = [];
  (function collect(nodes: SetNode[]): void {
    for (const node of nodes) if ('children' in node) { groups.push(node); collect(node.children); }
  })(set.nodes);
  const groupMarks = assignNoteMarks(groups.map((g) => ({ path: relative(g.key) })), { reserved: [...RESERVED_MARKS, ...noteMarks] });
  groups.forEach((g, i) => groupAnchors.set(g, groupMarks[i] ?? EMPTY_SLUG));

  const noteByMark = new Map<string, SetNote>(set.notesInOrder.map((n) => [anchors.get(n.path) ?? '', n]));
  const markOf = (n: SetNote): string => anchors.get(n.path) ?? EMPTY_SLUG;
  const treeOf = (n: SetNote): HTMLElement => roots.get(n.path) ?? doc.createElement('div');
  const flag = (severity: Finding['severity'], code: string, variant: string | undefined, args: readonly FindingArg[], notePath?: string): void => {
    findings.push({ severity, code, ...(variant !== undefined ? { variant } : {}), args, ...(notePath !== undefined ? { notePath } : {}) });
  };

  // --- 2. Titelüberschrift, Faltung des Einstiegs, Naht
  const foldPorts: ExportFoldPorts = { createEl: (tag) => doc.createElement(tag) };
  const removedTitle = new Map<string, string>();   // Pfad → Slug der weggelassenen Titelüberschrift
  for (const n of set.notesInOrder) {
    const root = treeOf(n);
    const isEntry = n === set.entry;
    const dropped = dropTitleHeading(root, isEntry ? [n.title, set.title] : [n.title]);
    if (dropped !== null) removedTitle.set(n.path, slugify(dropped, { fallback: EMPTY_SLUG }));
    if (isEntry && recipe.fold.headingsFrom !== null) {
      // Der Fußnotenblock, den Obsidian ans Ende des Baums zeichnet, würde sonst im letzten gefalteten Abschnitt landen: abheben und hinter die Abschnitte setzen.
      const footnoteBlocks = Array.from(root.querySelectorAll(':scope > section.footnotes'));
      for (const block of footnoteBlocks) block.remove();
      foldHeadingSections(root, foldPorts, { fromLevel: recipe.fold.headingsFrom });
      root.append(...footnoteBlocks);
    }
    markRenderedNote(root, createNoteMarks(markOf(n)), isEntry ? 2 : 3 + n.depth, (severity, code, variant, args) => flag(severity, code, variant, args, n.path));
  }

  // --- 3. Links
  const headingIndex = new Map<string, Array<{ slug: string; id: string }>>();
  const headingsOf = (path: string): Array<{ slug: string; id: string }> => {
    let list = headingIndex.get(path);
    if (list === undefined) {
      list = [];
      const mark = anchors.get(path);
      const root = roots.get(path);
      if (mark !== undefined && root !== undefined) {
        for (const h of Array.from(root.querySelectorAll(HEADINGS))) {
          // eigene Überschrift der Notiz: `<marke>--<slug>`; die einer Einbettung heißt `<marke>--e<n>--<slug>`, und ein Slug enthält nie `--`
          if (!h.id.startsWith(`${mark}--`) || h.id.slice(mark.length + 2).includes('--')) continue;
          list.push({ slug: slugify(h.textContent, { fallback: EMPTY_SLUG }), id: h.id });
        }
      }
      headingIndex.set(path, list);
    }
    return list;
  };
  const portsFor = (from: string): ExportLinkPorts => ({
    resolve: (linkpath) => (linkpath === '' ? from : resolve(linkpath, from)),
    noteMark: (path) => anchors.get(path) ?? null,
    headingMark: (path, heading) => {
      const slug = slugify(heading, { fallback: EMPTY_SLUG });
      const own = headingsOf(path).find((h) => h.slug === slug);
      if (own !== undefined) return own.id;
      return removedTitle.get(path) === slug ? (anchors.get(path) ?? null) : null;   // der Titel steht als Überschrift der summary dort
    },
    createSpan: () => doc.createElement('span'),
  });
  const linkOptions = { textClass: LINK_TEXT_CLASS, tagClass: TAG_CLASS };

  for (const n of set.notesInOrder) {
    const root = treeOf(n);
    const seen = new Set<string>();
    const report = (severity: Finding['severity'], code: string, target: string, variant: string | undefined, args: readonly FindingArg[]): void => {
      const key = `${code}|${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      flag(severity, code, variant, args, n.path);
    };
    // Block-Verweise merken, ehe das Kit die geschriebene Adresse überschreibt
    const blockLinks = new Map<Element, string>();
    for (const a of Array.from(root.querySelectorAll('a'))) {
      const written = writtenHref(a);
      if (written.includes('#^')) blockLinks.set(a, written);
    }
    const kitFindings: ExportLinkFinding[] = [];
    // Einbettungen von innen nach außen: jede löst ihre Links gegen die eigene Notiz auf (ein umgeschriebener Link trägt data-export-link und bleibt beim äußeren Durchgang stehen)
    const embeds = Array.from(root.querySelectorAll(`${EMBED}[src]`));
    const embedPath = new Map<Element, string>();
    for (const e of embeds) {
      const outer = e.parentElement?.closest(`${EMBED}[src]`) ?? null;
      const from = (outer === null ? undefined : embedPath.get(outer)) ?? n.path;
      const src = (e.getAttribute('src') ?? '').split('#')[0]?.split('|')[0] ?? '';
      embedPath.set(e, (src === '' ? from : resolve(src, from)) ?? from);
    }
    for (const e of embeds.reverse()) kitFindings.push(...rewriteExportLinks(e, portsFor(embedPath.get(e) ?? n.path), linkOptions).findings);
    kitFindings.push(...rewriteExportLinks(root, portsFor(n.path), linkOptions).findings);

    for (const f of kitFindings) {
      if (f.kind === 'outside') report('warning', CODES.linkOutside, f.target, undefined, [f.target]);
      else if (f.kind === 'unresolved') report('warning', CODES.linkUnresolved, f.target, undefined, [f.target]);
      else if (f.kind === 'scheme') report('info', CODES.linkScheme, f.target, f.scheme === '' ? 'no-scheme' : undefined, f.scheme === '' ? [f.target] : [f.target, f.scheme]);
      else report('info', CODES.linkHeadingMissing, `${f.target}`, undefined, [f.heading, f.target]);
    }
    for (const [a, written] of blockLinks) {
      if (a.getAttribute(JUMP_ATTR) === 'jump') report('info', CODES.linkBlock, written, undefined, [written]);
    }
  }

  // --- 4. Callouts, Zusatzzeile aus dem ersten Link
  for (const n of set.notesInOrder) foldCallouts(treeOf(n), foldPorts);
  const summaryLine = (text: string): HTMLElement => {
    const p = doc.createElement('p');
    p.className = 'ht-summary-line';
    p.textContent = text;
    return p;
  };
  if (recipe.fold.linkedSummary && recipe.fold.headingsFrom !== null) {
    for (const section of Array.from(treeOf(set.entry).querySelectorAll('details[data-export-fold="section"]'))) {
      const href = section.querySelector(`a[${JUMP_ATTR}="jump"]`)?.getAttribute('href');
      const target = href === undefined || href === null ? undefined : noteByMark.get(safeDecode(href.slice(1)).split('--')[0] ?? '');
      const line = target === undefined ? null : extras.summaryOf(target);
      if (line !== null && line !== '') section.firstElementChild?.append(summaryLine(line));
    }
  }

  // --- 5. Zusammenbau
  const adopt = (from: HTMLElement, to: HTMLElement): void => {
    for (const child of Array.from(from.childNodes)) to.appendChild(child);
  };
  const heading = (level: number, text: string, notePath?: string): HTMLElement => {
    if (level > 6) flag('info', CODES.headingCapped, 'one', [text, level], notePath);
    const h = doc.createElement(`h${Math.min(6, level)}`);
    h.textContent = text;
    return h;
  };

  const entryMark = markOf(set.entry);
  const entrySection = doc.createElement('section');
  entrySection.id = entryMark;
  entrySection.setAttribute('data-ht-note', entryMark);
  const title = doc.createElement('h1');
  title.textContent = set.title;
  entrySection.appendChild(title);
  adopt(treeOf(set.entry), entrySection);
  body.appendChild(entrySection);

  const noteDetails = (n: SetNote): HTMLElement => {
    const mark = markOf(n);
    const details = doc.createElement('details');
    details.id = mark;
    details.setAttribute('data-ht-note', mark);
    const summary = doc.createElement('summary');
    summary.appendChild(heading(2 + n.depth, n.title, n.path));
    const line = extras.summaryOf(n);
    if (line !== null && line !== '') summary.appendChild(summaryLine(line));
    details.appendChild(summary);
    adopt(treeOf(n), details);
    return details;
  };
  const place = (nodes: SetNode[], parent: HTMLElement, level: number): void => {
    for (const node of nodes) {
      if (!('children' in node)) {
        parent.appendChild(noteDetails(node));
        continue;
      }
      const mark = groupAnchors.get(node) ?? EMPTY_SLUG;
      const details = doc.createElement('details');
      details.id = mark;
      details.setAttribute('data-ht-group', mark);
      if (node.open) details.setAttribute('open', '');
      const summary = doc.createElement('summary');
      summary.appendChild(heading(2 + level, node.title));
      details.appendChild(summary);
      const overview = extras.overviewFor(node, anchors);
      if (overview !== null) details.appendChild(overview);
      place(node.children, details, level + 1);
      parent.appendChild(details);
    }
  };
  place(set.nodes, body, 0);

  // Das Kit-Zeichen eines umgeschriebenen Sprungs diente nur dem zweiten Durchgang.
  for (const a of Array.from(body.querySelectorAll(`a[${JUMP_ATTR}]`))) a.removeAttribute(JUMP_ATTR);
  return { body, anchors, groupAnchors, findings: sortFindings(findings) };
}

/** Das Dokument, in dem die Elemente entstehen: das der gezeichneten Bäume (ein Popout-Fenster hat ein eigenes); ohne Bäume ein leeres. */
function documentOf(set: ExportSet, roots: Map<string, HTMLElement>): Document {
  const entry = roots.get(set.entry.path);
  if (entry !== undefined) return entry.ownerDocument;
  for (const root of roots.values()) return root.ownerDocument;
  return new DOMParser().parseFromString('', 'text/html');
}
