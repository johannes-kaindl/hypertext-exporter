// vendored from code-kit@0.89.0, src/ts/web/export-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { decodeCssEscapes, parseCssDeclarations, parseCssRules, readCssUrls, type CssDeclaration } from "./css-rules";
import { trimUrlLikeBrowser } from "./safe-markdown";
import { linkScheme } from "./link-guard";
import { checkSvg, type SvgGuardOptions } from "./svg-guard";

/** Protective pass for an exported page: cuts what RUNS or NAVIGATES out of a DOM tree before it is serialized, and keeps what is shown
 *  (images, video, audio, inline SVG after `checkSvg`, `style` attributes). One pass over the tree, never a regex over HTML (CORE-DATA-04).
 *
 *  ── Why not `link-guard` (and `remote-resources`) ───────────────────────────────────────
 *  `link-guard` is built for a chat answer: it removes EVERY `<img>`, `<video>`, `<audio>`, `<source>` and `<style>` and every `<svg>` that is not a
 *  shape-only icon, strips `src`/`srcset` from the rest, and keeps only `http(s)`/`mailto` link targets. An export is the opposite: the pictures
 *  and the Mermaid diagrams ARE the content, and the page is opened from a file, where relative links stay. What both share is the knowledge
 *  of the carriers, so the tests here start from the carrier catalogue of `tests/link-guard.test.ts` (form `action`, `formaction`, `ping`,
 *  MathML `href`, `xlink:href`, `srcdoc`, `on*`) and `linkScheme` is reused as it is (it reads the scheme the way the URL parser does, and a
 *  little stricter: zero-width characters are skipped too, the safe side). Differences, each with its reason: (1) media stay, because they are
 *  the content; (2) an inline `<svg>` is not thinned to an icon but judged whole by `checkSvg` and REPLACED by the tree it returns, because a
 *  Mermaid diagram has `<style>`, markers, gradients and `url(#id)`, and the contract of `checkSvg` is "insert the checked tree, never the
 *  text"; (3) `data:` targets are decided by media type (raster image, audio, video stay; `text/html`, `image/svg+xml` and every other type go),
 *  not removed wholesale, because the exporter embeds images as `data:`; (4) no switch for `obsidian:` links: the page leaves Obsidian, an
 *  `obsidian://` link is a navigation of the reader's machine and is left to the exporter's link policy, not touched here.
 *
 *  ── The rules ───────────────────────────────────────────────────────────────────────────
 *  Elements removed with their subtree: `script`, `iframe`, `frame`, `frameset`, `object`, `embed`, `webview`, `applet`, `portal`, `fencedframe`,
 *  `form`, `base`, `bgsound`, `link`, and every `<meta>` with an `http-equiv` (not only `refresh`); also `noscript`, `xmp`, `noembed`, `noframes`, `plaintext`, whose content
 *  an HTML serializer writes UNESCAPED and a browser with scripting reads in another mode than the parser that built this tree (the classic
 *  re-parse break-out: `<noscript><p title="</noscript><script>…">`). A `<style>` whose text holds `</style` goes for the same reason. An
 *  inline `<svg>` outside another `<svg>` goes through `checkSvg`: ok → replaced by the checked tree; refused → removed and reported with the
 *  first problem. `<template>` content is entered.
 *  Attributes removed from every element: `on*` (any case, any namespace), `srcdoc`, `ping`. Attributes that name a URL (`href` in any
 *  namespace, `src`, `formaction`, `data`, `poster`, `background`, `codebase`, `cite`, `longdesc`, `manifest`, and each candidate of
 *  `srcset`): removed when the scheme is `javascript` or `vbscript`, or `data` with a media type that is not a raster image, audio or video.
 *  `style` attributes: every DECLARATION with a `url(` that is not `data:`, with `src(`, `image-set(`, `image(`, `cross-fade(`, `attr(`,
 *  `expression(`, `-moz-binding`, or a backslash outside a string (a function name spelled with an escape) goes; the others stay as they were
 *  written. A `<style>` ELEMENT holding an `@import`, such a declaration or a `url(` that is not `data:` goes as a whole (the rewrite of a sheet
 *  is not worth its risk; the exporter writes its own styles after this pass). A comment that could end itself (`-->`, `--!>`, a start with
 *  `>`) goes.
 *
 *  ── Why `<link>` and `<meta http-equiv>` go (Welle 37, review of etappe 10, finding 1) ───
 *  A `<link rel="preconnect|dns-prefetch|prefetch|preload|modulepreload|stylesheet" href="http://elsewhere">` in the BODY opens a DNS lookup and a TCP
 *  connection from the finished page (measured in Chrome 158, also with the page's Content-Security-Policy: the CSP blocks the request, not the
 *  hint): whoever gets a note with that line into the set learns when and from which address the page is opened. An export has no use for a `<link>`
 *  in the body, the exporter writes its own head AFTER this pass, so the element goes whatever its `rel`. A `<meta http-equiv>` is a pseudo header
 *  (`refresh`, `set-cookie`, `content-security-policy`, `x-dns-prefetch-control`, `default-style`, `link`, …): a browser reads most of them
 *  only in the head, but which ones changes with the version, and the exporter writes the ones it wants itself, so every one goes, not only
 *  `refresh`. `<meta charset>`, `<meta name=…>` and `itemprop` stay (they do nothing in a body and a note may carry them).
 *
 *  ── DOM clobbering (finding 4) ──────────────────────────────────────────────────────────
 *  Measured in Chrome 158 (a page that appends each tag with `name` and with `id` and asks `window[x]` and `document[x]`): `name` makes a named property of
 *  `document` (and of `window`) on `img`, `form`, `embed`, `object`, `iframe` — and on nothing else (`a`, `area`, `input`, `map`, `button` do
 *  not; `<image>` is parsed as `img`); `id` makes one of `document` only on `object`, and of `window` on every element. `<img name="getElementById">`
 *  therefore replaces `document.getElementById` for every script of the page (the search script of the exporter stopped, silently). Four of the five
 *  carriers are removed with their subtree anyway; the `name` of the one that stays, `img`, goes (the attribute is obsolete there; a note
 *  has no use for it). `id` stays: a jump mark needs it, and a window property made by an `id` never replaces an own property or a declared global of
 *  the page (`document`, `location`, `fetch` stay what they are), it only answers an identifier that no script declared. The scripts of the exported page are
 *  the exporter's own, they declare what they use and read the document through the prototype; a script that reads an undeclared global would
 *  be the bug, and `name` on a carrier cannot reach it any more.
 *
 *  ── The tree after the pass is re-read until it is stable (finding 2, mutation XSS) ─────
 *  A tree that is serialized and parsed again can come back as another tree: the classic form is `<math><mtext><table><mglyph><style><img src=x
 *  onerror=…>` (DOMPurify 2.0.0): in the parsed tree the `<style>` is an HTML element with a text child that holds the `<img>`, after the
 *  serializer wrote it and the browser parsed it again `<mglyph>` is MathML, the `<style>` below it is MathML too, and the `<img>` is a real element
 *  with its handler (same with `malignmark`, with `<svg></p><style>`, with `<form><math><mtext></form><form><mglyph><style>`). No rule on the tree
 *  sees that, because the tree it sees is the wrong one. So, after the rules, `guardExportTree` serializes the children of `root`, parses
 *  that string in a new inert document (`DOMParser`, a `<body>` context), runs the rules on the NEW tree and serializes it: the string of the first and
 *  of the second round are equal and the second round found nothing = a fixed point, the tree is what any later parse of its serialization gives
 *  and the rules have looked at that one. If not, the tree changed by being read again: that is a finding (`kind: "reparse"`, the first one of the
 *  round), `root` gets the protected tree of the NEW round, and the loop goes on. After `MAX_REPARSE_ROUNDS` (3) rounds without a fixed point
 *  the children of `root` are all removed and a finding says so — a tree that does not settle is not let through. That costs the WHOLE root, also the harmless text before the hostile
 *  part: measured, a chain of three nested `<math><mtext><table><mglyph><style><img onerror>` forms empties the root (one or two settle in one or two rounds and the text stays). Safe, but a loss
 *  of content, and on purpose (a per-child retry would be more code on the one path that must not be wrong); a consumer reports that finding as an error with the note's path, never silently. Contract for the caller: the tree
 *  it holds after the call is protected AND stable under one more serialize/parse; it may differ from the tree it passed in (not only by what was
 *  cut) when a `reparse` finding is in the list, so keep no node references into it from before the call. A normal note gives no `reparse` finding
 *  (the positive list of the Chromium run checks that, Mermaid SVG included); one that does is hostile or cannot be exported faithfully.
 *  `root` is read as a flow-content container (`div`, `main`, a `DocumentFragment`, a `<template>` content); a `Document` is judged whole by the
 *  rules and has its `<body>` re-read. The tree is read at most three more times, so the work stays linear.
 *
 *  ── Click traps (finding 3) ─────────────────────────────────────────────────────────────
 *  `style-src-attr 'unsafe-inline'` lets a note lay a transparent link over the whole page: `<a href="http://elsewhere" style="position:fixed;inset:0;
 *  z-index:2147483647;opacity:0">` catches every click, also on the table of contents and the search field. Default (`fixedPosition: "remove"`): a
 *  `style` attribute loses its `position` declaration unless the value is `static`, `relative`, `absolute` or a CSS-wide keyword (so `fixed`, `sticky`,
 *  `-webkit-sticky` and a `var()` or an escape that could spell them go; the property name is read with its escapes decoded). An export has no
 *  fixed element. Measured for Mermaid 11.16.0 (its bundle): it writes `position` into a `style` attribute only as `absolute` (once, `.style("position", "absolute")`;
 *  the one `fixed` in it is the SVG ATTRIBUTE `position="fixed"` on a gantt `foreignObject`, which CSS does not read, and `checkSvg` refuses a `foreignObject` anyway). Not measured: MathJax and
 *  the DOM that Obsidian renders (both are in the consumer's fixtures, which it measures; the Chromium run keeps a `position: relative` and a Mermaid-like SVG in its positive list). `"keep"` leaves the attribute alone. Not covered, and
 *  not claimable: `position: absolute` and `relative` with an offset, a negative margin, a transform or a huge box can cover the page too; the page that
 *  embeds the note needs `contain: paint` (or a transform) on the container of the note so that nothing of it paints or positions outside. This option is
 *  the cheap first net, the container is the second. **The container does not reach the TOP LAYER** (review round 2): a `<button popovertarget="p">` with a `<div popover id="p">`, or a
 *  `<button commandfor="d" command="show-modal">` with a `<dialog id="d">`, holds the same invisible link over the whole page after ONE click on the bait, in the top layer, where
 *  `contain: paint` does not apply, so the next click anywhere leaves the page (measured in Chrome 158, also with the page's CSP). The attributes `popover`, `popovertarget`,
 *  `popovertargetaction`, `commandfor`, `command`, `interestfor` and `interesttarget` are therefore removed from every element, in every spelling (the local name is read lower-cased,
 *  a `setAttributeNS(null, "POPOVER", …)` too); a note has no use for them. The other ways into the top layer need a script (`showModal()`, `showPopover()`, `requestFullscreen()`) or are the
 *  browser's own UI (a `<select>` list, a date or colour picker, the controls of a `<video>`); a `<dialog open>` is not in the top layer, but its UA style is `position: absolute`, which this pass
 *  does not touch: the `contain: paint` of the container holds it (the consumer's duty, above).
 *
 *  ── Limits ──────────────────────────────────────────────────────────────────────────────
 *  (1) The tree must be INERT (a `DOMParser` document or a `<template>` content, not attached to a window): a frame or script in a live
 *  document starts its work before this pass runs, and a frame leaves a live tree only later (`web/leave-tree`). (2) It judges the tree and then the
 *  tree that its serialization gives (above), in the parser of the RUNTIME it runs in: a parser that reads a string differently from the browser
 *  of the reader (happy-dom against Chromium, Chromium against Safari) leaves a gap the Chromium run measures only for Chromium; the Content-Security-Policy of
 *  the page (`pure/csp`, script digests) is the second line, this pass is the first. (3) Remote LOADS (`<img src="https://…">`; `url(https://…)` in a
 *  `<style>` is cut, in a `style` attribute too, but `<img>` is not): that is `remote-resources` and the exporter's choice; the `<link>` hints
 *  are cut here, because they are not a load the CSP can stop. (4) `<a href>` to an `http:` page, a relative file or `#fragment` stays: a link is not code. */

