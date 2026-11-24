// vendored from code-kit@0.88.0, src/ts/pure/screen-document.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: new in code-kit (Welle 36, h1c, order 9 of the hypertext-exporter plan, spec 10.8 and 12 layer 3). Measured 2026-11-19 before building:
//   * `print-document` (`buildPrintDocument`) is a PRINT document: no viewport, no `<title>`, no script, and its CSP is the caller's string. A screen page needs the
//     opposite on all three, and its CSP is derived from the page, so it is a second builder and not an option of the first (they share `html-escape`, nothing else).
//   * `csp` (`cspStandalonePage`) writes the policy from digests; `sha256` (`sha256Base64Utf8`, new with this order) writes the digest. This module is the place
//     where both are made from ONE string per block, which is the only way a digest and the bytes between the tags cannot drift apart.
//
// `buildScreenDocument({ title, lang, css, script, bodyHtml, … })` returns one stand-alone HTML file: charset, viewport, the Content-Security-Policy `<meta>` with the
// digests of exactly this style block and this script block, the title, the style, the body and the script. No clock, no random number, `\n` as the only line break:
// equal input gives equal bytes. Written once, in this order:
//   <!doctype html> / <html lang class> / <head> charset, viewport, CSP, title, <style> / </head> / <body class> body, <script> / </body> / </html>
//
// WHAT THE DIGEST COVERS. A CSP digest is the hash of the text between `<style>` and `</style>` (or the script tags), byte for byte, no tag, no trim. So the text is
// normalised FIRST (line breaks to `\n`), then hashed, then written: the hashed string and the written string are the same variable. Nothing is added inside
// the tags (no leading newline, no indentation).
//   * style: `<` becomes the CSS escape `\3C ` (as in `print-document`), so no `</style` can close the element; the digest is of the escaped text, as written.
//   * script: NOT changed. A script that holds `</script` (it would close the element and the browser would cut the program in two) or `<!--` (it moves the
//     parser into the "script data escaped" state, where the end tag can stop working) is REFUSED with an error value; rewriting a program to make it fit would change
//     what it does. A source that needs the text writes it as `<\/script` or `\x3C!--` itself.
//   * `bodyHtml` is the caller's trusted markup (the rendered note, already through the protective pass of order 11); it is not looked at here, and the CSP is the net:
//     with `script-src` naming one digest, a `<script>` in the body that is not that script does not run, and an `onclick=` attribute does not run either.
//   * `title` goes through `escapeHtmlText`, `lang`, `htmlClass` and `bodyClass` through `escapeHtmlAttr`.
// An empty `css` writes no `<style>` element (and `style-src 'none'`), a missing or empty `script` writes no `<script>` element (and `script-src 'none'`).
// `style="…"` attributes of the body are allowed by the policy (`style-src-attr 'unsafe-inline'`), see `csp`.
//
// Measured in Chromium 153 (`npm run check:csp-chromium`): the script of the built document runs; the same file with ONE byte of the script changed does not.

import { cspStandalonePage } from "./csp";
import { escapeHtmlAttr, escapeHtmlText } from "./html-escape";
import { sha256Base64Utf8 } from "./sha256";

export interface ScreenDocumentInput {
  /** The text of `<title>` (escaped here). */
  title: string;
  /** The `lang` of `<html>` (escaped here). */
  lang: string;
  /** One style block; "" writes none. */
  css: string;
  /** The page's one script; omitted or "" writes none. It must not contain `</script` or `<!--` (see the header). */
  script?: string;
  /** Trusted markup for the `<body>`, written as it is (line breaks normalised). */
  bodyHtml: string;
  htmlClass?: string;
  bodyClass?: string;
  /** Where images and media may come from, see `cspStandalonePage`. Default `"data"`. */
  media?: "data" | "relative";
}

export type ScreenDocumentError = "script-end-tag" | "script-comment-open";

export type ScreenDocumentResult =
  | {
      ok: true;
      /** The whole file. */
      html: string;
      /** The policy that is in the `<meta>`, unescaped. */
      csp: string;
      /** Digest of the style block as written, or null when there is none. */
      styleDigest: string | null;
      /** Digest of the script block as written, or null when there is none. */
      scriptDigest: string | null;
    }
  | { ok: false; error: ScreenDocumentError };

const LINE_BREAKS = /\r\n?/g;
const SCRIPT_END_TAG = /<\/script/i;
const SCRIPT_COMMENT_OPEN = /<!--/;

function lf(text: string): string {
  return text.replace(LINE_BREAKS, "\n");
}

/** Build the stand-alone page; see the module header. Never throws; a script the page cannot carry is an error value. */
export function buildScreenDocument(input: ScreenDocumentInput): ScreenDocumentResult {
  const script = lf(typeof input.script === "string" ? input.script : "");
  if (SCRIPT_END_TAG.test(script)) return { ok: false, error: "script-end-tag" };
  if (SCRIPT_COMMENT_OPEN.test(script)) return { ok: false, error: "script-comment-open" };
  const css = lf(typeof input.css === "string" ? input.css : "").replace(/</g, "\\3C ");
  const body = lf(typeof input.bodyHtml === "string" ? input.bodyHtml : "");

  const styleDigest = css === "" ? null : sha256Base64Utf8(css);
  const scriptDigest = script === "" ? null : sha256Base64Utf8(script);
  const { csp } = cspStandalonePage({
    styleDigests: styleDigest === null ? [] : [styleDigest],
    scriptDigests: scriptDigest === null ? [] : [scriptDigest],
    ...(input.media === undefined ? {} : { media: input.media }),
  });

  const htmlClass = input.htmlClass === undefined || input.htmlClass === "" ? "" : ` class="${escapeHtmlAttr(input.htmlClass)}"`;
  const bodyClass = input.bodyClass === undefined || input.bodyClass === "" ? "" : ` class="${escapeHtmlAttr(input.bodyClass)}"`;
  const html =
    "<!doctype html>\n" +
    `<html lang="${escapeHtmlAttr(input.lang)}"${htmlClass}>\n` +
    "<head>\n" +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttr(csp)}">\n` +
    `<title>${escapeHtmlText(input.title)}</title>\n` +
    (css === "" ? "" : `<style>${css}</style>\n`) +
    "</head>\n" +
    `<body${bodyClass}>\n` +
    body +
    "\n" +
    (script === "" ? "" : `<script>${script}</script>\n`) +
    "</body>\n</html>\n";
  return { ok: true, html, csp, styleDigest, scriptDigest };
}
