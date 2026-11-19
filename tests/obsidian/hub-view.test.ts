// @vitest-environment jsdom
import type { App, WorkspaceLeaf } from 'obsidian';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { registerI18n } from '../../src/i18n/strings';
import type { Finding } from '../../src/core/types';
import type { ExportActions } from '../../src/obsidian/actions';
import { ExportPanel, FindingsPanel, HtHubView, type HubHost } from '../../src/obsidian/hub-view';
import { DEFAULT_SETTINGS, type HtSettings } from '../../src/obsidian/settings';
import { installObsidianDom } from './dom-polyfill';

beforeAll(() => {
  installObsidianDom();
  registerI18n();
});

function fakeApp(paths: string[] = []): { app: App; openLinkText: ReturnType<typeof vi.fn> } {
  const openLinkText = vi.fn().mockResolvedValue(undefined);
  const app = {
    vault: { getMarkdownFiles: () => paths.map((path) => ({ path })) },
    workspace: { openLinkText, on: () => ({}), getActiveFile: () => null },
  } as unknown as App;
  return { app, openLinkText };
}

const F = (over: Partial<Finding>): Finding => ({ severity: 'info', code: 'set.empty-file', message: 'leer', ...over });

describe('FindingsPanel', () => {
  it('zeigt bei [] den Empty-State und keine Liste', () => {
    const { app } = fakeApp();
    const panel = new FindingsPanel(app);
    const root = document.createElement('div');
    panel.mount(root);
    panel.setFindings([]);
    expect(root.querySelector('.ht-empty')?.textContent).toContain('No findings');
    expect(root.querySelector('ul')).toBeNull();
  });

  it('zeigt einen Eintrag je Befund mit Schwere-Symbol und Code', () => {
    const { app } = fakeApp();
    const panel = new FindingsPanel(app);
    const root = document.createElement('div');
    panel.mount(root);
    panel.setFindings([F({ severity: 'error', code: 'mark.duplicate', message: 'doppelt' }), F({ severity: 'warning' }), F({})]);
    const items = Array.from(root.querySelectorAll('li.ht-finding'));
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.getAttribute('data-code'))).toEqual(['mark.duplicate', 'set.empty-file', 'set.empty-file']);
    expect(items.map((i) => i.querySelector('.okit-status-icon')?.getAttribute('data-icon'))).toEqual(['circle-x', 'alert-triangle', 'info']);
    expect(items[0]?.querySelector('.okit-status')?.getAttribute('aria-label')).toBe('Error');
    expect(items[0]?.querySelector('.ht-finding-message')?.textContent).toBe('doppelt');
    expect(root.querySelector('.ht-findings-summary')?.textContent).toBe('1 errors, 1 warnings, 1 notices');
    expect(root.querySelector('.ht-empty')).toBeNull();
  });

  it('bietet den Sprung nur bei notePath und öffnet die Notiz', () => {
    const { app, openLinkText } = fakeApp();
    const panel = new FindingsPanel(app);
    const root = document.createElement('div');
    panel.mount(root);
    panel.setFindings([F({ notePath: 'beispiel/kapitel/01 Grundlagen.md' }), F({ message: 'ohne Notiz' }), F({ recipePath: 'sectons' })]);
    const links = root.querySelectorAll('a.ht-finding-note');
    expect(links).toHaveLength(1);
    const items = root.querySelectorAll('li.ht-finding');
    expect(items[1]?.querySelector('a')).toBeNull();
    expect(items[2]?.querySelector('a')).toBeNull();
    expect(items[2]?.textContent).toContain('sectons');
    (links[0] as HTMLElement).click();
    expect(openLinkText).toHaveBeenCalledWith('beispiel/kapitel/01 Grundlagen.md', '', false);
  });

  it('Befunde, die vor dem Aufbau gesetzt werden, erscheinen nach dem Aufbau', () => {
    const { app } = fakeApp();
    const panel = new FindingsPanel(app);
    panel.setFindings([F({})]);
    const root = document.createElement('div');
    panel.mount(root);
    expect(root.querySelectorAll('li.ht-finding')).toHaveLength(1);
  });
});

function host(actions: ExportActions | null, settings: HtSettings = DEFAULT_SETTINGS): HubHost {
  return { settings: () => settings, actions: () => actions };
}

