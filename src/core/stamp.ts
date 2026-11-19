// Stempel (Bauplan Task 10, Spec 10.8): die Umgebung, in der die Seite entstand, als `<meta>`-Zeilen im Kopf.
// Kein Datum, keine Uhrzeit, kein Pfad: Der Stempel gehört zur Datei und damit zur Byte-Gleichheit. Ändert sich die Umgebung, ändert sich die Datei sichtbar an dieser Stelle.
import { escapeHtmlAttr } from '../vendor/kit/html-escape';
import { compareCodePoints } from '../vendor/kit/name-order';
import type { BlocksMode } from './types';

export interface StampInput {
  pluginVersion: string;
  obsidianVersion: string;
  obsidianLang: string;
  themeKey: string;
  themeSha256: string;
  blocks: BlocksMode;
  embeds: 'static';
  remoteImages: 'skip' | 'embed';
  /** Nur bei `stamp: full`: alle aktivierten Community-Plugins; der Stempel ordnet sie selbst nach `id`. */
  plugins?: Array<{ id: string; version: string }>;
}

/**
 * `<meta name="ht-…" content="…">`, eine Zeile je Eintrag, getrennt durch `\n`, ohne Zeilenende am Schluss. Feste Reihenfolge:
 * Plugin-Version, Obsidian-Version und -Sprache, Thema und seine Prüfsumme, Schalter, dann (nur mit `plugins`) je ein `ht-plugin` nach `id`.
 * Werte laufen durch `escapeHtmlAttr`. Die Plugins sortiert der Stempel nach `id` (Codepunkt, `compareCodePoints` des Kits), bei gleicher `id` nach Version.
 */
export function stampMeta(input: StampInput): string {
  const rows: Array<[string, string]> = [
    ['ht-plugin-version', input.pluginVersion],
    ['ht-obsidian-version', input.obsidianVersion],
    ['ht-obsidian-lang', input.obsidianLang],
    ['ht-theme', input.themeKey],
    ['ht-theme-sha256', input.themeSha256],
    ['ht-blocks', input.blocks],
    ['ht-embeds', input.embeds],
    ['ht-remote-images', input.remoteImages],
  ];
  const plugins = [...(input.plugins ?? [])].sort((a, b) => compareCodePoints(a.id, b.id) || compareCodePoints(a.version, b.version));
  for (const p of plugins) rows.push(['ht-plugin', `${p.id}@${p.version}`]);
  return rows.map(([name, value]) => `<meta name="${name}" content="${escapeHtmlAttr(value)}">`).join('\n');
}
