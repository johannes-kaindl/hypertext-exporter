import { describe, expect, it } from 'vitest';
import { compareFindings, countFindings, FindingList, hasError, sortFindings } from '../../src/core/findings';
import type { Finding } from '../../src/core/types';

// `tag` unterscheidet Befunde mit gleichem Schlüssel; er steht als Wert in `args`.
const f = (severity: Finding['severity'], code: string, notePath?: string, tag = code): Finding =>
  notePath === undefined ? { severity, code, args: [tag] } : { severity, code, args: [tag], notePath };

const SAMPLE: Finding[] = [
  f('info', 'output.size'),
  f('warning', 'link.unresolved', 'b.md'),
  f('error', 'mark.duplicate', 'a.md'),
  f('warning', 'link.outside', 'a.md'),
  f('error', 'final.forbidden'),
  f('warning', 'embed.missing', 'a.md'),
  f('info', 'set.empty-file', 'leer/README.md'),
  f('warning', 'embed.missing', 'Z.md'),
  f('warning', 'embed.missing', 'a.md', 'zweiter Fund an derselben Stelle'),
];

/** Alle Umordnungen einer kleinen Liste (Heap-Algorithmus), damit „unabhängig von der Eingabereihenfolge“ vollständig geprüft ist. */
function permutations<T>(items: T[]): T[][] {
  const out: T[][] = [];
  const a = [...items];
  const run = (n: number): void => {
    if (n <= 1) { out.push([...a]); return; }
    for (let i = 0; i < n; i++) {
      run(n - 1);
      const j = n % 2 === 0 ? i : 0;
      [a[n - 1], a[j]] = [a[j] as T, a[n - 1] as T];
    }
  };
  run(a.length);
  return out;
}

describe('sortFindings', () => {
  it('ordnet nach Schwere, dann Notizpfad (ohne Notiz zuerst), dann Code', () => {
    const sorted = sortFindings(SAMPLE).map((x) => `${x.severity} ${x.notePath ?? '-'} ${x.code}`);
    expect(sorted).toEqual([
      'error - final.forbidden',
      'error a.md mark.duplicate',
      'warning Z.md embed.missing',
      'warning a.md embed.missing',
      'warning a.md embed.missing',
      'warning a.md link.outside',
      'warning b.md link.unresolved',
      'info - output.size',
      'info leer/README.md set.empty-file',
    ]);
  });

  it('vergleicht nach Zeichenfolge und nicht nach Sprache: Großbuchstaben vor Kleinbuchstaben', () => {
    // localeCompare('Z.md', 'a.md') ist positiv (a vor Z); die feste Ordnung stellt Z vor a.
    expect('Z.md'.localeCompare('a.md')).toBeGreaterThan(0);
    expect(compareFindings(f('warning', 'x', 'Z.md'), f('warning', 'x', 'a.md'))).toBeLessThan(0);
  });

  it('vergleicht nach Codepunkt und nicht nach UTF-16-Einheit: U+FF5E vor U+1F600', () => {
    // nach UTF-16-Einheit steht das Ersatzpaar des Emoji (D83D) vor U+FF5E; nach Codepunkt U+FF5E vor U+1F600
    const emoji = f('warning', 'x', '\u{1F600}.md');
    const tilde = f('warning', 'x', '\uFF5E.md');
    expect(compareFindings(tilde, emoji)).toBeLessThan(0);
    expect(compareFindings(emoji, tilde)).toBeGreaterThan(0);
    expect(sortFindings([emoji, tilde]).map((x) => x.notePath)).toEqual(['\uFF5E.md', '\u{1F600}.md']);
  });

  it('gibt dasselbe Ergebnis für jede Eingabereihenfolge (alle Umordnungen von sechs Befunden)', () => {
    const six = [SAMPLE[0], SAMPLE[1], SAMPLE[2], SAMPLE[3], SAMPLE[4], SAMPLE[6]] as Finding[];
    const expected = JSON.stringify(sortFindings(six));
    const all = permutations(six);
    expect(all).toHaveLength(720);
    for (const p of all) expect(JSON.stringify(sortFindings(p))).toBe(expected);
  });

  it('hält gleiche Befunde in Eingabereihenfolge (stabil)', () => {
    const a = f('warning', 'embed.missing', 'a.md', 'erster');
    const b = f('warning', 'embed.missing', 'a.md', 'zweiter');
    expect(sortFindings([a, b]).map((x) => x.args?.[0])).toEqual(['erster', 'zweiter']);
    expect(sortFindings([b, a]).map((x) => x.args?.[0])).toEqual(['zweiter', 'erster']);
  });

  it('ändert die Eingabe nicht', () => {
    const input = [...SAMPLE];
    const before = JSON.stringify(input);
    sortFindings(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('countFindings und hasError', () => {
  it('zählt nach Schwere', () => {
    expect(countFindings(SAMPLE)).toEqual({ errors: 2, warnings: 5, infos: 2 });
    expect(countFindings([])).toEqual({ errors: 0, warnings: 0, infos: 0 });
  });

  it('hasError ist nur bei einem Fehler wahr', () => {
    expect(hasError(SAMPLE)).toBe(true);
    expect(hasError([f('warning', 'x'), f('info', 'y')])).toBe(false);
    expect(hasError([])).toBe(false);
  });
});

describe('FindingList', () => {
  it('sammelt in Reihenfolge des Anfalls und liefert die feste Ordnung auf Wunsch', () => {
    const list = new FindingList();
    list.add(f('info', 'output.size'));
    list.addAll([f('error', 'mark.duplicate', 'a.md'), f('warning', 'embed.missing', 'a.md')]);
    expect(list.all().map((x) => x.code)).toEqual(['output.size', 'mark.duplicate', 'embed.missing']);
    expect(list.sorted().map((x) => x.code)).toEqual(['mark.duplicate', 'embed.missing', 'output.size']);
    expect(list.counts()).toEqual({ errors: 1, warnings: 1, infos: 1 });
    expect(list.hasError()).toBe(true);
  });

  it('all() gibt eine Kopie', () => {
    const list = new FindingList();
    list.add(f('info', 'x'));
    list.all().push(f('error', 'y'));
    expect(list.hasError()).toBe(false);
  });
});
