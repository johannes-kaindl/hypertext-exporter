// Alle plugin-eigenen Typen (Bauplan Task 4; Typen von Task 5 nur als Schnittstelle, ohne Funktionen).

export type Severity = 'error' | 'warning' | 'info';
/**
 * Ein Befund. `code` (mit `variant`, wo ein Code mehrere Sätze trägt) ist der Vertrag; `args` sind die Werte für die Lücken des Satzes. Der Satz selbst entsteht erst an der Oberfläche
 * (`findingMessage`, Schlüssel `finding.<code>[.<variant>]` in `src/i18n/strings.ts`), in der Sprache der Obsidian-Oberfläche. Werte in `args` sind nie übersetzter Text.
 */
export type FindingArg = string | number;
export interface Finding { severity: Severity; code: string; variant?: string; args?: readonly FindingArg[]; notePath?: string; recipePath?: string }
export type BlocksMode = 'none' | 'core' | 'all';
export type OutputMode = 'auto' | 'file' | 'package';
/** genau eins von field, template; `label` nur in der Zusatzzeile: steht als „label: Wert“ vor dem Wert. */
export interface Column { header: string; field?: string; template?: string; label?: string }
export type OrderRule = { kind: 'name' } | { kind: 'mention' } | { kind: 'field'; field: string };
/**
 * Ein Bereich. `kind: 'sources'` ist eine Obergruppe über mehrere Quellen: `sources` nennt ihre Schlüssel, `path` ist leer, `title` ist Pflicht.
 * `titleFrom[i]` ist das Feld, aus dem die Gruppen der Ebene `groupBy[i]` ihren Titel nehmen (fehlt es, ist der Titel der Gruppenwert).
 */
export interface SectionSpec { kind: 'folder' | 'note' | 'source' | 'sources'; path: string; sources?: string[]; title?: string; order: OrderRule; groupBy: string[]; titleFrom?: string[]; overview: Column[]; summaryLine: Column[]; open: boolean }
export interface SourceSpec { path: string; key: string; title?: string }
export interface GridRule { states: Record<string, string[]>; groupColumns: 'header-prefix' | null; rowNote: 'parentheses' | null }
/** Pause über createCooperativeYield, Zustand über makeRunState (code-kit). */
export interface RunControl { readonly aborted: boolean; pause(): Promise<void>; progress(done: number, total: number, label: string): void }
/** Ergebnis eines Laufs (Bauplan Task 12). `html` fehlt bei `ok: false`; `bytes` ist die Größe der fertigen Seite in UTF-8-Bytes. */
export interface ExportResult { ok: boolean; html?: string; fileName: string; /** Vault-Pfad der Einstiegsnotiz, wie der Lauf ihn bestimmt hat (bei „automatisch“ erst im Lauf bekannt); fehlt, wenn es keine gibt. */ entryPath?: string; findings: Finding[]; stats: { notes: number; bytes: number; mediaBytes: Record<string, number> } }
export interface Recipe { version: 1; title?: string; lang: 'en' | 'de'; sources: SourceSpec[]; sections: SectionSpec[]; fields: { title?: string; order?: string; exclude?: string }; fold: { headingsFrom: number | null; linkedSummary: boolean }; grids: GridRule | null; theme: string; output: OutputMode; outputLimitMb: number; embeds: 'static'; blocks: BlocksMode; remoteImages: 'skip' | 'embed'; stamp: 'minimal' | 'full' }

// Aus Task 5 (Menge): nur die Typen, die Funktionen folgen mit Task 5.

/** body ab locateFrontmatter(text)?.bodyFrom ?? 0; links: aufgelöste Zielpfade in Textreihenfolge. */
export interface NoteInput { path: string; frontmatter: Record<string, unknown>; body: string; links: string[] }
/** depth: Zahl der Gruppen darüber; Marken vergibt erst Task 9. */
export interface SetNote { path: string; title: string; frontmatter: Record<string, unknown>; body: string; sourceKey?: string; depth: number }
/** `nav`: die Navigation führt die Untergruppen unter dieser Gruppe (Obergruppe über mehrere Quellen). */
export interface SetGroup { key: string; title: string; open: boolean; overview: Column[]; summaryLine: Column[]; children: SetNode[]; nav?: boolean }
export type SetNode = SetGroup | SetNote;
export interface ExportSet { title: string; entry: SetNote; nodes: SetNode[]; notesInOrder: SetNote[] }
export type ExportScope = { kind: 'folder'; folder: string; entryPath: string } | { kind: 'note'; entryPath: string };
