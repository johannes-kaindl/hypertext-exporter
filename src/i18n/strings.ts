import { defineStrings } from "../vendor/kit/i18n";

export const EN: Record<string, string> = {
  "plugin.name": "Hypertext Exporter",
};

export const DE: Record<string, string> = {
  "plugin.name": "Hypertext Exporter",
};

export function registerI18n(): void {
  defineStrings({ en: EN, de: DE });
}
