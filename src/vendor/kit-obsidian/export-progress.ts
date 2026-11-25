// vendored from obsidian-kit@0.109.1, src/obsidian/export-progress.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Fortschritt mit Abbrechen für Exporte (Welle 36, h2b, Bestellung 14 der Design-Linie hypertext; gehoben aus obsidian-paperize@0.6.2 `src/obsidian/export-progress.ts` `startExportProgress`, auf code-kit `run-state` und `cooperative-yield`).
//
// Ein Hinweis (`Notice`, ohne Frist) mit Fortschrittstext und Abbrechen-Knopf, ein Laufzustand dahinter und ein Haltepunkt je Notiz:
//   const progress = startExportProgress({ total: notes.length });
//   try {
//     for (const [i, note] of notes.entries()) { await progress.checkpoint({ done: i, label: note.basename }); … rendern … }
//     progress.setPhase("writing");              // ab hier ist Abbrechen gesperrt (Punkt ohne Wiederkehr)
//     await writeExportOutput(…);
//     progress.finish();
//   } catch (e) { if (isExportCancelled(e)) … else progress.fail(errorMessage(e)); } finally { progress.close(); }
//
// Vertrag:
// - **`checkpoint()` wirft `ExportCancelled`, wenn der Nutzer abgebrochen hat** (vor und nach der Atempause: ein Klick kommt während der Pause an, nicht mitten in einem Schritt). Ein laufender Schritt (Rendern, Bild-Abruf) wird nicht
//   unterbrochen; sein Ergebnis verwirft der Aufrufer, indem er den Wurf nicht abfängt. Die Zeitgrenze eines Schritts bleibt `withTimeout`/die Frist von `withRenderedNote`. Abgebrochen wird VOR dem Schreiben: der Aufrufer ruft den
//   Schreiber erst nach dem letzten Haltepunkt, also liegt nach einem Abbruch keine Ausgabedatei und keine halbe Datei.
// - **Die Atempause gehört dazu.** Eine Schleife ohne Pause friert Obsidian ein; ein Abbrechen-Knopf, der nie einen Klick zugestellt bekommt, ist Dekoration. `checkpoint()` meldet Fortschritt und gibt die Pause zeitgetaktet (`everyMs`,
//   Vorgabe 100), über `createMacrotaskPause` (ein Zeitgeber würde in einem Fenster im Hintergrund auf bis zu eine Sekunde gedrosselt).
// - **Zustandsfolge:** `run-state` (`idle`, `running`, `done`, `aborted`, `failed`). Nur ein laufender Zustand verlässt sich: ein Folgefehler nach dem Abbruch überschreibt ihn nicht (`fail` nach `abort` bleibt `aborted`), ein fertiger
//   Lauf wird nicht nachträglich `failed`. Die Phase `writing` ist nicht abbrechbar (`abortableIn`): der Knopf ist dort gesperrt, ein Klick ändert nichts.
// - **Ports für die Tests:** der Hinweis (`ProgressNoticePort`), die Pause und die Uhr kommen von außen; ohne Angabe die echten.
// - Die Texte gehören dem Aufrufer oder den Vorgaben `EXPORT_PROGRESS_STRINGS_EN` und `_DE`.
// Unterschiede zum Träger, mit Grund: `checkpoint` ist async (die Pause), nimmt Fortschritt entgegen und der Laufzustand ist ein `run-state` statt eines `cancelled`-Flags; `done()` heißt `close()` und ist idempotent; der Träger hängt den Hinweis
// ans Menü seines Plugins (`t('notice.exporting')`), hier kommen die Texte als Parameter.
import { Notice } from "obsidian";
import { createCooperativeYield, type NowPort } from "../kit/cooperative-yield";
import { makeRunState, type RunState } from "../kit/run-state";
import { createMacrotaskPause } from "../kit/macrotask-pause";

export type ExportPhase = "preparing" | "rendering" | "writing";
export interface ExportRunning { done: number; total: number; label: string }
export type ExportRunState = RunState<ExportPhase, ExportRunning, object>;

/** Der Laufzustand eines Exports: `writing` ist der Punkt ohne Wiederkehr. Auch einzeln nutzbar (reine Übergänge). */
export const exportRun = makeRunState<ExportPhase, ExportRunning, object>({ abortableIn: (p) => p !== "writing" });

export class ExportCancelled extends Error {
  constructor() { super("export cancelled"); this.name = "ExportCancelled"; }
}
export function isExportCancelled(e: unknown): e is ExportCancelled { return e instanceof ExportCancelled; }

export interface ExportProgressStrings {
  /** Der Text im Hinweis, während es läuft. */
  running(p: { done: number; total: number; label: string; phase: ExportPhase }): string;
  /** Der Text in der Schreibphase (Abbrechen ist dort gesperrt). */
  writing: string;
  cancel: string;
}
export const EXPORT_PROGRESS_STRINGS_EN: ExportProgressStrings = {
  running: (p) => (p.total > 0 ? `Exporting… ${String(p.done)}/${String(p.total)}${p.label === "" ? "" : ` · ${p.label}`}` : "Exporting…"),
  writing: "Writing the file…",
  cancel: "Cancel",
};
export const EXPORT_PROGRESS_STRINGS_DE: ExportProgressStrings = {
  running: (p) => (p.total > 0 ? `Exportiere… ${String(p.done)}/${String(p.total)}${p.label === "" ? "" : ` · ${p.label}`}` : "Exportiere…"),
  writing: "Schreibe die Datei…",
  cancel: "Abbrechen",
};

