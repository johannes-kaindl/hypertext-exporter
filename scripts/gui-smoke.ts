/**
 * GUI-Smoke — faehrt die Pruefpunkte gegen ein **laufendes** Obsidian (CORE-TEST-02 b).
 *
 * Bruecke, Vault-Aufbau und Bilanz kommen zentral aus dem Dach (`obsidian-plugins/tools/obsidian-cdp/`);
 * dieser Treiber importiert sie und vendort nichts. Im Repo bleiben nur Pruefpunkte und Fixture.
 *
 * Lauf: `tools/obsidian-cdp/messlauf.sh` (Dach, README § Messlauf in einem Aufruf) startet die Zweitinstanz,
 * baut und raeumt auf; das Rezept steht nur dort. Der Lock steht davor, mit `--exclusive all` (kein Canvas, kein WebGL).
 * Fuer diesen Treiber: `REPO=hypertext-exporter VAULT=hypertext-exporter-smoke SETUP_MIT_PORT=1`.
 *
 * Staging-Vault: `hypertext-exporter-smoke` (nicht `hypertext-exporter`; der gehoert der Messung und traegt private Daten).
 * `--setup` stellt ihn aus `tests/fixtures/` her: `beispiel/` und `ausserhalb/` als Notizen, `obsidian/` als Vault-Konfiguration.
 *
 * Weitere Schalter:
 *   --list         Vertrag anzeigen
 *   --gegenprobe   schaltet das Plugin vor P1 ab; P1 muss dann rot sein (Beleg, dass der Punkt etwas misst)
 *
 * `--port` ist Pflicht (auch als `CDP_PORT` lesbar): ohne Angabe bricht der Treiber ab, statt auf die reguläre
 * Instanz (9222) zu greifen. Je Messlauf ein frischer Prozess.
 *
 * Bilanz in vier Zustaenden (`bilanz.ts`): gruen, rot, uebersprungen, nichts gemessen. `PUNKTE` ist der Nenner.
 *
 * Pruefpunkte P2 bis P6 (Task 13): sechs Befehle registriert, Export des Beispielordners ueber den Befehl, zweiter Lauf
 * byte-gleich, Abbruch bei Notiz 3 von 300, `Check HTML export` meldet gleich. Mit `--gegenprobe` laeuft nur P1 (rot erwartet).
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, cwd, env } from "node:process";

import {
  attachTo,
  beimAbbruch,
  bereiteInstanzVor,
  clearNotices,
  clickReal,
  closeExtraLeaves,
  istAbgebrochen,
  ladePluginNeu,
  pollUntil,
  requireVisible,
  type Cdp,
} from "../../tools/obsidian-cdp/cdp.js";
import { createBilanz, parseArgs, runDriver, Vorbedingung } from "../../tools/obsidian-cdp/bilanz.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "hypertext-exporter";
const PLUGIN_ID = "hypertext-exporter";
/** Eigener Staging-Vault; der Filter in `attachTo` haengt an diesem Namen. */
const VAULT_NAME = `${REPO_NAME}-smoke`;
/** Pflicht: `--port` oder `CDP_PORT`; gesetzt in `main()`. Kein Default 9222 (reguläre Instanz). */
let PORT = 0;

/** Soll-Liste (Nenner der Bilanz). */
const PUNKTE = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;

/** Alle Befehle des Plugins (UI-STANDARD §11, Bauplan Task 13 Step 2). */
const BEFEHLE = ["export-folder", "export-current-note", "check-export", "open-export", "insert-recipe", "open-view"] as const;
const EINSTIEG = "beispiel/beispiel.md";
const AUSGABE_HTML = "beispiel/beispiel.html";
const AUSGABE_JSON = "beispiel/beispiel.export.json";
/** Abbruch-Fall: Ordner mit Einstiegsnotiz (Block `hypertext:`) und so vielen Notizen insgesamt. */
const ABBRUCH_ORDNER = "abbruch";
const ABBRUCH_EINSTIEG = `${ABBRUCH_ORDNER}/00 Start.md`;
const ABBRUCH_HTML = `${ABBRUCH_ORDNER}/00 Start.html`;
const ABBRUCH_JSON = `${ABBRUCH_ORDNER}/00 Start.export.json`;
const ABBRUCH_NOTIZEN = 300;
const ABBRUCH_AB = 3;

