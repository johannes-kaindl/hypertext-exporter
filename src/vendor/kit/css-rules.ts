// vendored from code-kit@0.86.0, src/ts/pure/css-rules.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { trimUrlLikeBrowser } from "./safe-markdown";

/** One CSS splitter for the workspace: the rules of a style sheet, the declarations of a block (`style=`), the selector list of a rule and the
 *  `url()` calls of a value, read the way a browser reads them. No DOM, no I/O, linear in the text, never throws.
 *
 *  Origin: lifted from `web/svg-guard.ts` of code-kit@b02f1af (`parseRules`, `parseDeclarations`, `stripImportant`, `fragmentIds`; Welle 36, h1d,
 *  order 24 of the hypertext-exporter). The second carrier of the same job was the private splitter of the hypertext-exporter's `math-css.ts`
 *  (`splitRules`, `splitTopLevel`, `remoteUrls`, commit a01617c); it drops out when that repo vendors this file. `web/svg-guard` and
 *  `web/export-guard` (the protective pass for exported pages) read CSS through this file, so "what is a rule, what is a URL" has one answer.
 *
 *  ── What the splitter tracks ────────────────────────────────────────────────────────────
 *  Strings (a line break that is not escaped ends one, as in CSS), comments (also unterminated ones: they run to the end of the text), parentheses
 *  (a `;` `{` `}` inside `(…)` is part of the value) and backslash escapes (an escaped character is never structure: `\}` is text). **Inside the
 *  parentheses of `url(`, a slash-star is not a comment** (the body of an unquoted URL is a URL), the splitter therefore keeps it. A comment outside
 *  becomes one space in `prelude`, `value` and the like, so `a` + comment + `b` reads as two tokens, while `text` keeps the original characters.
 *  Nesting is a stack, not recursion: a depth of {@link CssParseOptions.maxDepth} (default 100) is the end of reading, `truncated` says so, the open
 *  rules are closed as unclosed. Nothing is repaired: an unclosed block yields its rule with `closed: false`.
 *
 *  ── Kinds ───────────────────────────────────────────────────────────────────────────────
 *  `style` (`a, b { … }`, also nested in another rule: its `prelude` is the inner selector only, the outer one is implied), `group` (`@media`,
 *  `@supports`, `@layer`, `@container`, `@scope`, `@starting-style`, `@document`: the children are rules), `keyframes` (with vendor prefix) and its
 *  `keyframe` steps (`from`, `50%`), `font-face`, `at` (any other at-rule with a block: `@page`, `@property`, `@counter-style` …) and `statement`
 *  (an at-rule that ends at `;`: `@import`, `@charset`, `@namespace`, `@layer a, b;`). Declarations stand in the rule that holds them, whatever
 *  the kind (`@font-face` has them, a group may hold bare ones).
 *
 *  ── URLs ────────────────────────────────────────────────────────────────────────────────
 *  {@link readCssUrls} finds every `url(` (any case, loose on purpose: `url(` inside a string is reported too, a false alarm costs a declaration, a
 *  miss costs a load). The body is decoded (CSS escapes) and trimmed the way the URL parser does ({@link trimUrlLikeBrowser}). A function name
 *  spelled with an escape (`u\72l(`) is no `url(` to this scan and a browser reads it as one: `obscured` says that a backslash stands outside every
 *  string, so a guard that must not miss a load refuses the value (svg-guard refuses every backslash for the same reason).
 *  Not covered: `image-set(`, `src(`, `@import` and the like are other functions and statements, named by the guards' own lists, not read here. */

/** The kinds of a rule, see the header. */
export type CssRuleKind = "style" | "group" | "keyframes" | "keyframe" | "font-face" | "at" | "statement";

export interface CssDeclaration {
  /** Lower case. */
  name: string;
  /** As written (a custom property `--Accent` differs from `--accent`, the name above does not tell them apart). */
  rawName: string;
  /** Trimmed, without `!important`, comments as one space. */
  value: string;
  important: boolean;
}