export type ExportGuardKind = "element" | "attribute" | "declaration" | "svg" | "comment" | "reparse";

export interface ExportGuardFinding {
  kind: ExportGuardKind;
  /** The element the finding sits on (lower-case local name). */
  element: string;
  /** The attribute or CSS property, when the finding is one. */
  name?: string;
  /** Why, in a few words. */
  detail: string;
}

export interface ExportGuardOptions {
  /** Passed to `checkSvg` for every inline `<svg>`. */
  svg?: SvgGuardOptions;
  /** What happens to a `position` declaration of a `style` attribute that is not `static`, `relative`, `absolute` or a CSS-wide keyword (`fixed`, `sticky`, …;
   *  the click trap of the module header). Default `"remove"`: the declaration goes, its neighbours stay. `"keep"` leaves it. */
  fixedPosition?: "remove" | "keep" | undefined;
}

/** Rounds of serialize, parse, protect, after which a tree that is still changing is emptied. */
export const MAX_REPARSE_ROUNDS = 3;

const REMOVED_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "webview", "applet", "portal", "fencedframe", "form", "base", "bgsound",
  "noscript", "xmp", "noembed", "noframes", "plaintext", "link",
]);
/** Elements whose `name` makes a property of `document` and `window` (measured in Chrome 158, see the header). Those that are in `REMOVED_ELEMENTS` never reach the attribute pass. */
const NAMED_ACCESS_CARRIERS: ReadonlySet<string> = new Set(["img", "form", "embed", "object", "iframe", "applet", "frame", "frameset"]);
const SAFE_POSITIONS: ReadonlySet<string> = new Set(["static", "relative", "absolute", "inherit", "initial", "unset", "revert", "revert-layer"]);
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src", "formaction", "data", "poster", "background", "codebase", "cite", "longdesc", "manifest"]);
/** The attributes that put an element into the TOP LAYER (or let a click do it) without a script: `popover` + `popovertarget`/`popovertargetaction`, the invoker `commandfor` + `command`
 *  (`show-modal`, `show-popover`, …), and `interestfor`/`interesttarget` (the interest invoker). See the module header, "Click traps". */
