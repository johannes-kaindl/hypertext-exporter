// vendored from obsidian-kit@0.106.0, src/obsidian/export-output.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Ziel der Ausgabe, Schreiber (Welle 36, h2b, Bestellung 13 der Design-Linie hypertext; gehoben aus epub-exporter@e6f3a42 `src/obsidian/output.ts` `writeEpub`).
//
// Nimmt Bytes, einen Basisnamen und eines der vier Ziele (`OutputDestination`, reiner Teil in `src/pure/output-target.ts`) und schreibt:
//   - `besideNote`, `attachmentFolder`, `customFolder`: über die Vault-API in den aufgelösten Pfad, der Ordner wird angelegt, eine vorhandene Datei wird ABBRUCHSICHER ersetzt (`replaceFileSafely`: `.tmp`, Zurücklesen,
//     `.prev`, `rename`; der Träger schrieb mit `writeBinary` in die Zieldatei, das kürzt sie zuerst auf 0 Bytes) oder, mit `ifExists: "number"`, unter dem ersten freien Namen daneben (`Buch 2.epub`);
//   - `share`: `shareExport` (versteckter Ordner, Teilen-Blatt, sonst Standard-App). Die Texte dazu gehören dem Aufrufer.
// Der Baustein zeigt selbst nichts an: der Träger rief hier `new Notice(…)` mit seinem Text; das Ergebnis trägt `path` und `replaced`, der Aufrufer zeigt, was er will. Schreibt `share` etwas, zeigt `shareExport`
// seine Meldungen (Fertig, Fehler) selbst, wie bisher.
// Wirft nie: ein Fehler des Adapters kommt als `{ ok: false, message }`; die Zieldatei ist dann unberührt oder die alte Fassung liegt vollständig vor (Weg und Abbruchpunkte: `replace-file-safely.ts`).
import type { App } from "obsidian";
import { firstFreeNameAsync } from "../kit/filename-policy";
import { errorMessage } from "../kit/error-message";
import { outputFileName, resolveOutputPath, type OutputDestination } from "../kit/output-target";
import { replaceFileSafely } from "./replace-file-safely";
import { shareExport, type ShareExportResult, type ShareExportStrings } from "./share-export";

export interface ExportOutputOptions {
  destination: OutputDestination;
  /** Name ohne Endung, roh; wird bereinigt (`sanitizeBase`). */
  baseName: string;
  /** Endung mit Punkt (`.epub`, `.pdf`, `.html`). */
  extension: string;
  mime: string;
  /** Ordner der Notiz, `""` für die Wurzel. */
  noteDir: string;
  customFolder: string;
  /** Aufgelöster Anhangspfad, nur für `attachmentFolder` gelesen. */
  attachmentPath: string;
  fallbackName?: string;
  /** Die Datei am Zielpfad gibt es schon: `replace` (Vorgabe) ersetzt sie abbruchsicher, `number` schreibt unter dem ersten freien Namen. Für `share` ohne Wirkung (der Ordner wird dort geleert). */
  ifExists?: "replace" | "number";
  /** Nur für `share` nötig: der versteckte Ordner (`.epub-export`) und die Texte. */
  share?: { dir: string; strings?: ShareExportStrings };
}

export type ExportOutputResult =
  | { ok: true; destination: Exclude<OutputDestination, "share">; path: string; replaced: boolean }
  | { ok: true; destination: "share"; share: ShareExportResult }
  | { ok: false; message: string };

export async function writeExportOutput(app: App, bytes: Uint8Array, o: ExportOutputOptions): Promise<ExportOutputResult> {
  try {
    if (o.destination === "share") {
      if (o.share === undefined) return { ok: false, message: "Für das Ziel „share“ fehlt der Ordner (`share.dir`)." };
      const fileName = outputFileName(o.baseName, o.extension, o.fallbackName);
      const result = await shareExport(app, bytes, { dir: o.share.dir, fileName, mime: o.mime, strings: o.share.strings });
      // `shareExport` hat seine eigene Fehlermeldung schon gezeigt; hier nur der Befund für den Aufrufer.
      if (result.outcome === "failed") return { ok: false, message: errorMessage(result.error) };
      return { ok: true, destination: "share", share: result };
    }
    const adapter = app.vault.adapter;
    const wanted = resolveOutputPath(o.destination, o);
    // Nur `share` liefert null, und das ist oben abgehandelt; die Prüfung hält den Typ ehrlich.
    if (wanted === null) return { ok: false, message: "Kein Ausgabepfad." };
    const path = o.ifExists === "number" ? await firstFreeNameAsync(wanted, "file", (c) => adapter.exists(c)) : wanted;
    const replaced = await adapter.exists(path);
    const written = await replaceFileSafely(adapter, path, bytes);
    if (!written.ok) return { ok: false, message: written.message };
    return { ok: true, destination: o.destination, path, replaced };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}
