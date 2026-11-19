// Übersichten und Zusatzzeilen aus Frontmatter (Bauplan Task 10, Spec 10.6 und A1).
// Allgemeines kommt aus dem Kit und wird hier nur gerufen: Feldzugriff samt Punkt-Pfad, Schreibweise und Alias-Toleranz allein über `readField` (frontmatter-field),
// `{feld}`-Vorlage und „Wert als Text“ (Liste mit `, `, Zahl, Datum) allein über `fillFieldTemplate`/`fieldValueText` (field-template), Attributnamen über `slugify`.
// `fillFieldTemplate` löst keinen Pfad auf; es fragt den eingereichten Leser, und der ist `readField`. Ein Pfad, eine Stelle.
// Die Tabelle entsteht im DOM des übergebenen Dokuments; Text geht nur über `textContent` und `setAttribute`, Maskieren ist damit Sache des Serialisierers.
import { fieldValueText, fillFieldTemplate } from '../vendor/kit/field-template';
import { buildFmIndex, readField, type FmIndex } from '../vendor/kit/frontmatter-field';
import { slugify } from '../vendor/kit/slug';
import { CODES } from './finding-codes';
import { PAGE_TEXTS, type PageLang } from './page-texts';
import type { Column, Finding, SetNote } from './types';

/** Trenner der Teile einer Zusatzzeile. */
const SUMMARY_SEPARATOR = ' · ';

interface Cell { text: string; missing: string[] }

/**
 * Der Text einer Zelle und die Felder, die ihr fehlten (leer, nicht da oder nicht als Text darstellbar).
 * Eine Vorlage, der ein Feld fehlt, bleibt ganz leer: „4 von  Personas“ wäre eine Aussage, die niemand getroffen hat.
 */
function cellOf(idx: FmIndex, column: Column): Cell {
  const read = (name: string): unknown => readField(idx, name, []);
  if (column.template !== undefined) {
    const filled = fillFieldTemplate(column.template, read);
    const missing = [...filled.missing, ...filled.unusable];
    return { text: missing.length > 0 ? '' : filled.text, missing };
  }
  const field = column.field ?? '';
  const value = fieldValueText(read(field));
  return value.notice !== undefined || value.text === '' ? { text: '', missing: [field] } : { text: value.text, missing: [] };
}

/** Die Zusatzzeile einer Notiz: die nichtleeren Zellen der Spalten, mit ` · ` verbunden; `missing` nennt je Feld einmal, was fehlte (Reihenfolge der ersten Nennung). */
export function summaryLine(note: SetNote, columns: Column[]): { text: string; missing: string[] } {
  const idx = buildFmIndex(note.frontmatter);
  const parts: string[] = [];
  const missing = new Set<string>();
  for (const column of columns) {
    const cell = cellOf(idx, column);
    if (cell.text !== '') parts.push(cell.text);
    for (const name of cell.missing) missing.add(name);
  }
  return { text: parts.join(SUMMARY_SEPARATOR), missing: [...missing] };
}

/**
 * Die Übersicht einer Gruppe: eine Tabelle im Behälter `div.ht-table[tabindex=0]` (waagerecht scrollbar, per Tastatur erreichbar), eine Zeile je Notiz.
 * Erste Spalte ist der Titel als Sprung `#<marke>` (ohne Marke Text); jede Zeile trägt zu jeder Feldspalte `data-ht-<slug>="<Wert als Text>"` (A1, Filter und Sortierung später).
 * Befunde in fester Reihenfolge: erst Attributkollisionen in Spaltenfolge, dann je fehlendem Feld einer (Spaltenfolge, dann Folge in der Vorlage).
 */
export function buildOverview(
  notes: SetNote[],
  columns: Column[],
  anchors: Map<string, string>,
  doc: Document,
  lang: PageLang = 'en',
): { table: HTMLElement; findings: Finding[] } {
  const findings: Finding[] = [];

  // Attributname je Feldspalte; zwei Felder auf denselben Namen: nur das erste.
  const attrByColumn: Array<string | undefined> = [];
  const owner = new Map<string, string>();
  columns.forEach((column, i) => {
    if (column.field === undefined) return;
    const slug = slugify(column.field);
    if (slug === '') return;
    const first = owner.get(slug);
    if (first !== undefined) {
      findings.push({ severity: 'warning', code: CODES.fieldAttrCollision, message: `Die Felder „${first}“ und „${column.field}“ ergeben beide das Attribut data-ht-${slug}; gesetzt wird nur das erste`, recipePath: `overview[${i}]` });
      return;
    }
    owner.set(slug, column.field);
    attrByColumn[i] = `data-ht-${slug}`;
  });

  // Zellen spaltenweise, damit die fehlenden Felder in Spaltenfolge gezählt werden.
  const indexes = notes.map((n) => buildFmIndex(n.frontmatter));
  const cells: Cell[][] = notes.map(() => []);
  // je Feld die Notizen, denen es fehlt: ein Feld in zwei Spalten zählt eine Notiz einmal
  const missingIn = new Map<string, Set<number>>();
  columns.forEach((column, c) => {
    indexes.forEach((idx, r) => {
      const cell = cellOf(idx, column);
      cells[r][c] = cell;
      for (const name of cell.missing) {
        const set = missingIn.get(name) ?? new Set<number>();
        set.add(r);
        missingIn.set(name, set);
      }
    });
  });
  for (const [name, inNotes] of missingIn) {
    findings.push({ severity: 'warning', code: CODES.fieldMissing, message: `Das Feld „${name}“ fehlt oder ist leer in ${inNotes.size} von ${notes.length} Notizen` });
  }

  const table = doc.createElement('div');
  table.className = 'ht-table';
  table.setAttribute('tabindex', '0');
  const el = doc.createElement('table');
  table.appendChild(el);

  const headRow = doc.createElement('tr');
  for (const header of [PAGE_TEXTS[lang].overviewTitle, ...columns.map((c) => c.header)]) {
    const th = doc.createElement('th');
    th.setAttribute('scope', 'col');
    th.textContent = header;
    headRow.appendChild(th);
  }
  const thead = doc.createElement('thead');
  thead.appendChild(headRow);
  el.appendChild(thead);

  const tbody = doc.createElement('tbody');
  notes.forEach((note, r) => {
    const tr = doc.createElement('tr');
    const first = doc.createElement('td');
    const anchor = anchors.get(note.path);
    if (anchor === undefined) {
      first.textContent = note.title;
    } else {
      const a = doc.createElement('a');
      a.setAttribute('href', `#${anchor}`);
      a.textContent = note.title;
      first.appendChild(a);
    }
    tr.appendChild(first);
    columns.forEach((_column, c) => {
      const cell = cells[r][c];
      const td = doc.createElement('td');
      td.textContent = cell.text;
      tr.appendChild(td);
      const attr = attrByColumn[c];
      if (attr !== undefined) tr.setAttribute(attr, cell.text);
    });
    tbody.appendChild(tr);
  });
  el.appendChild(tbody);
  return { table, findings };
}
