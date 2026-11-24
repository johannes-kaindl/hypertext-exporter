// vendored from obsidian-kit@0.109.0, src/pure/output-target.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Ziel der Ausgabe, reiner Teil (Welle 36, h2b, Bestellung 13 der Design-Linie hypertext; gehoben aus epub-exporter@e6f3a42 `src/core/output-path.ts`, dort `resolveOutputPath` und `sanitizeBase`).
//
// Vier Ziele, die jeder Exporter kennt: `besideNote` (Ordner der Notiz), `attachmentFolder` (der Pfad, den Obsidians `getAvailablePathForAttachment` schon aufgelöst hat), `customFolder` (ein Ordner aus
// den Einstellungen) und `share` (kein Vault-Pfad: die Datei geht an Teilen-Blatt oder Standard-App, siehe `src/obsidian/export-output.ts` und `shareExport`).
//
// Unterschiede zum Träger, mit Grund: (1) die Endung ist ein Parameter (epub-exporter schrieb `.epub` fest; Paperize und Letterhead brauchen `.pdf`, ein HTML-Export `.html`); (2) der Ersatzname für einen leeren
// Namen ist einer (Träger: „Untitled“, health-vitals „Export“); (3) die Endung wird geprüft, weil sie in einen Pfad eingeht. Alles andere ist byte-gleich zum Träger: `sanitizeBase` und `joinVaultPath` tragen
// die Regeln, hier steht nur die Zusammensetzung. Kein `obsidian`-Import; gehört trotzdem ins Kit und nicht nach code-kit, weil `joinVaultPath` die Vault-Pfad-Semantik trägt (CONTRIBUTING § 2).
import { sanitizeBase } from "./filename-template";
import { joinVaultPath } from "./vault-path";

export type OutputDestination = "besideNote" | "attachmentFolder" | "customFolder" | "share";

export const OUTPUT_DESTINATIONS: readonly OutputDestination[] = ["besideNote", "attachmentFolder", "customFolder", "share"];

export interface OutputPathInput {
  /** Der Ordner der Notiz (`vaultDirname(note.path)`), `""` für die Wurzel. */
  noteDir: string;
  /** Der Name ohne Endung, roh (Notizname oder Titel); wird bereinigt. */
  baseName: string;
  /** Die Endung mit Punkt, klein oder gemischt: `.epub`, `.pdf`, `.html`. */
  extension: string;
  /** Der Ordner aus den Einstellungen; Slash-Rauschen und leer (= Vault-Wurzel) verträgt `joinVaultPath`. */
  customFolder: string;
  /** Der aufgelöste Anhangspfad (`getAvailablePathForAttachment`), nur für `attachmentFolder` gelesen. Er trägt die Endung schon und wird unverändert übernommen. */
  attachmentPath: string;
  /** Ersatzname, wenn nach dem Bereinigen nichts übrig bleibt. Vorgabe „Untitled“. */
  fallbackName?: string;
}

const EXTENSION_PATTERN = /^\.[A-Za-z0-9]{1,16}$/;

/** Dateiname mit Endung für `baseName`: bereinigt (kein Pfad, keine Sonderzeichen), leer wird `fallbackName`. Wirft eine `RangeError` bei einer Endung, die keine ist (sie ginge in einen Pfad ein). */
export function outputFileName(baseName: string, extension: string, fallbackName = "Untitled"): string {
  if (!EXTENSION_PATTERN.test(extension)) throw new RangeError(`Ungültige Endung: ${extension}`);
  return `${sanitizeBase(baseName, fallbackName)}${extension}`;
}

/** Der Vault-Pfad der Ausgabe, oder `null` für `share` (es gibt keinen). Für `attachmentFolder` der aufgelöste Pfad, unverändert. */
export function resolveOutputPath(dest: OutputDestination, input: OutputPathInput): string | null {
  if (dest === "share") return null;
  if (dest === "attachmentFolder") return input.attachmentPath;
  const file = outputFileName(input.baseName, input.extension, input.fallbackName);
  return joinVaultPath(dest === "besideNote" ? input.noteDir : input.customFolder, file);
}
