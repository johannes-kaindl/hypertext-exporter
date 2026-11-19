import type { App } from 'obsidian';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerI18n } from '../../src/i18n/strings';
import { DEFAULT_SETTINGS, DESTINATIONS, HtSettingTab, loadSettings, type HtSettings } from '../../src/obsidian/settings';
import { githubHelpUrls } from '../../src/vendor/kit-obsidian/help-setting';

beforeAll(registerI18n);

describe('loadSettings', () => {
  it('Standardwerte laut Bauplan Task 13', () => {
    expect(DEFAULT_SETTINGS).toEqual({ themesFolder: 'hypertext-themes', destination: 'beside-entry', destinationFolder: 'exports' });
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings('kaputt')).toEqual(DEFAULT_SETTINGS);
  });

  it('teilt keine Referenz mit den Standardwerten', () => {
    expect(loadSettings(undefined)).not.toBe(DEFAULT_SETTINGS);
  });

  it('lässt das Altfeld writeFindingsNote und jedes unbekannte Feld fallen und behält die gültigen Werte', () => {
    const loaded = loadSettings({ themesFolder: 'meine-themen', destination: 'folder', destinationFolder: 'pub', writeFindingsNote: true, irgendwas: 1 });
    expect(loaded).toEqual({ themesFolder: 'meine-themen', destination: 'folder', destinationFolder: 'pub' });
    expect('writeFindingsNote' in loaded).toBe(false);
  });

  it('ein ungültiges Ziel oder ein leerer Ordner wird zum Standard', () => {
    expect(loadSettings({ destination: 'ueberall' }).destination).toBe('beside-entry');
    expect(loadSettings({ destination: 3 }).destination).toBe('beside-entry');
    expect(loadSettings({ destinationFolder: '   ', themesFolder: '' })).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ destinationFolder: ' out ' }).destinationFolder).toBe('out');
  });
});

function tabWith(settings: HtSettings): { tab: HtSettingTab; saved: number[] } {
  const saved: number[] = [];
  const host = { settings, saveSettings: () => { saved.push(saved.length); return Promise.resolve(); } };
  return { tab: new HtSettingTab({} as App, host), saved };
}

describe('HtSettingTab', () => {
  it('die Hilfe-Zeile steht zuerst, jede Steuerung gehört zu einem Feld der Einstellungen', () => {
    const { tab } = tabWith({ ...DEFAULT_SETTINGS });
    const defs = tab.getSettingDefinitions();
    const help = githubHelpUrls('hypertext-exporter');
    expect(defs[0]).toMatchObject({ name: 'Help' });
    expect('render' in (defs[0] as object)).toBe(true);
    expect(help.docsUrl).toContain('hypertext-exporter');
    const keys = defs.slice(1).map((d) => (d as { control: { key: string } }).control.key);
    expect(keys.sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('das Ziel bietet genau die Werte von Destination', () => {
    const { tab } = tabWith({ ...DEFAULT_SETTINGS });
    const dest = tab.getSettingDefinitions().find((d) => (d as { control?: { key: string } }).control?.key === 'destination') as { control: { options: Record<string, string> } };
    expect(Object.keys(dest.control.options)).toEqual([...DESTINATIONS]);
  });

  it('speichert einen gültigen Wert, verwirft einen ungültigen und speichert in beiden Fällen', async () => {
    const settings: HtSettings = { ...DEFAULT_SETTINGS };
    const { tab, saved } = tabWith(settings);
    await tab.setControlValue('destination', 'folder');
    expect(settings.destination).toBe('folder');
    await tab.setControlValue('destination', 'quatsch');
    expect(settings.destination).toBe('beside-entry');
    await tab.setControlValue('destinationFolder', '  pub  ');
    expect(settings.destinationFolder).toBe('pub');
    expect(tab.getControlValue('destinationFolder')).toBe('pub');
    expect(saved).toHaveLength(3);
  });
});
