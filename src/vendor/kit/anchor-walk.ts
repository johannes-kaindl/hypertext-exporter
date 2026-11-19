// vendored from obsidian-kit@0.106.0, src/pure/anchor-walk.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: new in obsidian-kit (Welle 36, h3, order 6 of the hypertext-exporter plan, spec 10.3 and 10.4). The half of the order that reads Obsidian's RENDERED tree; the plain half
// (the scheme of the marks, `shiftHeadingLevels`, `checkAnchors`) lives in code-kit `pure/anchor-marks` and `web/anchor-check`. No `obsidian` import: the module reads a DOM tree
// it is handed (the root of `withRenderedNote`), so it is tested at a real DOM (happy-dom) and measured once in the live app (pilot driver `anchor-walk`).
//
// What Obsidian writes, measured 2026-11-19 (Obsidian 1.15.1, pilot `anker-dump`, a note with two footnotes, three equal headings and two embedded notes):
//   heading     `<h2 data-heading="Abschnitt">`; no `id`. Equal headings cannot be told apart.
//   footnote    reference `<sup class="footnote-ref" data-footnote-id="fnref-1-<16 hex>" id="fnref-1-<16 hex>"><a class="footnote-link" href="#fn-1-<16 hex>">`;
//               target `<li data-footnote-id="fn-1-<16 hex>" id="fn-1-<16 hex>">` with a back link `<a class="footnote-backref" href="#fnref-1-<16 hex>">`. `<n>` counts the footnotes of
//               ONE rendered note; the hex is new at every render, and an embedded note has its own `<n>` (from 1) and its own hex and its own `<section class="footnotes">`.
//               A footnote referenced again has one more reference `fnref-<n>-<k>-<16 hex>` (`k` = 1 for the second, 2 for the third; shown as "[1-1]") and one more back link per reference.
//   embed       `<span class="internal-embed markdown-embed is-loaded" src="…">` holding `.markdown-embed-content > .markdown-preview-view` with the whole embedded note
//               (its own `h1`, its own footnotes). A section embed (`![[note#Heading]]`) holds only that section. Image and file embeds are `internal-embed` without `markdown-embed`.
//   link        `[[#Heading]]` and `[text](#Heading)` both give `<a class="internal-link" href="#Heading" data-href="#Heading">`: the fragment is the heading's TEXT.
//
// What the walk does, in document order, one depth-first pass and one pass over what the first pass collected (linear; nothing is searched in a loop):
//   1. every heading gets `id` = `marks.heading(text)`; the text is `data-heading`, else the text content. An `id` the author had written is replaced and reported.
//   2. every footnote id (`id` and `data-footnote-id`) is rewritten to `footnote(n)` / `footnoteRef(n)` of the note it sits in (a repeated reference: `footnoteRef(n, k)`, k from 1,
//      `<mark>--fnref-<n>--<k>`, code-kit 0.86.0), and every `href="#…"` that pointed at one follows.
//      The new value depends on the number `<n>` only, never on the hex, so two renders of the same note give the same bytes (the test of spec 4a).
//   3. every markdown embed gets `id` = `marks.embed(k).mark` (k counts the embeds of its parent note from 1) and the inside of it is walked with its own marks object.
//   4. heading levels are moved with `shiftHeadingLevels` per note: the outermost note starts at `baseLevel` (default 2, the page keeps its `h1`); an embedded note starts one level
//      below the heading it sits under (or at the base of its parent when it sits before any heading). The outline stays gapless across the embed. A tag cannot change name in place, so
//      a heading whose level changes is REPLACED by a new element (attributes and children move over); a heading whose level stays is not touched.
//   5. a same-document heading link (`href="#Text"`, from `data-href`) is pointed at the mark of the first heading with that text in the same note (case and runs of spaces are not told apart,
//      as in Obsidian). Without this the links of step 1's headings would be dead (`checkAnchors`).
//
// Findings (never a silent skip, CORE-DATA-01): a name for each form the walk does not recognise or cannot settle; `checkAnchors` on the result is the second net.
//   `heading-id-replaced`      a heading had its own `id` (raw HTML in the note); it is replaced, links to the old one are dead
//   `footnote-form-unknown`    an id that starts with `fn`/`fnref` but is none of `fn-<n>-<hex>`, `fnref-<n>-<hex>`, `fnref-<n>-<k>-<hex>`; left as it is
//   `footnote-id-collision`    two footnote ids of one note map to the same mark; the second is left as it is
//   `footnote-target-missing`  a `href="#fn-…"` / `#fnref-…` whose old id is not in the tree
//   `fragment-link-unresolved` a `#…` link that is not a footnote and names no heading of its note (a block link `#^id`, a nested path `#A#B`, a heading that is not there); left as it is
//   `heading-level-clamped`    headings that would lie below `h6`; held at `h6`
//   `embed-not-loaded`         a markdown embed without `is-loaded` (its content may still be on the way); marked all the same
// Measured in the live app (pilot `anchor-walk`, Obsidian 1.15.1, 2026-11-19): on a note with duplicate headings, skipped levels, a footnote referenced three times, five heading links, an embedded note
// that embeds a third and a section embed, `checkAnchors` finds 6 dead links before the walk (all heading links) and 0 after; four renders differ byte for byte before the walk (four hashes) and are
// equal after it (one hash); no 16-digit hex is left. The pilot note nests three notes deep, so one level lies below `h6` and is reported as `heading-level-clamped`.
// Known limits: heading links with a nested path or a block id are not resolved (reported); a `k` beyond the third reference is assumed to count on (measured to 2, the third reference); links to other notes
// (`href` not starting with `#`) belong to the link resolver of the exporter and are not touched; the walk runs ONCE on a tree (a second run finds the ids it set and reports them as replaced);
// Plugin blocks (Dataview, Bases) and `<iframe>` content are not measured.

