import { readFileSync } from "node:fs";
import type { App, PluginManifest } from "obsidian";
import { describe, expect, it } from "vitest";
import HypertextExporterPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/obsidian/settings";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as Record<string, unknown>;
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
const versions = JSON.parse(readFileSync("versions.json", "utf8")) as Record<string, string>;

describe("manifest", () => {
  it("carries the values of the build plan", () => {
    expect(manifest.id).toBe("hypertext-exporter");
    expect(manifest.name).toBe("Hypertext Exporter");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.isDesktopOnly).toBe(false);
    expect(manifest.minAppVersion).toBe("1.8.7");
    expect(manifest.author).toBe("Johannes Kaindl");
  });

  it("agrees with package.json and versions.json", () => {
    expect(pkg.version).toBe(manifest.version);
    expect(pkg.license).toBe("AGPL-3.0-or-later");
    expect(versions[manifest.version as string]).toBe(manifest.minAppVersion);
  });
});

describe("plugin", () => {
  it("loads with default settings, registers the one view and the six commands, and unloads", async () => {
    const app = { workspace: { on: () => ({}), getActiveFile: () => null } } as unknown as App;
    const plugin = new HypertextExporterPlugin(app, {} as PluginManifest);
    await plugin.onload();
    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    const reg = (plugin as unknown as { registered: { views: string[]; commands: Array<{ id: string; name: string }>; settingTabs: unknown[] } }).registered;
    expect(reg.views).toEqual(["hypertext-exporter-hub"]);
    expect(reg.commands).toEqual([
      { id: "open-view", name: "Open Hypertext Exporter" },
      { id: "export-folder", name: "Export folder as HTML page…" },
      { id: "export-current-note", name: "Export current note as HTML page" },
      { id: "check-export", name: "Check HTML export" },
      { id: "open-export", name: "Open HTML export" },
      { id: "insert-recipe", name: "Insert export recipe" },
    ]);
    expect(reg.settingTabs).toHaveLength(1);
    expect(() => plugin.onunload()).not.toThrow();
  });
});
