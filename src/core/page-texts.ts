// Feste Tabelle der Texte, die die Seite selbst setzt, je `lang` der Bauanleitung (Bauplan Global Constraints, Spec 10.10).
// Nie aus der Obsidian-Sprache: gleiche Dateien ergeben dieselbe Seite, egal wie Obsidian eingestellt ist.
import type { Recipe } from './types';

export interface MediaTexts {
  notEmbedded: string;
  remoteSkipped: string;
  later: string;
  fallbackName: string;
}

export interface PageTexts {
  /** Sprunglink am Seitenanfang, Ziel `#inhalt`. */
  skipLink: string;
  /** Überschrift des Inhaltsverzeichnisses in der Navigation. */
  tocHeading: string;
  media: MediaTexts;
}

export type PageLang = Recipe['lang'];

export const PAGE_TEXTS: Record<PageLang, PageTexts> = {
  en: {
    skipLink: 'Skip to content',
    tocHeading: 'Contents',
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
    media: {
      notEmbedded: 'Nicht eingebettet:',
      remoteSkipped: 'Bild aus dem Netz nicht geladen:',
      later: 'In dieser Version nicht eingebettet:',
      fallbackName: 'Datei',
    },
  },
};