import type { NoteMarks } from "./anchor-marks";
import { shiftHeadingLevels } from "./anchor-marks";

export type AnchorWalkFinding =
  | { kind: "heading-id-replaced"; id: string; text: string }
  | { kind: "footnote-form-unknown"; id: string }
  | { kind: "footnote-id-collision"; id: string; mark: string }
  | { kind: "footnote-target-missing"; href: string }
  | { kind: "fragment-link-unresolved"; href: string; text: string }
  | { kind: "heading-level-clamped"; count: number }
  | { kind: "embed-not-loaded"; mark: string };

/** What the walk needs from its host. `createEl` makes the element that replaces a heading whose level changes (the plugin passes Obsidian's global `createEl`; `document.createElement`
 *  would break the store rule `prefer-create-el`, and a pure module has no global to reach for). */
export interface AnchorWalkPorts {
  createEl(tag: string): Element;
}

export interface AnchorWalkOptions {
  /** Level of the outermost note's first heading. Default 2 (the page keeps `h1`). `false`: the levels are left as Obsidian rendered them. */
  baseLevel?: number | false;
}

export interface AnchorWalkResult {
  headings: number;
  footnotes: number;
  footnoteRefs: number;
  embeds: number;
  /** Heading links (`href="#Text"`) that were pointed at a mark. */
  linksRewritten: number;
  /** Headings whose element was replaced because their level changed. */
  levelsChanged: number;
  findings: AnchorWalkFinding[];
}

// `fn-<n>-<hex>`, `fnref-<n>-<hex>` and, for the second and later reference to the same footnote, `fnref-<n>-<k>-<hex>` (measured: `fnref-1-1-<hex>`, shown as "[1-1]"); the hex is 16 digits.
const FOOTNOTE_ID = /^(fn|fnref)-(\d+)(?:-(\d+))?-[0-9a-f]{8,}$/;
const FOOTNOTE_LIKE = /^fn(?:ref)?[-:_\d]/;
const HEADING_TAG = /^H([1-6])$/;

