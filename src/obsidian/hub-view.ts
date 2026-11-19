// Die eine Ansicht des Plugins (UI-STANDARD §1, §4): Hub mit den Panels „Export“ und „Befunde“.
// Vorbild für die Ansicht: epub-exporter/src/obsidian/hub-view.ts (ItemView, schmale Brücke zum Plugin);
// für die Panels: slide-deck/src/hub-view.ts (`buildHubInto`, mount-once). Die Ansicht kennt das Plugin nicht, nur `HubHost`.
import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import type { Finding } from "../core/types";
import { t } from "../vendor/kit/i18n";
import { pathsInFolder } from "../vendor/kit/folder-scope";
import { FolderSuggest } from "../vendor/kit-obsidian/folder-suggest";
import { buildHubInto, type HubController, type HubPanel } from "../vendor/kit-obsidian/hub";
import { buildStatus, paintStatus, type StatusPhase } from "../vendor/kit-obsidian/status-indicator";
import type { ExportActions } from "./actions";
import type { HtSettings } from "./settings";

export const VIEW_TYPE_HT_HUB = "hypertext-exporter-hub";
export type HubTabId = "export" | "findings";

/** Was die Ansicht vom Plugin braucht: lesende Getter, keine Rückkanäle (Muster `PanelHost`, UI-STANDARD §4). */
export interface HubHost {
  settings(): HtSettings;
  /** `null`, solange der Ablauf (Task 12) fehlt. */
  actions(): ExportActions | null;
}

export class ExportPanel implements HubPanel<HubTabId> {
  readonly id: HubTabId = "export";
  get label(): string { return t("hub.tab.export"); }
  readonly icon = "file-output";

  private root: HTMLElement | null = null;
  private source = "";
  /** Hat der Nutzer den Ordner selbst gesetzt, folgt das Panel nicht mehr der geöffneten Notiz. */
  private sourceTouched = false;
  private entry: string | null = null;
  private entrySelect: HTMLSelectElement | null = null;
  private sourceInput: HTMLInputElement | null = null;
  private button: HTMLButtonElement | null = null;
  private buttonHelp: HTMLElement | null = null;
  private targetLine: HTMLElement | null = null;
  private countLine: HTMLElement | null = null;

  constructor(private app: App, private host: HubHost) {}

  mount(container: HTMLElement): void {
    this.root = container;
    container.addClass("ht-panel", "ht-export-panel");
    this.render();
  }

  onShow(): void {
    // Einstellungen und Ablauf können sich seit dem Aufbau geändert haben (Plugin geladen, Einstellung gespeichert).
    this.refreshEntries();
    this.refreshCount();
    this.refreshTarget();
    this.refreshButton();
  }

