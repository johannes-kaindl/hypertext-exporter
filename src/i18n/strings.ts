import { defineStrings } from "../vendor/kit/i18n";

export const EN: Record<string, string> = {
  "plugin.name": "Hypertext Exporter",

  "view.title": "Hypertext Exporter",
  "cmd.openView": "Open Hypertext Exporter",

  "hub.tab.export": "Export",
  "hub.tab.findings": "Findings",

  "export.source.label": "Source folder",
  "export.source.placeholder": "Folder with the notes",
  "export.source.help": "The notes in this folder become one HTML page.",
  "export.entry.label": "Entry note",
  "export.entry.auto": "Automatic (folder note, else the first note)",
  "export.entry.help": "The entry note opens the page and may carry the recipe.",
  "export.theme.label": "Theme",
  "export.theme.default": "Default",
  "export.theme.help": "More themes come in a later version.",
  "export.form.label": "Output form",
  "export.form.file": "One HTML file with everything embedded. This version always writes this form.",
  "export.target.label": "Saved to",
  "export.target.share": "The share sheet (hidden export folder)",
  "export.target.beside-entry": "Beside the entry note",
  "export.target.folder": "The folder {0} in the vault",
  "export.button": "Export folder",
  "export.button.later": "Coming with the export run.",

  "findings.empty": "No findings",
  "findings.empty.help": "Run an export or a check, and its findings appear here.",
  "findings.summary": "{0} errors, {1} warnings, {2} notices",
  "findings.severity.error": "Error",
  "findings.severity.warning": "Warning",
  "findings.severity.info": "Notice",
  "findings.recipeKey": "Recipe key: {0}",

  "settings.help.name": "Help",
  "settings.help.desc": "Getting started, how-tos and troubleshooting",
  "settings.help.openDocs": "Open documentation",
  "settings.help.reportIssue": "Report an issue",
  "settings.destination.name": "Save the page to",
  "settings.destination.desc": "Where the export is written. The place does not change the page itself.",
  "settings.destination.share": "Share sheet (hidden export folder)",
  "settings.destination.beside-entry": "Beside the entry note",
  "settings.destination.folder": "Folder in the vault",
  "settings.destinationFolder.name": "Export folder",
  "settings.destinationFolder.desc": "Used only when the page is saved to a folder in the vault.",
  "settings.themesFolder.name": "Themes folder",
  "settings.themesFolder.desc": "Folder in the vault where your own themes live.",
};

export const DE: Record<string, string> = {
  "plugin.name": "Hypertext Exporter",

  "view.title": "Hypertext Exporter",
  "cmd.openView": "Hypertext Exporter öffnen",

  "hub.tab.export": "Export",
  "hub.tab.findings": "Befunde",

  "export.source.label": "Quellordner",
  "export.source.placeholder": "Ordner mit den Notizen",
  "export.source.help": "Die Notizen in diesem Ordner werden eine HTML-Seite.",
  "export.entry.label": "Einstiegsnotiz",
  "export.entry.auto": "Automatisch (Ordnernotiz, sonst die erste Notiz)",
  "export.entry.help": "Die Einstiegsnotiz eröffnet die Seite und kann die Bauanleitung tragen.",
  "export.theme.label": "Thema",
  "export.theme.default": "Standard",
  "export.theme.help": "Weitere Themen kommen in einer späteren Version.",
  "export.form.label": "Ausgabeform",
  "export.form.file": "Eine HTML-Datei mit allem eingebettet. Diese Version schreibt immer diese Form.",
  "export.target.label": "Gespeichert in",
  "export.target.share": "Das Teilen-Blatt (verstecktes Export-Verzeichnis)",
  "export.target.beside-entry": "Neben der Einstiegsnotiz",
  "export.target.folder": "Der Ordner {0} im Vault",
  "export.button": "Ordner exportieren",
  "export.button.later": "Kommt mit dem Ablauf.",

  "findings.empty": "Keine Befunde",
  "findings.empty.help": "Starte einen Export oder eine Prüfung, dann erscheinen die Befunde hier.",
  "findings.summary": "{0} Fehler, {1} Warnungen, {2} Hinweise",
  "findings.severity.error": "Fehler",
  "findings.severity.warning": "Warnung",
  "findings.severity.info": "Hinweis",
  "findings.recipeKey": "Schlüssel der Bauanleitung: {0}",

  "settings.help.name": "Hilfe",
  "settings.help.desc": "Erste Schritte, Anleitungen und Fehlersuche",
  "settings.help.openDocs": "Dokumentation öffnen",
  "settings.help.reportIssue": "Problem melden",
  "settings.destination.name": "Seite speichern in",
  "settings.destination.desc": "Wohin der Export geschrieben wird. Der Ort ändert die Seite selbst nicht.",
  "settings.destination.share": "Teilen-Blatt (verstecktes Export-Verzeichnis)",
  "settings.destination.beside-entry": "Neben der Einstiegsnotiz",
  "settings.destination.folder": "Ordner im Vault",
  "settings.destinationFolder.name": "Export-Ordner",
  "settings.destinationFolder.desc": "Gilt nur, wenn die Seite in einem Ordner im Vault gespeichert wird.",
  "settings.themesFolder.name": "Themen-Ordner",
  "settings.themesFolder.desc": "Ordner im Vault, in dem deine eigenen Themen liegen.",
};

export function registerI18n(): void {
  defineStrings({ en: EN, de: DE });
}
