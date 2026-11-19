// Einstellungen (Bauplan Task 13): nur, was nicht in die Bauanleitung gehört und die Seite nicht ändert (Spec 11).
// Vorbild: epub-exporter/src/obsidian/settings-tab.ts (zweigleisig über den Kit-Walker, Hilfe-Zeile zuerst, Zielordner-Zeile
// immer sichtbar mit Hinweis im Text, weil `minAppVersion` unter 1.13 liegt und Sichtbarkeitsprädikate dort nicht greifen).
import { PluginSettingTab, type App, type Plugin, type SettingDefinitionItem } from "obsidian";
import { t } from "../vendor/kit/i18n";
import { nonEmptyString, oneOf, validateSettings } from "../vendor/kit/settings_schema";
import { githubHelpUrls, helpSettingDefinition } from "../vendor/kit-obsidian/help-setting";
import { renderSettingDefinitions } from "../vendor/kit-obsidian/settings_walker";

export type Destination = "share" | "beside-entry" | "folder";

export interface HtSettings {
  themesFolder: string;
  destination: Destination;
  destinationFolder: string;
}

export const DESTINATIONS: readonly Destination[] = ["share", "beside-entry", "folder"];

export const DEFAULT_SETTINGS: HtSettings = {
  themesFolder: "hypertext-themes",
  destination: "beside-entry",
  destinationFolder: "exports",
};

/** Gespeicherte Daten (`loadData()`) auf geprüfte Einstellungen: geschlossene Welt, Altfelder (etwa `writeFindingsNote`) fallen weg, ein ungültiger Wert wird zum Standard. */
export function loadSettings(raw: unknown): HtSettings {
  return validateSettings(DEFAULT_SETTINGS, raw, {
    destination: oneOf(DESTINATIONS),
    themesFolder: nonEmptyString({ trim: true }),
    destinationFolder: nonEmptyString({ trim: true }),
  });
}

interface SettingsHost {
  settings: HtSettings;
  saveSettings(): Promise<void>;
}

export class HtSettingTab extends PluginSettingTab {
  constructor(app: App, private host: SettingsHost) {
    super(app, host as unknown as Plugin);
  }

  // Deklarativ (Obsidian 1.13+): trägt Darstellung und Suchindex. Darunter ruft der Host display(), das dieselbe Liste zeichnet.
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      // UI-STANDARD §8: die Hilfe-Zeile steht immer zuerst.
      helpSettingDefinition({
        ...githubHelpUrls("hypertext-exporter"),
        texts: {
          name: t("settings.help.name"),
          desc: t("settings.help.desc"),
          openDocs: t("settings.help.openDocs"),
          reportIssue: t("settings.help.reportIssue"),
        },
      }),
      {
        name: t("settings.destination.name"),
        desc: t("settings.destination.desc"),
        control: {
          type: "dropdown",
          key: "destination",
          options: {
            share: t("settings.destination.share"),
            "beside-entry": t("settings.destination.beside-entry"),
            folder: t("settings.destination.folder"),
          },
        },
      },
      {
        name: t("settings.destinationFolder.name"),
        desc: t("settings.destinationFolder.desc"),
        control: { type: "folder", key: "destinationFolder" },
      },
      {
        name: t("settings.themesFolder.name"),
        desc: t("settings.themesFolder.desc"),
        control: { type: "folder", key: "themesFolder" },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.host.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    // Dieselbe Prüfung wie beim Laden: ein Müllwert aus einem deklarativen Host fällt auf den Standard.
    Object.assign(this.host.settings, loadSettings({ ...this.host.settings, [key]: value }));
    await this.host.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    renderSettingDefinitions(containerEl, this.getSettingDefinitions(), this, this.app);
  }
}
