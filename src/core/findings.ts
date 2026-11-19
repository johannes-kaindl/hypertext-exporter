// Befundliste (Bauplan Task 12, Spec 10.9): sammeln, zählen, in fester Reihenfolge ordnen.
// Die Reihenfolge hängt nur vom Inhalt der Befunde ab (Schwere, Notizpfad, Code), nie von der Reihenfolge, in der sie anfielen: Die Ergebnisdatei
// gehört zur Byte-Gleichheit (Spec 10.8). Verglichen wird nach Codepunkt, nie mit `localeCompare` (das hängt an Sprache und ICU des Rechners).
import { compareCodePoints } from '../vendor/kit/name-order';
import type { Finding, Severity } from './types';

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export interface FindingCounts { errors: number; warnings: number; infos: number }

/**
 * Ordnung: Schwere (Fehler vor Warnung vor Hinweis), dann `notePath` (Befunde ohne Notiz zuerst), dann `code`.
 * Der Textvergleich ist `compareCodePoints` des Kits (Codepunkt, nie Sprache, nie UTF-16-Einheit): fest und rechnerunabhängig.
 */
export function compareFindings(a: Finding, b: Finding): number {
  if (a.severity !== b.severity) return RANK[a.severity] - RANK[b.severity];
  return compareCodePoints(a.notePath ?? '', b.notePath ?? '') || compareCodePoints(a.code, b.code);
}

/** Eine geordnete Kopie; gleiche Befunde behalten ihre Eingabereihenfolge (stabil, ohne sich auf die Sortierung der Laufzeit zu verlassen). */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => compareFindings(a.finding, b.finding) || a.index - b.index)
    .map((entry) => entry.finding);
}

export function countFindings(findings: readonly Finding[]): FindingCounts {
  const counts: FindingCounts = { errors: 0, warnings: 0, infos: 0 };
  for (const f of findings) {
    if (f.severity === 'error') counts.errors++;
    else if (f.severity === 'warning') counts.warnings++;
    else counts.infos++;
  }
  return counts;
}

export function hasError(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}

/** Sammelt die Befunde eines Laufs in der Reihenfolge, in der sie anfallen; `sorted()` liefert die feste Ordnung. */
export class FindingList {
  private readonly items: Finding[] = [];

  add(finding: Finding): void {
    this.items.push(finding);
  }

  addAll(findings: readonly Finding[]): void {
    for (const f of findings) this.items.push(f);
  }

  /** In Eingabereihenfolge, als Kopie. */
  all(): Finding[] {
    return [...this.items];
  }

  sorted(): Finding[] {
    return sortFindings(this.items);
  }

  counts(): FindingCounts {
    return countFindings(this.items);
  }

  hasError(): boolean {
    return hasError(this.items);
  }
}
