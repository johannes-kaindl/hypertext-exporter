// Je Notiz zeichnen (Bauplan Task 6, Spec 10.2 Schritt 2b und 3): Vorbehandlung, Zeichnen über das Kit, Einbettungen prüfen.
// Gezeichnet wird ausschließlich von `withRenderedNote` (Kit, Bestellung 1): Host, Frist, Mermaid-Wartezeit, Ruhe-Regel und Fenstercheck liegen dort. Hier steht nur,
// was plugin-eigene Typen trägt: die Übersetzung der Kit-Befunde in `Finding`, die Prüfung der Einbettungen gegen die Menge und der Ablauf je Notiz.
import { parseLinktext, stripHeading, type App, type TFile } from 'obsidian';
import { CODES } from '../core/finding-codes';
import type { Finding, Recipe, RunControl, SetNote } from '../core/types';
import { RENDER_NOTE_CSS, withRenderedNote, type RenderNoteFinding, type RenderNotePorts } from '../vendor/kit-obsidian/render-note';

/** Vertrag mit `styles.css`: der Host des Kit-Zeichners braucht diese Regel wortgleich (Test `render.test.ts` prüft es). */
export const RENDER_HOST_CSS = RENDER_NOTE_CSS;

export interface RenderDeps {
  /** Gehört der Zielpfad (einer Notiz) zur Menge des Exports? Ohne Angabe entfällt die Prüfung auf `embed.outside`. */
  inSet?: (path: string) => boolean;
  /** Zeichner; Vorgabe `withRenderedNote` des Kits. Tests reichen einen Ersatz durch. */
  draw?: typeof withRenderedNote;
  /** Dokument des Zeichners und Ports des Kits (Uhr, Beobachter, Sichtbarkeit); nur für Tests. */
  doc?: Document;
  kit?: Partial<RenderNotePorts>;
}

export interface RenderResult {
  /** Losgelöster Baum; der Host des Zeichners ist abgeräumt. Bei Abbruch und bei `render.hidden-window` ist er leer. */
  root: HTMLElement;
  findings: Finding[];
}

/** Pflichtprüfung vor dem ersten Zeichnen (Spec 4b): ein verdecktes oder minimiertes Fenster drosselt den Renderer so stark, dass der Export nicht fertig wird. */
export function assertWindowVisible(doc: Pick<Document, 'visibilityState'> = activeWindow.document): Finding | null {
  if (doc.visibilityState !== 'hidden') return null;
  return {
    severity: 'error',
    code: CODES.renderHiddenWindow,
    message: 'Das Obsidian-Fenster ist verdeckt. Obsidian-Fenster nicht minimieren, solange der Export läuft.',
  };
}

/** Kit-Befund des Zeichners als `Finding` mit Pfad der Notiz. */
export function translateRenderFinding(f: RenderNoteFinding, notePath: string): Finding {
  switch (f.kind) {
    case 'render-timeout':
      return { severity: 'warning', code: CODES.renderTimeout, message: `Zeichnen nach ${f.ms} ms nicht fertig; die Notiz kann unvollständig sein`, notePath };
    case 'render-failed':
      return { severity: 'warning', code: CODES.renderFailed, message: `Der Zeichner meldete einen Fehler: ${f.message}`, notePath };
    case 'mermaid-missing':
      return { severity: 'warning', code: CODES.renderMermaidMissing, message: `${f.expected - f.drawn} von ${f.expected} Diagrammen wurden nicht gezeichnet`, notePath };
    case 'not-settled':
      return {
        severity: 'warning',
        code: CODES.renderPlaceholder,
        message: `Nach ${f.ms} ms stand noch kein Endergebnis da (${f.placeholders} Platzhalter, etwa „Loading“); der Block kann leer oder unfertig sein`,
        notePath,
      };
    case 'window-hidden':
      return { severity: 'error', code: CODES.renderHiddenWindow, message: assertWindowVisible({ visibilityState: 'hidden' })?.message ?? '', notePath };
    case 'embed-missing':
      return { severity: 'warning', code: CODES.embedMissing, message: `Einbettung ohne Ziel: ${f.target}`, notePath };
  }
}

/**
 * Die Naht für Kit-Bestellung 21 (Vorbehandlung, Spec 10.2 Schritt 2b): rohe Rahmen zu Platzhaltern, Codeblöcke und Inline-Abfragen je nach `recipe.blocks` herausnehmen.
 * Bis das Kit sie liefert, gibt sie den Text unverändert zurück und `restore` tut nichts. Hier, und nur hier, wird 21 eingesetzt: `markdown` ist der vorbehandelte Text,
 * `restore` setzt die herausgenommenen Blöcke nach dem Zeichnen als `<pre><code class="language-x">` in den gezeichneten Baum zurück.
 */
