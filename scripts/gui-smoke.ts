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
 * Spaetere Tasks haengen ihre Pruefpunkte hier an (Befehle, Export, Byte-Gleichheit, Abbruch).
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, cwd, env } from "node:process";

import {
  attachTo,
  beimAbbruch,
  bereiteInstanzVor,
  closeExtraLeaves,
  istAbgebrochen,
  ladePluginNeu,
  requireVisible,
} from "../../tools/obsidian-cdp/cdp.js";
import { createBilanz, parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "hypertext-exporter";
const PLUGIN_ID = "hypertext-exporter";
/** Eigener Staging-Vault; der Filter in `attachTo` haengt an diesem Namen. */
const VAULT_NAME = `${REPO_NAME}-smoke`;
/** Pflicht: `--port` oder `CDP_PORT`; gesetzt in `main()`. Kein Default 9222 (reguläre Instanz). */
let PORT = 0;

/** Soll-Liste (Nenner der Bilanz). */
const PUNKTE = ["P1"] as const;

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
