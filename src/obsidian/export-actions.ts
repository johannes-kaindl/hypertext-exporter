// Die Implementierung von `ExportActions` (Vertrag in `actions.ts`): verbindet Oberfläche und Ablauf. Wirft nie; bedient Notices, Fortschritt und das Panel „Befunde“.
// Folge je Export: `startRunProgress` → `runExport` → bei Abbruch `ok:false` → `beginWriting` → `writeExport` → `end` im `finally` → Notice → Befunde zeigen.
import { Notice, Platform, type App } from 'obsidian';
import { CODES } from '../core/finding-codes';
import { countFindings } from '../core/findings';
import { toResultFinding, type ResultFinding } from '../core/result-file';
import type { ExportResult, ExportScope, Finding } from '../core/types';
import { errorMessage } from '../vendor/kit/error-message';
import { t } from '../vendor/kit/i18n';
import { baseName } from '../vendor/kit/rel-path';
import { shareFile } from '../vendor/kit-obsidian/share-export';
import type { ExportActions } from './actions';
import { outputPaths, writeExport } from './output';
import { checkExport, runExport, scopeForEntry, type PipelineDeps, type PipelineHost } from './pipeline';
import { startRunProgress, type ExportProgressRun } from './progress';

/** Was die Aktionen vom Plugin brauchen: der Ablauf und das Zeigen der Befunde (öffnet die Ansicht). */
export interface ActionsHost extends PipelineHost {
  showFindings(findings: ResultFinding[]): Promise<void>;
}

/** Nähte für Tests. */
export interface ActionsDeps {
  /** Fortschritt; Vorgabe `startRunProgress`. */
  startProgress?: () => ExportProgressRun;
  pipeline?: PipelineDeps;
}

interface ResultFile { ok: boolean; path: string | null; findings: ResultFinding[] }

function readResult(json: string): ResultFile {
  return JSON.parse(json) as ResultFile;
}

/** Ein Lauf, der abgebrochen wurde, nachdem er schon eine Seite hatte: ohne Seite und nicht ok. */
function cancelled(result: ExportResult): ExportResult {
  const { html: _dropped, ...rest } = result;
  return { ...rest, ok: false };
}

interface AppWithDefaultApp { openWithDefaultApp?: (path: string) => Promise<void> }

export function createExportActions(host: ActionsHost, deps: ActionsDeps = {}): ExportActions {
  const startProgress = deps.startProgress ?? ((): ExportProgressRun => startRunProgress());

  /** Fängt jeden Ausnahmefall; die Methoden der Schnittstelle werfen nie. */
  const safely = async (work: () => Promise<void>): Promise<void> => {
    try { await work(); } catch (e) { new Notice(t('notice.failed', errorMessage(e))); }
  };

  const show = async (findings: ResultFinding[]): Promise<void> => {
    try { await host.showFindings(findings); } catch (e) { new Notice(t('notice.failed', errorMessage(e))); }
  };

  const exportScope = async (scope: ExportScope): Promise<void> => {
    const progress = startProgress();
    let failure: string | undefined;
    let findings: ResultFinding[] = [];
    let ok = false;
    let path: string | null = null;
    try {
      let result = await runExport(host, scope, progress.control, deps.pipeline);
      if (progress.control.aborted) result = cancelled(result);
      else progress.beginWriting();
      const entryPath = result.entryPath ?? scope.entryPath;
      if (entryPath === '') {
        // Es gibt keine Einstiegsnotiz, also keinen Ort für eine Ergebnisdatei.
        findings = result.findings.map((f) => toResultFinding(f, t));
      } else {
        const written = readResult(await writeExport(host, result, entryPath));
        findings = written.findings;
        ok = written.ok;
        path = written.path;
      }
    } catch (e) {
      failure = errorMessage(e);
      const failedFinding: Finding = { severity: 'error', code: CODES.exportFailed, args: [failure] };
      findings = [toResultFinding(failedFinding, t)];
      // Eine alte Ergebnisdatei mit ok:true darf nach einem gescheiterten Lauf nicht liegen bleiben.
      if (scope.entryPath !== '') {
        try {
          await writeExport(host, { ok: false, fileName: baseName(scope.entryPath), findings: [failedFinding], stats: { notes: 0, bytes: 0, mediaBytes: {} } }, scope.entryPath);
        } catch { /* writeExport wirft nie; sicher ist sicher */ }
      }
    } finally {
      const outcome = progress.end(failure);
      if (outcome === 'cancelled') new Notice(t('notice.cancelled'));
      else if (failure !== undefined) new Notice(t('notice.failed', failure));
      else if (!ok) new Notice(t('notice.errors', countFindings(findings).errors));
      else if (path !== null) new Notice(t('notice.done', path));
    }
    await show(findings);
  };

  return {
    exportFolder: (folder, entryPath) => safely(() => exportScope({ kind: 'folder', folder, entryPath: entryPath ?? '' })),

    exportNote: (entryPath) => safely(() => exportScope(scopeForEntry(host.app, entryPath))),

    checkExport: (entryPath) => safely(async () => {
      if (host.settings.destination === 'share') { new Notice(t('check.nothing')); return; }
      const paths = outputPaths(host, entryPath);
      if (paths === null || !(await host.app.vault.adapter.exists(paths.html))) { new Notice(t('notice.noExport')); return; }
      const progress = startProgress();
      let failure: string | undefined;
      let check: Awaited<ReturnType<typeof checkExport>> | null = null;
      try {
        check = await checkExport(host, scopeForEntry(host.app, entryPath), progress.control, deps.pipeline);
      } catch (e) {
        failure = errorMessage(e);
      } finally {
        progress.end(failure);
      }
      if (check === null) { new Notice(t('notice.failed', failure ?? '')); return; }
      switch (check.status) {
        case 'same': new Notice(t('check.same')); break;
        case 'differs': new Notice(t('check.differs', check.firstDiff ?? 0)); break;
        case 'no-export': new Notice(t('notice.noExport')); break;
        case 'nothing-to-compare': new Notice(t('check.nothing')); break;
        case 'cancelled': new Notice(t('notice.cancelled')); break;
        case 'failed': new Notice(t('check.failed')); break;
      }
      await show(check.findings.map((f) => toResultFinding(f, t)));
    }),

    openExport: (entryPath) => safely(async () => {
      const paths = outputPaths(host, entryPath);
      const adapter = host.app.vault.adapter;
      if (paths === null || !(await adapter.exists(paths.html))) { new Notice(t('notice.noExport')); return; }
      await openFile(host.app, paths.html);
    }),
  };
}

/** Am Desktop die Standard-App, am Handy das Teilen-Blatt (beides Kit `share-export`). */
async function openFile(app: App, path: string): Promise<void> {
  if (Platform.isMobile) {
    const bytes = new Uint8Array(await app.vault.adapter.readBinary(path));
    await shareFile(app, bytes, baseName(path), 'text/html', path);
    return;
  }
  const open = (app as unknown as AppWithDefaultApp).openWithDefaultApp;
  if (typeof open === 'function') await open.call(app, path);
}
