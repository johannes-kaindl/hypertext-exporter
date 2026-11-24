// Je Notiz zeichnen (Bauplan Task 6 und 7, Spec 10.2 Schritt 2b bis 5): Vorbehandlung, Zeichnen über das Kit, Einbettungen prüfen, Einfrieren, Schutzdurchgang.
// Gezeichnet wird ausschließlich von `withRenderedNote` (Kit, Bestellung 1): Host, Frist, Mermaid-Wartezeit, Ruhe-Regel und Fenstercheck liegen dort. Hier steht nur,
// was plugin-eigene Typen trägt: die Übersetzung der Kit-Befunde in `Finding`, die Prüfung der Einbettungen gegen die Menge und der Ablauf je Notiz.
import { parseLinktext, stripHeading, type App, type TFile } from 'obsidian';
import { CODES } from '../core/finding-codes';
import type { Finding, Recipe, RunControl, SetNote } from '../core/types';
import { prepareExportMarkdown } from '../vendor/kit/export-prepare';
import { guardExportTree, MAX_REPARSE_ROUNDS, type ExportGuardFinding } from '../vendor/kit/export-guard';
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
  return { severity: 'error', code: CODES.renderHiddenWindow, args: [] };
}

/** Kit-Befund des Zeichners als `Finding` mit Pfad der Notiz. */
export function translateRenderFinding(f: RenderNoteFinding, notePath: string): Finding {
  switch (f.kind) {
    case 'render-timeout':
      return { severity: 'warning', code: CODES.renderTimeout, args: [f.ms], notePath };
    case 'render-failed':
      return { severity: 'warning', code: CODES.renderFailed, args: [f.message], notePath };
    case 'mermaid-missing':
      return { severity: 'warning', code: CODES.renderMermaidMissing, args: [f.expected - f.drawn, f.expected], notePath };
    case 'not-settled':
      return {
        severity: 'warning',
        code: CODES.renderPlaceholder,
        args: [f.ms, f.placeholders],
        notePath,
      };
    case 'window-hidden':
      return { severity: 'error', code: CODES.renderHiddenWindow, args: [], notePath };
    case 'metadata-not-ready':
      // Das Zeichnen lief trotzdem: eine Abschnitts-Einbettung kann die ganze Notiz zeigen, die Seite ist vollständig, aber vielleicht nicht, was die Notiz meint.
      return { severity: 'warning', code: CODES.renderMetadataNotReady, args: [f.target, f.ms], notePath };
    case 'embed-missing':
      return { severity: 'warning', code: CODES.embedMissing, args: [f.target], notePath };
  }
}

/** Kit-Befund des Einfrierens als `Finding` mit Präfix `freeze.` und Pfad der Notiz. */
export function translateFreezeFinding(f: ExportFreezeFinding, notePath: string): Finding {
  switch (f.kind) {
    case 'canvas-failed':
      return { severity: 'warning', code: CODES.freezeCanvasFailed, args: [f.reason], notePath };
    case 'canvas-blank':
      return { severity: 'warning', code: CODES.freezeCanvasBlank, args: [f.width, f.height], notePath };
    case 'empty-block': {
      const where = f.hint === '' ? f.what : `${f.what}: ${f.hint}`;
      return { severity: 'warning', code: CODES.freezeEmptyBlock, args: [where], notePath };
    }
  }
}

const GUARD_KINDS: readonly ExportGuardFinding['kind'][] = ['element', 'attribute', 'declaration', 'svg', 'comment'];

/**
 * Kit-Befunde des Schutzdurchgangs, je Art zu einem `guard.removed` mit Zahl zusammengefasst (sonst wüchse die Befundliste mit jedem `onclick`).
 * Die Art `reparse` (Kit 0.89.0: der Baum ergab beim erneuten Lesen einen anderen) wird nicht gezählt, sondern einzeln gemeldet: `guard.reparse` als `error`, wenn die Wurzel nach den Runden
 * geleert wurde (`rootEmptied`: die Notiz ist nicht übernommen), sonst als `warning` (die Notiz steht in der Form, die ein Browser aus ihrem Text liest, der Inhalt kann abweichen).
 */
