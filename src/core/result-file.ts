// Ergebnisdatei `<basis>.export.json` (Bauplan Task 12): ein Text, den ein Aufrufer (Kommandozeile, Skript) liest, um zu wissen, ob der Export geklappt hat.
// Schlüssel und Befunde stehen in fester Reihenfolge, der Text endet mit `\n`; zweimal derselbe Lauf ergibt dieselben Bytes.
// Die Befundliste steht hier und nicht in einer Notiz: Eine Notiz neben der Ausgabe gehörte beim nächsten Lauf zur Menge (Bauplan, Änderungen gegenüber der Spec).
import { findingMessage, type Translate } from './finding-text';
import { countFindings, sortFindings } from './findings';
import type { ExportResult, Finding, Severity } from './types';

/** Ein Befund mit fertigem Satz, wie ihn die Ergebnisdatei trägt und das Panel zeigt. Der Satz folgt der Sprache der Oberfläche; `code` ist der Vertrag. */
export interface ResultFinding { severity: Severity; code: string; message: string; notePath?: string; recipePath?: string }

/** `ok` heißt: der Lauf meldet Erfolg und kein Befund ist ein Fehler. Eine `ok: true`-Meldung mit Fehlerbefund gäbe es nie in der Ergebnisdatei. */
export function exportOk(result: ExportResult): boolean {
  return result.ok && countFindings(result.findings).errors === 0;
}

/** Der Befund mit seinem Satz in der Sprache von `translate`. */
export function toResultFinding(f: Finding, translate: Translate): ResultFinding {
  const out: ResultFinding = { severity: f.severity, code: f.code, message: findingMessage(f, translate) };
  if (f.notePath !== undefined) out.notePath = f.notePath;
  if (f.recipePath !== undefined) out.recipePath = f.recipePath;
  return out;
}

function findingObject(f: Finding, translate: Translate): Record<string, string> {
  const out: Record<string, string> = { severity: f.severity, code: f.code, message: findingMessage(f, translate) };
  if (f.notePath !== undefined) out.notePath = f.notePath;
  if (f.recipePath !== undefined) out.recipePath = f.recipePath;
  return out;
}

/**
 * `{"ok":…,"path":…,"errors":n,"warnings":n,"infos":n,"findings":[…]}\n`. `path` ist der Vault-Pfad der HTML-Datei, sonst `null`;
 * bei `ok: false` immer `null`, auch wenn der Aufrufer einen Pfad übergibt (dort liegt keine Datei dieses Laufs).
 * `message` trägt den Satz in der Sprache von `translate` (die Oberfläche übergibt `t`); gleiche Sprache, gleicher Lauf: dieselben Bytes. Verlassen kann sich ein Aufrufer nur auf `code`.
 */
export function resultJson(result: ExportResult, outPath: string | null, translate: Translate): string {
  const ok = exportOk(result);
  const findings = sortFindings(result.findings);
  const counts = countFindings(findings);
  return `${JSON.stringify({
    ok,
    path: ok ? outPath : null,
    errors: counts.errors,
    warnings: counts.warnings,
    infos: counts.infos,
    findings: findings.map((f) => findingObject(f, translate)),
  })}\n`;
}
