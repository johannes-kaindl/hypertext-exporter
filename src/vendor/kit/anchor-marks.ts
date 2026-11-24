// vendored from code-kit@0.89.0, src/ts/pure/anchor-marks.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: new in code-kit (Welle 36, h1c, order 6 of the hypertext-exporter plan, spec 10.3 and 10.4; the part of the order that needs no DOM, the DOM runner that
// sets the marks on Obsidian's rendered tree is written in obsidian-kit — decision of the kit master 2026-11-19). Measured before building: `slug` (`slugify`) writes
// the slug and is used as it is; `heading-title` finds a note's first heading and gives no mark; `export-studio/src/ids.ts` was read for the umlaut and number edge
// cases (the kit's `slugify` already does ä → ae, ß → ss, and a leading digit is fine in an `id`); no module here dedupes marks.
//
// The marks of one page: every one is a function of PATHS and TEXTS, never of a run (no counter that survives a call, no clock, no random value). The scheme:
//   note                  slug of the path below the folder, without `.md`, `/` as `-`                         themen/einstieg 2.md  →  themen-einstieg-2
//   note from a source    slug of `<source key>/<path>`                                                          (a note outside the chosen folder)
//   heading               <note mark>--<slug of the heading>; a repeat in the same note gets -2, -3
//   footnote              <note mark>--fn-<n> and <note mark>--fnref-<n>           replaces Obsidian's `fn-1-<16 hex>`, which is new at every render
//   embedded note         <note mark>--e<n> is its mark; its headings are <note mark>--e<n>--<slug>, so nothing repeats on a shared page
//   fixed places          `oben`, `inhalt`, `suche`, `werkzeug` are taken: a note that would get one of them gets -2 (and so on)
//   empty slug            `abschnitt`
// A slug holds only `a-z`, `0-9` and single `-`, so the double hyphen `--` is a separator no slug can contain: `a--b` is never the slug of anything, and the three kinds
// of mark (note, `--` part, `--e<n>` embed) cannot meet by accident. What CAN meet is a heading whose slug is already a fixed word of the scheme: a heading `fn 1`
// (slug `fn-1`) would take the footnote's mark, a heading `e1` the embed's. Those slugs (`fn-<n>`, `fnref-<n>`, `e<n>`) are therefore treated as taken and the heading
// gets `-2`; this is decided by the slug alone, not by the order in which a footnote or an embed happens to be asked for.
//
// Collisions inside one set are always settled the same way: the first claimant keeps the mark, the next gets `-2`, then `-3` (a `-2` that an EARLIER heading
// already has by its own text, `A 2`, is skipped, so uniqueness holds whatever the headings are called). The order of the input is the order of claims: the caller passes notes in the order of the page.
//
// `shiftHeadingLevels` is the other half of spec 10.3 ("headings are moved per area so that the outline stays gapless"): the levels of an area's headings, in document
// order, become levels with no jump of more than one step down, starting at `base`.

import { slugify } from "./slug";

/** Marks of the fixed places of a page (`oben` = top, `inhalt` = contents, `suche` = search, `werkzeug` = tools). A note that would get one of them gets `-2`. */
export const RESERVED_MARKS: readonly string[] = ["oben", "inhalt", "suche", "werkzeug"];

/** What an empty slug becomes. */
export const EMPTY_SLUG = "abschnitt";

const SCHEME_SLUG = /^(?:fn|fnref)-\d+$|^e\d+$/;

/** The marks handed out so far, and for each base the number after which to look for the next free `-n` (so k equal marks cost k steps, not k²/2). */
interface Claims {
  taken: Set<string>;
  next: Map<string, number>;
}

function newClaims(reserved: Iterable<string> = []): Claims {
  return { taken: new Set(reserved), next: new Map() };
}

/** The first free of `base`, `base-2`, `base-3`, … in `claims`; the chosen mark is recorded. */
function claim(base: string, claims: Claims): string {
  if (!claims.taken.has(base)) {
    claims.taken.add(base);
    return base;
  }
  for (let n = claims.next.get(base) ?? 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!claims.taken.has(candidate)) {
      claims.taken.add(candidate);
      claims.next.set(base, n + 1);
      return candidate;
    }
  }
}

export interface NoteRef {
  /** Path of the note below the chosen folder (or below its source), with `/` or `\`, usually with the `.md`. */
  path: string;
  /** The key of the source when the note does not come from the chosen folder; it is part of the slug. */
  source?: string;
}

export interface NoteMarkOptions {
  /** Marks the page keeps for itself. Default {@link RESERVED_MARKS}. */
  reserved?: readonly string[];
}