function prepareMarkdown(note: SetNote, recipe: Recipe): { markdown: string; restore: (root: HTMLElement) => void } {
  void recipe;
  return { markdown: note.body, restore: () => {} };
}

/** Name des Abschnitts oder Blocks, wie Obsidian ihn vergleicht: ohne Sonderzeichen, ohne Groß/Klein. */
function headingKey(text: string): string {
  return stripHeading(text).toLowerCase();
}

/** Fehlt ein Teil des Unterpfads (`#Überschrift`, `#H1#H2`, `#^block`) in der Zielnotiz? Ohne Index (`null`) kein Urteil. */
function sectionMissing(app: App, target: TFile, subpath: string): boolean {
  const cache = app.metadataCache.getFileCache(target);
  if (cache === null) return false;
  const parts = subpath.split('#').filter((p) => p !== '');
  for (const part of parts) {
    if (part.startsWith('^')) {
      if (cache.blocks?.[part.slice(1).toLowerCase()] === undefined) return true;
    } else if (!(cache.headings ?? []).some((h) => headingKey(h.heading) === headingKey(part))) {
      return true;
    }
  }
  return false;
}

/**
 * Prüft die Einbettungen im gezeichneten Baum. Eine Einbettung ohne Ziel (`mod-empty`) meldet schon der Zeichner; sie löst hier zu keiner Datei auf und fällt von selbst heraus. Hier: Notiz-Ziel außerhalb der Menge (`embed.outside`) und
 * Abschnitts- oder Blockziel, das in der Zielnotiz fehlt (`embed.missing-section`; Obsidian bettet dann still die ganze Notiz ein, Spec 4b). Eine Einbettung in einer Einbettung
 * löst gegen die eingebettete Notiz auf, nicht gegen die äußere. Bilder und andere Anhänge gehören nie zur Menge und werden hier übergangen.
 */
function checkEmbeds(app: App, root: HTMLElement, note: SetNote, inSet: ((path: string) => boolean) | undefined): Finding[] {
  const findings: Finding[] = [];
  const resolved = new Map<Element, string>();
  for (const el of Array.from(root.querySelectorAll('.internal-embed'))) {
    const src = el.getAttribute('src');
    if (!src) continue;
    const outer = el.parentElement?.closest('.internal-embed') ?? null;
    const sourcePath = (outer !== null ? resolved.get(outer) : undefined) ?? note.path;
    const { path: linkpath, subpath } = parseLinktext(src);
    const target = linkpath === '' ? app.vault.getFileByPath(sourcePath) : app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (target === null) continue;
    resolved.set(el, target.path);
    if (target.extension !== 'md') continue;
    if (inSet !== undefined && !inSet(target.path)) {
      findings.push({ severity: 'warning', code: CODES.embedOutside, message: `Eingebettete Notiz liegt außerhalb der Menge: ${target.path}`, notePath: note.path });
    }
    if (subpath !== '' && sectionMissing(app, target, subpath)) {
      findings.push({
        severity: 'warning',
        code: CODES.embedMissingSection,
        message: `Abschnitt oder Block fehlt in ${target.path}: ${subpath}; Obsidian bettet die ganze Notiz ein`,
        notePath: note.path,
      });
    }
  }
  return findings;
}

/**
 * Zeichnet eine Notiz. Bei `run.aborted` wird nicht gezeichnet. Der Baum lebt im Kit nur im Rückruf; was den angehängten Baum braucht, geschieht dort,
 * danach geht der Inhalt in einen losgelösten Behälter.
 */
export async function renderNote(app: App, note: SetNote, recipe: Recipe, run: RunControl, deps: RenderDeps = {}): Promise<RenderResult> {
  if (run.aborted) return { root: createDiv(), findings: [] };
  const prepared = prepareMarkdown(note, recipe);
  const draw = deps.draw ?? withRenderedNote;
  return draw(
    {
      app,
      markdown: prepared.markdown,
      sourcePath: note.path,
      ...(deps.doc !== undefined ? { doc: deps.doc } : {}),
      ...(deps.kit !== undefined ? { ports: deps.kit } : {}),
    },
    (rendered): RenderResult => {
      const findings = rendered.findings.map((f) => translateRenderFinding(f, note.path));
      const root = createDiv();
      if (rendered.findings.some((f) => f.kind === 'window-hidden')) return { root, findings };
      findings.push(...checkEmbeds(app, rendered.root, note, deps.inSet));
      prepared.restore(rendered.root);
      root.append(...Array.from(rendered.root.childNodes));
      return { root, findings };
    },
  );
}
