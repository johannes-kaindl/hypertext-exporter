// Befehle und Dateimenü des Exports (Bauplan Task 13 Step 2, UI-STANDARD §11). Die Befehle sind dünn: sie wählen Ordner oder Notiz und rufen den Ablauf über `ExportActions`;
// Notices zum Ergebnis und das Panel „Befunde“ bedient der Ablauf. `open-view` und `insert-recipe` bleiben in `main.ts`.
import { Notice, TFile, TFolder, type App, type Command, type EventRef, type TAbstractFile, type Menu } from 'obsidian';
import { t } from '../vendor/kit/i18n';
import type { ExportActions } from './actions';

/** Was die Befehle vom Plugin brauchen: der Ablauf (oder `null`) und das Öffnen der Ansicht auf einem Ordner. */
export interface CommandHost {
  /** `null`, solange der Ablauf (Task 12) fehlt. */
  actions(): ExportActions | null;
  /** Öffnet die Ansicht auf dem Panel „Export“; `folder` `null` lässt den Ordner, wie er ist. */
  showExport(folder: string | null): Promise<void>;
}

/** Der Teil von `Plugin`, den die Registrierung braucht (ein Test reicht ein Fake hinein). */
export interface CommandPlugin {
  app: App;
  addCommand(command: Command): unknown;
  registerEvent(ref: EventRef): void;
}

const ICON = 'file-output';

function folderOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/** Der Wurzelordner des Vaults heißt in Obsidian `/`; die Ansicht kennt ihn als leeren Pfad. */
function folderPath(folder: TFolder): string {
  return folder.path === '/' ? '' : folder.path;
}

export function registerExportCommands(plugin: CommandPlugin, host: CommandHost): void {
  const { app } = plugin;

  const withActions = (run: (actions: ExportActions) => Promise<void>): void => {
    const actions = host.actions();
    if (actions === null) { new Notice(t('notice.noRun')); return; }
    void run(actions);
  };

  /** `checkCallback` für Befehle, die an die aktive Markdown-Notiz gebunden sind. */
  const forActiveNote = (run: (actions: ExportActions, entryPath: string) => Promise<void>) => (checking: boolean): boolean => {
    const file = app.workspace.getActiveFile();
    if (file === null || file.extension !== 'md') return false;
    if (!checking) withActions((actions) => run(actions, file.path));
    return true;
  };

  plugin.addCommand({
    id: 'export-folder',
    name: t('cmd.exportFolder'),
    icon: ICON,
    callback: () => {
      const file = app.workspace.getActiveFile();
      void host.showExport(file === null ? null : folderOf(file.path));
    },
  });
  plugin.addCommand({
    id: 'export-current-note',
    name: t('cmd.exportNote'),
    icon: ICON,
    checkCallback: forActiveNote((actions, path) => actions.exportNote(path)),
  });
  plugin.addCommand({
    id: 'check-export',
    name: t('cmd.checkExport'),
    checkCallback: forActiveNote((actions, path) => actions.checkExport(path)),
  });
  plugin.addCommand({
    id: 'open-export',
    name: t('cmd.openExport'),
    checkCallback: forActiveNote((actions, path) => actions.openExport(path)),
  });

  plugin.registerEvent(app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
    if (file instanceof TFolder) {
      const folder = folderPath(file);
      menu.addItem((item) => item.setTitle(t('menu.exportFolder')).setIcon(ICON).onClick(() => { void host.showExport(folder); }));
    } else if (file instanceof TFile && file.extension === 'md') {
      const path = file.path;
      menu.addItem((item) => item.setTitle(t('menu.exportNote')).setIcon(ICON).onClick(() => { withActions((actions) => actions.exportNote(path)); }));
    }
  }));
}
