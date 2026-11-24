// Der Ablauf (Bauplan Task 12, Spec 10.2): die feste Folge der Schritte, vom Sammeln der Menge bis zur fertigen Seite, dazu der Prüfbefehl und die Schnittstelle für die Kommandozeile.
// Hier wird nur verdrahtet; jeder Baustein steht in seiner Datei (Menge `core/set`, Zeichnen `obsidian/render`, Medien `obsidian/media`, Marken und Aufklappen `core/structure`,
// Übersichten `core/overview`, Seite `core/page`, Endprüfung `core/final-check`). Geschrieben wird nicht hier, sondern von `writeExport` (`output.ts`).
//
// Folge in `runExport` (die Nummern sind die der Spec 10.2); nach jedem Schritt und nach jeder Notiz ein Haltepunkt (`run.aborted` lesen, `await run.pause()`):
//   1+2  Menge sammeln, Bauanleitung lesen, Befunde sammeln   → ein Fehler hält hier an, vor dem Zeichnen
//   2b–5 je Notiz: Vorbehandeln, Zeichnen, Einfrieren, Schutz (`renderNote`), dann Medien (`embedMedia`)   → ein verdecktes Fenster hält an
//   6–9  Marken, Links, Aufklappen, Übersichten (`structure`)
//   11   Seite bauen (Stil, MathJax-Stile, Stempel), harte Endprüfung, zweiter Schutzdurchgang auf dem neu gelesenen Text   → ein Fehler hält an, es entsteht keine Seite
// Schritt 10 (Medien) läuft je Notiz gleich nach dem Zeichnen, weil die Adressen der Bilder nur dort gelten; Schritt 12 (Ausgeben) gehört `writeExport` und dem Aufrufer.
//
// Ein Abbruch oder ein Fehler gibt ein `ExportResult` mit `ok: false` und ohne `html`; der Aufrufer schreibt damit (`writeExport`) die Ergebnisdatei mit `ok:false`.
import { apiVersion, getLanguage, type App } from 'obsidian';
import { CODES } from '../core/finding-codes';
import { FindingList } from '../core/findings';
import { finalCheck, finalGuard } from '../core/final-check';
import { filterMathCss } from '../core/math-css';
import { buildOverview, summaryLine } from '../core/overview';
import { buildPage } from '../core/page';
import { DEFAULT_RECIPE, notYetFindings, parseRecipe } from '../core/recipe';
import { resultJson } from '../core/result-file';
import { buildSet } from '../core/set';
import { stampMeta } from '../core/stamp';
import { structure } from '../core/structure';
import type { Column, ExportResult, ExportScope, ExportSet, Finding, Recipe, RunControl, SetGroup, SetNode, SetNote } from '../core/types';
import { BASE_CSS } from '../theme/base-css';
import { DEFAULT_THEME_CSS, DEFAULT_THEME_KEY } from '../theme/default-theme';
import { errorMessage } from '../vendor/kit/error-message';
import { formatBytes } from '../vendor/kit/format-bytes';
import { createMacrotaskPause } from '../vendor/kit/macrotask-pause';
import { baseName, splitFileName } from '../vendor/kit/rel-path';
import { sha256HexUtf8 } from '../vendor/kit/sha256';
import { vaultDirname } from '../vendor/kit/vault-path';
import type { InlineImagesPorts } from '../vendor/kit-obsidian/inline-images';
import { collectInputs } from './collect';
import { RECIPE_KEY } from './insert-recipe';
import { embedMedia } from './media';
import { outputPaths, writeExport, type OutputHost } from './output';
import { assertWindowVisible, renderNote, type RenderDeps } from './render';
import type { HtSettings } from './settings';

export type ExportRequest = ExportScope;

/** Was der Ablauf vom Plugin braucht; `HypertextExporterPlugin` erfüllt es, ein Test gibt Fakes hinein. */
export interface PipelineHost extends OutputHost {
  app: App;
  settings: HtSettings;
  manifest: { version: string };
}

/** Nähte für Tests und für andere Umgebungen; alles ist optional, die Vorgabe ist Obsidian. */
export interface PipelineDeps {
  /** Zeichner, Dokument und Ports des Kits (`renderNote`); `inSet` setzt der Ablauf selbst. */
  render?: Omit<RenderDeps, 'inSet'>;
  /** Lade-Ports des Bildeinbettens (`embedMedia`). */
  media?: InlineImagesPorts;
  /** Sichtbarkeit des Fensters; Vorgabe das aktive Fenster. */
  visibility?: Pick<Document, 'visibilityState'>;
  /** Inhalte der MathJax-`<style>`-Elemente; Vorgabe die des aktiven Dokuments. */
  mathStyles?: () => string[];
  obsidianVersion?: string;
  obsidianLang?: string;
  /** Basispfad des Vaults (Desktop) für die Endprüfung; `null` heißt: es gibt keinen. */
  basePath?: string | null;
}

