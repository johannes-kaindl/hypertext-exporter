import { getLanguage, Plugin, type WorkspaceLeaf } from "obsidian";
import { registerI18n } from "./i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";
import type { ExportActions } from "./obsidian/actions";
import { HtHubView, VIEW_TYPE_HT_HUB, type HubHost } from "./obsidian/hub-view";
import { insertRecipeCheck } from "./obsidian/insert-recipe";
import { HtSettingTab, loadSettings, DEFAULT_SETTINGS, type HtSettings } from "./obsidian/settings";

function readObsidianLocale(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class HypertextExporterPlugin extends Plugin {
  settings: HtSettings = { ...DEFAULT_SETTINGS };
  /** Der Ablauf (Task 12) setzt das; bis dahin ist der Export-Knopf der Ansicht aus. */
  actions: ExportActions | null = null;

  async onload(): Promise<void> {
    registerI18n();
    setLang(pickLang(readObsidianLocale()));
    this.settings = loadSettings(await this.loadData());

    const host: HubHost = { settings: () => this.settings, actions: () => this.actions };
    this.registerView(VIEW_TYPE_HT_HUB, (leaf: WorkspaceLeaf) => new HtHubView(leaf, host));
    this.addRibbonIcon("globe", t("cmd.openView"), () => { void this.openView(); });
    this.addCommand({ id: "open-view", name: t("cmd.openView"), callback: () => { void this.openView(); } });
    this.addCommand({ id: "insert-recipe", name: t("cmd.insertRecipe"), checkCallback: insertRecipeCheck(this.app, () => readObsidianLocale() ?? "en") });
    this.addSettingTab(new HtSettingTab(this.app, this));
  }

  onunload(): void {
    // Ansicht, Befehl, Ribbon und Einstellungsreiter räumt Obsidian über die register*-Helfer ab.
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HT_HUB)) {
      if (leaf.view instanceof HtHubView) leaf.view.refresh();
    }
  }

  /** Öffnet die Ansicht (eine einzige, UI-STANDARD §1) und gibt sie zurück; Task 12 ruft darauf `showFindings`. */
  async openView(): Promise<HtHubView | null> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_HT_HUB);
    const leaf = existing[0] ?? workspace.getRightLeaf(false);
    if (!leaf) return null;
    if (existing.length === 0) await leaf.setViewState({ type: VIEW_TYPE_HT_HUB, active: true });
    void workspace.revealLeaf(leaf);
    return leaf.view instanceof HtHubView ? leaf.view : null;
  }
}