export function translateGuardFindings(found: readonly ExportGuardFinding[], notePath: string, rootEmptied = false): Finding[] {
  const out: Finding[] = [];
  for (const kind of GUARD_KINDS) {
    const hits = found.filter((f) => f.kind === kind);
    if (hits.length === 0) continue;
    const names = new Map<string, number>();
    for (const h of hits) {
      const label = h.name !== undefined ? `${h.element}[${h.name}]` : h.element;
      names.set(label, (names.get(label) ?? 0) + 1);
    }
    const list = Array.from(names, ([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(', ');
    out.push({
      // Eine abgelehnte Zeichnung fehlt in der Seite und verdient mehr als einen Hinweis.
      severity: kind === 'svg' ? 'warning' : 'info',
      code: CODES.guardRemoved,
      variant: kind,
      args: [hits.length, list],
      notePath,
    });
  }
  if (found.some((f) => f.kind === 'reparse')) {
    out.push(rootEmptied
      ? { severity: 'error', code: CODES.guardReparse, args: [MAX_REPARSE_ROUNDS], notePath }
      : { severity: 'warning', code: CODES.guardReparse, variant: 'changed', args: [], notePath });
  }
  return out;
}

/**
 * Schutzdurchgang (Kit-Bestellung 11, Spec 10.2 Schritt 5): Skripte, Ereignis-Attribute, `javascript:`-Ziele und Rahmen aus dem eingefrorenen Baum entfernen.
 * Der Kit-Durchgang verlangt einen Baum ohne Fenster; `root` ist der losgelöste Behälter, nicht der Host des Zeichners.
 */
function protectTree(root: HTMLElement, note: SetNote): Finding[] {
  const hadContent = root.childNodes.length > 0;
  const found = guardExportTree(root);
  // Eine Wurzel, die der Durchgang nach seinen Runden ganz geleert hat, ist nicht von einer Notiz zu unterscheiden, die er leer vorfand; deshalb nur mit Inhalt davor und einem `reparse`.
  return translateGuardFindings(found, note.path, hadContent && root.childNodes.length === 0);
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
function prepareMarkdown(note: SetNote, recipe: Recipe): { markdown: string; frames: ReadonlyMap<string, number>; restore: (root: HTMLElement) => Finding[] } {
  // `prepared.frames` zählt die Rahmen (seit obsidian-kit 0.108.0 je öffnender Marke einen); der Befund nennt aber auch die Namen, deshalb zählt der Ersatztext je Name mit, der nur für öffnende Marken verlangt wird.
  const frames = new Map<string, number>();
  const prepared = prepareExportMarkdown(note.body, {
    codeBlocks: recipe.blocks,
    frameText: (tag) => {
      frames.set(tag, (frames.get(tag) ?? 0) + 1);
      return `\\[${tag}\\]`;
    },
  });
  const restore = (root: HTMLElement): Finding[] => {
    const findings: Finding[] = [];
    const nodes = textNodes(root);
    for (const code of prepared.codes) {
      const hit = nodes.find((n) => n.parentNode !== null && n.data.trim() === code.placeholder);
      if (hit === undefined) {
        findings.push({
          severity: 'warning',
          code: CODES.renderPlaceholderLost,
          ...(code.lang === '' ? { args: [] } : { variant: 'lang', args: [code.lang] }),
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
  return { markdown: prepared.markdown, frames, restore };
}

/** Rohe Rahmen (`iframe`, `object`, …) ersetzt die Vorbehandlung vor dem Zeichnen durch einen Text wie `[iframe]`; der Leser der Ergebnisdatei soll den Verlust sehen (CORE-DATA-01). Je Notiz ein Befund mit der Zahl. */
export function frameReplacedFinding(frames: ReadonlyMap<string, number>, notePath: string): Finding {
  const total = Array.from(frames.values()).reduce((a, b) => a + b, 0);
  const list = Array.from(frames, ([tag, n]) => (n > 1 ? `${tag} ×${n}` : tag)).sort().join(', ');
  return {
    severity: 'info',
    code: CODES.prepareFrameReplaced,
    ...(total === 1 ? { variant: 'one' } : {}),
    args: total === 1 ? [list] : [total, list],
    notePath,
  };
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
      findings.push({ severity: 'warning', code: CODES.embedOutside, args: [target.path], notePath: note.path });
    }
    if (subpath !== '' && sectionMissing(app, target, subpath)) {
      findings.push({
        severity: 'warning',
        code: CODES.embedMissingSection,
        args: [target.path, subpath],
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
      if (prepared.frames.size > 0) findings.push(frameReplacedFinding(prepared.frames, note.path));
      findings.push(...checkEmbeds(app, rendered.root, note, deps.inSet));
      findings.push(...prepared.restore(rendered.root));
      // Einfrieren am angehängten Baum (der Canvas braucht seinen Inhalt), erst danach löst sich der Inhalt vom Host.
      const frozen = freezeRenderedDom(rendered.root, deps.freezePorts ?? { createEl: (tag) => createEl(tag) });
      // Eine Einbettung ohne Ziel (`mod-empty`) hat der Zeichner schon als `embed.missing` gemeldet; nicht noch einmal als leerer Block.
      const unreported = frozen.findings.filter((f) => !(f.kind === 'empty-block' && f.what === 'embed' && /\bmod-empty/.test(f.hint)));
      findings.push(...unreported.map((f) => translateFreezeFinding(f, note.path)));
      // Erst lösen, dann schützen: der Kit-Durchgang braucht einen Baum, der an keinem Fenster hängt.
      root.append(...Array.from(rendered.root.childNodes));
      findings.push(...protectTree(root, note));
      return { root, findings };
    },
  );
}
