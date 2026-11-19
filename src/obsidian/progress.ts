// Fortschritt mit Abbrechen für den Ablauf (Bauplan Task 13, Bestellung 14): macht aus `startExportProgress` (Kit) den `RunControl` des Kerns.
// Der Ablauf (Task 12, `runExport` und `checkExport`) kennt nur `RunControl`; Hinweis, Knopf und Laufzustand bleiben hier.
//   const run = startRunProgress({ total });
//   try {
//     const result = await runExport(plugin, scope, run.control);   // prüft `run.control.aborted` zwischen den Notizen und ruft `pause()`/`progress()`
//     if (run.control.aborted) …                                     // nichts schreiben
//     run.beginWriting();                                            // ab hier ist Abbrechen gesperrt
//     await writeExport(plugin, result, entryPath);
//   } catch (e) { failure = errorMessage(e); } finally { outcome = run.end(failure); }
import type { RunControl } from '../core/types';
import { getLang } from '../vendor/kit/i18n';
import {
  EXPORT_PROGRESS_STRINGS_DE,
  EXPORT_PROGRESS_STRINGS_EN,
  isExportCancelled,
  startExportProgress,
  type ExportProgressPorts,
  type ExportProgressStrings,
} from '../vendor/kit-obsidian/export-progress';

/** Wie der Lauf endete. `cancelled` gewinnt gegen einen Folgefehler (Kit `run-state`, Regel 1). */
export type ProgressOutcome = 'done' | 'cancelled' | 'failed';

export interface ExportProgressRun {
  /** Was der Kern liest: `aborted` folgt dem Abbrechen-Knopf, `pause()` gibt die Oberfläche frei, `progress` zeichnet die Anzeige. */
  readonly control: RunControl;
  /** Phase „Schreiben“: der Knopf ist aus, `control.aborted` ändert sich nicht mehr. Nach einem Abbruch ohne Wirkung. */
  beginWriting(): void;
  /** Schließt den Hinweis und räumt die Pause ab; mehrfach aufrufbar (der erste Aufruf zählt). `failure` ist der Fehlertext eines gescheiterten Laufs. */
  end(failure?: string): ProgressOutcome;
}

export interface RunProgressOptions {
  /** Anzahl der Notizen, wenn sie vor dem Lauf feststeht; sonst setzt der erste `progress`-Aufruf sie. */
  total?: number;
  /** Texte; Vorgabe nach der Sprache der Oberfläche. */
  strings?: ExportProgressStrings;
  /** Schrittweite von Textaktualisierung und Atempause in Millisekunden (Kit-Vorgabe 100). */
  everyMs?: number;
  /** Nur für Tests. */
  ports?: ExportProgressPorts;
}

function ignoreCancel(e: unknown): void {
  // Der Kern liest `aborted`; der Wurf des Kit-Haltepunkts hat hier keinen Empfänger.
  if (!isExportCancelled(e)) throw e;
}

export function startRunProgress(o: RunProgressOptions = {}): ExportProgressRun {
  const progress = startExportProgress({
    total: o.total ?? 0,
    strings: o.strings ?? (getLang() === 'de' ? EXPORT_PROGRESS_STRINGS_DE : EXPORT_PROGRESS_STRINGS_EN),
    ...(o.everyMs !== undefined ? { everyMs: o.everyMs } : {}),
    ...(o.ports !== undefined ? { ports: o.ports } : {}),
  });
  let outcome: ProgressOutcome | null = null;

  const control: RunControl = {
    get aborted() { return progress.cancelled; },
    pause: () => progress.checkpoint().catch(ignoreCancel),
    progress(done, total, label) {
      // Der Zustand wird sofort gesetzt (der Haltepunkt läuft bis zum ersten `await` synchron); die Atempause folgt von selbst.
      void progress.checkpoint({ done, total, label }).catch(ignoreCancel);
    },
  };

  return {
    control,
    beginWriting() {
      if (progress.cancelled) return;
      progress.setPhase('writing');
    },
    end(failure) {
      if (outcome !== null) return outcome;
      if (progress.cancelled) outcome = 'cancelled';
      else if (failure !== undefined) { progress.fail(failure); outcome = 'failed'; }
      else { progress.finish(); outcome = 'done'; }
      progress.close();
      return outcome;
    },
  };
}
