// vendored from code-kit@0.86.1, src/ts/pure/csp.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: lifted from four private Content-Security-Policy strings (Welle 36, h1c, order 4 of the hypertext-exporter plan, spec 7.2, 7.3, 10, 14). Measured 2026-11-19:
//   obsidian-paperize    src/obsidian/export-desktop.ts:26   PRINT_CSP          default-src 'none'; style-src 'unsafe-inline' https:; font-src data: https:; img-src data: https:
//   obsidian-kit         pilot/papier-profil.ts:18           CSP                (the same string as paperize: the pilot prints what paperize prints)
//   obsidian-letterhead  src/obsidian/html-engine.ts:226     PRINT_CSP          default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:
//   slide-deck           src/export.ts:25                    MOBILE_EXPORT_CSP  default-src 'none'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; base-uri 'none'; form-action 'none'
//   code-kit             pure/print-document.ts              takes the value as input, owns none (its test uses a two-directive example)
// The consumers do not move in this commit (the breadth does that). The differences between the strings, each with its reason or its end:
//   * `https:` in `style-src` and `font-src` — PAPERIZE ONLY. Reason: paperize prints the CSS it collects from the live window (`web/collect-css`), and a community
//     theme there may `@import` a style sheet or load a web font over https; letterhead writes its own CSS and has none. Kept as the second constant
//     (`CSP_PRINT_WEBVIEW_THEMED`); a consumer that inlines everything takes `CSP_PRINT_WEBVIEW` and loses nothing.
//   * `blob:` in `img-src` — SLIDE-DECK ONLY, and it DISAPPEARS as a difference (master decision, 2026-11-19): slide-deck calls `createObjectURL` nowhere (src and
//     vendor/deck-core), the comment at `MOBILE_EXPORT_CSP` justifies `data:` and `https:` and not `blob:`, and a loose file without a script cannot make a `blob:` URL
//     (only a script does). Without a reason it is drift, not inheritance. `CSP_LOOSE_FILE` is therefore the same policy as `CSP_PRINT_WEBVIEW`, under the name of its purpose.
//   * `base-uri 'none'; form-action 'none'` — SLIDE-DECK ONLY, and it DISAPPEARS as a difference: both directives do NOT fall back to `default-src`, so a policy that
//     leaves them out allows a `<base href>` and a form post. Every constant here carries them. The bytes of the paperize and letterhead strings change by exactly
//     these two directives (MIGRATION); nothing those documents do today uses either.
//   * each constant keeps the order of directives of the string it replaces (they differ: paperize writes `font-src` before `img-src`, letterhead and slide-deck after);
//     `default-src` stays first and `base-uri`, `form-action` last. The order has no meaning to the browser, and a test compares bytes, so it is fixed.
//
// The new policy is for a stand-alone page (`cspStandalonePage`): no network, one `<style>` and one `<script>` that are named by their SHA-256 digest, nothing else
// executes. Measured in Chromium 153 (chrome-headless-shell from the Playwright cache, `npm run check:csp-chromium`): a script whose digest is not in the policy does not
// run, the same script with its digest does, a one-byte change after the digest was taken stops it, and an image next to the file (`img-src 'self'`) loads from file://.
//   default-src 'none'; style-src <hashes>; style-src-attr 'unsafe-inline'; script-src <hashes>; img-src data: [or 'self' data:]; media-src data: [or 'self' data:];
//   base-uri 'none'; form-action 'none'; frame-src 'none'
// `style-src-attr 'unsafe-inline'` allows `style="…"` attributes only: a hash in `style-src` covers `<style>` elements, never attributes, and an exported note carries
// attributes (colours, widths). It does not allow a `<style>` element or a `javascript:` anything. `frame-src 'none'` repeats what `default-src` already says, on purpose:
// the spec lists it, and a later edit of `default-src` must not open frames. An empty hash list gives `'none'` for that directive (no style, no script): the page then
// carries none of that kind, and nothing is allowed by accident.
//
// A digest is what `sha256Base64` (order 9) writes: 44 characters of standard Base64, `=` at the end. Anything else is REJECTED and returned in `rejected`, not
// dropped silently and not thrown: a quote or a `;` in a digest would end its source expression and write a directive of the caller's choosing. The directive then holds
// the digests that were fine; a page whose only script digest was rejected has `script-src 'none'` and its script does not run (it fails closed).
// A digest names the exact bytes between the tags, so the page and the policy have to be made from the same string; building both from one value is the caller's job (order 9).
// The relative-files variant is measured in Chromium only; Safari and Firefox treat `'self'` on a `file:` document differently and were not measured.

