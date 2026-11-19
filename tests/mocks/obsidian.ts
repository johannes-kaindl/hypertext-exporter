// tests/mocks/obsidian.ts
// Test-only node stand-in for the "obsidian" module, activated via the vitest
// resolve.alias. Minimal on purpose: grows with the tests that need more.
// NEVER import this from src/.

export class Plugin {
  app: unknown = {};
  manifest: unknown = {};
  private data: unknown = null;
  loadData(): Promise<unknown> { return Promise.resolve(this.data); }
  saveData(data: unknown): Promise<void> { this.data = data; return Promise.resolve(); }
}

export function getLanguage(): string { return "en"; }

// Nur damit `import { requestUrl } from "obsidian"` im vendorten inline-images auflöst; Tests reichen eigene `ports` durch.
export function requestUrl(): Promise<never> { return Promise.reject(new Error("requestUrl: im Test nicht verfügbar")); }
