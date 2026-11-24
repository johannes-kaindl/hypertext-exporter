// vendored from code-kit@0.89.0, src/ts/pure/page-search.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: new in code-kit (Welle 37, order 18 of the hypertext-exporter plan, spec 10.5 and 10.14). First consumer: hypertext-exporter, whose stand-alone page has `script-src`
// with one digest and no `fetch` (a `file://` page cannot fetch), so search and the fold helpers have to be ONE embedded script that reads the page it sits in.
// Semantics follow `matchByQuery` of `slash-query` (every word of the query must occur, the comparison key is case- and composition-insensitive), the key itself is `foldCase`.
//
// WHAT THIS MODULE IS. Pure: it never touches a DOM. The script is a string (`buildPageSearchScript`), the tool block is a string (`buildPageSearchControls`); both are
// built from one `PageSearchConfig`. The script goes into `buildScreenDocument({ script })`, which hashes exactly these bytes into the CSP; equal config gives equal
// bytes (the config is written in a fixed key order, so the order of the caller's keys does not matter). The script contains no `</script` and no `<!--`
// (config text is written with `<` as `<`, so it cannot either), no `eval`, no `Function`, no network, no storage, no `innerHTML`/`outerHTML`, no `document.write`,
// no timer with a string. It is ES2019 and strict mode.
//
// WHAT THE SCRIPT DOES (the page is complete and operable without it; the tool block is `hidden` until the script shows it):
//   * unit = an element matching `unitSelector` (a note, a folded section). Its text is the text nodes below it WITHOUT the text of nested units (that belongs to the
//     inner unit), read once at the first keystroke (`<script>` and `<style>` text is skipped). No index file.
//   * key = `foldCase` per text node (NFC, lower, upper, lower), joined; the query gets the same key and is split at white space. A unit hits when every word occurs
//     in its key. An empty query is the initial state.
//   * while typing: a unit or container (a `details` under the root that holds units but is none) that neither hits nor holds a hit is `hidden`; a hit and everything above
//     it is opened (`open` on every `details`, the unit itself included); the count is the number of units with an OWN hit (an outer unit that only holds a hit is open but
//     not counted). The count text comes from the config (`{n}` is replaced everywhere).
//   * highlight: CSS Custom Highlight API under `highlightName` (the page styles `::highlight(<name>)`); without `CSS.highlights` or `Highlight` it only filters and opens.
//     A match is mapped back to the ORIGINAL text per code point (a combining mark stays with its base): `ß` folds to `ss`, so the key is longer than the text, and a
//     match on the second `s` highlights the `ß`. A text node whose per-code-point key differs from its whole-node key (Hangul jamo that compose, a Greek final sigma, which
//     lower-casing decides by context) is matched but not highlighted. A word that straddles two text nodes hits but is not highlighted. At most 5000 ranges per search.
//   * the state before the search (which `details` were open, which unit or container was `hidden`) is taken at the first character; the clear button, Escape in the field
//     and deleting down to nothing restore exactly that and remove the highlight.
//   * jump targets: on `hashchange`, on load with a hash and on a click on `a[href^="#"]`, every `details` above the target (and the target when it is one) is opened and an
//     element the search hid on the way is shown. The target is found with `getElementById` on the decoded hash, never with a selector built from it.
//   * print: `beforeprint` opens every `details` and shows what the search hid, `afterprint` puts it back.
//   * expand all / collapse all: every `details` under the root.
//   * no exception leaves the script: a missing root does nothing at all, a missing tool block or field switches that part off, every handler is wrapped.
//   * DOM clobbering (security review hypertext-exporter, stage 10): content on the page can name elements, and a browser then answers some property reads with the element
//     instead of the built-in: on `document` for an `img`, `form`, `embed`, `object` or `iframe` with a `name` (Document is [LegacyOverrideBuiltIns]) and on a `form` for its
//     named controls. So no method and no accessor of a document or of an element is read off the object: the functions and getters come from the prototypes, caught once
//     at the start, and are called with `.call` (`addEventListener` from `EventTarget.prototype`; an environment whose window is no EventTarget, such as happy-dom, falls
//     back to the plain call). Used as they are because they cannot be clobbered: `document`, `window` and `window.location` (unforgeable); `window` for an `id` (named
//     properties never shadow what the window inherits, measured in Chromium: `<i id="addEventListener">` does nothing); the globals `CSS`, `Highlight`, `Document`,
//     `Element`, `Node`, `EventTarget`, `Object`, `Array`, `Set` (own properties of the global object win over named access); the methods of objects that are no document or
//     form (`Range`, `Event`, a text node, the search field, `Set`); `CSS.highlights`. Out of scope: a script on the page (it could do anything).
// No debounce: the search runs on every `input` event; whether a page of ten megabytes needs a pause is for the first consumer's measurement to say.
//
// The tool block: `buildPageSearchControls` writes `<div id role="search" hidden>` with label, search field (`autocomplete="off"`), clear button, a polite status for the count
// and the two fold buttons (`type="button"`), all text escaped. It carries no class; style by id. An author rule that sets `display` on the block overrides `hidden`, so a page
// needs `[hidden] { display: none }` (the script removes the attribute, nothing else shows it).

