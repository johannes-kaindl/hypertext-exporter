import { readFileSync } from "node:fs";
import type { App, PluginManifest } from "obsidian";
import { describe, expect, it } from "vitest";
import HypertextExporterPlugin, { DEFAULT_SETTINGS } from "../src/main";

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
  it("loads with default settings and unloads without registering a command", async () => {
    const plugin = new HypertextExporterPlugin({} as App, {} as PluginManifest);
    await plugin.onload();
    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    expect(() => plugin.onunload()).not.toThrow();
  });
});
