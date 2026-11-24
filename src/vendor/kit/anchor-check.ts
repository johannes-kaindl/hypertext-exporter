// vendored from code-kit@0.89.0, src/ts/web/anchor-check.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: new in code-kit (Welle 36, h1c, order 6 of the hypertext-exporter plan, the "Nachtrag" of 2026-11-19; spec 10.4: "Jede Marke ist eindeutig, und jedes interne
// Ziel existiert; beides prüft der Export am Ende und meldet Verstöße als Fehler"). Measured before building: no module in code-kit or obsidian-kit checks ids or
// fragment links (`link-guard` reads the SCHEME of an `href` and cuts `id` from an inline `<svg>`; `svg-guard` has its own `fragmentIds` for one SVG file, order 24 lifts it).
//
// `checkAnchors(root, options?)` reads a tree and answers two questions about it, as a list of findings and not as a throw:
//   * `duplicate-id`  — an `id` that more than one element carries (`count` says how many);
//   * `dead-link`     — an `<a href="#x">` or `<area href="#x">` whose target `x` is not in the tree.
// A finding is DATA for the caller to put in its findings list (spec 10.9); the function never throws on what it reads, whatever the tree holds.
//
// What counts as a target, by the rule a browser applies when it follows `#x` (HTML "find a potential indicated element"):
//   * an element with `id="x"`; the fragment is also tried percent-decoded (`#a%20b` finds `id="a b"`), and a fragment that does not decode (`%E0%A4%A`) is
//     taken as it stands;
//   * an `<a name="x">` (the old anchor form; Obsidian does not write it, a hand-written note may);
//   * the empty fragment (`href="#"`) and `#top` (when no element has the id `top`) — the browser scrolls to the top, so they are not dead;
//   * every name in `options.knownTargets`: places the page has outside the tree that is checked (a fixed header, the search box).
// Only same-document links are looked at (an `href` that starts with `#` after the ASCII whitespace the URL parser strips). `other.html#x` and `https://…#x` point into another document and are not this function's
// question. An `id=""` is not an id (the empty string names nothing). The root's own `id` counts when the root is an element. A `<template>` content is not entered
// (it is inert and a link to it is dead in a browser too).
//
// Linear: one pass over the elements that carry an `id` or a `name`, one over the links; the lookups are Map and Set operations.
// Output order is fixed: duplicates in the order of their first element, then dead links in document order. Same tree, same list.

export type AnchorFinding =
  | {
      kind: "duplicate-id";
      /** The id that more than one element carries. */
      id: string;
      /** How many elements carry it (2 or more). */
      count: number;
    }
  | {
      kind: "dead-link";
      /** The `href` as written, with its `#`. */
      href: string;
      /** The element name: `a` or `area`. */
      tag: string;
      /** The text of the link, whitespace collapsed, at most 60 characters (a place to look for it). */
      text: string;
    };

export interface AnchorCheckOptions {
  /** Targets that live outside the tree being checked (without `#`). A link to one of them is not dead. */
  knownTargets?: Iterable<string>;
}

function decoded(fragment: string): string | null {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return null; // malformed escape: only the raw form can match
  }
}

/** The URL parser strips leading and trailing ASCII whitespace (tab, LF, FF, CR, space) from an `href`, nothing else; a plain loop, no regex that could back up. */
function stripUrlSpace(href: string): string {
  const ws = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r";
  let a = 0;
  let b = href.length;
  while (a < b && ws(href.charAt(a))) a++;
  while (b > a && ws(href.charAt(b - 1))) b--;
  return href.slice(a, b);
}

function collapse(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

/** Check ids and `#` links of a tree; see the module header. */
export function checkAnchors(root: ParentNode, options: AnchorCheckOptions = {}): AnchorFinding[] {
  const ids = new Map<string, number>();
  const names = new Set<string>();
  const count = (id: string): void => {
    if (id !== "") ids.set(id, (ids.get(id) ?? 0) + 1);
  };

  // The root itself, when it is an element.
  const self = root as Partial<Element>;
  if (self.nodeType === 1 && typeof self.getAttribute === "function") count(self.getAttribute("id") ?? "");
  for (const el of Array.from(root.querySelectorAll("[id]"))) count(el.getAttribute("id") ?? "");
  // an empty `name` is never looked up (the empty fragment is answered first), so it needs no guard
  for (const el of Array.from(root.querySelectorAll("a[name]"))) names.add(el.getAttribute("name") ?? "");
  const known = new Set<string>(options.knownTargets ?? []);

  const findings: AnchorFinding[] = [];
  for (const [id, n] of ids) if (n > 1) findings.push({ kind: "duplicate-id", id, count: n });

  const exists = (fragment: string): boolean => {
    if (fragment === "") return true;
    if (ids.has(fragment) || names.has(fragment) || known.has(fragment)) return true;
    const d = decoded(fragment);
    if (d !== null && d !== fragment && (ids.has(d) || names.has(d) || known.has(d))) return true;
    return fragment === "top";
  };
  for (const el of Array.from(root.querySelectorAll("a[href], area[href]"))) {
    const href = stripUrlSpace(el.getAttribute("href") ?? "");
    if (!href.startsWith("#")) continue;
    if (exists(href.slice(1))) continue;
    findings.push({ kind: "dead-link", href, tag: el.tagName.toLowerCase(), text: collapse(el.textContent ?? "") });
  }
  return findings;
}