/** Der Hinweis hinter dem Baustein. Echt: `Notice` ohne Frist mit einem Knopf; im Test eine Attrappe. */
export interface ProgressNoticePort {
  setText(text: string): void;
  setCancelEnabled(enabled: boolean): void;
  hide(): void;
}
export interface ExportProgressPorts {
  openNotice(text: string, cancelLabel: string, onCancel: () => void): ProgressNoticePort;
  /** Die Atempause; `close` räumt ihren Kanal ab. */
  pause: { pause(): Promise<void>; close(): void };
  clock: NowPort;
}

export function obsidianProgressPorts(): ExportProgressPorts {
  return {
    openNotice(text, cancelLabel, onCancel) {
      const notice = new Notice("", 0);
      const host = notice.messageEl;
      const line = host.createDiv({ text });
      const button = host.createEl("button", { text: cancelLabel });
      button.addEventListener("click", onCancel);
      return {
        setText: (t) => { line.setText(t); },
        setCancelEnabled: (on) => { button.disabled = !on; },
        hide: () => { notice.hide(); },
      };
    },
    pause: createMacrotaskPause(),
    clock: Date,
  };
}

export interface ExportProgressOptions {
  /** Anzahl der Schritte (Notizen); 0 oder fehlend: der Text zeigt keine Zahl. */
  total?: number;
  strings?: ExportProgressStrings;
  /** Schrittweite von Textaktualisierung und Atempause in Millisekunden. Vorgabe 100. */
  everyMs?: number;
  ports?: ExportProgressPorts;
}

export interface ExportProgress {
  /** Der Laufzustand (`idle` gibt es hier nie: der Lauf beginnt mit dem Aufruf von `startExportProgress`). */
  readonly state: ExportRunState;
  readonly cancelled: boolean;
  /** Haltepunkt: setzt Fortschritt, gibt die Oberfläche frei (zeitgetaktet) und wirft `ExportCancelled`, wenn abgebrochen wurde. Ein fehlendes Feld bleibt, wie es war. */
  checkpoint(info?: { done?: number; total?: number; label?: string }): Promise<void>;
  /** Wechselt die Phase. `writing` sperrt das Abbrechen (Knopf aus, Text „Schreibe…“). Wirft `ExportCancelled`, wenn schon abgebrochen wurde. */
  setPhase(phase: ExportPhase): void;
  /** Der Lauf ist fertig. Schließt den Hinweis NICHT (das tut `close`). Nach einem Abbruch ohne Wirkung. */
  finish(): void;
  /** Der Lauf ist gescheitert. Nach einem Abbruch ohne Wirkung (der Abbruch bleibt der Befund). */
  fail(message: string): void;
  /** Hinweis schließen und die Atempause abräumen; immer im `finally`, mehrfach aufrufbar. */
  close(): void;
}

export function startExportProgress(o: ExportProgressOptions = {}): ExportProgress {
  const strings = o.strings ?? EXPORT_PROGRESS_STRINGS_EN;
  const ports = o.ports ?? obsidianProgressPorts();
  let state: ExportRunState = exportRun.begin("preparing", { done: 0, total: o.total ?? 0, label: "" });
  let closed = false;

  const text = (): string => {
    if (state.status !== "running") return strings.running({ done: 0, total: 0, label: "", phase: "preparing" });
    return state.phase === "writing" ? strings.writing : strings.running({ done: state.done, total: state.total, label: state.label, phase: state.phase });
  };
  const notice = ports.openNotice(text(), strings.cancel, () => {
    state = exportRun.abort(state);
    if (state.status === "aborted") { notice.hide(); closed = true; }
  });
  const pacer = createCooperativeYield({ yieldToUi: () => ports.pause.pause(), everyMs: o.everyMs ?? 100, clock: ports.clock });
  const throwIfCancelled = (): void => { if (state.status === "aborted") throw new ExportCancelled(); };
  const paint = (): void => { if (!closed) notice.setText(text()); };

  return {
    get state() { return state; },
    get cancelled() { return state.status === "aborted"; },
    async checkpoint(info = {}) {
      throwIfCancelled();
      const patch: Partial<ExportRunning> = {};
      if (info.done !== undefined) patch.done = info.done;
      if (info.total !== undefined) patch.total = info.total;
      if (info.label !== undefined) patch.label = info.label;
      state = exportRun.progress(state, patch);
      await pacer.tick(paint);
      throwIfCancelled();   // ein Klick kommt während der Pause an
    },
    setPhase(phase) {
      throwIfCancelled();
      state = exportRun.progress(state, { phase });
      if (phase === "writing") notice.setCancelEnabled(false);
      paint();
    },
    finish() { state = exportRun.finish(state, {}); },
    fail(message) { state = exportRun.fail(state, message); },
    close() {
      if (!closed) { closed = true; notice.hide(); }
      ports.pause.close();
    },
  };
}