import { escapeHtmlAttr, escapeHtmlText } from "./html-escape";

export interface PageSearchConfig {
  /** Selector of the element the page is searched and folded in (e.g. `main`). Missing in the page: the script does nothing. */
  rootSelector: string;
  /** Selector of the search units below the root (the smallest foldable area with its own title). */
  unitSelector: string;
  /** Ids of the tool block and its parts; the script finds them with `getElementById`. */
  ids: { tools: string; input: string; clear: string; count: string; expandAll: string; collapseAll: string };
  /** Count texts; `{n}` in `countMany` stands for the number of units with a hit. */
  texts: { countMany: string; countOne: string; countNone: string };
  /** Name of the CSS highlight (the page styles `::highlight(<name>)`). */
  highlightName: string;
}

export interface PageSearchLabels {
  search: string;
  clear: string;
  expandAll: string;
  collapseAll: string;
}

// The script body. `String.raw`, so backslashes (regular expressions) stay as written; it must not hold a backtick or `${`.
const BODY = String.raw`
var doc = document, win = window;
var DP = Document.prototype, EP = Element.prototype, NP = Node.prototype, ET = EventTarget.prototype;
var dQuery = DP.querySelector, dById = DP.getElementById, dQueryAll = DP.querySelectorAll, dRange = DP.createRange;
var eQuery = EP.querySelector, eQueryAll = EP.querySelectorAll, eMatches = EP.matches, eClosest = EP.closest, eGet = EP.getAttribute;
var eHas = EP.hasAttribute, eSet = EP.setAttribute, eRemove = EP.removeAttribute, eScroll = EP.scrollIntoView, listen = ET.addEventListener;
function getter(proto, name) {
  for (var p = proto; p; p = Object.getPrototypeOf(p)) {
    var d = Object.getOwnPropertyDescriptor(p, name);
    if (d) return d.get;
  }
}
var gReady = getter(DP, 'readyState'), gType = getter(NP, 'nodeType'), gFirst = getter(NP, 'firstChild');
var gNext = getter(NP, 'nextSibling'), gParent = getter(NP, 'parentNode'), gTag = getter(EP, 'tagName');
var SKIP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1 };
var MAX_RANGES = 5000;
var root = null, tools = null, input = null, countEl = null;
var index = null, snap = null, hiddenNow = new Set(), printState = null;

function guard(fn) {
  return function () {
    try { return fn.apply(this, arguments); } catch (e) { return undefined; }
  };
}
function on(target, type, fn) {
  if (!target) return;
  var handler = guard(fn);
  try { listen.call(target, type, handler); } catch (e) { target.addEventListener(type, handler); }
}
function byId(id) { return typeof id === 'string' && id !== '' ? dById.call(doc, id) : null; }
function all(selector, from) { return Array.prototype.slice.call((from === doc ? dQueryAll : eQueryAll).call(from, selector)); }
function fold(s) { return s.normalize('NFC').toLowerCase().toUpperCase().toLowerCase(); }
function has(el, name) { return eHas.call(el, name); }
function setOpen(el, flag) { if (flag) eSet.call(el, 'open', ''); else eRemove.call(el, 'open'); }
function setHidden(el, flag) { if (flag) eSet.call(el, 'hidden', ''); else eRemove.call(el, 'hidden'); }
function setCount(text) { if (countEl) countEl.textContent = text; }

function ownNodes(unit) {
  var out = [];
  (function walk(parent) {
    for (var c = gFirst.call(parent); c; c = gNext.call(c)) {
      var type = gType.call(c);
      if (type === 3) out.push(c);
      else if (type === 1 && !SKIP[gTag.call(c)] && !eMatches.call(c, C.u)) walk(c);
    }
  })(unit);
  return out;
}

function buildIndex() {
  var units = all(C.u, root).map(function (el) {
    var nodes = ownNodes(el);
    return { el: el, nodes: nodes, key: nodes.map(function (n) { return fold(n.data); }).join('') };
  });
  var boxes = all('details', root).filter(function (d) { return !eMatches.call(d, C.u) && eQuery.call(d, C.u) !== null; });
  return { units: units, boxes: boxes };
}

function snapshot() {
  var els = index.units.map(function (u) { return u.el; }).concat(index.boxes);
  snap = {
    open: all('details', root).map(function (d) { return [d, has(d, 'open')]; }),
    hid: els.map(function (el) { return [el, has(el, 'hidden')]; })
  };
}

function unpaint() {
  if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete(C.h);
}

function restore() {
  if (snap) {
    snap.open.forEach(function (p) { setOpen(p[0], p[1]); });
    snap.hid.forEach(function (p) { setHidden(p[0], p[1]); });
  }
  snap = null;
  hiddenNow.clear();
  unpaint();
  setCount('');
}

function mapping(text, key) {
  if (key.length === text.length && text.normalize('NFC') === text) return { same: true };
  var starts = [], ends = [], rebuilt = '', pos = 0;
  var parts = text.match(/[^\p{M}]\p{M}*|\p{M}+/gu) || [];
  for (var i = 0; i < parts.length; i++) {
    var f = fold(parts[i]);
    rebuilt += f;
    for (var k = 0; k < f.length; k++) { starts.push(pos); ends.push(pos + parts[i].length); }
    pos += parts[i].length;
  }
  return rebuilt === key ? { starts: starts, ends: ends } : null;
}

function mark(node, words, ranges) {
  var text = node.data, key = fold(text), spans = [], map = null;
  words.forEach(function (w) {
    for (var at = key.indexOf(w); at !== -1; at = key.indexOf(w, at + w.length)) spans.push([at, at + w.length]);
  });
  if (!spans.length) return;
  map = mapping(text, key);
  if (!map) return;
  for (var i = 0; i < spans.length && ranges.length < MAX_RANGES; i++) {
    var a = spans[i][0], b = spans[i][1], r = dRange.call(doc);
    r.setStart(node, map.same ? a : map.starts[a]);
    r.setEnd(node, map.same ? b : map.ends[b - 1]);
    ranges.push(r);
  }
}

function paint(hits, words) {
  unpaint();
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight !== 'function') return;
  var ranges = [];
  for (var i = 0; i < hits.length && ranges.length < MAX_RANGES; i++) {
    for (var j = 0; j < hits[i].nodes.length && ranges.length < MAX_RANGES; j++) mark(hits[i].nodes[j], words, ranges);
  }
  if (ranges.length) CSS.highlights.set(C.h, new Highlight(...ranges));
}

function run(query) {
  var words = fold(query).split(/\s+/).filter(function (w) { return w !== ''; });
  if (!words.length) { restore(); return; }
  if (!index) index = buildIndex();
  if (!snap) snapshot();
  var keep = new Set(), hits = [];
  index.units.forEach(function (u) {
    if (!words.every(function (w) { return u.key.indexOf(w) !== -1; })) return;
    hits.push(u);
    for (var n = u.el; n && n !== root; n = gParent.call(n)) keep.add(n);
  });
  index.units.map(function (u) { return u.el; }).concat(index.boxes).forEach(function (el) {
    if (!keep.has(el)) { setHidden(el, true); hiddenNow.add(el); }
    else if (hiddenNow.has(el)) { setHidden(el, false); hiddenNow.delete(el); }
  });
  keep.forEach(function (el) { if (gTag.call(el) === 'DETAILS') setOpen(el, true); });
  setCount(hits.length === 0 ? C.t.none : hits.length === 1 ? C.t.one : C.t.many.split('{n}').join(String(hits.length)));
  paint(hits, words);
}

function setAll(flag) { all('details', root).forEach(function (d) { setOpen(d, flag); }); }

function reveal(hash, scroll) {
  if (typeof hash !== 'string' || hash.length < 2 || hash.charAt(0) !== '#') return;
  var id;
  try { id = decodeURIComponent(hash.slice(1)); } catch (e) { return; }
  var target = byId(id);
  if (!target) return;
  for (var n = target; n && gType.call(n) === 1; n = gParent.call(n)) {
    if (hiddenNow.has(n)) { setHidden(n, false); hiddenNow.delete(n); }
    if (gTag.call(n) === 'DETAILS') setOpen(n, true);
  }
  if (scroll && typeof eScroll === 'function') eScroll.call(target);
}

function start() {
  try { root = dQuery.call(doc, C.r); } catch (e) { root = null; }
  if (!root) return;
  tools = byId(C.i.tools);
  input = byId(C.i.input);
  countEl = byId(C.i.count);
  var clear = byId(C.i.clear), expand = byId(C.i.expandAll), collapse = byId(C.i.collapseAll);

  on(win, 'hashchange', function () { reveal(win.location.hash, true); });
  on(doc, 'click', function (e) {
    var a = e.target && gType.call(e.target) === 1 ? eClosest.call(e.target, 'a[href^="#"]') : null;
    if (a) reveal(eGet.call(a, 'href'), false);
  });
  on(win, 'beforeprint', function () {
    if (printState) return;
    printState = { open: all('details', doc).map(function (d) { return [d, has(d, 'open')]; }), hid: Array.from(hiddenNow) };
    printState.open.forEach(function (p) { setOpen(p[0], true); });
    printState.hid.forEach(function (el) { setHidden(el, false); });
  });
  on(win, 'afterprint', function () {
    if (!printState) return;
    printState.open.forEach(function (p) { setOpen(p[0], p[1]); });
    printState.hid.forEach(function (el) { setHidden(el, true); });
    printState = null;
  });
  on(expand, 'click', function () { setAll(true); });
  on(collapse, 'click', function () { setAll(false); });
  if (input) {
    on(input, 'input', function () { run(input.value); });
    on(input, 'keydown', function (e) {
      if (e.key === 'Escape' && (input.value !== '' || snap)) { input.value = ''; restore(); e.preventDefault(); }
    });
    on(clear, 'click', function () { input.value = ''; restore(); input.focus(); });
  }
  if (tools) eRemove.call(tools, 'hidden');
  reveal(win.location.hash, true);
}

if (gReady.call(doc) === 'loading') on(doc, 'DOMContentLoaded', start);
else guard(start)();
`;