export interface CssRule {
  kind: CssRuleKind;
  /** At-rule name in lower case without `@` (`media`, `-webkit-keyframes`); `""` for `style` and `keyframe`. */
  name: string;
  /** Text before `{` (or before `;` of a statement), trimmed, comments as one space. For `style` and `keyframe` the selector list. */
  prelude: string;
  /** The selector list of a `style` or `keyframe` rule split at its top-level commas (strings, parentheses and brackets stay whole), trimmed; `[]` otherwise. */
  selectors: string[];
  declarations: CssDeclaration[];
  /** The rules inside: the body of a group, the steps of `@keyframes`, a rule nested in a rule. */
  rules: CssRule[];
  /** The original source of the rule from its prelude to its closing brace (or semicolon), comments and escapes unchanged. */
  text: string;
  /** False when the text ended before the block did. */
  closed: boolean;
}

export interface CssSheet {
  /** The rules of the top level, in source order. */
  rules: CssRule[];
  /** Reading stopped at `maxDepth`; what follows the offending `{` is not in `rules`. */
  truncated: boolean;
}

export interface CssParseOptions {
  /** Deepest nesting of `{` that is read (default 100, the limit svg-guard puts on a `<style>`). */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 100;
const GROUP_AT_RULES: ReadonlySet<string> = new Set(["media", "supports", "layer", "container", "scope", "starting-style", "document", "-moz-document"]);
const KEYFRAMES = /^(?:-\w+-)?keyframes/;

/** The value without a trailing `!important` (and whether there was one). */
function splitImportant(value: string): { value: string; important: boolean } {
  const v = value.trimEnd();
  const bang = v.lastIndexOf("!");
  return bang >= 0 && v.slice(bang + 1).trim().toLowerCase() === "important" ? { value: v.slice(0, bang).trimEnd(), important: true } : { value: v, important: false };
}

function declarationOf(part: string): CssDeclaration | null {
  const colon = part.indexOf(":");
  if (colon < 0) return null;
  const rawName = part.slice(0, colon).trim();
  if (rawName === "") return null;
  const { value, important } = splitImportant(part.slice(colon + 1).trim());
  return { name: rawName.toLowerCase(), rawName, value, important };
}

interface Frame { rule: CssRule; start: number }

/** The one scanner behind {@link parseCssRules} and {@link parseCssDeclarations}: `block` reads a declaration list (`style=`), where `{` and `}` are
 *  ordinary characters, as the old `parseDeclarations` did. */
function scan(src: string, block: boolean, maxDepth: number): { rules: CssRule[]; declarations: CssDeclaration[]; truncated: boolean } {
  const root: CssRule[] = [];
  const rootDeclarations: CssDeclaration[] = [];
  const stack: Frame[] = [];
  let buf = "";
  let tail = ""; // the last three characters of `buf`: slicing a long concatenated string every time would flatten it again and again
  let segStart = -1;
  let depth = 0;
  const urlParens: boolean[] = [];
  let quote = "";
  let truncated = false;

  const put = (s: string, at: number): void => {
    buf += s;
    tail = (tail + s).slice(-3);
    if (segStart < 0 && s.trim() !== "") segStart = at;
  };
  /** The pending text ends at `;`, at `}` or at the end of the text: a declaration, or an at-rule without a block. */
  const flush = (end: number): void => {
    const part = buf.trim();
    const start = segStart;
    buf = "";
    tail = "";
    segStart = -1;
    if (part === "") return;
    const top = stack.at(-1)?.rule;
    if (!block && part.startsWith("@")) {
      (top?.rules ?? root).push(makeRule("statement", part, src.slice(start, end), true));
      return;
    }
    const d = declarationOf(part);
    if (d !== null) (top?.declarations ?? rootDeclarations).push(d);
  };
  const close = (end: number, eof: boolean): void => {
    flush(end);
    const f = stack.pop();
    if (f === undefined) return;
    f.rule.text = src.slice(f.start, eof ? src.length : end + 1);
    f.rule.closed = !eof;
    (stack.at(-1)?.rule.rules ?? root).push(f.rule);
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] ?? "";
    if (ch === "\\") { put(ch + (src[i + 1] ?? ""), i); i++; continue; } // an escaped character is text, in a string or outside
    if (quote !== "") { put(ch, i); if (ch === quote || ch === "\n") quote = ""; continue; }
    if (ch === "/" && src[i + 1] === "*" && urlParens.at(-1) !== true) {
      const e = src.indexOf("*/", i + 2);
      put(" ", i);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; put(ch, i); continue; }
    if (ch === "(") { depth++; urlParens.push(tail.toLowerCase() === "url"); }
    else if (ch === ")" && depth > 0) { depth--; urlParens.pop(); }
    if (depth > 0) { put(ch, i); continue; }
    if (ch === ";") flush(i + 1);
    else if (!block && ch === "{") {
      if (stack.length >= maxDepth) { truncated = true; break; }
      const prelude = buf.trim();
      const start = segStart < 0 ? i : segStart;
      buf = "";
      tail = "";
      segStart = -1;
      stack.push({ rule: makeRule(kindOf(prelude, stack.at(-1)?.rule), prelude, "", false), start });
    } else if (!block && ch === "}") close(i, false);
    else put(ch, i);
  }
  if (!truncated) flush(src.length);
  while (stack.length > 0) close(src.length, true);
  return { rules: root, declarations: rootDeclarations, truncated };
}

