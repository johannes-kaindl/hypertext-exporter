// Ausgabe schreiben (Bauplan Task 12, Etappe 0 Zusatzmessung 6): die Seite und die Ergebnisdatei `<basis>.export.json` neben ihr.
// Ziel und Ersetzen trägt das Kit (`writeExportOutput`, Bestellung 13): Zwischendatei `<ziel>.tmp`, Zurücklesen, alte Fassung als `.prev` beiseite, `.tmp` wird das Ziel.
// Ein Abbruch lässt nie eine halbe Datei zurück; eine liegengebliebene `.tmp` oder `.prev` überschreibt oder räumt der nächste Lauf. Beide Endungen sind keine Markdown-Dateien
// und gehören damit nie zur Menge des nächsten Laufs (Byte-Gleichheit, Spec 10.8).
// `runExport`, `checkExport` und `exportApi` kommen mit der Menge (Task 5) und der Seite (Task 10); hier steht nur das Schreiben.
import type { App } from 'obsidian';
import { CODES } from '../core/finding-codes';
import { exportOk, resultJson } from '../core/result-file';
import type { ExportResult, Finding } from '../core/types';
import { errorMessage } from '../vendor/kit/error-message';
import { getLang, t } from '../vendor/kit/i18n';
import { outputFileName, resolveOutputPath, type OutputDestination } from '../vendor/kit/output-target';
import { baseName, splitFileName } from '../vendor/kit/rel-path';
import { joinVaultPath, vaultDirname } from '../vendor/kit/vault-path';
import { writeExportOutput } from '../vendor/kit-obsidian/export-output';
import { replaceFileSafely } from '../vendor/kit-obsidian/replace-file-safely';
import { SHARE_EXPORT_STRINGS_DE, SHARE_EXPORT_STRINGS_EN } from '../vendor/kit-obsidian/share-export';
import type { HtSettings } from './settings';

/** Was das Schreiben vom Plugin braucht; `HypertextExporterPlugin` erfüllt es, ein Test gibt eine Fake-Platte hinein. */
export interface OutputHost {
  app: App;
  settings: Pick<HtSettings, 'destination' | 'destinationFolder'>;
}

const HTML_EXTENSION = '.html';
const RESULT_SUFFIX = '.export.json';
/** Versteckter Ordner im Vault für das Ziel „Teilen“ (Name des Plugins, damit das Leeren nur eigene Reste trifft). */
const SHARE_DIR = '.hypertext-export';
const MIME_HTML = 'text/html';
const FALLBACK_NAME = 'export';

const KIT_DESTINATION: Record<HtSettings['destination'], OutputDestination> = {
  'beside-entry': 'besideNote',
  folder: 'customFolder',
  share: 'share',
};

function writeFailure(reason?: string): Finding {
  return reason === undefined
    ? { severity: 'error', code: CODES.outputWriteFailed, variant: 'no-path', args: [] }
    : { severity: 'error', code: CODES.outputWriteFailed, args: [reason] };
}

function failed(result: ExportResult, ...extra: Finding[]): ExportResult {
  const { html: _dropped, ...rest } = result;
  return { ...rest, ok: false, findings: [...result.findings, ...extra] };
}

/**
 * Schreibt die Seite nach dem Ziel der Einstellungen und liefert den Text der Ergebnisdatei (`resultJson`) zurück; wirft nie.
 * - `beside-entry` und `folder`: `<basis>.html` und `<basis>.export.json` im selben Ordner, beide abbruchsicher ersetzt; `basis` ist der Name der Einstiegsnotiz.
 * - `share`: die Seite geht an das Teilen-Blatt des Kits, es gibt keine Ergebnisdatei und keinen Vault-Pfad (`path` ist `null`).
 * - `ok: false` (oder ein Fehlerbefund): keine HTML-Datei, eine vorhandene bleibt unberührt; die Ergebnisdatei wird mit `ok:false` und `path:null` ersetzt,
 *   damit nie eine alte `ok:true` neben dem gescheiterten Lauf liegt.
 * - Scheitert das Schreiben der Seite, wird daraus `ok:false` mit dem Befund `output.write-failed`.
 */
