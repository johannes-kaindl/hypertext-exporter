import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODES, VARIANTS } from '../../src/core/finding-codes';
import { findingKey, findingMessage } from '../../src/core/finding-text';
import { DE, EN } from '../../src/i18n/strings';
import { tableTranslate } from './text-of';

const codes = Object.values(CODES);
const findingKeys = (table: Record<string, string>): string[] => Object.keys(table).filter((k) => k.startsWith('finding.'));
/** Anzahl der Lücken `{n}` eines Textes: EN und DE müssen dieselben Werte brauchen. */
const slots = (text: string): string[] => Array.from(new Set(Array.from(text.matchAll(/\{(\d+)\}/g), (m) => m[1] as string))).sort();

describe('Befundtexte: jeder Code hat einen EN- und einen DE-Text', () => {
  it.each(codes)('%s', (code) => {
    expect(EN[findingKey({ code })], `EN finding.${code}`).toBeTruthy();
    expect(DE[findingKey({ code })], `DE finding.${code}`).toBeTruthy();
  });

  it('jede Variante hat einen EN- und einen DE-Text, und jeder Text gehört zu einem Code oder einer Variante', () => {
    const expected = new Set<string>();
    for (const code of codes) expected.add(findingKey({ code }));
    for (const [code, variants] of Object.entries(VARIANTS)) {
      expect(codes, `Code ${code} in VARIANTS`).toContain(code);
      for (const variant of variants) {
        const key = findingKey({ code, variant });
        expected.add(key);
        expect(EN[key], `EN ${key}`).toBeTruthy();
        expect(DE[key], `DE ${key}`).toBeTruthy();
      }
    }
    expect(findingKeys(EN).sort()).toEqual([...expected].sort());
    expect(findingKeys(DE).sort()).toEqual([...expected].sort());
  });

  it('EN und DE verlangen je Text dieselben Werte (Lücken)', () => {
    for (const key of findingKeys(EN)) expect(slots(DE[key] ?? ''), key).toEqual(slots(EN[key] ?? ''));
  });

  it('der Quelltext nennt nur Varianten, die VARIANTS führt', () => {
    const all = new Set(Object.values(VARIANTS).flat());
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === 'vendor') continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk('src');
    const used = new Set<string>();
    for (const file of files) for (const m of readFileSync(file, 'utf8').matchAll(/variant: '([a-z-]+)'/g)) used.add(m[1] as string);
    // Die Varianten der Prüfarten des Kits stehen in recipe.ts als Menge (`ISSUE_VARIANTS`), nicht als `variant: '…'`.
    expect([...used].filter((v) => !all.has(v)), 'Varianten im Quelltext ohne Eintrag in VARIANTS').toEqual([]);
  });
});

describe('findingMessage', () => {
  it('setzt die Werte in die Lücken, in der Sprache der Tabelle', () => {
    const f = { severity: 'warning' as const, code: CODES.linkOutside, args: ['Outside/Camp rules'] };
    expect(findingMessage(f, tableTranslate(EN))).toBe('The link to “Outside/Camp rules” leads out of the set and stays as text.');
    expect(findingMessage(f, tableTranslate(DE))).toBe('Der Link auf „Outside/Camp rules“ führt aus der Menge hinaus und steht als Text.');
  });

  it('nimmt für eine Variante ihren Satz und fällt ohne Text auf den Schlüssel zurück', () => {
    const t = tableTranslate(EN);
    expect(findingMessage({ severity: 'info', code: CODES.linkScheme, variant: 'no-scheme', args: ['x'] }, t)).toBe('The link “x” has no allowed form and stays as text.');
    expect(findingMessage({ severity: 'info', code: 'nie.gehört', args: [] }, t)).toBe('finding.nie.gehört');
  });

  it('ein Text in der falschen Sprache der Tabelle fällt auf die zweite Tabelle zurück', () => {
    const t = tableTranslate({}, EN);
    expect(findingMessage({ severity: 'info', code: CODES.setExcluded }, t)).toBe(EN['finding.set.excluded']);
  });
});