interface Scope {
  marks: NoteMarks;
  parent: Scope | null;
  /** Number of the parent's headings that came before this embed (decides its base level). */
  parentHeadings: number;
  headings: Array<{ el: Element; level: number }>;
  /** Heading marks by normalised text, the first heading wins. */
  byText: Map<string, string>;
  embeds: number;
  children: Scope[];
}

interface HashLink {
  el: Element;
  scope: Scope;
}

function normaliseText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function elementChildren(el: Element): Element[] {
  return Array.from(el.children);
}

function hasClass(el: Element, name: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(name);
}

/** The text a heading is called: Obsidian's own attribute, else what it shows. */
function headingText(el: Element): string {
  const own = el.getAttribute("data-heading");
  return own !== null && own !== "" ? own : (el.textContent ?? "");
}

/** Walk the rendered tree of one note, set the marks, and return what was found. The tree is changed in place; `root` itself is not given an id. */
export function walkAnchors(root: Element, marks: NoteMarks, ports: AnchorWalkPorts, options: AnchorWalkOptions = {}): AnchorWalkResult {
  const findings: AnchorWalkFinding[] = [];
  const result: AnchorWalkResult = { headings: 0, footnotes: 0, footnoteRefs: 0, embeds: 0, linksRewritten: 0, levelsChanged: 0, findings };
  const newScope = (m: NoteMarks, parent: Scope | null, parentHeadings: number): Scope => {
    const s: Scope = { marks: m, parent, parentHeadings, headings: [], byText: new Map(), embeds: 0, children: [] };
    parent?.children.push(s);
    return s;
  };
  const top = newScope(marks, null, 0);

  const footnoteMap = new Map<string, string>(); // old id → new id (whole tree: the hex makes an old id unique)
  const footnoteMarks = new Set<string>(); // new ids handed out, for the collision check
  const hashLinks: HashLink[] = [];

  /** Rewrite a footnote id (`id` or `data-footnote-id`) of an element in `scope`; true when it was one. */
  const footnoteId = (value: string, scope: Scope): string | null => {
    const known = footnoteMap.get(value);
    if (known !== undefined) return known;
    const m = FOOTNOTE_ID.exec(value);
    if (m === null) {
      if (FOOTNOTE_LIKE.test(value)) findings.push({ kind: "footnote-form-unknown", id: value });
      return null;
    }
    const n = Number(m[2]);
    const next = m[1] === "fn" ? scope.marks.footnote(n) : m[3] === undefined ? scope.marks.footnoteRef(n) : scope.marks.footnoteRef(n, Number(m[3]));
    if (m[1] === "fn" && m[3] !== undefined) {
      findings.push({ kind: "footnote-form-unknown", id: value });
      return null;
    }
    if (footnoteMarks.has(next)) {
      findings.push({ kind: "footnote-id-collision", id: value, mark: next });
      return null;
    }
    footnoteMarks.add(next);
    footnoteMap.set(value, next);
    if (m[1] === "fn") result.footnotes++;
    else result.footnoteRefs++;
    return next;
  };

  // Pass 1: depth-first, explicit stack (a deep note must not exhaust the call stack), document order.
  const frames: Array<{ scope: Scope; next: number; kids: Element[] }> = [];
  const visit = (el: Element, scope: Scope): Scope => {
    const tag = el.tagName.toUpperCase();
    const heading = HEADING_TAG.exec(tag);
    if (heading !== null) {
      const text = headingText(el);
      const had = el.getAttribute("id");
      if (had !== null && had !== "") findings.push({ kind: "heading-id-replaced", id: had, text });
      const mark = scope.marks.heading(text);
      el.setAttribute("id", mark);
      scope.headings.push({ el, level: Number(heading[1]) });
      const key = normaliseText(text);
      if (!scope.byText.has(key)) scope.byText.set(key, mark);
      result.headings++;
      return scope;
    }
    // Footnote ids first: an element that carries one is not an embed or a heading.
    for (const attr of ["id", "data-footnote-id"] as const) {
      const value = el.getAttribute(attr);
      if (value === null || value === "") continue;
      const next = footnoteId(value, scope);
      if (next !== null) el.setAttribute(attr, next);
    }
    if (tag === "A") {
      const href = el.getAttribute("href");
      if (href !== null && href.startsWith("#")) hashLinks.push({ el, scope });
    }
    if (tag === "SPAN" && hasClass(el, "markdown-embed")) {
      scope.embeds++;
      const inner = newScope(scope.marks.embed(scope.embeds), scope, scope.headings.length);
      el.setAttribute("id", inner.marks.mark);
      if (!hasClass(el, "is-loaded")) findings.push({ kind: "embed-not-loaded", mark: inner.marks.mark });
      result.embeds++;
      return inner;
    }
    return scope;
  };

  // The root itself is entered without being visited (it is the host), its children are.
  frames.push({ scope: top, next: 0, kids: elementChildren(root) });
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const child = frame.kids[frame.next++];
    if (child === undefined) {
      frames.pop();
      continue;
    }
    const childScope = visit(child, frame.scope);
    // `visit` returns the scope the CHILD's content belongs to (an embed opens a new one).
    frames.push({ scope: childScope, next: 0, kids: elementChildren(child) });
  }

  // Pass 2a: links. A footnote link follows the map; a heading link goes to the mark of the first heading with that text in its note.
  for (const { el, scope } of hashLinks) {
    const href = el.getAttribute("href") ?? "";
    const target = footnoteMap.get(href.slice(1));
    if (target !== undefined) {
      el.setAttribute("href", `#${target}`);
      continue;
    }
    if (FOOTNOTE_ID.test(href.slice(1))) {
      findings.push({ kind: "footnote-target-missing", href });
      continue;
    }
    const raw = el.getAttribute("data-href");
    let wanted = raw !== null && raw.startsWith("#") ? raw.slice(1) : href.slice(1);
    if (raw === null) {
      try {
        wanted = decodeURIComponent(wanted);
      } catch {
        // an undecodable fragment is looked up as it stands
      }
    }
    const mark = wanted === "" || wanted.startsWith("^") || wanted.includes("#") ? undefined : scope.byText.get(normaliseText(wanted));
    if (mark === undefined) {
      findings.push({ kind: "fragment-link-unresolved", href, text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) });
      continue;
    }
    el.setAttribute("href", `#${mark}`);
    if (el.getAttribute("data-href") !== null) el.setAttribute("data-href", `#${mark}`);
    result.linksRewritten++;
  }

  // Pass 2b: levels, parent notes before the notes embedded in them.
  if (options.baseLevel !== false) {
    const base = options.baseLevel ?? 2;
    let clamped = 0;
    // Parent before child, with an explicit stack (embeds can nest). `overflow`: the start lies below `h6`, so every heading of the note is held at `h6` and counted;
    // the count of `shiftHeadingLevels` would count only the nested ones.
    const open: Array<{ scope: Scope; from: number; overflow: boolean }> = [{ scope: top, from: base, overflow: false }];
    for (let job = open.pop(); job !== undefined; job = open.pop()) {
      const { scope, from, overflow } = job;
      const own = shiftHeadingLevels(scope.headings.map((h) => h.level), from);
      clamped += overflow ? scope.headings.length : own.clamped;
      scope.headings.forEach((h, i) => {
        const level = overflow ? 6 : (own.levels.at(i) ?? 6);
        own.levels[i] = level;
        if (level === h.level) return;
        const swap = ports.createEl(`h${level}`);
        for (const attr of Array.from(h.el.attributes)) swap.setAttribute(attr.name, attr.value);
        while (h.el.firstChild !== null) swap.appendChild(h.el.firstChild);
        h.el.replaceWith(swap);
        result.levelsChanged++;
      });
      for (const child of scope.children) {
        const above = child.parentHeadings > 0 ? own.levels.at(child.parentHeadings - 1) : undefined;
        const beneath = above === undefined ? from : above + 1;
        open.push({ scope: child, from: Math.min(beneath, 6), overflow: beneath > 6 });
      }
    }
    if (clamped > 0) findings.push({ kind: "heading-level-clamped", count: clamped });
  }
  return result;
}
