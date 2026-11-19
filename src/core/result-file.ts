// Ergebnisdatei `<basis>.export.json` (Bauplan Task 12): ein Text, den ein Aufrufer (Kommandozeile, Skript) liest, um zu wissen, ob der Export geklappt hat.
// Schlüssel und Befunde stehen in fester Reihenfolge, der Text endet mit `\n`; zweimal derselbe Lauf ergibt dieselben Bytes.
// Die Befundliste steht hier und nicht in einer Notiz: Eine Notiz neben der Ausgabe gehörte beim nächsten Lauf zur Menge (Bauplan, Änderungen gegenüber der Spec).
import { countFindings, sortFindings } from './findings';
import type { ExportResult, Finding } from './types';

/** `ok` heißt: der Lauf meldet Erfolg und kein Befund ist ein Fehler. Eine `ok: true`-Meldung mit Fehlerbefund gäbe es nie in der Ergebnisdatei. */
export function exportOk(result: ExportResult): boolean {
  return result.ok && countFindings(result.findings).errors === 0;
}

function findingObject(f: Finding): Record<string, string> {
  const out: Record<string, string> = { severity: f.severity, code: f.code, message: f.message };
  if (f.notePath !== undefined) out.notePath = f.notePath;
  if (f.recipePath !== undefined) out.recipePath = f.recipePath;
  return out;
}

/**
 * `{"ok":…,"path":…,"errors":n,"warnings":n,"infos":n,"findings":[…]}\n`. `path` ist der Vault-Pfad der HTML-Datei, sonst `null`;
 * bei `ok: false` immer `null`, auch wenn der Aufrufer einen Pfad übergibt (dort liegt keine Datei dieses Laufs).
 */
export function resultJson(result: ExportResult, outPath: string | null): string {
  const ok = exportOk(result);
  const findings = sortFindings(result.findings);
  const counts = countFindings(findings);
  return `${JSON.stringify({
    ok,
    path: ok ? outPath : null,
    errors: counts.errors,
    warnings: counts.warnings,
    infos: counts.infos,
    findings: findings.map(findingObject),
  })}\n`;
}
