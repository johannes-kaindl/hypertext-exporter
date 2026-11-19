// Reihenfolge „nach erster Erwähnung in der Einstiegsnotiz, übrige danach“ (Spec 10.3, Bauplan Task 5): so ordnet der focus-crew-Vertrag die Themen.
// Rein. Das Ergebnis hängt nur von der Menge der Pfade und den Links der Einstiegsnotiz ab, nie von der Reihenfolge der Eingabe.
import { compareCodePoints, compareOrderedNames, parseOrderedName } from '../vendor/kit/name-order';
import type { NoteInput } from './types';

const MD = /\.md$/i;

/** Der Name eines Pfadteils als Ordnung des Kits (Zahlenpräfix, natürliche Ordnung); bei der Datei ohne `.md`. */
function segmentOrder(segment: string, last: boolean) {
  return parseOrderedName((last ? segment.replace(MD, '') : segment).normalize('NFC'));
}

/** Namensordnung zweier Pfade: Teil für Teil nach der Namensregel, bei Gleichstand der ganze Pfad nach Codepunkt. */
function comparePaths(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const byName = compareOrderedNames(segmentOrder(x[i] ?? '', i === x.length - 1), segmentOrder(y[i] ?? '', i === y.length - 1));
    if (byName !== 0) return byName;
  }
  return compareCodePoints(a.normalize('NFC'), b.normalize('NFC'));
}

/**
 * Die Pfade in der Reihenfolge, in der `entry.links` sie zum ersten Mal nennt; die nicht genannten danach in Namensordnung.
 * Jeder Pfad steht einmal im Ergebnis (so, wie die Eingabe ihn schreibt); Links auf Pfade außerhalb von `paths` zählen nicht. Pfade werden nach NFC verglichen.
 */
export function orderByMention(entry: NoteInput, paths: string[]): string[] {
  const wanted = new Map<string, string>();
  for (const p of paths) {
    const key = p.normalize('NFC');
    if (!wanted.has(key)) wanted.set(key, p);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const link of entry.links) {
    const key = link.normalize('NFC');
    const hit = wanted.get(key);
    if (hit === undefined || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  const rest = Array.from(wanted.entries()).filter(([key]) => !seen.has(key)).map(([, original]) => original);
  rest.sort(comparePaths);
  return [...out, ...rest];
}
