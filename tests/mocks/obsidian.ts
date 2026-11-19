// tests/mocks/obsidian.ts
// Test-only node stand-in for the "obsidian" module, activated via the vitest
// resolve.alias. Minimal on purpose: grows with the tests that need more.
// NEVER import this from src/.

/** Was ein Plugin im Test an Obsidian registriert hat. */
export interface Registered {
  views: string[];
  commands: Array<{ id: string; name: string }>;
  ribbons: string[];
  settingTabs: unknown[];
}

export class Plugin {
  app: unknown = {};
  manifest: unknown = {};
  registered: Registered = { views: [], commands: [], ribbons: [], settingTabs: [] };
  private data: unknown = null;
  loadData(): Promise<unknown> { return Promise.resolve(this.data); }
  saveData(data: unknown): Promise<void> { this.data = data; return Promise.resolve(); }
  registerView(type: string): void { this.registered.views.push(type); }
  addCommand(cmd: { id: string; name: string }): void { this.registered.commands.push({ id: cmd.id, name: cmd.name }); }
  addRibbonIcon(icon: string): void { this.registered.ribbons.push(icon); }
  addSettingTab(tab: unknown): void { this.registered.settingTabs.push(tab); }
}

export function getLanguage(): string { return "en"; }

// Nur damit `import { requestUrl } from "obsidian"` im vendorten inline-images auflöst; Tests reichen eigene `ports` durch.
export function requestUrl(): Promise<never> { return Promise.reject(new Error("requestUrl: im Test nicht verfügbar")); }

// Oberfläche: nur Bausteine, die Ansicht, Hub und Einstellungsreiter beim Laden brauchen. Die DOM-Helfer (createDiv, empty, …) kommen aus tests/obsidian/dom-polyfill.ts.
// In der node-Umgebung (ohne jsdom) gibt es kein Dokument; Tests, die den Inhalt lesen, laufen unter jsdom.
function makeEl(): HTMLElement { return typeof document === "undefined" ? ({} as HTMLElement) : document.createElement("div"); }

export function setIcon(el: Element, name: string): void { el.setAttribute("data-icon", name); }

export class ItemView {
  app: unknown;
  leaf: unknown;
  contentEl: HTMLElement;
  events: unknown[] = [];
  constructor(leaf: { app?: unknown }) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.contentEl = makeEl();
  }
  registerEvent(ref: unknown): void { this.events.push(ref); }
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl: HTMLElement;
  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = makeEl();
  }
}

export class AbstractInputSuggest<T> {
  value = "";
  constructor(public app: unknown, public inputEl: HTMLInputElement) { void this.inputEl; }
  setValue(v: string): void { this.value = v; }
  close(): void {}
  getSuggestions(_query: string): T[] { return []; }
}