const TOP_LAYER_ATTRIBUTES: ReadonlySet<string> = new Set(["popover", "popovertarget", "popovertargetaction", "commandfor", "command", "interestfor", "interesttarget"]);
const ALWAYS_REMOVED_ATTRIBUTES: ReadonlySet<string> = new Set(["srcdoc", "ping"]);
const SAFE_DATA_TYPE = /^(?:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/;
const RISKY_FUNCTION = /src\(|image-set\(|image\(|cross-fade\(|attr\(|expression\(|-moz-binding/i;
const SVG_NS = "http://www.w3.org/2000/svg";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

/** HTML and CSS white space, and nothing else: space, tab, LF, FF, CR. JS `trim()` and `\s` also strip NBSP, U+FEFF, U+1680, U+2000..200A, U+2028/2029, U+202F, U+205F, U+3000 and VT, which a browser reads as
 *  characters of a token. For a judgement that LETS something stay (an allow list: media type, `position` value) the guard reads what the browser reads, so such a character is part
 *  of the token and the token is not on the list. Where a wider strip can only drop more it stays as it is: the property NAME compared with a deny list, the srcset candidates (a deny list: a candidate
 *  that starts with NBSP and `javascript:` is cut, a browser would read it as a relative path), `linkScheme`. */
function trimAsciiSpace(s: string): string {
  let start = 0;
  let end = s.length;
  const white = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
  while (start < end && white(s.charCodeAt(start))) start++;
  while (end > start && white(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}
/** ASCII letters lower-cased and nothing else: `toLowerCase()` turns the Kelvin sign (U+212A) into `k`, which a browser keeps as another character. */
function lowerAscii(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/** Is this URL value one that may stay on an element? `javascript:` and `vbscript:` never; `data:` only for a raster image, audio or video. */
export function isSafeExportTarget(value: string): boolean {
  const scheme = linkScheme(value);
  if (scheme === null) return true;
  if (scheme === "javascript" || scheme === "vbscript") return false;
  if (scheme !== "data") return true;
  const clean = trimUrlLikeBrowser(value);
  const body = clean.slice(clean.indexOf(":") + 1);
  const comma = body.indexOf(",");
  const type = (comma < 0 ? body : body.slice(0, comma)).split(";")[0] ?? "";
  return SAFE_DATA_TYPE.test(lowerAscii(trimAsciiSpace(type)));
}

/** A `position` that could lift an element out of its place over the page (`fixed`, `sticky`, anything that is not a known harmless value). */
function isPositionTrap(d: CssDeclaration): boolean {
  return decodeCssEscapes(d.name).trim().toLowerCase() === "position" && !SAFE_POSITIONS.has(lowerAscii(trimAsciiSpace(d.value)));
}

/** Is `url(...)` or a loading function in this declaration value something that may stay? Only `data:` URLs may. */
function declarationIsSafe(d: CssDeclaration, trap: boolean): boolean {
  if (trap && isPositionTrap(d)) return false;
  const { calls, obscured } = readCssUrls(d.value);
  if (obscured || RISKY_FUNCTION.test(d.value)) return false;
  return calls.every((c) => /^data:/i.test(c.value));
}

function cleanStyleAttribute(value: string, trap: boolean): { text: string; dropped: CssDeclaration[] } | null {
  const all = parseCssDeclarations(value);
  const dropped = all.filter((d) => !declarationIsSafe(d, trap));
  if (dropped.length === 0) return null;
  const kept = all.filter((d) => !dropped.includes(d));
  return { text: kept.map((d) => `${d.rawName}: ${d.value}${d.important ? " !important" : ""}`).join("; "), dropped };
}

function styleElementIsSafe(css: string): boolean {
  if (css.toLowerCase().includes("</style")) return false;
  const { calls, obscured } = readCssUrls(css);
  if (obscured || RISKY_FUNCTION.test(css) || !calls.every((c) => /^data:/i.test(c.value))) return false;
  const stack = [...parseCssRules(css).rules];
  for (let r = stack.pop(); r !== undefined; r = stack.pop()) {
    if (r.kind === "statement" && r.name === "import") return false;
    stack.push(...r.rules);
  }
  return true;
}

function candidates(srcset: string): string[] {
  // A deny-list judgement (`isSafeExportTarget` drops script and non-media targets): the wider JS strip and `\s` split can only find MORE, so `\u00a0javascript:x`
  // is cut here although a browser reads it as a relative URL (measured in the test: the one place where reading like the browser would LET MORE through).
  return srcset.split(",").map((c) => c.trim().split(/\s+/)[0] ?? "").filter((c) => c !== "");
}

/** An `<svg>` that is the root of an inline drawing. One inside another is cut or replaced together with its ancestor, which comes first in document order. */
function inlineSvgOutsideSvg(el: Element): boolean {
  return el.localName === "svg" && el.namespaceURI === SVG_NS;
}

function unsafeComment(data: string): boolean {
  return data.includes("--") || data.startsWith(">") || data.startsWith("->") || data.endsWith("-");
}

/** Cuts the active content out of `root` in place, re-reads the result until it is stable, and returns what it cut. See the module header for the
 *  rules, the contract of the re-read and the limits. */
export function guardExportTree(root: ParentNode, options: ExportGuardOptions = {}): ExportGuardFinding[] {
  const findings = protect(root, options);
  const target = (root as Node).nodeType === 9 ? ((root as Document).body as HTMLElement | null) : root; // a Document: its <body> is re-read
  if (target !== null) settle(target, options, findings);
  return findings;
}

/** The children of `root` as an HTML string (the serialization a page would carry). */
function serializeChildren(root: ParentNode): string {
  if ("innerHTML" in root) return (root as Element).innerHTML;
  const holder = (root as DocumentFragment).ownerDocument.createElement("div");
  for (const child of Array.from(root.childNodes)) holder.appendChild(child.cloneNode(true));
  return holder.innerHTML;
}

/** The `<body>` of an inert document parsed from `html`: what a browser makes of the string. */
function reparse(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html").body;
}

function replaceChildrenWith(root: ParentNode, from: ParentNode): void {
  const doc = (root as Node).ownerDocument as Document;
  const kids = Array.from(from.childNodes).map((n) => doc.importNode(n, true));
  while (root.firstChild !== null) root.removeChild(root.firstChild);
  for (const kid of kids) root.appendChild(kid);
}

/** Serialize, parse, protect, serialize, until two rounds give the same string and the second found nothing (see the module header). */
function settle(root: ParentNode, options: ExportGuardOptions, findings: ExportGuardFinding[]): void {
  let current = serializeChildren(root);
  for (let round = 1; round <= MAX_REPARSE_ROUNDS; round++) {
    const body = reparse(current);
    const again = protect(body, options);
    const next = serializeChildren(body);
    if (again.length === 0 && next === current) return;
    findings.push({ kind: "reparse", element: "#tree", detail: `the tree changed when its serialization was read again (round ${String(round)})` }, ...again);
    replaceChildrenWith(root, body);
    current = next;
  }
  while (root.firstChild !== null) root.removeChild(root.firstChild);
  findings.push({ kind: "reparse", element: "#tree", detail: `the tree did not settle in ${String(MAX_REPARSE_ROUNDS)} rounds: everything was removed` });
}

/** One pass of the rules over `root`. */
function protect(root: ParentNode, options: ExportGuardOptions): ExportGuardFinding[] {
  const trap = options.fixedPosition !== "keep";
  const findings: ExportGuardFinding[] = [];
  const roots: ParentNode[] = [root];
  for (let scope = roots.pop(); scope !== undefined; scope = roots.pop()) {
    for (const el of Array.from(scope.querySelectorAll("*"))) {
      if (!(scope as Node).contains(el)) continue; // cut together with an ancestor, or replaced
      const name = el.localName.toLowerCase();
      if (el.localName === "template" && (el as HTMLTemplateElement).content !== undefined) roots.push((el as HTMLTemplateElement).content);
      if (REMOVED_ELEMENTS.has(name)) { cut(el, name, "active element"); continue; }
      if (name === "meta" && el.hasAttribute("http-equiv")) { cut(el, name, trimUrlLikeBrowser(el.getAttribute("http-equiv") ?? "").toLowerCase() === "refresh" ? "meta refresh" : "meta http-equiv (a pseudo header)"); continue; }
      if (name === "style" && el.namespaceURI !== SVG_NS && !styleElementIsSafe(el.textContent ?? "")) { cut(el, name, "style element with a load, an import or a break-out"); continue; }
      if (inlineSvgOutsideSvg(el)) {
        const checked = checkSvg(new XMLSerializer().serializeToString(el), options.svg);
        // An Element always has its document: no fallback to the global one (a consumer's store lint, obsidianmd/prefer-active-doc, flags it).
        if (checked.ok) {
          const checkedSvg = el.ownerDocument.importNode(checked.svg, true);
          el.replaceWith(checkedSvg);
          if (trap) for (const inner of [checkedSvg, ...Array.from(checkedSvg.querySelectorAll("[style]"))]) cleanStyle(inner, inner.localName.toLowerCase());
        }
        else cut(el, "svg", `refused by checkSvg: ${checked.problems[0]?.code ?? "unknown"} ${checked.problems[0]?.detail ?? ""}`.trim(), "svg");
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const attrName = attr.name.toLowerCase();
        const local = attr.localName.toLowerCase();
        if (local.startsWith("on") || ALWAYS_REMOVED_ATTRIBUTES.has(local)) { drop(el, attr, name, local.startsWith("on") ? "event handler" : "loads or navigates"); continue; }
        if (TOP_LAYER_ATTRIBUTES.has(local)) { drop(el, attr, name, "puts an element into the top layer (click trap)"); continue; }
        if (attrName === "style") { cleanStyle(el, name); continue; }
        if (local === "name" && NAMED_ACCESS_CARRIERS.has(name) && el.namespaceURI !== SVG_NS && el.namespaceURI !== MATHML_NS) { drop(el, attr, name, "names a property of document and window (DOM clobbering)"); continue; }
        if (URL_ATTRIBUTES.has(local) && !isSafeExportTarget(attr.value)) { drop(el, attr, name, "script or non-media data target"); continue; }
        if (local === "srcset" && !candidates(attr.value).every(isSafeExportTarget)) drop(el, attr, name, "script or non-media data target");
      }
    }
    const walker = (scope as Document | Element).ownerDocument ?? (scope as Document);
    if (typeof walker.createTreeWalker === "function") {
      const tw = walker.createTreeWalker(scope, 128); // 128 = NodeFilter.SHOW_COMMENT
      const comments: Comment[] = [];
      for (let n = tw.nextNode(); n !== null; n = tw.nextNode()) comments.push(n as Comment);
      for (const c of comments) if (unsafeComment(c.data)) { c.remove(); findings.push({ kind: "comment", element: "#comment", detail: "comment that can end itself" }); }
    }
  }
  return findings;

  function cleanStyle(el: Element, name: string): void {
    const attr = el.getAttributeNode("style");
    if (attr === null) return;
    const cleaned = cleanStyleAttribute(attr.value, trap);
    if (cleaned === null) return;
    for (const d of cleaned.dropped) findings.push({ kind: "declaration", element: name, name: d.name, detail: trap && isPositionTrap(d) ? "position that can lay the element over the page (click trap)" : "url, loading function or escaped function name" });
    // by node, not by name: `removeAttribute("ONCLICK")` lower-cases the name in an HTML document and misses an attribute that `setAttributeNS(null, "ONCLICK", …)` made
    if (cleaned.text === "") el.removeAttributeNode(attr); else attr.value = cleaned.text;
  }
  function cut(el: Element, name: string, detail: string, kind: ExportGuardKind = "element"): void {
    findings.push({ kind, element: name, detail });
    el.remove();
  }
  function drop(el: Element, attr: Attr, name: string, detail: string): void {
    findings.push({ kind: "attribute", element: name, name: attr.name.toLowerCase(), detail });
    el.removeAttributeNode(attr);
  }
}
