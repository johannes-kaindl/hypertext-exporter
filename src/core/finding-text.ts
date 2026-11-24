// Der Satz zu einem Befund (Task „Sprache der Meldungen“, entschieden 2026-11-24): der Kern liefert Code, Variante und Werte, der Satz entsteht über eine übergebene Übersetzung.
// Der Kern kennt weder die Sprache noch die Tabelle; die Oberfläche übergibt `t` des Kits (Sprache der Obsidian-Oberfläche), Tests eine Übersetzung aus einer Tabelle (`tests/core/text-of.ts`).
import type { Finding } from './types';

/** Übersetzung nach dem Muster von `t` im Kit `i18n`: Schlüssel, dann die Werte für `{0}`, `{1}` … */
export type Translate = (key: string, ...args: (string | number)[]) => string;

/** Schlüssel des Satzes: `finding.<code>` oder `finding.<code>.<variant>`. */
export function findingKey(f: Pick<Finding, 'code' | 'variant'>): string {
  return f.variant === undefined ? `finding.${f.code}` : `finding.${f.code}.${f.variant}`;
}

export function findingMessage(f: Finding, translate: Translate): string {
  return translate(findingKey(f), ...(f.args ?? []));
}
