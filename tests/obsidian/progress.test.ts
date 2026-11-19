import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../src/vendor/kit/i18n';
import type { ExportProgressPorts, ProgressNoticePort } from '../../src/vendor/kit-obsidian/export-progress';
import { startRunProgress } from '../../src/obsidian/progress';

interface FakeNotice extends ProgressNoticePort {
  text: string;
  cancelEnabled: boolean;
  hidden: boolean;
  cancelLabel: string;
  click(): void;
}

function fakePorts(): { ports: ExportProgressPorts; notice: () => FakeNotice; pauses: () => number; pauseClosed: () => boolean } {
  let notice: FakeNotice | null = null;
  let pauses = 0;
  let pauseClosed = false;
  let now = 0;
  const ports: ExportProgressPorts = {
    openNotice(text, cancelLabel, onCancel) {
      notice = {
        text,
        cancelLabel,
        cancelEnabled: true,
        hidden: false,
        setText(t) { this.text = t; },
        setCancelEnabled(on) { this.cancelEnabled = on; },
        hide() { this.hidden = true; },
        click() { if (this.cancelEnabled) onCancel(); },
      };
      return notice;
    },
    pause: { pause: () => { pauses++; return Promise.resolve(); }, close: () => { pauseClosed = true; } },
    // Jeder Aufruf der Uhr vergeht 1 ms; mit everyMs 0 ist jede Runde fällig.
    clock: { now: () => ++now },
  };
  return {
    ports,
    notice: () => { if (notice === null) throw new Error('kein Hinweis geöffnet'); return notice; },
    pauses: () => pauses,
    pauseClosed: () => pauseClosed,
  };
}

afterEach(() => { setLang('en'); });

describe('startRunProgress', () => {
  it('öffnet einen Hinweis mit Abbrechen-Knopf; aborted ist anfangs false', () => {
    const f = fakePorts();
    const run = startRunProgress({ total: 300, ports: f.ports, everyMs: 0 });
    expect(run.control.aborted).toBe(false);
    expect(f.notice().cancelLabel).toBe('Cancel');
    expect(f.notice().text).toBe('Exporting… 0/300');
    run.end();
  });

  it('der Abbrechen-Knopf setzt aborted, und end meldet cancelled', () => {
    const f = fakePorts();
    const run = startRunProgress({ total: 300, ports: f.ports, everyMs: 0 });
    f.notice().click();
    expect(run.control.aborted).toBe(true);
    expect(run.end()).toBe('cancelled');
  });

  it('progress landet in der Anzeige (Zahl, Gesamt, Name)', () => {
    const f = fakePorts();
    const run = startRunProgress({ ports: f.ports, everyMs: 0 });
    run.control.progress(3, 300, 'Notiz 3');
    expect(f.notice().text).toBe('Exporting… 3/300 · Notiz 3');
    run.control.progress(4, 300, '');
    expect(f.notice().text).toBe('Exporting… 4/300');
    run.end();
  });

  it('die Texte folgen der Sprache der Oberfläche', () => {
    setLang('de');
    const f = fakePorts();
    const run = startRunProgress({ total: 10, ports: f.ports, everyMs: 0 });
    run.control.progress(2, 10, 'a');
    expect(f.notice().text).toBe('Exportiere… 2/10 · a');
    expect(f.notice().cancelLabel).toBe('Abbrechen');
    run.end();
  });

  it('pause gibt die Hauptschleife frei und wirft auch nach dem Abbrechen nicht', async () => {
    const f = fakePorts();
    const run = startRunProgress({ ports: f.ports, everyMs: 0 });
    await run.control.pause();
    expect(f.pauses()).toBe(1);
    f.notice().click();
    await expect(run.control.pause()).resolves.toBeUndefined();
    expect(run.control.aborted).toBe(true);
    run.end();
  });

  it('progress nach dem Abbrechen wirft nicht (kein offenes Promise mit Fehler)', async () => {
    const f = fakePorts();
    const run = startRunProgress({ ports: f.ports, everyMs: 0 });
    f.notice().click();
    expect(() => { run.control.progress(5, 10, 'x'); }).not.toThrow();
    await Promise.resolve();
    run.end();
  });

  it('beginWriting sperrt das Abbrechen und zeigt den Schreibtext', () => {
    const f = fakePorts();
    const run = startRunProgress({ total: 3, ports: f.ports, everyMs: 0 });
    run.beginWriting();
    expect(f.notice().cancelEnabled).toBe(false);
    expect(f.notice().text).toBe('Writing the file…');
    f.notice().click();
    expect(run.control.aborted).toBe(false);
    expect(run.end()).toBe('done');
  });

  it('end räumt auf: Hinweis zu, Pause geschlossen, mehrfach aufrufbar', () => {
    const f = fakePorts();
    const run = startRunProgress({ ports: f.ports, everyMs: 0 });
    expect(run.end()).toBe('done');
    expect(f.notice().hidden).toBe(true);
    expect(f.pauseClosed()).toBe(true);
    expect(run.end()).toBe('done');
  });

  it('end mit Fehlertext meldet failed; ein Abbruch bleibt cancelled', () => {
    const a = fakePorts();
    expect(startRunProgress({ ports: a.ports, everyMs: 0 }).end('kaputt')).toBe('failed');
    const b = fakePorts();
    const run = startRunProgress({ ports: b.ports, everyMs: 0 });
    b.notice().click();
    expect(run.end('Folgefehler')).toBe('cancelled');
  });
});
