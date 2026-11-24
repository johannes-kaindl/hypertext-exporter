import { getLanguage, Plugin, type WorkspaceLeaf } from "obsidian";
import { registerI18n } from "./i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";
import type { ExportActions } from "./obsidian/actions";
import { createExportActions } from "./obsidian/export-actions";
import { exportApi, type ExportApi } from "./obsidian/pipeline";
import type { ResultFinding } from "./core/result-file";
import { registerExportCommands } from "./obsidian/commands";
import { HtHubView, VIEW_TYPE_HT_HUB, type HubHost } from "./obsidian/hub-view";
import { insertRecipeCheck } from "./obsidian/insert-recipe";
import { HtSettingTab, loadSettings, DEFAULT_SETTINGS, type HtSettings } from "./obsidian/settings";

function readObsidianLocale(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class HypertextExporterPlugin extends Plugin {
  settings: HtSettings = { ...DEFAULT_SETTINGS };
  /** Der Ablauf hinter Ansicht, Befehlen und Dateimenü; `null` nur, solange das Plugin nicht geladen ist (dann ist der Export-Knopf aus und die Befehle zeigen eine Notice). */
  actions: ExportActions | null = null;
  /** Öffentliche Schnittstelle für die Kommandozeile (`obsidian eval code="await app.plugins.plugins['hypertext-exporter'].api.exportAndWait('<pfad>')"`) und andere Plugins. */
  api: ExportApi | null = null;

  async onload(): Promise<void> {
    registerI18n();
    setLang(pickLang(readObsidianLocale()));
    this.settings = loadSettings(await this.loadData());
    this.actions = createExportActions(this);
    this.api = exportApi(this);

    const host: HubHost = { settings: () => this.settings, actions: () => this.actions };
    this.registerView(VIEW_TYPE_HT_HUB, (leaf: WorkspaceLeaf) => new HtHubView(leaf, host));
    this.addRibbonIcon("globe", t("cmd.openView"), () => { void this.openView(); });
    this.addCommand({ id: "open-view", name: t("cmd.openView"), callback: () => { void this.openView(); } });
    registerExportCommands(this, { actions: () => this.actions, showExport: (folder) => this.showExport(folder) });
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

  /** Öffnet die Ansicht auf dem Panel „Export“ (Befehl `export-folder`, Dateimenü); `folder` setzt den Quellordner. */
  async showExport(folder: string | null): Promise<void> {
    const view = await this.openView();
    view?.showExport(folder);
  }

  /** Zeigt die Befunde eines Laufs im Panel „Befunde“ (öffnet die Ansicht, auch bei einer leeren Liste, damit der Leerzustand den alten Lauf ersetzt). */
  async showFindings(findings: ResultFinding[]): Promise<void> {
    const view = await this.openView();
    view?.showFindings(findings);
  }

  /** Öffnet die Ansicht (eine einzige, UI-STANDARD §1) und gibt sie zurück. */
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
