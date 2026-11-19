import type { App, Command, TFile as TFileType } from 'obsidian';
import { Notice, TFile, TFolder } from '../mocks/obsidian';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerI18n } from '../../src/i18n/strings';
import { setLang } from '../../src/vendor/kit/i18n';
import type { ExportActions } from '../../src/obsidian/actions';
import { registerExportCommands, type CommandHost } from '../../src/obsidian/commands';

beforeAll(() => { registerI18n(); setLang('en'); });
beforeEach(() => { Notice.messages.length = 0; });

function file(path: string, extension = 'md'): TFileType {
  return Object.assign(new TFile(), { path, extension, name: path.slice(path.lastIndexOf('/') + 1) }) as TFileType;
}

interface Menu { items: Array<{ title: string; icon: string; click: () => void }> }

function setup(active: TFileType | null, actions: ExportActions | null) {
  const commands = new Map<string, Command>();
  let fileMenu: ((menu: unknown, f: unknown) => void) | null = null;
  const showExport = vi.fn().mockResolvedValue(undefined);
  const plugin = {
    app: {
      workspace: {
        getActiveFile: () => active,
        on: (name: string, cb: (menu: unknown, f: unknown) => void) => { if (name === 'file-menu') fileMenu = cb; return {}; },
      },
    } as unknown as App,
    addCommand: (c: Command) => { commands.set(c.id, c); return c; },
    registerEvent: () => {},
  };
  const host: CommandHost = { actions: () => actions, showExport };
  registerExportCommands(plugin, host);
  const openMenu = (f: unknown): Menu => {
    const menu: Menu = { items: [] };
    const api = {
      addItem(build: (item: unknown) => void) {
        const entry = { title: '', icon: '', click: () => {} };
        const item = {
          setTitle(t: string) { entry.title = t; return item; },
          setIcon(i: string) { entry.icon = i; return item; },
          onClick(cb: () => void) { entry.click = cb; return item; },
        };
        build(item);
        menu.items.push(entry);
        return api;
      },
    };
    fileMenu?.(api, f);
    return menu;
  };
  return { commands, showExport, openMenu };
}

const fakeActions = (): ExportActions & { [K in keyof ExportActions]: ReturnType<typeof vi.fn> } => ({
  exportFolder: vi.fn().mockResolvedValue(undefined),
  exportNote: vi.fn().mockResolvedValue(undefined),
  checkExport: vi.fn().mockResolvedValue(undefined),
  openExport: vi.fn().mockResolvedValue(undefined),
});

describe('registerExportCommands', () => {
  it('registriert die vier Befehle mit den Namen des Plans', () => {
    const { commands } = setup(null, null);
    expect([...commands.values()].map((c) => [c.id, c.name])).toEqual([
      ['export-folder', 'Export folder as HTML page…'],
      ['export-current-note', 'Export current note as HTML page'],
      ['check-export', 'Check HTML export'],
      ['open-export', 'Open HTML export'],
    ]);
  });

  it('export-folder öffnet die Ansicht auf dem Ordner der aktiven Notiz', () => {
    const { commands, showExport } = setup(file('berichte/q1/bericht.md'), null);
    (commands.get('export-folder')?.callback as () => void)();
    expect(showExport).toHaveBeenCalledWith('berichte/q1');
  });

  it('export-folder ohne aktive Notiz öffnet die Ansicht ohne Ordner; Notiz in der Wurzel ergibt den leeren Ordner', () => {
    const a = setup(null, null);
    (a.commands.get('export-folder')?.callback as () => void)();
    expect(a.showExport).toHaveBeenCalledWith(null);
    const b = setup(file('wurzel.md'), null);
    (b.commands.get('export-folder')?.callback as () => void)();
    expect(b.showExport).toHaveBeenCalledWith('');
  });

  it.each([['export-current-note', 'exportNote'], ['check-export', 'checkExport'], ['open-export', 'openExport']] as const)(
    '%s ruft %s mit dem Pfad der aktiven Notiz',
    (id, method) => {
      const actions = fakeActions();
      const { commands } = setup(file('a/b.md'), actions);
      const cb = commands.get(id)?.checkCallback as (checking: boolean) => boolean;
      expect(cb(true)).toBe(true);
      expect(actions[method]).not.toHaveBeenCalled();
      expect(cb(false)).toBe(true);
      expect(actions[method]).toHaveBeenCalledWith('a/b.md');
    },
  );

  it.each(['export-current-note', 'check-export', 'open-export'])('%s ist nur bei einer aktiven Markdown-Notiz verfügbar', (id) => {
    const actions = fakeActions();
    for (const active of [null, file('bild.png', 'png')]) {
      const { commands } = setup(active, actions);
      const cb = commands.get(id)?.checkCallback as (checking: boolean) => boolean;
      expect(cb(true)).toBe(false);
      expect(cb(false)).toBe(false);
    }
    expect(actions.exportNote).not.toHaveBeenCalled();
  });

  it('ohne Ablauf zeigen die Befehle eine Notice statt zu werfen', () => {
    const { commands } = setup(file('a.md'), null);
    for (const id of ['export-current-note', 'check-export', 'open-export']) {
      expect(() => (commands.get(id)?.checkCallback as (c: boolean) => boolean)(false)).not.toThrow();
    }
    expect(Notice.messages).toEqual(Array(3).fill('The export is not available yet.'));
  });
});

describe('Dateimenü', () => {
  it('Ordner: Eintrag „Export folder as HTML page…“ öffnet die Ansicht auf dem Ordner', () => {
    const { openMenu, showExport } = setup(null, null);
    const menu = openMenu(Object.assign(new TFolder(), { path: 'berichte/q1' }));
    expect(menu.items.map((i) => i.title)).toEqual(['Export folder as HTML page…']);
    menu.items[0]?.click();
    expect(showExport).toHaveBeenCalledWith('berichte/q1');
  });

  it('Wurzelordner des Vaults ergibt den leeren Pfad', () => {
    const { openMenu, showExport } = setup(null, null);
    openMenu(Object.assign(new TFolder(), { path: '/' })).items[0]?.click();
    expect(showExport).toHaveBeenCalledWith('');
  });

  it('Markdown-Notiz: Eintrag exportiert die Notiz über den Ablauf', () => {
    const actions = fakeActions();
    const { openMenu } = setup(null, actions);
    const menu = openMenu(file('a/b.md'));
    expect(menu.items.map((i) => i.title)).toEqual(['Export note as HTML page']);
    menu.items[0]?.click();
    expect(actions.exportNote).toHaveBeenCalledWith('a/b.md');
  });

  it('andere Dateien bekommen keinen Eintrag; ohne Ablauf meldet die Notiz-Zeile eine Notice', () => {
    const { openMenu } = setup(null, null);
    expect(openMenu(file('bild.png', 'png')).items).toEqual([]);
    openMenu(file('a.md')).items[0]?.click();
    expect(Notice.messages).toEqual(['The export is not available yet.']);
  });
});
