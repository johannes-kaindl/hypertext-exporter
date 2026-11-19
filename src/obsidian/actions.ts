// Schmale Schnittstelle zwischen Ansicht und Ablauf (UI-STANDARD §4: die Ansicht kennt weder Plugin noch Ports).
// Task 12 (Ablauf, Ausgabe) füllt sie; bis dahin liefert das Plugin `null` und der Knopf der Ansicht bleibt aus.

export interface ExportActions {
  /** Exportiert den Ordner; `entryPath` null heißt: Einstieg nach der Rangfolge (Ordnernotiz, sonst erste Notiz). */
  exportFolder(folder: string, entryPath: string | null): Promise<void>;
}
