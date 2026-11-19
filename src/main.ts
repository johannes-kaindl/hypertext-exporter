import { getLanguage, Plugin } from "obsidian";
import { registerI18n } from "./i18n/strings";
import { pickLang, setLang } from "./vendor/kit/i18n";

export interface HtSettings {
  themesFolder: string;
  destination: "share" | "beside-entry" | "folder";
  destinationFolder: string;
  writeFindingsNote: boolean;
}

export const DEFAULT_SETTINGS: HtSettings = {
  themesFolder: "hypertext-themes",
  destination: "beside-entry",
  destinationFolder: "exports",
  writeFindingsNote: false,
};

function readObsidianLocale(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class HypertextExporterPlugin extends Plugin {
  settings: HtSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    registerI18n();
    setLang(pickLang(readObsidianLocale()));
    const raw: unknown = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...((raw ?? {}) as Partial<HtSettings>) };
  }

  onunload(): void {
    // Nothing registered yet; Obsidian removes everything added via the register* helpers.
  }
}