const OUTPUT_EXTENSION = '.html';
const FALLBACK_STEM = 'export';
const MIB = 1024 * 1024;

function stemOf(entryPath: string): string {
  const stem = splitFileName(baseName(entryPath)).stem;
  return stem === '' ? FALLBACK_STEM : stem;
}

/** Die Entscheidung von „Notiz exportieren“ und der Kommandozeile: trägt die Notiz einen Block `hypertext:`, ist die Menge ihr Ordner, sonst die Einzelnotiz. */
export function scopeForEntry(app: App, entryPath: string): ExportScope {
  const frontmatter = app.metadataCache.getCache(entryPath)?.frontmatter;
  const hasRecipe = frontmatter !== undefined && Object.prototype.hasOwnProperty.call(frontmatter, RECIPE_KEY);
  return hasRecipe ? { kind: 'folder', folder: vaultDirname(entryPath), entryPath } : { kind: 'note', entryPath };
}

/** Schritte 1 und 2: Menge sammeln, Bauanleitung der Einstiegsnotiz lesen. Die Einstiegsnotiz bestimmt bei „automatisch“ erst die Menge selbst. */
async function prepare(app: App, req: ExportRequest): Promise<{ scope: ExportScope; recipe: Recipe; set: ExportSet; findings: Finding[] }> {
  const first = await collectInputs(app, req, DEFAULT_RECIPE);
  let entryPath = req.entryPath;
  if (entryPath === '') entryPath = buildSet(req, first, DEFAULT_RECIPE).set.entry.path;
  const entry = entryPath === '' ? undefined : first.find((n) => n.path.normalize('NFC') === entryPath.normalize('NFC'));
  const parsed = parseRecipe(entry?.frontmatter[RECIPE_KEY]);
  const scope: ExportScope = { ...req, entryPath };
  // Quellen außerhalb des Ordners kennt erst die Bauanleitung.
  const inputs = parsed.recipe.sources.length > 0 ? await collectInputs(app, scope, parsed.recipe) : first;
  const built = buildSet(scope, inputs, parsed.recipe);
  return { scope, recipe: parsed.recipe, set: built.set, findings: [...parsed.findings, ...notYetFindings(parsed.recipe), ...built.findings] };
}

function notesBelow(nodes: SetNode[]): SetNote[] {
  const out: SetNote[] = [];
  for (const node of nodes) {
    if ('children' in node) out.push(...notesBelow(node.children));
    else out.push(node);
  }
  return out;
}

/** Die Spalten der Zusatzzeile je Notiz: die der nächsten Gruppe darüber, die welche hat (Untergruppen aus Ordnern tragen keine eigene Angabe). */
function summaryColumns(nodes: SetNode[], inherited: Column[], into: Map<string, Column[]>): void {
  for (const node of nodes) {
    if ('children' in node) summaryColumns(node.children, node.summaryLine.length > 0 ? node.summaryLine : inherited, into);
    else if (inherited.length > 0) into.set(node.path, inherited);
  }
}

/** Übersichten und Zusatzzeilen (Schritt 9), eingehängt in `structure`. Befunde (`field.missing`) sammelt der Rückgabewert. */
function makeExtras(set: ExportSet, recipe: Recipe, doc: Document): { extras: Parameters<typeof structure>[4]; findings: () => Finding[] } {
  const columns = new Map<string, Column[]>();
  summaryColumns(set.nodes, [], columns);
  const overviewFindings: Finding[] = [];
  const summarized = new Set<string>();
  const missingIn = new Map<string, Set<string>>();
  const extras: Parameters<typeof structure>[4] = {
    summaryOf(note) {
      const cols = columns.get(note.path);
      if (cols === undefined) return null;
      const line = summaryLine(note, cols);
      summarized.add(note.path);
      for (const name of line.missing) {
        const paths = missingIn.get(name) ?? new Set<string>();
        paths.add(note.path);
        missingIn.set(name, paths);
      }
      return line.text === '' ? null : line.text;
    },
    overviewFor(group: SetGroup, anchors) {
      if (group.overview.length === 0) return null;
      const built = buildOverview(notesBelow(group.children), group.overview, anchors, doc, recipe.lang);
      overviewFindings.push(...built.findings);
      return built.table;
    },
  };
  const findings = (): Finding[] => {
    const out = [...overviewFindings];
    for (const [name, paths] of missingIn) {
      // Ein Feld, das eine Übersicht schon gemeldet hat, wird nicht noch einmal gemeldet.
      if (overviewFindings.some((f) => f.code === CODES.fieldMissing && f.message.startsWith(`Das Feld „${name}“ `))) continue;
      out.push({ severity: 'warning', code: CODES.fieldMissing, message: `Das Feld „${name}“ fehlt oder ist leer in ${paths.size} von ${summarized.size} Notizen (Zusatzzeile)` });
    }
    return out;
  };
  return { extras, findings };
}

