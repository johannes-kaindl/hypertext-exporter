// Alle plugin-eigenen Typen (Bauplan Task 4; Typen von Task 5 nur als Schnittstelle, ohne Funktionen).

export type Severity = 'error' | 'warning' | 'info';
export interface Finding { severity: Severity; code: string; message: string; notePath?: string; recipePath?: string }
export type BlocksMode = 'none' | 'core' | 'all';
export type OutputMode = 'auto' | 'file' | 'package';
export interface Column { header: string; field?: string; template?: string }   // genau eins von field, template
export type OrderRule = { kind: 'name' } | { kind: 'mention' } | { kind: 'field'; field: string };
export interface SectionSpec { kind: 'folder' | 'note' | 'source'; path: string; title?: string; order: OrderRule; groupBy: string[]; overview: Column[]; summaryLine: Column[]; open: boolean }
export interface SourceSpec { path: string; key: string; title?: string }
export interface GridRule { states: Record<string, string[]>; groupColumns: 'header-prefix' | null; rowNote: 'parentheses' | null }
/** Pause über createCooperativeYield, Zustand über makeRunState (code-kit). */
export interface RunControl { readonly aborted: boolean; pause(): Promise<void>; progress(done: number, total: number, label: string): void }
export interface Recipe { version: 1; title?: string; lang: 'en' | 'de'; sources: SourceSpec[]; sections: SectionSpec[]; fields: { title?: string; order?: string; exclude?: string }; fold: { headingsFrom: number | null; linkedSummary: boolean }; grids: GridRule | null; theme: string; output: OutputMode; outputLimitMb: number; embeds: 'static'; blocks: BlocksMode; remoteImages: 'skip' | 'embed'; stamp: 'minimal' | 'full' }

// Aus Task 5 (Menge): nur die Typen, die Funktionen folgen mit Task 5.

/** body ab locateFrontmatter(text)?.bodyFrom ?? 0; links: aufgelöste Zielpfade in Textreihenfolge. */
export interface NoteInput { path: string; frontmatter: Record<string, unknown>; body: string; links: string[] }
/** depth: Zahl der Gruppen darüber; Marken vergibt erst Task 9. */
export interface SetNote { path: string; title: string; frontmatter: Record<string, unknown>; body: string; sourceKey?: string; depth: number }
export interface SetGroup { key: string; title: string; open: boolean; overview: Column[]; summaryLine: Column[]; children: SetNode[] }
export type SetNode = SetGroup | SetNote;
export interface ExportSet { title: string; entry: SetNote; nodes: SetNode[]; notesInOrder: SetNote[] }
export type ExportScope = { kind: 'folder'; folder: string; entryPath: string } | { kind: 'note'; entryPath: string };
