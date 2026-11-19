// Schmale Schnittstelle zwischen Oberfläche (Ansicht, Befehle, Dateimenü) und Ablauf (UI-STANDARD §4: die Oberfläche kennt weder Plugin noch Ports).
// Umgesetzt in `export-actions.ts` (`createExportActions`, über `runExport`, `writeExport`, `checkExport`); `main.ts` setzt `plugin.actions` beim Laden. Ist es `null`,
// hält die Ansicht den Knopf aus und die Befehle zeigen eine Notice „noch nicht verfügbar“ (`src/obsidian/commands.ts`).
//
// Vertrag für den Ablauf (alle vier Methoden):
// - **Wirft nie.** Jeder Ausgang, auch ein Fehler oder ein Abbruch, endet als aufgelöstes Promise; Fehler stehen als Befund (Fehlerstufe) im Ergebnis und in der Notice.
// - **Die Implementierung bedient Notices und das Panel „Befunde“**, nicht der Aufrufer: nach jedem Lauf (Export oder Prüfung) `plugin.openView()` und `view.showFindings(findings)`
//   (auch bei `[]`, damit der Empty-State den alten Lauf ersetzt). Die Befehle und das Panel „Export“ tun nach dem Aufruf nichts weiter.
// - **Fortschritt** über `startRunProgress` (`src/obsidian/progress.ts`): `run.control` geht als `RunControl` in `runExport`/`checkExport`, `run.beginWriting()` vor `writeExport`,
//   `run.end(failure)` im `finally`. Ein Abbruch endet als `cancelled`: keine HTML-Datei, die Ergebnisdatei mit `ok:false`, Notice „abgebrochen“.
// - **Sprache und Wortlaut** der Meldungen über `t(...)` und `src/i18n/strings.ts` (EN und DE); die Befehle selbst schreiben keine Meldung, außer „Ablauf fehlt“ (`notice.noRun`).

export interface ExportActions {
  /**
   * Exportiert den Ordner als `ExportScope` `{ kind: 'folder', folder, entryPath }` und schreibt nach dem Ziel der Einstellungen.
   * `entryPath` `null` heißt: Einstieg nach der Rangfolge (Ordnernotiz, sonst erste Notiz in Namensordnung).
   * Kommt vom Knopf des Panels „Export“ (Ordner und Einstieg, wie der Nutzer sie dort gewählt hat); zeigt am Ende die Befunde.
   */
  exportFolder(folder: string, entryPath: string | null): Promise<void>;

  /**
   * Befehl `export-current-note` und Dateimenü einer Notiz; ohne Dialog.
   * Die Entscheidung trifft der Ablauf: trägt die Notiz im Frontmatter einen Block `hypertext:`, ist die Menge ihr Ordner
   * (`{ kind: 'folder', folder: <Ordner der Notiz>, entryPath }`), sonst die Einzelnotiz (`{ kind: 'note', entryPath }`).
   * `entryPath` ist der Vault-Pfad einer Markdown-Notiz (die Befehle prüfen das vorher).
   */
  exportNote(entryPath: string): Promise<void>;

  /**
   * Befehl `check-export`: baut die Seite zur Einstiegsnotiz noch einmal (dieselbe Mengen-Entscheidung wie `exportNote`, ohne zu schreiben)
   * und vergleicht sie Byte für Byte mit der vorhandenen Ausgabe. Meldet per Notice
   *   - `t('check.same')` („gleich“), wenn beide übereinstimmen,
   *   - `t('check.differs', n)` („weicht ab ab Byte n“) mit dem ersten abweichenden Byte-Index,
   *   - `t('notice.noExport')` („noch kein Export“), wenn die Ausgabe fehlt,
   *   - eine Meldung „nichts zu vergleichen“ beim Ziel „Teilen“ (dort gibt es keine Datei im Vault).
   * Zeigt die Befunde der Prüfung im Panel „Befunde“.
   */
  checkExport(entryPath: string): Promise<void>;

  /**
   * Befehl `open-export`: öffnet die Ausgabe zur Einstiegsnotiz. Am Desktop `openWithDefaultApp`, am Handy `shareFile` (beides Kit `share-export`).
   * Fehlt die Ausgabe, kommt die Notice `t('notice.noExport')` („noch kein Export“) und es geschieht sonst nichts. Kein Lauf, keine Befunde.
   */
  openExport(entryPath: string): Promise<void>;
}