/**
 * Die Regeln der MathJax-Stile des Fensters, je Regel `cssText`. MathJax hängt Regeln für neue Zeichen und Bauteile per `insertRule` an; der Textinhalt des
 * `<style>`-Elements wächst dabei nicht mit (gemessen 2026-11-24: 11688 Zeichen Text, 164 bis 207 Regeln im Blatt), das CSSOM trägt alles.
 * Ein Element ohne lesbares Blatt fällt auf seinen Textinhalt zurück.
 */
export function windowMathStyles(): string[] {
  return Array.from(activeDocument.querySelectorAll('style#MJX-CHTML-styles')).map((el) => {
    const sheet = (el as HTMLStyleElement).sheet;
    if (sheet === null || sheet === undefined) return el.textContent ?? '';
    return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
  });
}

/** Benutzte MathJax-Zeichen und -Elemente im gezeichneten Baum und die Stile des Fensters, gefiltert (Spec 4b); ohne Formel nichts. */
function mathCss(roots: Iterable<HTMLElement>, deps: PipelineDeps): { css: string; findings: Finding[] } {
  const used = new Set<string>();
  const elements = new Set<string>();
  let formulas = false;
  for (const root of roots) {
    if (root.querySelector('mjx-container') !== null) formulas = true;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const name = el.tagName.toLowerCase();
      if (name.startsWith('mjx-')) elements.add(name);
    }
    for (const el of Array.from(root.querySelectorAll('mjx-c'))) {
      for (const cls of Array.from(el.classList)) {
        const m = /^mjx-c([0-9A-Fa-f]+)$/.exec(cls);
        if (m !== null) used.add(m[1] ?? '');
      }
    }
  }
  if (!formulas) return { css: '', findings: [] };
  const styles = deps.mathStyles !== undefined ? deps.mathStyles() : windowMathStyles();
  return filterMathCss(styles, used, elements);
}

function readObsidianLang(): string {
  try { return getLanguage(); } catch { return 'en'; }
}

function readBasePath(app: App): string | null {
  const adapter = app.vault.adapter as unknown as { getBasePath?: () => string };
  return typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : null;
}

/** Die aktivierten Community-Plugins für den vollen Stempel; die Liste führt Obsidian nicht in der öffentlichen Schnittstelle, deshalb nur lesend und defensiv. */
function enabledPlugins(app: App): Array<{ id: string; version: string }> {
  const registry = (app as unknown as { plugins?: { enabledPlugins?: Set<string>; manifests?: Record<string, { version?: string } | undefined> } }).plugins;
  const enabled = registry?.enabledPlugins;
  if (enabled === undefined) return [];
  return Array.from(enabled).map((id) => ({ id, version: registry?.manifests?.[id]?.version ?? '' }));
}

/**
 * Die ganze Folge bis zur fertigen Seite. Wirft bei einem unerwarteten Fehler (der Aufrufer fängt ihn: `ExportActions` und `exportApi` tun es);
 * Fehler im Sinne der Seite (Bauanleitung, Endprüfung, verdecktes Fenster) und Abbruch kommen als `ok: false` ohne `html`.
 */