export async function writeExport(plugin: OutputHost, result: ExportResult, entryPath: string): Promise<string> {
  try {
    return await write(plugin, result, entryPath);
  } catch (e) {
    return resultJson(failed(result, writeFailure(errorMessage(e))), null, t);
  }
}

/** Die Angaben, die das Kit für Ziel und Dateinamen braucht; derselbe Satz für das Schreiben und für `outputPaths`, damit beide Namen nie auseinanderlaufen. */
function pathInput(plugin: OutputHost, entryPath: string) {
  return {
    baseName: splitFileName(baseName(entryPath)).stem,
    extension: HTML_EXTENSION,
    noteDir: vaultDirname(entryPath),
    customFolder: plugin.settings.destinationFolder,
    attachmentPath: '',
    fallbackName: FALLBACK_NAME,
  };
}

/**
 * Wo die Ausgabe zur Einstiegsnotiz liegt: `html` (die Seite) und `json` (die Ergebnisdatei, `null` beim Ziel „Teilen“, dort gibt es keine).
 * Beim Ziel „Teilen“ ist `html` die Datei im versteckten Export-Ordner des Vaults (sie bleibt bis zum nächsten Export liegen). `null`, wenn sich kein Pfad ergibt.
 */
export function outputPaths(plugin: OutputHost, entryPath: string): { html: string; json: string | null } | null {
  const common = pathInput(plugin, entryPath);
  const destination = KIT_DESTINATION[plugin.settings.destination];
  if (destination === 'share') return { html: `${SHARE_DIR}/${outputFileName(common.baseName, common.extension, common.fallbackName)}`, json: null };
  const html = resolveOutputPath(destination, common);
  if (html === null) return null;
  return { html, json: joinVaultPath(vaultDirname(html), `${splitFileName(baseName(html)).stem}${RESULT_SUFFIX}`) };
}

async function write(plugin: OutputHost, result: ExportResult, entryPath: string): Promise<string> {
  const adapter = plugin.app.vault.adapter;
  const destination = KIT_DESTINATION[plugin.settings.destination];
  const html = exportOk(result) ? result.html : undefined;
  const common = pathInput(plugin, entryPath);

  if (destination === 'share') {
    if (html === undefined) return resultJson(failed(result), null, t);
    const strings = getLang() === 'de' ? SHARE_EXPORT_STRINGS_DE : SHARE_EXPORT_STRINGS_EN;
    const shared = await writeExportOutput(plugin.app, new TextEncoder().encode(html), { ...common, mime: MIME_HTML, destination, share: { dir: SHARE_DIR, strings } });
    if (!shared.ok) return resultJson(failed(result, writeFailure(shared.message)), null, t);
    return resultJson(result, null, t);
  }

  // Ort der Ergebnisdatei: neben der Seite, mit demselben bereinigten Namen.
  const paths = outputPaths(plugin, entryPath);
  const jsonPath = paths?.json ?? null;
  if (jsonPath === null) return resultJson(failed(result, writeFailure()), null, t);

  let final = result;
  let outPath: string | null = null;
  if (html !== undefined) {
    const written = await writeExportOutput(plugin.app, new TextEncoder().encode(html), { ...common, mime: MIME_HTML, destination });
    if (written.ok && written.destination !== 'share') outPath = written.path;
    else final = failed(result, written.ok ? writeFailure() : writeFailure(written.message));
  } else {
    final = failed(result);
  }

  const json = resultJson(final, outPath, t);
  const stored = await replaceFileSafely(adapter, jsonPath, new TextEncoder().encode(json));
  if (stored.ok) return json;
  // Die Seite liegt (oder der Lauf ist gescheitert), aber die Ergebnisdatei ließ sich nicht schreiben: der Aufrufer erfährt es aus dem Rückgabetext.
  return resultJson({ ...final, findings: [...final.findings, { severity: 'warning', code: CODES.outputWriteFailed, variant: 'result-file', args: [stored.message] }] }, outPath, t);
}