/** A SHA-256 digest as `sha256Base64` writes it: 43 Base64 characters and one `=`. */
const DIGEST = /^[A-Za-z0-9+/]{43}=$/;

/** True for a digest that may stand inside `'sha256-…'`. Total: anything that is not a string gives false. */
export function isCspDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

type Directive = readonly [name: string, sources: readonly string[]];

/** `name source source; name source …` — one place that writes the syntax, so no constant has a stray space or a missing semicolon. */
function serialize(directives: readonly Directive[]): string {
  return directives.map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
}

const NONE = "'none'";
const NO_BASE_OR_FORM: readonly Directive[] = [
  ["base-uri", [NONE]],
  ["form-action", [NONE]],
];

/** The document a print run takes in a blank `<webview>`, with CSS that is NOT the consumer's own (a collected theme): style sheets and fonts may also come over https.
 *  Was paperize's `PRINT_CSP` and the kit pilot's `CSP`, plus `base-uri` and `form-action`. No script, no frame, no connection. */
export const CSP_PRINT_WEBVIEW_THEMED: string = serialize([
  ["default-src", [NONE]],
  ["style-src", ["'unsafe-inline'", "https:"]],
  ["font-src", ["data:", "https:"]],
  ["img-src", ["data:", "https:"]],
  ...NO_BASE_OR_FORM,
]);

/** The same print run with CSS the consumer wrote itself (nothing over https but images). Was letterhead's `PRINT_CSP`, plus `base-uri` and `form-action`. */
export const CSP_PRINT_WEBVIEW: string = serialize([
  ["default-src", [NONE]],
  ["style-src", ["'unsafe-inline'"]],
  ["img-src", ["data:", "https:"]],
  ["font-src", ["data:"]],
  ...NO_BASE_OR_FORM,
]);

/** The loose file that the operating system opens (no `sandbox` frame around it) and that carries no script: the same policy as {@link CSP_PRINT_WEBVIEW}, named for
 *  its purpose. Was slide-deck's `MOBILE_EXPORT_CSP` minus `blob:` in `img-src` (no reason, see the header). */
export const CSP_LOOSE_FILE: string = CSP_PRINT_WEBVIEW;

export interface StandalonePageOptions {
  /** Digests (Base64, see {@link isCspDigest}) of the `<style>` elements the page carries, in the order the caller wants them written. */
  styleDigests: readonly string[];
  /** Digests of the `<script>` elements the page carries. */
  scriptDigests: readonly string[];
  /** Where images and media come from: `"data"` (default) only from `data:` URLs, `"relative"` also from files next to the page (`'self'`; measured in Chromium on file://). */
  media?: "data" | "relative";
}

export interface StandalonePageCsp {
  /** The policy, ready for a `<meta http-equiv="Content-Security-Policy" content="…">` (through `escapeHtmlAttr`: it holds apostrophes). */
  csp: string;
  /** Digests that were not a SHA-256 Base64 digest, in the order given, each once. Empty when all were fine. */
  rejected: string[];
}

function hashSources(digests: readonly string[], rejected: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of Array.isArray(digests) ? (digests as readonly unknown[]) : []) {
    if (!isCspDigest(d)) {
      rejected.add(String(d));
      continue;
    }
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(`'sha256-${d}'`);
  }
  return out.length > 0 ? out : [NONE];
}

/** The policy of a stand-alone page: see the module header. Equal input gives equal bytes (the order of the digests is the caller's, repeats are written once). */
export function cspStandalonePage(options: StandalonePageOptions): StandalonePageCsp {
  const rejected = new Set<string>();
  const style = hashSources(options.styleDigests, rejected);
  const script = hashSources(options.scriptDigests, rejected);
  const media = options.media === "relative" ? ["'self'", "data:"] : ["data:"];
  const csp = serialize([
    ["default-src", [NONE]],
    ["style-src", style],
    ["style-src-attr", ["'unsafe-inline'"]],
    ["script-src", script],
    ["img-src", media],
    ["media-src", media],
    ...NO_BASE_OR_FORM,
    ["frame-src", [NONE]],
  ]);
  return { csp, rejected: [...rejected] };
}