describe('ExportPanel', () => {
  it('ohne Ablauf ist der Knopf aus und die Hilfe-Zeile sagt warum', () => {
    const { app } = fakeApp();
    const panel = new ExportPanel(app, host(null));
    const root = document.createElement('div');
    panel.mount(root);
    const button = root.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(root.querySelector('.ht-button-help')?.textContent).toBe('Coming with the export run.');
  });

  it('zeigt Thema nur Standard, die Ausgabeform und das Ziel aus den Einstellungen', () => {
    const { app } = fakeApp();
    const panel = new ExportPanel(app, host(null, { ...DEFAULT_SETTINGS, destination: 'folder', destinationFolder: 'pub' }));
    const root = document.createElement('div');
    panel.mount(root);
    const options = Array.from(root.querySelectorAll('#ht-theme option')).map((o) => o.getAttribute('value'));
    expect(options).toEqual(['default']);
    expect((root.querySelector('#ht-theme') as HTMLSelectElement).disabled).toBe(true);
    expect(root.querySelector('.ht-form')?.textContent).toContain('One HTML file');
    expect(root.querySelector('.ht-target')?.textContent).toBe('Saved to: The folder pub in the vault');
  });

  it('listet die Notizen des Quellordners als Einstieg und ruft mit Ordner und Wahl den Ablauf', async () => {
    const exportFolder = vi.fn().mockResolvedValue(undefined);
    const { app } = fakeApp(['a/x.md', 'a/b/y.md', 'ab/z.md', 'root.md']);
    const panel = new ExportPanel(app, host({ exportFolder, exportNote: vi.fn(), checkExport: vi.fn(), openExport: vi.fn() }));
    const root = document.createElement('div');
    panel.mount(root);
    const button = root.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true); // kein Ordner gewählt
    const input = root.querySelector('#ht-source') as HTMLInputElement;
    input.value = 'a';
    input.dispatchEvent(new Event('input'));
    const select = root.querySelector('#ht-entry') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'a/b/y.md', 'a/x.md']);
    expect(button.disabled).toBe(false);
    button.click();
    expect(exportFolder).toHaveBeenCalledWith('a', null);
    select.value = 'a/x.md';
    select.dispatchEvent(new Event('change'));
    button.click();
    expect(exportFolder).toHaveBeenLastCalledWith('a', 'a/x.md');
  });

  it('zeigt die Zahl der Notizen im gewählten Ordner, samt Unterordnern und nur Markdown', () => {
    const { app } = fakeApp(['a/x.md', 'a/b/y.md', 'a/b/c/z.md', 'ab/z.md', 'root.md', 'a/bild.png']);
    const panel = new ExportPanel(app, host(null));
    const root = document.createElement('div');
    panel.mount(root);
    const count = (): string | undefined => root.querySelector('.ht-count')?.textContent ?? undefined;
    expect(count()).toBe('');
    const input = root.querySelector('#ht-source') as HTMLInputElement;
    input.value = 'a';
    input.dispatchEvent(new Event('input'));
    expect(count()).toBe('3 notes in this folder.');
    input.value = 'a/b/c';
    input.dispatchEvent(new Event('input'));
    expect(count()).toBe('1 note in this folder.');
    input.value = 'leer';
    input.dispatchEvent(new Event('input'));
    expect(count()).toBe('No notes in this folder.');
  });

  it('setSourceFolder setzt Ordner und Zahl von außen und lässt die Ansicht nicht mehr der Notiz folgen', () => {
    const { app } = fakeApp(['a/x.md', 'a/y.md']);
    const panel = new ExportPanel(app, host(null));
    const root = document.createElement('div');
    panel.mount(root);
    panel.setSourceFolder('a');
    expect((root.querySelector('#ht-source') as HTMLInputElement).value).toBe('a');
    expect(root.querySelector('.ht-count')?.textContent).toBe('2 notes in this folder.');
    panel.onFileOpen('anderswo/n.md');
    expect((root.querySelector('#ht-source') as HTMLInputElement).value).toBe('a');
  });

  it('setSourceFolder vor dem Aufbau wirkt beim Aufbau', () => {
    const { app } = fakeApp(['a/x.md']);
    const panel = new ExportPanel(app, host(null));
    panel.setSourceFolder('a');
    const root = document.createElement('div');
    panel.mount(root);
    expect((root.querySelector('#ht-source') as HTMLInputElement).value).toBe('a');
    expect(root.querySelector('.ht-count')?.textContent).toBe('1 note in this folder.');
  });

  it('folgt der geöffneten Notiz, bis der Nutzer den Ordner selbst setzt', () => {
    const { app } = fakeApp();
    const panel = new ExportPanel(app, host(null));
    const root = document.createElement('div');
    panel.mount(root);
    const input = root.querySelector('#ht-source') as HTMLInputElement;
    panel.onFileOpen('berichte/q1/bericht.md');
    expect(input.value).toBe('berichte/q1');
    input.value = 'eigen';
    input.dispatchEvent(new Event('input'));
    panel.onFileOpen('anderswo/n.md');
    expect(input.value).toBe('eigen');
  });
});

describe('HtHubView', () => {
  it('baut den Hub mit den Panels Export und Befunde; showFindings wechselt auf Befunde', async () => {
    const { app } = fakeApp();
    const view = new HtHubView({ app } as unknown as WorkspaceLeaf, host(null));
    await view.onOpen();
    const tabs = Array.from(view.contentEl.querySelectorAll('.okit-hub-tab')).map((b) => b.getAttribute('data-tab'));
    expect(tabs).toEqual(['export', 'findings']);
    expect(view.getViewType()).toBe('hypertext-exporter-hub');
    expect(view.contentEl.querySelector('.okit-hub-panel[data-tab="export"]')?.classList.contains('is-hidden')).toBe(false);
    view.showFindings([F({ message: 'ein Befund' })]);
    expect(view.contentEl.querySelector('.okit-hub-panel[data-tab="findings"]')?.classList.contains('is-hidden')).toBe(false);
    expect(view.contentEl.querySelector('.okit-hub-panel[data-tab="export"]')?.classList.contains('is-hidden')).toBe(true);
    expect(view.contentEl.querySelectorAll('li.ht-finding')).toHaveLength(1);
    await view.onClose();
    expect(view.contentEl.children).toHaveLength(0);
  });
  it('showExport wechselt auf das Panel Export und setzt den Ordner; null lässt ihn stehen', async () => {
    const { app } = fakeApp(['a/x.md']);
    const view = new HtHubView({ app } as unknown as WorkspaceLeaf, host(null));
    await view.onOpen();
    view.showFindings([F({})]);
    view.showExport('a');
    expect(view.contentEl.querySelector('.okit-hub-panel[data-tab="export"]')?.classList.contains('is-hidden')).toBe(false);
    expect((view.contentEl.querySelector('#ht-source') as HTMLInputElement).value).toBe('a');
    view.showExport(null);
    expect((view.contentEl.querySelector('#ht-source') as HTMLInputElement).value).toBe('a');
  });
});