const REPO_ROOT = cwd();
const FIXTURES_DIR = join(REPO_ROOT, "tests", "fixtures");

/** Version laut `manifest.json` des Repos; P1 vergleicht die geladene Version damit, nicht mit einer zweiten Zahl im Treiber. */
function erwarteteVersion(): string {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "manifest.json"), "utf8")) as { version?: string };
  if (typeof manifest.version !== "string") throw new Error("manifest.json traegt keine Version.");
  return manifest.version;
}

function zeigeVertrag(): void {
  console.log(`Pruefpunkte — ${PUNKTE.length}\n`);
  console.log(`  P1   Plugin ${PLUGIN_ID} geladen, Version laut manifest.json (heute ${erwarteteVersion()})`);
  console.log(`  P2   alle sechs Befehle registriert (${BEFEHLE.join(", ")})`);
  console.log(`  P3   Befehl export-current-note auf ${EINSTIEG}: ${AUSGABE_HTML} und ${AUSGABE_JSON} da, Ergebnisdatei ok:true, jedes href="#…" der Seite hat ein Ziel`);
  console.log("  P4   zweiter Lauf: Seite und Ergebnisdatei SHA-256-gleich zum ersten");
  console.log(`  P5   Abbruch bei Notiz >= 3 von ${ABBRUCH_NOTIZEN}: Knopf der Fortschrittsanzeige, danach keine neue HTML-Datei, vorhandene SHA-256-gleich, Ergebnisdatei ok:false`);
  console.log("  P6   Befehl check-export auf dem Beispiel meldet \"gleich\"");
}

/** Staging-Vault aus `tests/fixtures/` herstellen. `buildVault` erwartet `notes/` und `obsidian/`; die Notizen
 *  liegen hier als `beispiel/` und `ausserhalb/` nebeneinander, deshalb wird der Fixture-Ort kurz zusammengesetzt. */
