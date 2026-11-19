// vendored from code-kit@0.86.0, src/ts/web/export-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { parseCssDeclarations, parseCssRules, readCssUrls, type CssDeclaration } from "./css-rules";
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
 *  `form`, `base`, `bgsound`, and a `<meta http-equiv="refresh">`; also `noscript`, `xmp`, `noembed`, `noframes`, `plaintext`, whose content
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
 *  ── Limits ──────────────────────────────────────────────────────────────────────────────
 *  (1) The tree must be INERT (a `DOMParser` document or a `<template>` content, not attached to a window): a frame or script in a live
 *  document starts its work before this pass runs, and a frame leaves a live tree only later (`web/leave-tree`). (2) It judges the tree, not the
 *  bytes: a tree that serializes and re-parses to something else (mutation XSS) is only partly covered (the raw-text cases above); the
 *  Content-Security-Policy of the page (`pure/csp`, script digests) is the second line, this pass is the first. (3) Remote LOADS (`<img src="https://…">`,
 *  `<link rel=stylesheet>`, `url(https://…)` in a `<style>` is cut, in a `style` attribute too, but `<img>` and `<link>` are not): that is
 *  `remote-resources` and the exporter's choice. (4) `<a href>` to an `http:` page, a relative file or `#fragment` stays: a link is not code. */

export type ExportGuardKind = "element" | "attribute" | "declaration" | "svg" | "comment";

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
}

const REMOVED_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "webview", "applet", "portal", "fencedframe", "form", "base", "bgsound",
  "noscript", "xmp", "noembed", "noframes", "plaintext",
]);
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src", "formaction", "data", "poster", "background", "codebase", "cite", "longdesc", "manifest"]);
const ALWAYS_REMOVED_ATTRIBUTES: ReadonlySet<string> = new Set(["srcdoc", "ping"]);
const SAFE_DATA_TYPE = /^(?:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/;
const RISKY_FUNCTION = /src\(|image-set\(|image\(|cross-fade\(|attr\(|expression\(|-moz-binding/i;
const SVG_NS = "http://www.w3.org/2000/svg";

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
  return SAFE_DATA_TYPE.test(type.trim().toLowerCase());
}

/** Is `url(...)` or a loading function in this declaration value something that may stay? Only `data:` URLs may. */
function declarationIsSafe(d: CssDeclaration): boolean {
  const { calls, obscured } = readCssUrls(d.value);
  if (obscured || RISKY_FUNCTION.test(d.value)) return false;
  return calls.every((c) => /^data:/i.test(c.value));
}

function cleanStyleAttribute(value: string): { text: string; dropped: CssDeclaration[] } | null {
  const all = parseCssDeclarations(value);
  const dropped = all.filter((d) => !declarationIsSafe(d));
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
  return srcset.split(",").map((c) => c.trim().split(/\s+/)[0] ?? "").filter((c) => c !== "");
}

/** An `<svg>` that is the root of an inline drawing. One inside another is cut or replaced together with its ancestor, which comes first in document order. */
function inlineSvgOutsideSvg(el: Element): boolean {
  return el.localName === "svg" && el.namespaceURI === SVG_NS;
}

function unsafeComment(data: string): boolean {
  return data.includes("--") || data.startsWith(">") || data.startsWith("->") || data.endsWith("-");
}

/** Cuts the active content out of `root` in place and returns what it cut. See the module header for the rules and the limits. */
export function guardExportTree(root: ParentNode, options: ExportGuardOptions = {}): ExportGuardFinding[] {
  const findings: ExportGuardFinding[] = [];
  const roots: ParentNode[] = [root];
  for (let scope = roots.pop(); scope !== undefined; scope = roots.pop()) {
    for (const el of Array.from(scope.querySelectorAll("*"))) {
      if (!(scope as Node).contains(el)) continue; // cut together with an ancestor, or replaced
      const name = el.localName.toLowerCase();
      if (el.localName === "template" && (el as HTMLTemplateElement).content !== undefined) roots.push((el as HTMLTemplateElement).content);
      if (REMOVED_ELEMENTS.has(name)) { cut(el, name, "active element"); continue; }
      if (name === "meta" && trimUrlLikeBrowser(el.getAttribute("http-equiv") ?? "").toLowerCase() === "refresh") { cut(el, name, "meta refresh"); continue; }
      if (name === "style" && el.namespaceURI !== SVG_NS && !styleElementIsSafe(el.textContent ?? "")) { cut(el, name, "style element with a load, an import or a break-out"); continue; }
      if (inlineSvgOutsideSvg(el)) {
        const checked = checkSvg(new XMLSerializer().serializeToString(el), options.svg);
        if (checked.ok) { el.replaceWith((el.ownerDocument ?? document).importNode(checked.svg, true)); }
        else cut(el, "svg", `refused by checkSvg: ${checked.problems[0]?.code ?? "unknown"} ${checked.problems[0]?.detail ?? ""}`.trim(), "svg");
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const attrName = attr.name.toLowerCase();
        const local = attr.localName.toLowerCase();
        if (local.startsWith("on") || ALWAYS_REMOVED_ATTRIBUTES.has(local)) { drop(el, attr, name, local.startsWith("on") ? "event handler" : "loads or navigates"); continue; }
        if (attrName === "style") {
          const cleaned = cleanStyleAttribute(attr.value);
          if (cleaned !== null) {
            for (const d of cleaned.dropped) findings.push({ kind: "declaration", element: name, name: d.name, detail: "url, loading function or escaped function name" });
            if (cleaned.text === "") el.removeAttribute(attr.name); else el.setAttribute(attr.name, cleaned.text);
          }
          continue;
        }
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

  function cut(el: Element, name: string, detail: string, kind: ExportGuardKind = "element"): void {
    findings.push({ kind, element: name, detail });
    el.remove();
  }
  function drop(el: Element, attr: Attr, name: string, detail: string): void {
    findings.push({ kind: "attribute", element: name, name: attr.name.toLowerCase(), detail });
    el.removeAttribute(attr.name);
  }
}