function atName(prelude: string): string {
  return /^@([-\w]*)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
}

function kindOf(prelude: string, parent: CssRule | undefined): CssRuleKind {
  if (!prelude.startsWith("@")) return parent?.kind === "keyframes" ? "keyframe" : "style";
  const name = atName(prelude);
  if (KEYFRAMES.test(name)) return "keyframes";
  if (name === "font-face") return "font-face";
  return GROUP_AT_RULES.has(name) ? "group" : "at";
}

function makeRule(kind: CssRuleKind, prelude: string, text: string, closed: boolean): CssRule {
  const isAt = prelude.startsWith("@");
  return {
    kind,
    name: isAt ? atName(prelude) : "",
    prelude,
    selectors: kind === "style" || kind === "keyframe" ? splitCssList(prelude) : [],
    declarations: [],
    rules: [],
    text,
    closed,
  };
}

/** The rules of a style sheet. Never throws; an input of any shape gives some rules or none. */
export function parseCssRules(text: string, options: CssParseOptions = {}): CssSheet {
  const { rules, truncated } = scan(text, false, Math.max(1, options.maxDepth ?? DEFAULT_MAX_DEPTH));
  return { rules, truncated };
}

/** The declarations of a block such as a `style=` attribute, in source order. Splits at `;` outside parentheses and strings, so
 *  `url(data:…;base64,…)` and quoted semicolons stay whole; a part without a name before the colon is dropped. */
export function parseCssDeclarations(block: string): CssDeclaration[] {
  return scan(block, true, DEFAULT_MAX_DEPTH).declarations;
}

