// Fake-Platte für Tests, die in den Vault schreiben: Dateien und Ordner im Speicher, mit dem Verhalten, das Etappe 0 an Obsidian 1.13 gemessen hat
// (`writeBinary` überschreibt, `rename` auf ein vorhandenes Ziel wirft). `failOn` lässt einen Aufruf gezielt scheitern.
import type { App } from 'obsidian';

export interface FakeDisk {
  files: Map<string, Uint8Array>;
  folders: Set<string>;
  /** Wirft beim n-ten (ab 1) passenden Aufruf: `{ op: 'rename', to: 'x.html' }`. */
  failOn: Array<{ op: 'writeBinary' | 'rename' | 'readBinary' | 'mkdir' | 'remove'; path?: string; to?: string }>;
  adapter: Record<string, (...args: never[]) => unknown>;
}

const copy = (b: Uint8Array): Uint8Array => new Uint8Array(b);

export function makeDisk(initial: Record<string, string | Uint8Array> = {}): FakeDisk {
  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>(['']);
  for (const [path, content] of Object.entries(initial)) files.set(path, typeof content === 'string' ? new TextEncoder().encode(content) : copy(content));
  const disk: FakeDisk = { files, folders, failOn: [], adapter: {} };
  const maybeFail = (op: string, path: string, to?: string): void => {
    const hit = disk.failOn.find((f) => f.op === op && (f.path === undefined || f.path === path) && (f.to === undefined || f.to === to));
    if (hit) throw new Error(`Fake: ${op} ${path} schlägt fehl`);
  };
  const a = {
    exists: (p: string): Promise<boolean> => Promise.resolve(files.has(p) || folders.has(p)),
    mkdir: (p: string): Promise<void> => { maybeFail('mkdir', p); folders.add(p); return Promise.resolve(); },
    writeBinary: (p: string, data: ArrayBuffer): Promise<void> => { maybeFail('writeBinary', p); files.set(p, copy(new Uint8Array(data))); return Promise.resolve(); },
    readBinary: (p: string): Promise<ArrayBuffer> => {
      maybeFail('readBinary', p);
      const b = files.get(p);
      if (!b) return Promise.reject(new Error(`Fake: ${p} fehlt`));
      return Promise.resolve(copy(b).buffer as ArrayBuffer);
    },
    remove: (p: string): Promise<void> => { maybeFail('remove', p); files.delete(p); return Promise.resolve(); },
    rename: (from: string, to: string): Promise<void> => {
      maybeFail('rename', from, to);
      if (files.has(to)) return Promise.reject(new Error('Destination file already exists!'));
      const b = files.get(from);
      if (!b) return Promise.reject(new Error(`Fake: ${from} fehlt`));
      files.delete(from);
      files.set(to, b);
      return Promise.resolve();
    },
  };
  disk.adapter = a as unknown as FakeDisk['adapter'];
  return disk;
}

export function appOf(disk: FakeDisk): App {
  return { vault: { adapter: disk.adapter } } as unknown as App;
}

export const text = (disk: FakeDisk, path: string): string | undefined => {
  const b = disk.files.get(path);
  return b === undefined ? undefined : new TextDecoder().decode(b);
};

/** Alle Dateipfade, sortiert (nur für die Prüfung, die Menge des Plugins ordnet nie so). */
export const listing = (disk: FakeDisk): string[] => [...disk.files.keys()].sort();