  onFileOpen(path: string | null): void {
    if (this.sourceTouched || path === null || this.sourceInput === null) return;
    this.setSource(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    this.sourceInput.value = this.source;
  }

  destroy(): void {
    this.root?.empty();
    this.root = null;
  }

  /** Setzt den Quellordner von außen (Befehl „Export folder …“, Dateimenü); die Ansicht folgt danach nicht mehr der geöffneten Notiz. */
  setSourceFolder(folder: string): void {
    this.sourceTouched = true;
    this.setSource(folder);
    if (this.sourceInput !== null) this.sourceInput.value = folder;
  }

  private setSource(folder: string): void {
    this.source = folder;
    this.entry = null;
    this.refreshEntries();
    this.refreshCount();
    this.refreshButton();
  }

  private render(): void {
    const root = this.root;
    if (root === null) return;
    root.empty();

    const sourceField = root.createDiv({ cls: "ht-field" });
    sourceField.createEl("label", { text: t("export.source.label"), attr: { for: "ht-source" } });
    const input = sourceField.createEl("input", {
      attr: { id: "ht-source", type: "text", placeholder: t("export.source.placeholder"), spellcheck: "false" },
    });
    input.value = this.source;
    new FolderSuggest(this.app, input);
    input.addEventListener("input", () => {
      this.sourceTouched = true;
      this.setSource(input.value.trim());
    });
    this.sourceInput = input;
    sourceField.createDiv({ cls: "ht-info", text: t("export.source.help") });
    this.countLine = sourceField.createDiv({ cls: "ht-info ht-count" });

    const entryField = root.createDiv({ cls: "ht-field" });
    entryField.createEl("label", { text: t("export.entry.label"), attr: { for: "ht-entry" } });
    this.entrySelect = entryField.createEl("select", { attr: { id: "ht-entry" } });
    this.entrySelect.addEventListener("change", () => {
      this.entry = this.entrySelect?.value === "" ? null : (this.entrySelect?.value ?? null);
    });
    entryField.createDiv({ cls: "ht-info", text: t("export.entry.help") });

    const themeField = root.createDiv({ cls: "ht-field" });
    themeField.createEl("label", { text: t("export.theme.label"), attr: { for: "ht-theme" } });
    const theme = themeField.createEl("select", { attr: { id: "ht-theme", disabled: "" } });
    theme.createEl("option", { text: t("export.theme.default"), attr: { value: "default" } });
    themeField.createDiv({ cls: "ht-info", text: t("export.theme.help") });

    const formField = root.createDiv({ cls: "ht-field ht-form" });
    formField.createSpan({ cls: "ht-label", text: t("export.form.label") });
    formField.createDiv({ cls: "ht-info", text: t("export.form.file") });
    this.targetLine = formField.createDiv({ cls: "ht-info ht-target" });

    const actions = root.createDiv({ cls: "ht-actions" });
    this.button = actions.createEl("button", { cls: "mod-cta", text: t("export.button"), attr: { type: "button" } });
    this.button.addEventListener("click", () => { void this.runExport(); });
    this.buttonHelp = root.createDiv({ cls: "ht-info ht-button-help" });

    this.refreshEntries();
    this.refreshCount();
    this.refreshTarget();
    this.refreshButton();
  }

  /** Markdown-Dateien im Quellordner samt Unterordnern, nach Zeichenfolge des Pfads (Kit `pathsInFolder`). */
  private notesInSource(): string[] {
    return pathsInFolder(this.app.vault.getMarkdownFiles().map((f) => f.path), this.source).filter((p) => p.endsWith(".md"));
  }

  /** Zahl der Notizen im gewählten Ordner. Die geschätzte Größe fehlt bewusst: sie ginge nur mit dem Ablauf (Zeichnen und Einbetten der Medien). */
  private refreshCount(): void {
    if (this.countLine === null) return;
    if (this.source === "") { this.countLine.setText(""); return; }
    const n = this.notesInSource().length;
    this.countLine.setText(n === 0 ? t("export.count.none") : n === 1 ? t("export.count.one") : t("export.count.many", n));
  }

  /** Einstiegsnotizen des Ordners: „Automatisch“ plus jede Markdown-Datei darin, nach Zeichenfolge des Pfads. */
  private refreshEntries(): void {
    const select = this.entrySelect;
    if (select === null) return;
    const paths = this.notesInSource();
    select.empty();
    select.createEl("option", { text: t("export.entry.auto"), attr: { value: "" } });
    for (const p of paths) select.createEl("option", { text: p, attr: { value: p } });
    if (this.entry !== null && !paths.includes(this.entry)) this.entry = null;
    select.value = this.entry ?? "";
  }

  private refreshTarget(): void {
    if (this.targetLine === null) return;
    const s = this.host.settings();
    const where = s.destination === "folder"
      ? t("export.target.folder", s.destinationFolder)
      : t(`export.target.${s.destination}`);
    this.targetLine.setText(`${t("export.target.label")}: ${where}`);
  }

  private refreshButton(): void {
    if (this.button === null || this.buttonHelp === null) return;
    const ready = this.host.actions() !== null && this.source !== "";
    this.button.disabled = !ready;
    this.buttonHelp.setText(this.host.actions() === null ? t("export.button.later") : "");
  }

  private async runExport(): Promise<void> {
    const actions = this.host.actions();
    if (actions === null || this.source === "") return;
    await actions.exportFolder(this.source, this.entry);
  }
}

const PHASE_OF: Record<Finding["severity"], StatusPhase> = { error: "error", warning: "warning", info: "idle" };

export class FindingsPanel implements HubPanel<HubTabId> {
  readonly id: HubTabId = "findings";
  get label(): string { return t("hub.tab.findings"); }
  readonly icon = "list-checks";

