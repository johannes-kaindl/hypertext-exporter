// vendored from code-kit@0.84.0, src/ts/pure/field-template.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: new in code-kit (Welle 36, h1 and h1c, order 22 of the hypertext-exporter plan, task 10, spec 10.6). Measured 2026-11-19 before building:
//   * `filename-template` (`buildFilename`) reads `{\w+}` against a map of STRINGS, sanitises the result as a file name and keeps an unknown name literal;
//     it has no dot path, no list or number, no missing-field list and no `{{`. A different job (a file name), not a base for this one.
//   * `i18n` (`t`) reads `{0}`, `{1}` against positional arguments; no names, no paths.
//   * `list-summary` (`summarizeList`) cuts a list to its first N items; it does not join and does not turn a value into text.
//   * no other module in code-kit or obsidian-kit turns a field value into text or fills a `{field}` template (`naehte_suche` 0 hits, grep 0 hits).
// The path logic is NOT here: the template asks an injected `read(field)` for a value, and the reader is `readField` / `getField` of
// `frontmatter-field` (dot path, aliases, mapping). One path logic, one place.
//
// THE OUTPUT IS TEXT, NEVER HTML. Nothing is escaped or sanitised here: a field value `<b>` comes back as `<b>`. The caller who puts the text into
// markup runs `escapeHtmlText` / `escapeHtmlAttr` (html-escape) on it, once, at the edge.
//
// `fieldValueText(value)` — one value as text, no locale:
//   null, undefined            → ""
//   string                     → as it is
//   number, bigint, boolean    → `String(value)` (`0` → "0", `1.5` → "1.5", `-0` → "0", `NaN` → "NaN": no thousands separator, no decimal comma)
//   Date                       → `toISOString()` ("2024-01-15T00:00:00.000Z"); an invalid Date → "" with the notice "invalid-date"
//   array                      → the texts of its items joined with ", "; items that give "" are left out ("a, , b" would be a hole, not a list)
//   plain or other object, function, symbol → "" with the notice "object" (YAML may hold a map; `[object Object]` in a title is worse than nothing)
//   Arrays nest to a depth of 4, deeper is the notice "object" (a cyclic array cannot loop). A notice inside an array is passed up.
//
// `fillFieldTemplate(template, read)` — `{field}` and `{a.b}` are replaced by the text of `read(name)`:
//   * the name is whatever stands between `{` and `}` without a `{` or `}` inside, trimmed; `{}` and `{ }` are no placeholder and stay as written;
//   * `{{` is a literal `{` and `}}` a literal `}`; so `{{a}}` is the text `{a}`; a single `}` stays as it is;
//   * a `{` without a closing `}` stays as it is, and the text after it is read on (nothing throws, nothing is dropped);
//   * `missing` lists each name whose value is empty (undefined, null, "" or an empty list), once, in the order of first use; the placeholder gives "";
//   * `unusable` lists each name whose value is an object, a function, a symbol or an invalid Date (text "" too), once, in the order of first use;
//   * `read` is the caller's: if it throws, the error reaches the caller (a bug there must not be turned into an empty field).
// A hand-written scan, no regular expression: linear in the template (every `{` looks ahead only up to the next brace).

/** Why a value gave no text although it was there. */
export type FieldNotice = "object" | "invalid-date";

export interface FieldText {
  text: string;
  /** Set when the value could not be written as text (its `text` is ""). */
  notice?: FieldNotice;
}

export interface FilledTemplate {
  text: string;
  /** Names read as empty, once each, in order of first use. */
  missing: string[];
  /** Names whose value is not writable as text (object, function, symbol, invalid date), once each, in order of first use. */
  unusable: string[];
}

const MAX_DEPTH = 4;

function valueText(value: unknown, depth: number): FieldText {
  if (value === undefined || value === null) return { text: "" };
  if (typeof value === "string") return { text: value };
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return { text: String(value) };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { text: "", notice: "invalid-date" } : { text: value.toISOString() };
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return { text: "", notice: "object" };
    const parts: string[] = [];
    let notice: FieldNotice | undefined;
    for (const item of value as unknown[]) {
      const r = valueText(item, depth + 1);
      if (r.text !== "") parts.push(r.text);
      notice ??= r.notice;
    }
    return notice === undefined ? { text: parts.join(", ") } : { text: parts.join(", "), notice };
  }
  return { text: "", notice: "object" };
}

/** One frontmatter value as text, see the module header for the rule per type. Never throws. */
export function fieldValueText(value: unknown): FieldText {
  return valueText(value, 0);
}

/** Fill `{field}` placeholders from `read(name)`; see the module header. The text is plain text, never HTML. */
export function fillFieldTemplate(template: string, read: (field: string) => unknown): FilledTemplate {
  const missing = new Set<string>(); // a Set keeps the order of first use and costs O(1) per name
  const unusable = new Set<string>();
  if (typeof template !== "string") return { text: "", missing: [], unusable: [] };

  let out = "";
  let i = 0;
  while (i < template.length) {
    const c = template.charAt(i);
    if (c === "}") {
      out += "}";
      i += template.charAt(i + 1) === "}" ? 2 : 1;
      continue;
    }
    if (c !== "{") {
      // copy the run of plain text up to the next brace in one step
      let j = i + 1;
      while (j < template.length && template.charAt(j) !== "{" && template.charAt(j) !== "}") j++;
      out += template.slice(i, j);
      i = j;
      continue;
    }
    if (template.charAt(i + 1) === "{") {
      out += "{";
      i += 2;
      continue;
    }
    // `{`: look ahead for `}` but stop at another `{` (that one is the start of the next placeholder, this one stays literal)
    let j = i + 1;
    while (j < template.length && template.charAt(j) !== "}" && template.charAt(j) !== "{") j++;
    const name = template.slice(i + 1, j).trim();
    if (template.charAt(j) !== "}" || name === "") {
      out += "{";
      i += 1;
      continue;
    }
    const r = fieldValueText(read(name));
    out += r.text;
    if (r.notice !== undefined) unusable.add(name);
    else if (r.text === "") missing.add(name);
    i = j + 1;
  }
  return { text: out, missing: [...missing], unusable: [...unusable] };
}