function setup(): void {
  const vaultDir = stagingVaultDir(VAULT_NAME);
  const arbeit = mkdtempSync(join(tmpdir(), "ht-smoke-fixture-"));
  try {
    mkdirSync(join(arbeit, "notes"));
    cpSync(join(FIXTURES_DIR, "beispiel"), join(arbeit, "notes", "beispiel"), { recursive: true });
    cpSync(join(FIXTURES_DIR, "ausserhalb"), join(arbeit, "notes", "ausserhalb"), { recursive: true });
    cpSync(join(FIXTURES_DIR, "obsidian"), join(arbeit, "obsidian"), { recursive: true });
    const log = buildVault({
      repoRoot: REPO_ROOT,
      vaultDir,
      fixtureDir: arbeit,
      pluginId: PLUGIN_ID,
      pluginFiles: ["main.js", "manifest.json"],
    });
    console.log(`Staging-Vault: ${vaultDir}`);
    for (const zeile of log) console.log(`  ${zeile}`);
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
  console.log(
    "\nNaechster Schritt: Zweitinstanz mit eigenem Profil und Port auf diesen Vault starten (`messlauf.sh`, Dateikopf).\n" +
    `Danach: npm run smoke:gui -- --port ${PORT}`,
  );
}

interface PluginStand {
  da: boolean;
  aktiv: boolean;
  manifestVersion: string | null;
  instanzVersion: string | null;
}


interface ErgebnisDatei { ok: boolean; path: string | null; errors: number; warnings: number; infos: number }

function befehl(id: string): string {
  return `${PLUGIN_ID}:${id}`;
}

/** Eine vorhandene Notiz im Hauptbereich oeffnen und aktiv machen (die Befehle arbeiten auf der aktiven Notiz). */
async function oeffne(cdp: Cdp, pfad: string): Promise<void> {
  const ok = await cdp.evaluate<boolean>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
    if (!file) return false;
    const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit) ?? app.workspace.getLeaf(true);
    await leaf.openFile(file);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 200));
    return app.workspace.getActiveFile()?.path === ${JSON.stringify(pfad)};
  `);
  if (!ok) throw new Vorbedingung(`Notiz ${pfad} liess sich nicht oeffnen`);
}

/** Befehl ueber die Befehlspalette-Schnittstelle ausfuehren; `false`, wenn er nicht verfuegbar ist (checkCallback). */
function fuehreAus(cdp: Cdp, id: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`return app.commands.executeCommandById(${JSON.stringify(befehl(id))}) === true;`);
}

/** SHA-256 einer Vault-Datei (hex) oder `null`, wenn sie fehlt. */
function sha(cdp: Cdp, pfad: string): Promise<string | null> {
  return cdp.evaluate<string | null>(`
    const a = app.vault.adapter;
    if (!(await a.exists(${JSON.stringify(pfad)}))) return null;
    const d = await crypto.subtle.digest("SHA-256", await a.readBinary(${JSON.stringify(pfad)}));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  `);
}

function mtime(cdp: Cdp, pfad: string): Promise<number | null> {
  return cdp.evaluate<number | null>(`
    const st = await app.vault.adapter.stat(${JSON.stringify(pfad)});
    return st ? st.mtime : null;
  `);
}

function liesJson(cdp: Cdp, pfad: string): Promise<ErgebnisDatei | null> {
  return cdp.evaluate<ErgebnisDatei | null>(`
    const a = app.vault.adapter;
    if (!(await a.exists(${JSON.stringify(pfad)}))) return null;
    try { return JSON.parse(await a.read(${JSON.stringify(pfad)})); } catch { return null; }
  `);
}

/** Wartet, bis `pfad` neuer ist als `seit` (mtime); die Ergebnisdatei wird nach der Seite geschrieben und zeigt das Ende eines Laufs an. */
async function warteAufNeuere(cdp: Cdp, pfad: string, seit: number | null, was: string): Promise<void> {
  const da = await pollUntil<boolean>(cdp, `
    const st = await app.vault.adapter.stat(${JSON.stringify(pfad)});
    return Boolean(st) && st.mtime > ${seit ?? 0};
  `, 60_000, 200);
  if (!da) throw new Vorbedingung(`${was}: ${pfad} wurde nicht neu geschrieben (60 s)`);
}

interface LinkStand { anker: number; ohneZiel: string[] }

/** Jeder `href="#…"` der Seite braucht ein Element mit dieser `id` (oder einen `a[name]`). */
function pruefeAnker(cdp: Cdp, pfad: string): Promise<LinkStand> {
  return cdp.evaluate<LinkStand>(`
    const html = await app.vault.adapter.read(${JSON.stringify(pfad)});
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ids = new Set([...doc.querySelectorAll("[id]")].map((e) => e.id).concat([...doc.querySelectorAll("a[name]")].map((e) => e.getAttribute("name"))));
    const links = [...doc.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")).filter((h) => h.length > 1);
    const ziel = (h) => { let x = h.slice(1); try { x = decodeURIComponent(x); } catch {} return x; };
    return { anker: links.length, ohneZiel: [...new Set(links.filter((h) => !ids.has(ziel(h))))] };
  `);
}

/** Der Abbruch-Fall im Staging-Vault: Einstieg mit Block, 299 kurze Notizen, eine HTML-Platzhalterdatei und eine alte Ergebnisdatei `ok:true`. */
async function legeAbbruchFallAn(cdp: Cdp): Promise<void> {
  await cdp.evaluate<boolean>(`
    const a = app.vault.adapter;
    if (!(await a.exists(${JSON.stringify(ABBRUCH_ORDNER)}))) await app.vault.createFolder(${JSON.stringify(ABBRUCH_ORDNER)});
    const schreibe = async (pfad, text) => {
      const f = app.vault.getAbstractFileByPath(pfad);
      if (f) await app.vault.modify(f, text); else await app.vault.create(pfad, text);
    };
    await schreibe(${JSON.stringify(ABBRUCH_EINSTIEG)}, "---\\nhypertext:\\n  version: 1\\n---\\n\\n# Start\\n\\nEinstieg des Abbruch-Falls.\\n");
    for (let i = 1; i < ${ABBRUCH_NOTIZEN}; i++) {
      const nr = String(i).padStart(3, "0");
      await schreibe(${JSON.stringify(ABBRUCH_ORDNER)} + "/n" + nr + ".md", "# Notiz " + nr + "\\n\\nKurzer Text " + nr + ".\\n");
    }
    await a.write(${JSON.stringify(ABBRUCH_HTML)}, "<!-- vorhandene Ausgabe, darf der Abbruch nicht aendern -->\\n");
    await a.write(${JSON.stringify(ABBRUCH_JSON)}, JSON.stringify({ ok: true, path: ${JSON.stringify(ABBRUCH_HTML)}, errors: 0, warnings: 0, infos: 0, findings: [] }) + "\\n");
    return true;
  `);
}

const KNOPF_ABBRECHEN = `[...(activeDocument ?? document).querySelectorAll(".notice button")].find((b) => b.textContent.trim() === "Cancel")`;

/** Wartet, bis die Fortschrittsanzeige Notiz `ab` oder mehr meldet („Exporting… 3/300 · …“), und liefert die Zahl. */
async function warteAufNotiz(cdp: Cdp, ab: number): Promise<number | null> {
  return pollUntil<number>(cdp, `
    for (const n of (activeDocument ?? document).querySelectorAll(".notice")) {
      const m = /(\\d+)\\/(\\d+)/.exec(n.textContent ?? "");
      const knopf = [...n.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel");
      if (m && knopf && Number(m[2]) >= 100 && Number(m[1]) >= ${ab}) return Number(m[1]);
    }
    return null;
  `, 60_000, 25);
}

async function meldungenMit(cdp: Cdp, muster: string): Promise<string | null> {
  return pollUntil<string>(cdp, `
    for (const n of (activeDocument ?? document).querySelectorAll(".notice")) {
      const text = (n.textContent ?? "").trim();
      if (${muster}.test(text)) return text;
    }
    return null;
  `, 60_000, 200);
}

async function lauf(gegenprobe: boolean): Promise<void> {
  const cdp = await attachTo("workspace", PORT, VAULT_NAME);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Fenster fuer Vault "${VAULT_NAME}" auf Port ${PORT}. ` +
      "Laeuft die Zweitinstanz (Profil, Port, Vault in obsidian.json — siehe Dateikopf)?",
    );
  }

  const konsole: string[] = [];
  const bilanz = createBilanz({ punkte: PUNKTE });
  let abgeschaltet = false;

  // Die Gegenprobe schaltet das Plugin ab; der Normalweg (`finally`) und ein Abbruch stellen es mit demselben Schritt wieder her.
  const cleanupState = async (): Promise<void> => {
    if (!abgeschaltet) return;
    await cdp.evaluate(`await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)}); return true;`);
    abgeschaltet = false;
  };
  const zustand = beimAbbruch(cleanupState, "Plugin nach der Gegenprobe wieder einschalten");

  try {
    await cdp.mitschnitt((zeile) => konsole.push(zeile));
    await requireVisible(cdp);
    // Vertrauensdialog, Restricted Mode und Plugin-Ladung erledigt die Bruecke (frisches Profil).
    const instanz = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: VAULT_NAME, sprache: "en" });
    console.log(`Instanz vorbereitet: ${instanz.hinweis}`);
    await closeExtraLeaves(cdp);

    // Herkunft und Frische des Builds im Vault gegen den Repo-Stand (CORE-TEST-08 a), dann Neuladen.
    const neu = await ladePluginNeu(cdp, PLUGIN_ID, { repoMainJs: join(REPO_ROOT, "main.js") });
    if (!neu.geladen) throw new Error(`Plugin ${PLUGIN_ID} nicht aktiv — ${neu.hinweis}`);
    if (!neu.aktuell) throw new Error(neu.hinweis);
    console.log(`${neu.hinweis}\n`);

    if (gegenprobe) {
      abgeschaltet = true;
      await cdp.evaluate(`await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)}); return true;`);
      console.log("Gegenprobe: Plugin abgeschaltet, P1 muss rot sein.");
    }

    await bilanz.punkt("P1", async () => {
      const erwartet = erwarteteVersion();
      const stand = await cdp.evaluate<PluginStand>(`
        const id = ${JSON.stringify(PLUGIN_ID)};
        const plugin = app.plugins.plugins[id];
        return {
          da: Boolean(plugin),
          aktiv: app.plugins.enabledPlugins.has(id),
          manifestVersion: app.plugins.manifests[id]?.version ?? null,
          instanzVersion: plugin?.manifest?.version ?? null,
        };
      `);
      const text = `Plugin-Objekt ${stand.da ? "da" : "fehlt"}, eingeschaltet ${stand.aktiv}, Version Manifest ${stand.manifestVersion}, Instanz ${stand.instanzVersion}, erwartet ${erwartet}`;
      const ok = stand.da && stand.aktiv && stand.manifestVersion === erwartet && stand.instanzVersion === erwartet;
      bilanz.record("P1", ok, ok ? `Plugin geladen, Version ${erwartet} (${text})` : text);
    });

    if (gegenprobe) {
      for (const p of PUNKTE.slice(1)) bilanz.skipped(p, "Gegenprobe: das Plugin ist abgeschaltet, nur P1 misst");
      return;
    }

    let seiteHash: string | null = null;
    let jsonHash: string | null = null;

    await bilanz.punkt("P2", async () => {
      const fehlen = await cdp.evaluate<string[]>(`
        return ${JSON.stringify(BEFEHLE)}.filter((id) => !app.commands.commands[${JSON.stringify(PLUGIN_ID + ":")} + id]);
      `);
      bilanz.record("P2", fehlen.length === 0, fehlen.length === 0 ? `alle ${BEFEHLE.length} Befehle registriert` : `fehlen: ${fehlen.join(", ")}`);
    });

    await bilanz.punkt("P3", async () => {
      await cdp.evaluate<boolean>(`
        for (const p of [${JSON.stringify(AUSGABE_HTML)}, ${JSON.stringify(AUSGABE_JSON)}]) if (await app.vault.adapter.exists(p)) await app.vault.adapter.remove(p);
        return true;
      `);
      await oeffne(cdp, EINSTIEG);
      await clearNotices(cdp);
      if (!(await fuehreAus(cdp, "export-current-note"))) throw new Vorbedingung("export-current-note war nicht verfuegbar (keine aktive Markdown-Notiz?)");
      const ergebnis = await pollUntil<ErgebnisDatei>(cdp, `
        const a = app.vault.adapter;
        if (!(await a.exists(${JSON.stringify(AUSGABE_JSON)}))) return null;
        try { return JSON.parse(await a.read(${JSON.stringify(AUSGABE_JSON)})); } catch { return null; }
      `, 90_000, 300);
      if (!ergebnis) throw new Vorbedingung(`${AUSGABE_JSON} entstand nicht (90 s)`);
      seiteHash = await sha(cdp, AUSGABE_HTML);
      jsonHash = await sha(cdp, AUSGABE_JSON);
      const anker = seiteHash === null ? null : await pruefeAnker(cdp, AUSGABE_HTML);
      const text =
        `Ergebnisdatei ok:${String(ergebnis.ok)} Fehler ${ergebnis.errors}, Seite ${seiteHash === null ? "fehlt" : "da"}, ` +
        `${anker?.anker ?? 0} Anker, ohne Ziel: ${anker === null || anker.ohneZiel.length === 0 ? "keiner" : anker.ohneZiel.join(" ")}`;
      const ok = ergebnis.ok && seiteHash !== null && jsonHash !== null && anker !== null && anker.anker > 0 && anker.ohneZiel.length === 0;
      bilanz.record("P3", ok, text);
    });

    await bilanz.punkt("P4", async () => {
      if (seiteHash === null || jsonHash === null) throw new Vorbedingung("P3 hat keinen ersten Lauf geliefert");
      const vorher = await mtime(cdp, AUSGABE_JSON);
      await oeffne(cdp, EINSTIEG);
      if (!(await fuehreAus(cdp, "export-current-note"))) throw new Vorbedingung("export-current-note war nicht verfuegbar");
      await warteAufNeuere(cdp, AUSGABE_JSON, vorher, "zweiter Lauf");
      const seite2 = await sha(cdp, AUSGABE_HTML);
      const json2 = await sha(cdp, AUSGABE_JSON);
      bilanz.record("P4", seite2 === seiteHash && json2 === jsonHash, `Seite ${seite2 === seiteHash ? "gleich" : "ABWEICHEND"} (${String(seite2).slice(0, 12)}), Ergebnisdatei ${json2 === jsonHash ? "gleich" : "ABWEICHEND"}`);
    });

    await bilanz.punkt("P5", async () => {
      await legeAbbruchFallAn(cdp);
      const vorher = await sha(cdp, ABBRUCH_HTML);
      await oeffne(cdp, ABBRUCH_EINSTIEG);
      await clearNotices(cdp);
      if (!(await fuehreAus(cdp, "export-current-note"))) throw new Vorbedingung("export-current-note war nicht verfuegbar");
      const bei = await warteAufNotiz(cdp, ABBRUCH_AB);
      if (bei === null) throw new Vorbedingung(`die Fortschrittsanzeige erreichte nie Notiz ${ABBRUCH_AB} (Lauf zu schnell, zu frueh fertig oder keine Anzeige)`);
      if (!(await clickReal(cdp, KNOPF_ABBRECHEN))) throw new Vorbedingung("der Abbrechen-Knopf der Fortschrittsanzeige liess sich nicht klicken");
      // Die alte Ergebnisdatei (ok:true) muss durch ok:false ersetzt werden; das zeigt das Ende des abgebrochenen Laufs.
      const ergebnis = await pollUntil<ErgebnisDatei>(cdp, `
        const a = app.vault.adapter;
        try { const j = JSON.parse(await a.read(${JSON.stringify(ABBRUCH_JSON)})); return j.ok === false ? j : null; } catch { return null; }
      `, 60_000, 200);
      if (!ergebnis) throw new Vorbedingung("nach dem Abbrechen wurde die Ergebnisdatei nicht auf ok:false gesetzt (60 s)");
      const nachher = await sha(cdp, ABBRUCH_HTML);
      const dateien = await cdp.evaluate<string[]>(`return (await app.vault.adapter.list(${JSON.stringify(ABBRUCH_ORDNER)})).files.filter((f) => !f.endsWith(".md"));`);
      const fremd = dateien.filter((f) => f !== ABBRUCH_HTML && f !== ABBRUCH_JSON);
      const ok = vorher !== null && nachher === vorher && fremd.length === 0 && ergebnis.path === null;
      bilanz.record("P5", ok, `abgebrochen bei Notiz ${bei}, vorhandene Seite ${nachher === vorher ? "unveraendert" : "VERAENDERT"}, Ergebnisdatei ok:false path:${String(ergebnis.path)}, weitere Dateien: ${fremd.length === 0 ? "keine" : fremd.join(" ")}`);
    });

    await bilanz.punkt("P6", async () => {
      await oeffne(cdp, EINSTIEG);
      await clearNotices(cdp);
      if (!(await fuehreAus(cdp, "check-export"))) throw new Vorbedingung("check-export war nicht verfuegbar");
      const meldung = await meldungenMit(cdp, "/same as a fresh run|differs from a fresh run|No export yet/");
      if (meldung === null) throw new Vorbedingung("check-export zeigte keine Meldung (60 s)");
      bilanz.record("P6", /same as a fresh run/.test(meldung), meldung);
    });
  } finally {
    await zustand.schliesse();
    if (istAbgebrochen()) return;
    cdp.close();
  }

  if (konsole.length) {
    console.log(`\nKonsole des Prueflings (${konsole.length}):`);
    for (const z of konsole.slice(0, 20)) console.log(`  ${z}`);
  }

  bilanz.abschluss();
}

async function main(): Promise<void> {
  const args = parseArgs(argv.slice(2));
  if (args.has("list")) return zeigeVertrag();

  const portText = args.value("port") ?? env.CDP_PORT;
  if (!portText || !Number.isInteger(Number(portText))) {
    throw new Error("--port <port> fehlt (oder CDP_PORT). Kein Default: 9222 ist die regulaere Instanz.");
  }
  PORT = Number(portText);

  if (args.has("setup")) return setup();

  if (!existsSync(join(REPO_ROOT, "main.js"))) {
    throw new Error("main.js fehlt — erst `npm run build`.");
  }
  await lauf(args.has("gegenprobe"));
}

runDriver(main);
