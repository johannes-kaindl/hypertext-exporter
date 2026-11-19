import { describe, expect, it } from 'vitest';
import { orderByMention } from '../../src/core/mention-order';
import type { NoteInput } from '../../src/core/types';

const entry = (links: string[]): NoteInput => ({ path: 'o/o.md', frontmatter: {}, body: '', links });

describe('orderByMention', () => {
  it('erwähnte in Erwähnungsreihenfolge, übrige danach nach Namen', () => {
    const paths = ['o/Alpha.md', 'o/Beta.md', 'o/Gamma.md', 'o/Delta.md', 'o/10 Zehn.md', 'o/2 Zwei.md'];
    expect(orderByMention(entry(['o/Gamma.md', 'o/Beta.md']), paths)).toEqual(['o/Gamma.md', 'o/Beta.md', 'o/2 Zwei.md', 'o/10 Zehn.md', 'o/Alpha.md', 'o/Delta.md']);
  });

  it('jeder Pfad einmal: mehrfach erwähnte zählen beim ersten Mal, fremde Links und doppelte Pfade fallen weg', () => {
    const out = orderByMention(entry(['x/fremd.md', 'o/B.md', 'o/A.md', 'o/B.md']), ['o/A.md', 'o/B.md', 'o/A.md', 'o/C.md']);
    expect(out).toEqual(['o/B.md', 'o/A.md', 'o/C.md']);
  });

  it('ohne Erwähnung ist es die Namensordnung; die Reihenfolge der Eingabe ändert nichts', () => {
    const paths = ['o/Größe.md', 'o/Grundlagen.md', 'o/b/x.md', 'o/a/y.md', 'o/a/10 B.md', 'o/a/9 C.md'];
    const expected = orderByMention(entry([]), paths);
    expect(expected).toEqual(['o/a/9 C.md', 'o/a/10 B.md', 'o/a/y.md', 'o/b/x.md', 'o/Grundlagen.md', 'o/Größe.md']);
    expect(orderByMention(entry([]), [...paths].reverse())).toEqual(expected);
  });

  it('gleicht Pfade nach NFC ab (zerlegter Umlaut aus macOS ist derselbe Pfad) und gibt den Pfad der Eingabe zurück', () => {
    const nfd = 'o/Grösse.md';
    const nfc = 'o/Grösse.md';
    expect(orderByMention(entry([nfc]), ['o/A.md', nfd])).toEqual([nfd, 'o/A.md']);
  });

  it('Zeichen oberhalb der BMP: Codepunktordnung (U+FF5E vor U+1F600)', () => {
    expect(orderByMention(entry([]), ['o/\u{1F600}.md', 'o/～.md'])).toEqual(['o/～.md', 'o/\u{1F600}.md']);
  });

  it('leere Eingabe ergibt eine leere Liste', () => {
    expect(orderByMention(entry(['o/A.md']), [])).toEqual([]);
  });
});
