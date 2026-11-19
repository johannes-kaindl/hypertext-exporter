// Harte Endprüfung (Bauplan Task 10, Spec 10.4 und 10.8): sieht nur den fertigen Text der Seite.
// Die Marken-Prüfung über die ganze Seite (`mark.duplicate`, `mark.missing-target`) macht allein die Kit-Funktion `checkAnchors` (Bestellung 6).
import { checkAnchors } from '../vendor/kit/anchor-check';
import { CODES } from './finding-codes';
import type { Finding } from './types';

const FORBIDDEN: Array<{ needle: string; message: string }> = [
  { needle: 'app://', message: 'Die Seite enthält eine app://-Adresse.' },
  { needle: 'capacitor://', message: 'Die Seite enthält eine capacitor://-Adresse.' },
  { needle: 'file://', message: 'Die Seite enthält eine file://-Adresse.' },
];

const USER_PATHS: Array<{ needle: string; message: string }> = [
  { needle: '/Users/', message: 'Die Seite enthält Text, der wie ein Benutzerordner aussieht (/Users/).' },
  { needle: '/home/', message: 'Die Seite enthält Text, der wie ein Benutzerordner aussieht (/home/).' },
  { needle: 'C:\\Users', message: 'Die Seite enthält Text, der wie ein Benutzerordner aussieht (C:\\Users).' },
];

/**
 * `error` `final.forbidden` für `app://`, `capacitor://`, `file://` und den Vault-Basispfad (roh, `encodeURI`, `encodeURIComponent`);
 * `warning` `final.user-path` für `/Users/`, `/home/`, `C:\Users` (dürfen als Text einer Notiz vorkommen). Ein Befund je Muster, feste Reihenfolge.
 * Die Meldung nennt den Basispfad nie. `basePath` ist `null` oder leer, wo es keinen gibt (Handy): dann entfällt diese Prüfung.
 *
 * Danach die Marken der fertigen Seite `page` über `checkAnchors` (Kit): jede doppelte id `error` `mark.duplicate`, jeder Sprung `#…` ohne Ziel `error` `mark.missing-target`, in der Reihenfolge des Kits.
 */
export function finalCheck(html: string, page: HTMLElement, basePath: string | null): Finding[] {
  const findings: Finding[] = [];
  for (const { needle, message } of FORBIDDEN) {
    if (html.includes(needle)) findings.push({ severity: 'error', code: CODES.finalForbidden, message });
  }
  if (basePath !== null && basePath !== '') {
    const variants = [basePath, encodeURI(basePath), encodeURIComponent(basePath)];
    if (variants.some((v) => html.includes(v))) {
      findings.push({ severity: 'error', code: CODES.finalForbidden, message: 'Die Seite enthält den Pfad des Vault-Ordners.' });
    }
  }
  for (const { needle, message } of USER_PATHS) {
    if (html.includes(needle)) findings.push({ severity: 'warning', code: CODES.finalUserPath, message });
  }
  for (const a of checkAnchors(page)) {
    if (a.kind === 'duplicate-id') {
      findings.push({ severity: 'error', code: CODES.markDuplicate, message: `Die Marke „${a.id}“ steht ${a.count}-mal auf der Seite.` });
    } else {
      findings.push({ severity: 'error', code: CODES.markMissingTarget, message: `Der Sprung ${a.href} („${a.text}“) hat kein Ziel auf der Seite.` });
    }
  }
  return findings;
}