  private root: HTMLElement | null = null;
  private findings: Finding[] = [];

  constructor(private app: App) {}

  mount(container: HTMLElement): void {
    this.root = container;
    container.addClass("ht-panel", "ht-findings-panel");
    this.render();
  }

  destroy(): void {
    this.root?.empty();
    this.root = null;
  }

  setFindings(findings: Finding[]): void {
    this.findings = findings;
    this.render();
  }

  private render(): void {
    const root = this.root;
    if (root === null) return;
    root.empty();
    if (this.findings.length === 0) {
      const empty = root.createDiv({ cls: "ht-empty" });
      empty.createEl("p", { cls: "ht-empty-title", text: t("findings.empty") });
      empty.createEl("p", { cls: "ht-info", text: t("findings.empty.help") });
      return;
    }
    const count = (sev: Finding["severity"]): number => this.findings.filter((f) => f.severity === sev).length;
    root.createDiv({ cls: "ht-findings-summary", text: t("findings.summary", count("error"), count("warning"), count("info")) });
    const list = root.createEl("ul", { cls: "ht-findings" });
    for (const f of this.findings) this.renderItem(list, f);
  }

  private renderItem(list: HTMLElement, f: Finding): void {
    const item = list.createEl("li", { cls: `ht-finding is-${f.severity}`, attr: { "data-code": f.code } });
    const status = buildStatus(item, "ht-finding-status", { idleIcon: "info" });
    paintStatus(status, PHASE_OF[f.severity], t(`findings.severity.${f.severity}`));
    item.createDiv({ cls: "ht-finding-message", text: f.message });
    const meta = item.createDiv({ cls: "ht-finding-meta" });
    meta.createEl("code", { text: f.code });
    if (f.recipePath !== undefined) meta.createSpan({ text: t("findings.recipeKey", f.recipePath) });
    const notePath = f.notePath;
    if (notePath !== undefined) {
      // Sprung zur Notiz: `.internal-link` mit `href`, Klick öffnet im Arbeitsbereich (Muster vault-crews).
      const link = meta.createEl("a", {
        cls: "internal-link ht-finding-note",
        text: notePath,
        href: notePath,
      });
      link.addEventListener("click", (evt) => {
        evt.preventDefault();
        void this.app.workspace.openLinkText(notePath, "", false);
      });
    }
  }
}

export class HtHubView extends ItemView {
  private hub: HubController<HubTabId> | null = null;
  private exportPanel: ExportPanel;
  private findingsPanel: FindingsPanel;

  constructor(leaf: WorkspaceLeaf, private host: HubHost) {
    super(leaf);
    this.exportPanel = new ExportPanel(this.app, this.host);
    this.findingsPanel = new FindingsPanel(this.app);
  }

  getViewType(): string { return VIEW_TYPE_HT_HUB; }
  getDisplayText(): string { return t("view.title"); }
  getIcon(): string { return "globe"; }

  onOpen(): Promise<void> {
    this.contentEl.addClass("ht-hub-view");
    const panels: HubPanel<HubTabId>[] = [this.exportPanel, this.findingsPanel];
    this.hub = buildHubInto(this.contentEl, panels, "export");
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.hub?.notifyFileOpen(this.app.workspace.getActiveFile()?.path ?? null);
    }));
    return Promise.resolve();
  }

  /** Wechselt auf das Panel „Export“; mit `folder` setzt es den Quellordner (Befehl und Dateimenü). */
  showExport(folder: string | null): void {
    if (folder !== null) this.exportPanel.setSourceFolder(folder);
    this.hub?.setTab("export");
  }

  /** Zeigt die Befunde eines Laufs und wechselt auf das Panel „Befunde“. */
  showFindings(findings: Finding[]): void {
    this.findingsPanel.setFindings(findings);
    this.hub?.setTab("findings");
  }

  /** Liest Einstellungen und Ablauf neu (etwa nach dem Speichern der Einstellungen). */
  refresh(): void {
    this.hub?.refreshActive();
  }

  onClose(): Promise<void> {
    this.hub?.destroy();
    this.hub = null;
    this.contentEl.empty();
    return Promise.resolve();
  }
}
