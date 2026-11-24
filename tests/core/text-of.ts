import { findingMessage, type Translate } from '../../src/core/finding-text';
import type { Finding } from '../../src/core/types';
import { EN } from '../../src/i18n/strings';

/** Eine Übersetzung aus einer Tabelle (mit Rückfall auf eine zweite), gleiche Lücken `{0}` wie `t` des Kits. */
export function tableTranslate(table: Readonly<Record<string, string>>, fallback: Readonly<Record<string, string>> = {}): Translate {
  return (key, ...args) =>
    (table[key] ?? fallback[key] ?? key).replace(/\{(\d+)\}/g, (_m, i: string) => {
      const v = args[Number(i)];
      return v === undefined ? `{${i}}` : String(v);
    });
}

/** Der englische Satz zu einem Befund: Tests prüfen Codes, nur wo der Text selbst der Gegenstand ist (Werte in den Lücken), lesen sie ihn so. */
export const textOf = (f: Finding | undefined): string => (f === undefined ? '' : findingMessage(f, tableTranslate(EN)));