export async function runExport(host: PipelineHost, req: ExportRequest, run: RunControl, deps: PipelineDeps = {}): Promise<ExportResult> {
  const { app } = host;
  const findings = new FindingList();
  let entryPath = req.entryPath;
  const stats: ExportResult['stats'] = { notes: 0, bytes: 0, mediaBytes: {} };
  const result = (ok: boolean, html?: string): ExportResult => ({
    ok,
    ...(html !== undefined ? { html } : {}),
    fileName: `${stemOf(entryPath)}${OUTPUT_EXTENSION}`,
    ...(entryPath !== '' ? { entryPath } : {}),
    findings: findings.sorted(),
    stats: { notes: stats.notes, bytes: stats.bytes, mediaBytes: { ...stats.mediaBytes } },
  });
  /** Haltepunkt: gibt die Oberfläche frei und sagt, ob abgebrochen wurde. */
  const stop = async (): Promise<boolean> => {
    await run.pause();
    return run.aborted;
  };

  // 1 und 2: Menge, Bauanleitung, Befunde
  const prepared = await prepare(app, req);
  entryPath = prepared.set.entry.path !== '' ? prepared.set.entry.path : req.entryPath;
  const { recipe, set } = prepared;
  findings.addAll(prepared.findings);
  stats.notes = set.notesInOrder.length;
  if (await stop()) return result(false);
  if (findings.hasError()) return result(false);
  const hidden = assertWindowVisible(deps.visibility);
  if (hidden !== null) { findings.add(hidden); return result(false); }

  // 2b bis 5 und 10: jede Notiz zeichnen, dann ihre Medien einsetzen
  const inSet = new Set(set.notesInOrder.map((n) => n.path));
  const roots = new Map<string, HTMLElement>();
  const total = set.notesInOrder.length;
  for (const [index, note] of set.notesInOrder.entries()) {
    run.progress(index, total, note.title);
    if (await stop()) return result(false);
    const rendered = await renderNote(app, note, recipe, run, { ...deps.render, inSet: (path) => inSet.has(path) });
    findings.addAll(rendered.findings);
    // Ein verdecktes Fenster gilt für alle weiteren Notizen ebenso: weiterzeichnen hieße nur warten.
    if (rendered.findings.some((f) => f.code === CODES.renderHiddenWindow)) return result(false);
    const media = await embedMedia(app, rendered.root, note, recipe, deps.media);
    findings.addAll(media.findings);
    for (const [mime, bytes] of Object.entries(media.mediaBytes)) stats.mediaBytes[mime] = (stats.mediaBytes[mime] ?? 0) + bytes;
    roots.set(note.path, rendered.root);
    if (await stop()) return result(false);
  }
  run.progress(total, total, '');
  const math = mathCss(roots.values(), deps);
  findings.addAll(math.findings);

  // 6 bis 9: Marken, Links, Aufklappen, Übersichten
  const doc = (roots.get(set.entry.path) ?? createDiv()).ownerDocument;
  const { extras, findings: extraFindings } = makeExtras(set, recipe, doc);
  const resolve = (link: string, from: string): string | null => app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? null;
  const structured = structure(set, roots, recipe, resolve, extras, prepared.scope.kind === 'folder' ? prepared.scope.folder : undefined);
  findings.addAll(structured.findings);
  findings.addAll(extraFindings());
  if (await stop()) return result(false);
  if (findings.hasError()) return result(false);

  // 11: Seite bauen (Thema in Etappe 5 nur das Standard-Thema; ein anderer Name ist schon als `recipe.not-yet` gemeldet)
  const themeCss = DEFAULT_THEME_CSS;
  const stamp = stampMeta({
    pluginVersion: host.manifest.version,
    obsidianVersion: deps.obsidianVersion ?? apiVersion,
    obsidianLang: deps.obsidianLang ?? readObsidianLang(),
    themeKey: DEFAULT_THEME_KEY,
    themeSha256: sha256HexUtf8(themeCss),
    blocks: recipe.blocks,
    embeds: recipe.embeds,
    remoteImages: recipe.remoteImages,
    ...(recipe.stamp === 'full' ? { plugins: enabledPlugins(app) } : {}),
  });
  const toc: Array<{ anchor: string; title: string }> = [{ anchor: structured.anchors.get(set.entry.path) ?? '', title: set.title }];
  for (const node of set.nodes) {
    // Gruppen und lose Notizen der obersten Ebene in der Reihenfolge der Seite; Notizen in Gruppen führt die Gruppe selbst.
    if ('children' in node) toc.push({ anchor: structured.groupAnchors.get(node) ?? '', title: node.title });
    else toc.push({ anchor: structured.anchors.get(node.path) ?? '', title: node.title });
  }
  const html = buildPage({ title: set.title, lang: recipe.lang, toc, body: structured.body, css: `${BASE_CSS}\n${themeCss}`, mathCss: math.css, stamp });
  if (await stop()) return result(false);

  // Harte Endprüfung am fertigen Text
  const parsed = new DOMParser().parseFromString(html, 'text/html').documentElement;
  findings.addAll(finalCheck(html, parsed, deps.basePath !== undefined ? deps.basePath : readBasePath(app)));
  // Zweiter Schutzdurchgang auf dem neu gelesenen Text (verändert `parsed`, deshalb nach der Endprüfung)
  findings.addAll(finalGuard(parsed));
  if (findings.hasError()) return result(false);

  // 12 (Form): `auto` wählt in Etappe 5 immer `file`; das Paket kommt in Etappe 6. Die Größe steht als Hinweis, über der Grenze zusätzlich als Warnung.
  stats.bytes = new TextEncoder().encode(html).length;
  findings.add({ severity: 'info', code: CODES.outputSize, message: `Größe der Seite: ${stats.bytes} Byte (${formatBytes(stats.bytes)})` });
  if (stats.bytes > recipe.outputLimitMb * MIB) {
    findings.add({ severity: 'warning', code: CODES.outputOverLimit, message: `Die Seite ist größer als ${recipe.outputLimitMb} MB (output_limit_mb); ab einer späteren Fassung entsteht dann ein Paket` });
  }
  return result(true, html);
}