/** `text` split at its top-level commas (outside strings, parentheses and brackets), each part trimmed. `""` gives `[""]`, as `a,,b` gives an empty middle part. */
export function splitCssList(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (ch === "\\") { i++; continue; }
    if (quote !== "") { if (ch === quote || ch === "\n") quote = ""; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (ch === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  out.push(text.slice(start).trim());
  return out;
}

/** One `url(` call. */
export interface CssUrlCall {
  /** The body, decoded and trimmed as the URL parser does ({@link trimUrlLikeBrowser}); for a quoted body the string without quotes. */
  value: string;
  quoted: boolean;
  /** The call ends where CSS says it does: a quoted body at its closing quote, an unquoted one at `)`. False at the end of the text, or when a `(` comes first. */
  closed: boolean;
  /** Index of the `u` of `url(` in the text. */
  start: number;
  /** Index after the call: behind its `)`, or where the body ended when no `)` follows it. */
  end: number;
}

export interface CssUrls {
  calls: CssUrlCall[];
  /** A backslash stands outside every string: a function name may be spelled with an escape that this scan does not read as `url(`. */
  obscured: boolean;
}

function indexOfCI(text: string, needle: string, from: number): number {
  const n = needle.length;
  for (let i = from; i + n <= text.length; i++) {
    let j = 0;
    while (j < n && (text.charCodeAt(i + j) | 32) === needle.charCodeAt(j)) j++;
    if (j === n) return i;
  }
  return -1;
}

/** CSS escapes decoded: `\` + 1 to 6 hex digits (and one white space after them) is that code point, `\` + a line break is nothing, `\` + any other character is it. */
export function decodeCssEscapes(s: string): string {
  if (!s.includes("\\")) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? "";
    if (ch !== "\\") { out += ch; continue; }
    const next = s[i + 1];
    if (next === undefined) { out += "�"; break; }
    let j = i + 1;
    while (j < s.length && j < i + 7 && /[0-9a-fA-F]/.test(s[j] ?? "")) j++;
    if (j > i + 1) {
      const cp = parseInt(s.slice(i + 1, j), 16);
      out += cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
      if (/[ \t\n\r\f]/.test(s[j] ?? "x")) j++;
      i = j - 1;
    } else if (next !== "\n" && next !== "\r" && next !== "\f") { out += next; i++; }
    else i++;
  }
  return out;
}

function backslashOutsideStrings(text: string): boolean {
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (quote !== "") { if (ch === "\\") i++; else if (ch === quote || ch === "\n") quote = ""; continue; }
    if (ch === "\\") return true;
    if (ch === '"' || ch === "'") quote = ch;
  }
  return false;
}

/** Every `url(` call of a value or a text, in order. Linear: a call is read up to its own end, the next one starts behind its `url(`. */
export function readCssUrls(text: string): CssUrls {
  const calls: CssUrlCall[] = [];
  for (let at = indexOfCI(text, "url(", 0); at >= 0; at = indexOfCI(text, "url(", at + 4)) {
    let from = at + 4;
    while (from < text.length && /\s/.test(text[from] ?? "")) from++;
    const q = text[from];
    if (q === '"' || q === "'") {
      // a quoted body ends at the closing quote, whatever stands inside: `url("#a)b")` names `#a)b`; with no closing quote the string runs to the end of
      // the text, and anything behind the closing quote is ignored, as a browser does
      let close = from + 1;
      while (close < text.length && text[close] !== q) close += text[close] === "\\" ? 2 : 1;
      const end = Math.min(close, text.length);
      let after = Math.min(end + 1, text.length);
      while (after < text.length && /\s/.test(text[after] ?? "")) after++;
      calls.push({ value: trimUrlLikeBrowser(decodeCssEscapes(text.slice(from + 1, end))), quoted: true, closed: close < text.length, start: at, end: text[after] === ")" ? after + 1 : Math.min(end + 1, text.length) });
      continue;
    }
    let end = from;
    while (end < text.length && text[end] !== ")" && text[end] !== "(") end++;
    calls.push({ value: trimUrlLikeBrowser(decodeCssEscapes(text.slice(from, end))), quoted: false, closed: text[end] === ")", start: at, end: Math.min(end + 1, text.length) });
  }
  return { calls, obscured: backslashOutsideStrings(text) };
}

/** An element id read from a URL fragment: percent-decoded, or as written when that is not valid. */
export function decodeFragmentId(id: string): string {
  try { return decodeURIComponent(id); } catch { return id; }
}

/** The ids the `url(#id)` calls of `text` name. A quoted call counts closed or not, an unquoted one only when it is closed by `)`. */
export function cssFragmentIds(text: string): string[] {
  const ids: string[] = [];
  for (const c of readCssUrls(text).calls) {
    if (!c.quoted && !c.closed) continue;
    if (c.value.startsWith("#")) ids.push(decodeFragmentId(c.quoted ? c.value.slice(1) : c.value.slice(1).trimEnd()));
  }
  return ids;
}