/** The slug of a note's path: the extension `.md` (any case) goes, every separator (`/`, `\`, a space, a dot) is `-`. */
export function noteSlug(note: NoteRef): string {
  const path = String(note.path); // a backslash is a separator for slugify too, no step of its own
  const bare = path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
  const full = note.source === undefined ? bare : `${note.source}/${bare}` // an empty source leaves a leading "/", which the slug drops;
  return slugify(full, { fallback: EMPTY_SLUG });
}

/** One unique mark per note, in the order given. Equal input gives equal output; the first note with a slug keeps it, a later one with the same slug gets `-2`, `-3`. */
export function assignNoteMarks(notes: readonly NoteRef[], options: NoteMarkOptions = {}): string[] {
  const claims = newClaims(options.reserved ?? RESERVED_MARKS);
  return notes.map((note) => claim(noteSlug(note), claims));
}

/** The marks inside one note (or one embedded note). Create it with {@link createNoteMarks}; it remembers what it has handed out, so ask once per heading, in document order. */
export interface NoteMarks {
  /** The mark of the note itself (what `assignNoteMarks` gave, or `<outer>--e<n>` for an embed). */
  readonly mark: string;
  /** The mark of the next heading with this text: `<mark>--<slug>`, a repeat `-2`, `-3`. The text is the heading's visible text. */
  heading(text: string): string;
  /** `<mark>--fn-<n>`: the footnote's own anchor. `n` is the footnote's number in this note, counted from 1. */
  footnote(n: number): string;
  /** `<mark>--fnref-<n>`: the anchor of the reference that points at the footnote. `k` is the repeat, counted as Obsidian counts it (measured in 1.15.1 by h3: the
   *  first reference carries `fnref-<n>-<hex>`, a REPEATED one `fnref-<n>-<k>-<hex>` with the text `[1-1]`, so the first repeat is `k = 1`): `<mark>--fnref-<n>--<k>`. The double
   *  hyphen is the separator no slug holds, so a heading whose slug reads `fnref-1-2` (mark `<mark>--fnref-1-2`) never meets the repeat `<mark>--fnref-1--2`. Without `k`
   *  (or below 1) the mark is the one of the first reference, byte for byte as before. */
  footnoteRef(n: number, k?: number): string;
  /** The marks of the n-th embedded note of this one: its `mark` is `<mark>--e<n>`. Asking again with the same `n` gives a fresh set with the same marks. */
  embed(n: number): NoteMarks;
}

/** The marks of one note; `mark` is the note's own mark. */
export function createNoteMarks(mark: string): NoteMarks {
  const claims = newClaims();
  const part = (n: number): string => String(Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0)));
  return {
    mark,
    heading(text: string): string {
      const slug = slugify(String(text), { fallback: EMPTY_SLUG });
      if (SCHEME_SLUG.test(slug)) claims.taken.add(slug); // the scheme's own word: this heading is the second claimant
      return `${mark}--${claim(slug, claims)}`;
    },
    footnote: (n) => `${mark}--fn-${part(n)}`,
    footnoteRef: (n, k) => (k === undefined || !(k >= 1) ? `${mark}--fnref-${part(n)}` : `${mark}--fnref-${part(n)}--${part(k)}`),
    embed: (n) => createNoteMarks(`${mark}--e${part(n)}`),
  };
}

export interface ShiftedLevels {
  /** One level (1 to 6) per input heading, same order. */
  levels: number[];
  /** Headings that would have been deeper than 6 and were held at 6. */
  clamped: number;
  /** Input entries that were not an integer from 1 to 6; they are read as 6 so that nothing is lost, and counted here. */
  invalid: number;
}

/** Make the heading levels of one area gapless, starting at `base` (default 2: the page keeps `h1`). The first heading, and any heading as shallow as the first, takes `base`;
 *  a heading nested below another takes one level more than its parent, however many levels the source skipped (`h2, h4, h3` → `2, 3, 3` for base 2). A heading shallower than
 *  everything before it closes all of them and takes `base` again. Deeper than 6 is held at 6 and counted. Linear (a stack that only grows by one and pops what it passes). */
export function shiftHeadingLevels(levels: readonly number[], base = 2): ShiftedLevels {
  const start = Number.isInteger(base) ? Math.min(Math.max(base, 1), 6) : 2;
  const stack: number[] = [];
  const out: number[] = [];
  let clamped = 0;
  let invalid = 0;
  for (const raw of levels) {
    let level = raw;
    if (!Number.isInteger(level) || level < 1 || level > 6) {
      invalid++;
      level = 6;
    }
    while (stack.length > 0 && (stack[stack.length - 1] ?? 0) >= level) stack.pop();
    const wanted = start + stack.length;
    stack.push(level);
    if (wanted > 6) {
      clamped++;
      out.push(6);
    } else {
      out.push(wanted);
    }
  }
  return { levels: out, clamped, invalid };
}
