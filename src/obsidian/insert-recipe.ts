// Befehl „Insert export recipe“ (Bauplan Task 13 Step 4, Spec 10.10): schreibt den Block `hypertext:` mit den Standardwerten des Ordners in die aktive Notiz.
// Das ist die einzige Stelle, an der das Plugin in eine Notiz schreibt, und nur auf diesen Befehl hin. Geschrieben wird über `insertFrontmatterBlock` (Kit) im `vault.process`,
// nie über `processFrontMatter` (das formt den ganzen Block um); jede andere Zeile des Frontmatters bleibt byte-gleich.
import { Notice, type App, type TFile } from 'obsidian';
import { recipeYaml } from '../core/recipe';
import type { NoteInput } from '../core/types';
import { parseFrontmatter } from '../vendor/kit/frontmatter';
import { insertFrontmatterBlock } from '../vendor/kit/frontmatter-patch';
import { t } from '../vendor/kit/i18n';
import { confirmAction } from '../vendor/kit-obsidian/confirm';

export const RECIPE_KEY = 'hypertext';

export type InsertRecipeOutcome = 'inserted' | 'exists' | 'cancelled' | 'failed';

export interface InsertRecipeDeps {
  /** Bestätigen; Vorgabe `confirmAction` des Kits. Tests reichen einen Ersatz durch. */
  confirm?: typeof confirmAction;
}

/** Trägt die Notiz schon einen Schlüssel `hypertext:` in der obersten Ebene ihres Frontmatters? */
export function hasRecipeBlock(text: string): boolean {
  return Object.prototype.hasOwnProperty.call(parseFrontmatter(text).data, RECIPE_KEY);
}

/** Alle Notizen des Vaults; `recipeYaml` wählt die des Ordners, für die Bauanleitung zählen nur ihre Pfade. */
function notesOfVault(app: App): NoteInput[] {
  return app.vault.getMarkdownFiles().map((f) => ({ path: f.path, frontmatter: {}, body: '', links: [] }));
}

export async function insertRecipe(app: App, file: TFile, obsidianLang: string, deps: InsertRecipeDeps = {}): Promise<InsertRecipeOutcome> {
  const text = await app.vault.read(file);
  if (hasRecipeBlock(text)) {
    new Notice(t('insert.exists'));
    return 'exists';
  }
  const folder = file.parent?.path ?? '';
  const body = recipeYaml(folder === '/' ? '' : folder, notesOfVault(app), obsidianLang);
  const ok = await (deps.confirm ?? confirmAction)(app, {
    title: t('insert.confirm.title'),
    message: t('insert.confirm.message', file.name, folder === '' || folder === '/' ? t('insert.rootFolder') : folder),
    confirmLabel: t('insert.confirm.button'),
    cancelLabel: t('insert.confirm.cancel'),
    warning: false,
  });
  if (!ok) return 'cancelled';
  const result: { outcome: InsertRecipeOutcome } = { outcome: 'failed' };
  // Der Rückruf sieht den Text, wie er jetzt ist (nicht den von vorhin): ein Block, der inzwischen dazukam, wird nicht überschrieben.
  await app.vault.process(file, (data) => {
    const r = insertFrontmatterBlock(data, RECIPE_KEY, body);
    if (r.ok) { result.outcome = 'inserted'; return r.content; }
    result.outcome = r.reason === 'exists' ? 'exists' : 'failed';
    return data;
  });
  const { outcome } = result;
  new Notice(outcome === 'inserted' ? t('insert.done', file.name) : outcome === 'exists' ? t('insert.exists') : t('insert.failed'));
  return outcome;
}

/** `checkCallback` des Befehls: nur für die aktive Markdown-Notiz. */
export function insertRecipeCheck(app: App, obsidianLang: () => string): (checking: boolean) => boolean {
  return (checking) => {
    const file = app.workspace.getActiveFile();
    if (file === null || file.extension !== 'md') return false;
    if (!checking) void insertRecipe(app, file, obsidianLang());
    return true;
  };
}
