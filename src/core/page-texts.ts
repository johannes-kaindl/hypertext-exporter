// Feste Tabelle der Texte, die die Seite selbst setzt, je `lang` der Bauanleitung (Bauplan Global Constraints, Spec 10.10).
// Nie aus der Obsidian-Sprache: gleiche Dateien ergeben dieselbe Seite, egal wie Obsidian eingestellt ist.
import type { Recipe } from './types';

export interface MediaTexts {
  notEmbedded: string;
  remoteSkipped: string;
  later: string;
  fallbackName: string;
}

/** Texte des Werkzeug-Blocks (Suche und Aufklapp-Helfer, Spec 10.5); `{n}` in `countMany` ist die Zahl der Bereiche mit Treffer. */
export interface SearchTexts {
  label: string;
  clear: string;
  expandAll: string;
  collapseAll: string;
  countNone: string;
  countOne: string;
  countMany: string;
}

export interface PageTexts {
  /** Sprunglink am Seitenanfang, Ziel `#inhalt`. */
  skipLink: string;
  /** Überschrift des Inhaltsverzeichnisses in der Navigation. */
  tocHeading: string;
  /** Kopf der ersten Spalte jeder Übersicht (der Titel der Notiz). */
  overviewTitle: string;
  media: MediaTexts;
  search: SearchTexts;
}

export type PageLang = Recipe['lang'];

export const PAGE_TEXTS: Record<PageLang, PageTexts> = {
  en: {
    skipLink: 'Skip to content',
    tocHeading: 'Contents',
    overviewTitle: 'Title',
    search: { label: 'Search', clear: 'Clear', expandAll: 'Expand all', collapseAll: 'Collapse all', countNone: 'No matches', countOne: '1 match', countMany: '{n} matches' },
    media: {
      notEmbedded: 'Not embedded:',
      remoteSkipped: 'Remote image not loaded:',
      later: 'Not embedded in this version:',
      fallbackName: 'file',
    },
  },
  de: {
    skipLink: 'Zum Inhalt',
    tocHeading: 'Inhalt',
    overviewTitle: 'Titel',
    search: { label: 'Suchen', clear: 'Leeren', expandAll: 'Alles aufklappen', collapseAll: 'Alles zuklappen', countNone: 'Keine Treffer', countOne: 'Ein Treffer', countMany: '{n} Treffer' },
    media: {
      notEmbedded: 'Nicht eingebettet:',
      remoteSkipped: 'Bild aus dem Netz nicht geladen:',
      later: 'In dieser Version nicht eingebettet:',
      fallbackName: 'Datei',
    },
  },
};
