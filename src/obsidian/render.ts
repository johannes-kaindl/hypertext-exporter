// Je Notiz zeichnen (Bauplan Task 6 und 7, Spec 10.2 Schritt 2b bis 5): Vorbehandlung, Zeichnen über das Kit, Einbettungen prüfen, Einfrieren (Schutzdurchgang folgt mit Bestellung 11).
// Gezeichnet wird ausschließlich von `withRenderedNote` (Kit, Bestellung 1): Host, Frist, Mermaid-Wartezeit, Ruhe-Regel und Fenstercheck liegen dort. Hier steht nur,
// was plugin-eigene Typen trägt: die Übersetzung der Kit-Befunde in `Finding`, die Prüfung der Einbettungen gegen die Menge und der Ablauf je Notiz.
import { parseLinktext, stripHeading, type App, type TFile } from 'obsidian';
import { CODES } from '../core/finding-codes';
import type { Finding, Recipe, RunControl, SetNote } from '../core/types';
import { prepareExportMarkdown } from '../vendor/kit/export-prepare';
import { freezeRenderedDom, type ExportFreezeFinding, type ExportFreezePorts } from '../vendor/kit/export-freeze';
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
  /** Port des Einfrierens (Bild und Vergleichsfläche); Vorgabe das Obsidian-Global `createEl`. */
  freezePorts?: ExportFreezePorts;
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

/** Kit-Befund des Einfrierens als `Finding` mit Präfix `freeze.` und Pfad der Notiz. */
export function translateFreezeFinding(f: ExportFreezeFinding, notePath: string): Finding {
  switch (f.kind) {
    case 'canvas-failed':
      return { severity: 'warning', code: CODES.freezeCanvasFailed, message: `Ein Canvas ließ sich nicht in ein Bild wandeln und fehlt in der Seite (${f.reason})`, notePath };
    case 'canvas-blank':
      return { severity: 'warning', code: CODES.freezeCanvasBlank, message: `Ein Canvas (${f.width} × ${f.height}) ist leer gezeichnet worden; das Bild bleibt als leere Fläche`, notePath };
    case 'empty-block': {
      const where = f.hint === '' ? f.what : `${f.what}: ${f.hint}`;
      return { severity: 'warning', code: CODES.freezeEmptyBlock, message: `Ein Block blieb leer (${where})`, notePath };
    }
  }
}

/**
 * Die Naht für Kit-Bestellung 11 (Schutzdurchgang, Spec 10.2 Schritt 5): Skripte, Ereignis-Attribute, `javascript:`-Ziele und Rahmen aus dem eingefrorenen Baum entfernen,
 * jedes Entfernte als `guard.removed`. Bis das Kit sie liefert, ändert sie nichts. Hier, und nur hier, wird 11 eingesetzt.
 */
function protectTree(root: HTMLElement, note: SetNote): Finding[] {
  void root;
  void note;
  return [];
}

/** Alle Textknoten unter `node` in Dokumentreihenfolge (ohne `document`, damit der Baum auch losgelöst durchsucht wird). */
function textNodes(node: Node, out: Text[] = []): Text[] {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) out.push(child as Text);
    else textNodes(child, out);
  }
  return out;
}

/**
 * Vorbehandlung (Kit-Bestellung 21, Spec 10.2 Schritt 2b): rohe Rahmen werden zu Platzhaltern, Codeblöcke und Inline-Abfragen je nach `recipe.blocks` herausgenommen
 * (`none`/`core`/`all` entsprechen den Stellungen des Kits). `markdown` ist der vorbehandelte Text; `restore` setzt die herausgenommenen Blöcke nach dem Zeichnen als
 * `<pre><code class="language-x">` in den gezeichneten Baum zurück (Text über `textContent`, vom DOM maskiert) und meldet einen Platzhalter, den es im Baum nicht findet.
 */
function prepareMarkdown(note: SetNote, recipe: Recipe): { markdown: string; restore: (root: HTMLElement) => Finding[] } {
  const prepared = prepareExportMarkdown(note.body, { codeBlocks: recipe.blocks });
  const restore = (root: HTMLElement): Finding[] => {
    const findings: Finding[] = [];
    const nodes = textNodes(root);
    for (const code of prepared.codes) {
      const hit = nodes.find((n) => n.parentNode !== null && n.data.trim() === code.placeholder);
      if (hit === undefined) {
        findings.push({
          severity: 'warning',
          code: CODES.renderPlaceholderLost,
          message: `Ein Codeblock${code.lang === '' ? '' : ` (${code.lang})`} ging beim Zeichnen verloren und fehlt in der Seite`,
          notePath: note.path,
        });
        continue;
      }
      const pre = createEl('pre');
      pre.createEl('code', { text: code.text, ...(code.lang === '' ? {} : { cls: `language-${code.lang}` }) });
      const parent = hit.parentNode as Node;
      // Ein Absatz, der nur den Platzhalter trägt, wird ersetzt; in einer engen Liste steht der Platzhalter ohne Absatz und wird selbst ersetzt.
      const alone = parent.nodeName === 'P' && parent.childNodes.length === 1;
      (alone ? parent : hit).parentNode?.replaceChild(pre, alone ? parent : hit);
    }
    return findings;
  };
  return { markdown: prepared.markdown, restore };
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
      findings.push(...prepared.restore(rendered.root));
      // Einfrieren am angehängten Baum (der Canvas braucht seinen Inhalt), erst danach löst sich der Inhalt vom Host.
      const frozen = freezeRenderedDom(rendered.root, deps.freezePorts ?? { createEl: (tag) => createEl(tag) });
      // Eine Einbettung ohne Ziel (`mod-empty`) hat der Zeichner schon als `embed.missing` gemeldet; nicht noch einmal als leerer Block.
      const unreported = frozen.findings.filter((f) => !(f.kind === 'empty-block' && f.what === 'embed' && /\bmod-empty/.test(f.hint)));
      findings.push(...unreported.map((f) => translateFreezeFinding(f, note.path)));
      findings.push(...protectTree(rendered.root, note));
      root.append(...Array.from(rendered.root.childNodes));
      return { root, findings };
    },
  );
}