export type CheckStatus = 'same' | 'differs' | 'no-export' | 'nothing-to-compare' | 'failed' | 'cancelled';

/** Ergebnis des Prüfbefehls. `path` ist der Pfad der verglichenen Datei (leer, wo es keine gibt); `firstDiff` der erste abweichende Byte-Index (ab 0); `findings` die der neuen Fassung. */
export interface CheckResult {
  status: CheckStatus;
  same: boolean;
  firstDiff?: number;
  path: string;
  findings: Finding[];
}

/** Erster Byte-Index, an dem beide verschieden sind; bei einem Präfix die Länge des kürzeren; `-1`, wenn sie gleich sind. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : common;
}

/**
 * Baut die Seite noch einmal (derselbe Ablauf wie der Export, ohne zu schreiben) und vergleicht sie Byte für Byte mit der vorhandenen Datei.
 * Das Ziel „Teilen“ legt keine Datei im Vault ab: dort gibt es nichts zu vergleichen (`nothing-to-compare`). Ohne Ausgabe (`no-export`) wird gar nicht gezeichnet.
 * Ein Vergleich braucht die Einstiegsnotiz (`req.entryPath`), weil sie den Ort der Ausgabe bestimmt; ohne sie gilt `no-export`.
 */
export async function checkExport(host: PipelineHost, req: ExportRequest, run: RunControl, deps: PipelineDeps = {}): Promise<CheckResult> {
  if (host.settings.destination === 'share') return { status: 'nothing-to-compare', same: false, path: '', findings: [] };
  const paths = req.entryPath === '' ? null : outputPaths(host, req.entryPath);
  const adapter = host.app.vault.adapter;
  if (paths === null || !(await adapter.exists(paths.html))) return { status: 'no-export', same: false, path: paths?.html ?? '', findings: [] };
  const fresh = await runExport(host, req, run, deps);
  if (run.aborted) return { status: 'cancelled', same: false, path: paths.html, findings: fresh.findings };
  if (!fresh.ok || fresh.html === undefined) return { status: 'failed', same: false, path: paths.html, findings: fresh.findings };
  const existing = new Uint8Array(await adapter.readBinary(paths.html));
  const at = firstDifference(new TextEncoder().encode(fresh.html), existing);
  return at < 0
    ? { status: 'same', same: true, path: paths.html, findings: fresh.findings }
    : { status: 'differs', same: false, firstDiff: at, path: paths.html, findings: fresh.findings };
}

/** Öffentliche Schnittstelle (`plugin.api`) für Kommandozeile und andere Plugins. */
export interface ExportApi {
  /**
   * Exportiert die Notiz (ihr Ordner, wenn sie eine Bauanleitung trägt, sonst sie allein), schreibt Seite und Ergebnisdatei nach dem Ziel der Einstellungen und liefert
   * erst nach dem Schreiben genau den Text der Ergebnisdatei (`resultJson`). Wirft nie: jeder Fehler steht als Befund im Text. Der Exit-Code von `obsidian eval` ist immer 0.
   */
  exportAndWait(entryPath: string): Promise<string>;
}

export function exportApi(host: PipelineHost, deps: PipelineDeps = {}): ExportApi {
  return {
    async exportAndWait(entryPath) {
      const pause = createMacrotaskPause();
      const run: RunControl = { aborted: false, pause: () => pause.pause(), progress: () => {} };
      let result: ExportResult = { ok: false, fileName: `${stemOf(entryPath)}${OUTPUT_EXTENSION}`, findings: [], stats: { notes: 0, bytes: 0, mediaBytes: {} } };
      try {
        result = await runExport(host, scopeForEntry(host.app, entryPath), run, deps);
        return await writeExport(host, result, result.entryPath ?? entryPath);
      } catch (e) {
        const failed: ExportResult = { ok: false, fileName: result.fileName, findings: [...result.findings, { severity: 'error', code: CODES.exportFailed, message: errorMessage(e) }], stats: result.stats };
        return resultJson(failed, null);
      } finally {
        pause.close();
      }
    },
  };
}
