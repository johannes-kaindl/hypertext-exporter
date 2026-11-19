import { describe, expect, it } from 'vitest';
import { PAGE_TEXTS } from '../../src/core/page-texts';

describe('PAGE_TEXTS', () => {
  it('hat zu jedem Schlüssel in en und de einen nichtleeren Text', () => {
    const flat = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? (v === '' ? [] : [`${prefix}${k}`]) : flat(v as object, `${prefix}${k}.`)));
    expect(flat(PAGE_TEXTS.de)).toEqual(flat(PAGE_TEXTS.en));
    expect(flat(PAGE_TEXTS.en).length).toBeGreaterThan(5);
  });

  it('Sprunglink je Sprache', () => {
    expect(PAGE_TEXTS.en.skipLink).toBe('Skip to content');
    expect(PAGE_TEXTS.de.skipLink).toBe('Zum Inhalt');
  });
});