/** JSON for a script literal: `<` and the two line separators as escapes, so the text cannot close the element or open a comment. */
function literal(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** The page's search and fold script: an IIFE, ES2019, strict, deterministic for one config. See the module header for what it does. */
export function buildPageSearchScript(config: PageSearchConfig): string {
  const c = {
    r: config.rootSelector,
    u: config.unitSelector,
    i: {
      tools: config.ids.tools,
      input: config.ids.input,
      clear: config.ids.clear,
      count: config.ids.count,
      expandAll: config.ids.expandAll,
      collapseAll: config.ids.collapseAll,
    },
    t: { many: config.texts.countMany, one: config.texts.countOne, none: config.texts.countNone },
    h: config.highlightName,
  };
  return `(function () {\n'use strict';\nvar C = ${literal(c)};${BODY}})();\n`;
}

/** The tool block as HTML (`hidden` until the script shows it): label, search field, clear button, count status, expand and collapse buttons. All text is escaped. */
export function buildPageSearchControls(config: PageSearchConfig, labels: PageSearchLabels): string {
  const id = (name: string): string => escapeHtmlAttr(name);
  return (
    `<div id="${id(config.ids.tools)}" role="search" hidden>\n` +
    `<label for="${id(config.ids.input)}">${escapeHtmlText(labels.search)}</label>\n` +
    `<input type="search" id="${id(config.ids.input)}" autocomplete="off">\n` +
    `<button type="button" id="${id(config.ids.clear)}">${escapeHtmlText(labels.clear)}</button>\n` +
    `<span id="${id(config.ids.count)}" role="status" aria-live="polite"></span>\n` +
    `<button type="button" id="${id(config.ids.expandAll)}">${escapeHtmlText(labels.expandAll)}</button>\n` +
    `<button type="button" id="${id(config.ids.collapseAll)}">${escapeHtmlText(labels.collapseAll)}</button>\n` +
    "</div>\n"
  );
}
