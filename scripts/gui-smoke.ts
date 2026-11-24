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
 *   --chrome-port  Port der headless Chrome-Instanz fuer P9 und P10 (Standard 9844; eigener Lock, nie 9222, nie der Port der Zweitinstanz)
 *
 * `--port` ist Pflicht (auch als `CDP_PORT` lesbar): ohne Angabe bricht der Treiber ab, statt auf die reguläre
 * Instanz (9222) zu greifen. Je Messlauf ein frischer Prozess.
 *
 * Bilanz in vier Zustaenden (`bilanz.ts`): gruen, rot, uebersprungen, nichts gemessen. `PUNKTE` ist der Nenner.
 *
 * Pruefpunkte P7 bis P10 (Live-Reste der Abnahme Etappe 5, `gui-smoke-live.ts`): rohes iframe (Satz 18), dritter Export nach fremder Mathe,
 * Kaskade der MathJax-Blaetter gegen die Seite in Chrome, rohes details im Druck.
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
  openNote,
  pollUntil,
  reopenNote,
  requireVisible,
  type Cdp,
} from "../../tools/obsidian-cdp/cdp.js";
import { filterMathCss } from "../src/core/math-css.js";
import { createBilanz, parseArgs, runDriver, Vorbedingung } from "../../tools/obsidian-cdp/bilanz.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";
import {
  CHROME_PORT_STANDARD,
  DRUCK_MESSUNG,
  gedruckterText,
  oeffneSeiteInChrome,
  setzeMessStil,
  stilMessung,
  vergleicheStile,
  type StilContainer,
} from "./gui-smoke-live.js";

const REPO_NAME = "hypertext-exporter";
const PLUGIN_ID = "hypertext-exporter";
/** Eigener Staging-Vault; der Filter in `attachTo` haengt an diesem Namen. */
const VAULT_NAME = `${REPO_NAME}-smoke`;
/** Pflicht: `--port` oder `CDP_PORT`; gesetzt in `main()`. Kein Default 9222 (reguläre Instanz). */
let PORT = 0;

/** Soll-Liste (Nenner der Bilanz). */
const PUNKTE = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11"] as const;

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

/** Port der headless Chrome-Instanz fuer P9 und P10 (eigener Lock; nie 9222 und nie der Port der Zweitinstanz). */
let CHROME_PORT = CHROME_PORT_STANDARD;
/** Fremde Notiz mit Mathe ausserhalb der Menge (P8), im Staging-Vault angelegt. */
const FREMD_NOTIZ = "ausserhalb/mathe-fremd.md";
const FREMD_TEXT = String.raw`# Fremde Mathe

Außerhalb der Menge: $\alpha + \beta \leq \Gamma$ und $\oint_C \hbar \nabla \cdot \vec{F}$.

$$\sum_{k=1}^{n} \frac{\partial \Omega}{\partial \ell_k} \approx \int \Psi$$
`;
/** Notizen mit Formeln im Beispielordner und die Zahl ihrer `mjx-container` im Lesefenster (P9). */
const MATHE_NOTIZEN: readonly (readonly [string, number])[] = [["beispiel/anhang/blöcke.md", 2], ["beispiel/kapitel/02 Größen und Maße.md", 1]];

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
  console.log("  P7   Satz 18: Obsidians Lesefenster zeichnet das rohe iframe src=app://x (Kontrolle: Notizende gezeichnet); die exportierte Seite traegt kein iframe, der Befund-Weg wird benannt");
  console.log("  P8   dritter Export nach dem Zeichnen einer fremden Mathe-Notiz (MathJax-Stile wachsen): Seite und Ergebnisdatei SHA-256-gleich zu den ersten beiden");
  console.log(`  P9   Formelstile vollstaendig: berechnete Stile der MathJax-Elemente in Obsidian gegen die Seite als file:// in headless Chrome (Port ${CHROME_PORT}), Gegenprobe mit eingeschleuster Regel`);
  console.log("  P10  Kaskade: dieselben Regeln aus dem Stylesheet von Obsidian, durch filterMathCss geordnet (ein Blatt, zwei Blaetter vertauscht), in die Seite gelegt: berechnete Stile gleich");
  console.log("  P11  Druck: rohes details der Seite unter print: ::details-content sichtbar, Text im PDF (printToPDF, pdftotext), Gegenprobe mit versteckender Regel; Range.getBoundingClientRect nur mitgeschrieben");
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


interface ErgebnisBefund { severity: string; code: string; message: string; notePath?: string }
interface ErgebnisDatei { ok: boolean; path: string | null; errors: number; warnings: number; infos: number; findings?: ErgebnisBefund[] }

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

/** Eine vorhandene Notiz im Lesemodus neu oeffnen (Pfade ohne Rücksicht auf die Unicode-Form: `ö` kann als ein oder zwei Zeichen im Dateinamen stehen). */
async function oeffneLesemodus(cdp: Cdp, pfad: string): Promise<void> {
  const ok = await cdp.evaluate<boolean>(`
    const soll = ${JSON.stringify(pfad)}.normalize("NFC");
    const file = app.vault.getFiles().find((f) => f.path.normalize("NFC") === soll);
    if (!file) return false;
    const alt = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
    if (alt) alt.detach();
    await new Promise((r) => setTimeout(r, 300));
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file, { state: { mode: "preview" } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);
  if (!ok) throw new Vorbedingung(`Notiz ${pfad} nicht gefunden`);
}

/** Zustand von `style#MJX-CHTML-styles`: Regeln im Stylesheet (CSSOM) gegen die Zeichen im Textinhalt des Elements. MathJax haengt neue Regeln per `insertRule` an; der Textinhalt waechst nicht mit. */
interface MathStile { regeln: number; textZeichen: number }
function mathStile(cdp: Cdp): Promise<MathStile> {
  return cdp.evaluate<MathStile>(`
    const el = [...document.querySelectorAll("style#MJX-CHTML-styles")];
    return { regeln: el.reduce((n, e) => n + (e.sheet?.cssRules.length ?? 0), 0), textZeichen: el.reduce((n, e) => n + (e.textContent ?? "").length, 0) };
  `);
}

/** Alle Regeln der MathJax-Stylesheets als Text (CSSOM), in der Reihenfolge des Stylesheets. */
function mathRegeln(cdp: Cdp): Promise<string[]> {
  return cdp.evaluate<string[]>(`return [...document.querySelectorAll("style#MJX-CHTML-styles")].flatMap((e) => [...(e.sheet?.cssRules ?? [])].map((r) => r.cssText));`);
}

/** Was Obsidians Renderer aus dem rohen `<iframe>` der Fixture macht: `anhang/blöcke.md` im Lesefenster, bis ans Ende gerollt (Abschnitte werden erst beim Rollen gezeichnet). */
interface LesefensterBild { iframes: number; iframeHtml: string | null; details: number; ende: boolean }
function zeichneLesefenster(cdp: Cdp): Promise<LesefensterBild> {
  return cdp.evaluate<LesefensterBild>(`
    const v = document.querySelector(".markdown-preview-view");
    let ende = false;
    for (let i = 0; i < 12 && !ende; i++) {
      v.scrollTop = v.scrollHeight;
      await new Promise((r) => setTimeout(r, 400));
      ende = /Rohes Aufklappfeld/.test(v.textContent ?? "");
    }
    const ifr = v.querySelector("iframe");
    return { iframes: v.querySelectorAll("iframe").length, iframeHtml: ifr ? ifr.outerHTML : null, details: v.querySelectorAll("details").length, ende };
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

    const seiteImVault = join(stagingVaultDir(VAULT_NAME), AUSGABE_HTML);

    await bilanz.punkt("P7", async () => {
      const html = await cdp.evaluate<string | null>(`
        const a = app.vault.adapter;
        return (await a.exists(${JSON.stringify(AUSGABE_HTML)})) ? await a.read(${JSON.stringify(AUSGABE_HTML)}) : null;
      `);
      const ergebnis = await liesJson(cdp, AUSGABE_JSON);
      if (html === null || ergebnis === null) throw new Vorbedingung("keine exportierte Seite oder Ergebnisdatei (P3)");
      const befunde = ergebnis.findings ?? [];
      const seiteIframes = (html.match(/<iframe/gi) ?? []).length;
      const platzhalter = (html.match(/\[iframe\]/g) ?? []).length;
      const guard = befunde.filter((b) => b.code === "guard.removed");
      const nenntIframe = befunde.filter((b) => /iframe/i.test(b.message));
      // Obsidians Renderer, roh (ohne Vorbehandlung): dieselbe Notiz im Lesefenster; Kontrolle: das letzte Stück der Notiz (rohes details) wurde gezeichnet.
      await oeffneLesemodus(cdp, "beispiel/anhang/blöcke.md");
      const roh = await zeichneLesefenster(cdp);
      if (!roh.ende) throw new Vorbedingung("Kontrolle: das Lesefenster zeichnete das Ende der Notiz nicht (rohes details fehlt)");
      const weg =
        roh.iframes === 0 ? "der Renderer entfernt das iframe schon beim Zeichnen"
        : "der Renderer laesst das iframe stehen, die Vorbehandlung (export-prepare) ersetzt es vor dem Zeichnen";
      const befundWeg = guard.length === 0 && nenntIframe.length === 0 ? "kein Befund fuer das iframe in der Ergebnisdatei" : `Befund: ${[...guard, ...nenntIframe].map((b) => `${b.code} ${b.message}`).join(" | ")}`;
      const ok = seiteIframes === 0;
      bilanz.record("P7", ok,
        `roher Renderer (Lesefenster): ${roh.iframes} iframe${roh.iframeHtml ? ` ${roh.iframeHtml}` : ""} (Kontrolle: Ende der Notiz gezeichnet, details ${roh.details}) -> ${weg}; Seite: ${seiteIframes} iframe, Platzhalter "[iframe]" ${platzhalter}x; ` +
        `guard.removed ${guard.length}x${guard.length ? ` (${guard.map((b) => b.message).join("; ")})` : ""}; ${befundWeg}; Befunde gesamt ${befunde.length}`);
    });

    await bilanz.punkt("P8", async () => {
      if (seiteHash === null || jsonHash === null) throw new Vorbedingung("P3 hat keinen ersten Lauf geliefert");
      const davor = await mathStile(cdp);
      await openNote(cdp, FREMD_NOTIZ, FREMD_TEXT, "preview");
      const gezeichnet = await pollUntil<number>(cdp, `
        const n = document.querySelectorAll(".markdown-preview-view mjx-container").length;
        return n >= 3 ? n : null;
      `, 30_000, 250);
      if (gezeichnet === null) throw new Vorbedingung("die fremde Notiz zeigte keine drei Formeln (30 s)");
      await new Promise((r) => setTimeout(r, 600));
      const danach = await mathStile(cdp);
      if (danach.regeln <= davor.regeln) throw new Vorbedingung(`Kontrolle: die MathJax-Stile wuchsen nicht (${davor.regeln} -> ${danach.regeln} Regeln); der Punkt wuerde nichts messen`);
      const vorher = await mtime(cdp, AUSGABE_JSON);
      await oeffne(cdp, EINSTIEG);
      await clearNotices(cdp);
      if (!(await fuehreAus(cdp, "export-current-note"))) throw new Vorbedingung("export-current-note war nicht verfuegbar");
      await warteAufNeuere(cdp, AUSGABE_JSON, vorher, "dritter Lauf");
      const seite3 = await sha(cdp, AUSGABE_HTML);
      const json3 = await sha(cdp, AUSGABE_JSON);
      const nachStile = await mathStile(cdp);
      bilanz.record("P8", seite3 === seiteHash && json3 === jsonHash,
        `MathJax-Regeln im Stylesheet ${davor.regeln} -> ${danach.regeln} (nach dem Export ${nachStile.regeln}), Textinhalt des Style-Elements ${davor.textZeichen} -> ${danach.textZeichen} Zeichen, ${gezeichnet} Formeln der fremden Notiz; dritter Lauf: Seite ${seite3 === seiteHash ? "gleich" : "ABWEICHEND"} (${String(seite3).slice(0, 12)} gegen ${String(seiteHash).slice(0, 12)}), Ergebnisdatei ${json3 === jsonHash ? "gleich" : "ABWEICHEND"}`);
    });

    /** Berechnete Stile der Formeln in Obsidians Lesefenster (Original-Blaetter); Zeichen der Formeln der Seite und alle Regeln des Stylesheets. */
    const messeInstanz = async (): Promise<{ container: StilContainer[]; regeln: string[] }> => {
      const container: StilContainer[] = [];
      for (const [pfad, erwartet] of MATHE_NOTIZEN) {
        await oeffneLesemodus(cdp, pfad);
        const da = await pollUntil<number>(cdp, `
          const n = document.querySelectorAll(".markdown-preview-view mjx-container").length;
          return n >= ${erwartet} ? n : null;
        `, 30_000, 250);
        if (da === null) throw new Vorbedingung(`${pfad}: weniger als ${erwartet} Formeln im Lesefenster (30 s)`);
        await new Promise((r) => setTimeout(r, 600));
        container.push(...(await cdp.evaluate<StilContainer[]>(stilMessung(".markdown-preview-view mjx-container"))));
      }
      return { container, regeln: await mathRegeln(cdp) };
    };
    const schleuseEin = (chrome: { cdp: Cdp }, css: string): Promise<void> => setzeMessStil(chrome.cdp, css);
    const entferne = (chrome: { cdp: Cdp }): Promise<void> => setzeMessStil(chrome.cdp, "");
    const zeigeAbweichungen = (v: ReturnType<typeof vergleicheStile>): string => {
      const eig = Object.entries(v.nachEigenschaft).map(([n, e]) => `${n} ${e.n}x (${e.beispiele.map((b) => b.slice(0, 90)).join("; ")})`).join(" | ");
      return `Container Obsidian ${v.containerA}, Seite ${v.containerB}, gepaart ${v.gepaart} (nur Obsidian ${v.nurA}, nur Seite ${v.nurB}); ${v.elemente} Elemente, ${v.werte} Werte, ${v.abweichungen} Abweichungen${eig ? `: ${eig}` : ""}; Breiten (Schrift und Umgebung, nicht gewertet) ${v.schriftbedingt}`;
    };
    const GEGENREGEL = "mjx-container, mjx-container * { font-size: 123% !important; vertical-align: top !important; }";
    const CSS_TEILE = `
      const c = [...document.querySelectorAll("mjx-container mjx-c")].map((e) => (e.getAttribute("class") ?? "").split(/\\s+/).map((k) => /^mjx-c([0-9A-Fa-f]+)$/.exec(k)?.[1]).filter(Boolean)).flat();
      return [...new Set(c)];
    `;
    const ELEMENT_TEILE = `return [...new Set([...document.querySelectorAll("*")].map((e) => e.tagName.toLowerCase()).filter((n) => n.startsWith("mjx-")))];`;
    let formeln: { container: StilContainer[]; regeln: string[] } | null = null;

    await bilanz.punkt("P9", async () => {
      formeln = await messeInstanz();
      const chrome = await oeffneSeiteInChrome(seiteImVault, CHROME_PORT);
      try {
        const v = vergleicheStile(formeln.container, await chrome.cdp.evaluate<StilContainer[]>(stilMessung("mjx-container")));
        // Gegenprobe: eine eingeschleuste Regel muss der Vergleich als Abweichung sehen (sonst misst er nichts).
        await schleuseEin(chrome, GEGENREGEL);
        const kontrolle = vergleicheStile(formeln.container, await chrome.cdp.evaluate<StilContainer[]>(stilMessung("mjx-container")));
        const text = `${chrome.version}; ${zeigeAbweichungen(v)}; Gegenprobe (eingeschleuste Regel): ${kontrolle.abweichungen} Abweichungen`;
        if (v.gepaart === 0 || kontrolle.abweichungen <= v.abweichungen) throw new Vorbedingung(`Messung ungueltig: ${text}`);
        bilanz.record("P9", v.abweichungen === 0 && v.nurA === 0 && v.nurB === 0, text);
      } finally {
        await chrome.stoppe();
      }
    });

    await bilanz.punkt("P10", async () => {
      if (formeln === null) throw new Vorbedingung("P9 hat die Formeln in Obsidian nicht gemessen");
      const alle = formeln.regeln;
      if (alle.length < 20) throw new Vorbedingung(`zu wenige MathJax-Regeln im Stylesheet (${alle.length})`);
      const chrome = await oeffneSeiteInChrome(seiteImVault, CHROME_PORT);
      try {
        const benutzt = new Set(await chrome.cdp.evaluate<string[]>(CSS_TEILE));
        const elemente = new Set(await chrome.cdp.evaluate<string[]>(ELEMENT_TEILE));
        const mitte = Math.floor(alle.length / 2);
        const eins = filterMathCss([alle.join("\n")], benutzt, elemente);
        // Zwei Blaetter, vertauscht uebergeben; ob die Ordnung nach Zeichenfolge sie umstellt, zeigt `umgestellt`.
        const ersteHaelfte = alle.slice(0, mitte).join("\n");
        const zweiteHaelfte = alle.slice(mitte).join("\n");
        const zwei = filterMathCss([zweiteHaelfte, ersteHaelfte], benutzt, elemente);
        const a1 = filterMathCss([ersteHaelfte], benutzt, elemente).css;
        const a2 = filterMathCss([zweiteHaelfte], benutzt, elemente).css;
        const umgestellt = a1 !== "" && a2 !== "" && zwei.css === `${a2}\n${a1}`;
        const ergebnis: string[] = [];
        let abweichungen = 0;
        for (const [name, css] of [["ein Blatt", eins.css], ["zwei Blaetter", zwei.css]] as const) {
          await schleuseEin(chrome, css);
          const v = vergleicheStile(formeln.container, await chrome.cdp.evaluate<StilContainer[]>(stilMessung("mjx-container")));
          await entferne(chrome);
          abweichungen += v.abweichungen + v.nurA + v.nurB;
          ergebnis.push(`${name} (${css.length} Zeichen): ${zeigeAbweichungen(v)}`);
        }
        await schleuseEin(chrome, `${eins.css}\n${GEGENREGEL}`);
        const kontrolle = vergleicheStile(formeln.container, await chrome.cdp.evaluate<StilContainer[]>(stilMessung("mjx-container")));
        const text = `${chrome.version}; ${alle.length} Regeln im Stylesheet, ${benutzt.size} benutzte Zeichen; ${ergebnis.join("; ")}; zwei Blaetter ${umgestellt ? "von der Ordnung umgestellt" : "in der Reihenfolge belassen"}; Gegenprobe: ${kontrolle.abweichungen} Abweichungen`;
        if (kontrolle.abweichungen <= abweichungen / 2) throw new Vorbedingung(`Messung ungueltig (Gegenprobe wirkt nicht): ${text}`);
        bilanz.record("P10", abweichungen === 0, text);
      } finally {
        await chrome.stoppe();
      }
    });

    await bilanz.punkt("P11", async () => {
      const chrome = await oeffneSeiteInChrome(seiteImVault, CHROME_PORT);
      try {
        interface Druck { fehlt?: string; medienDruck: boolean; eigenOffen: boolean; vorfahrenOffen: boolean[]; text: { w: number; h: number }; summary: { w: number; h: number }; inhalt: string; kinder: string[] }
        const messe = async (medium: "screen" | "print"): Promise<Druck> => {
          await chrome.cdp.send("Emulation.setEmulatedMedia", { media: medium });
          const m = await chrome.cdp.evaluate<Druck>(DRUCK_MESSUNG);
          if (m.fehlt) throw new Vorbedingung(`Fixture fehlt in der Seite: ${m.fehlt}`);
          return m;
        };
        const zeige = (m: Druck): string => `Range ${m.text.w}x${m.text.h}, ::details-content ${m.inhalt}, eigenes details ${m.eigenOffen ? "offen" : "zu"}, Vorfahren ${m.vorfahrenOffen.map((o) => (o ? "offen" : "zu")).join("/") || "keine"}`;
        const schirm = await messe("screen");
        const druck = await messe("print");
        if (!druck.medienDruck || schirm.medienDruck) throw new Vorbedingung(`Medienemulation wirkte nicht (print ${druck.medienDruck}, screen ${schirm.medienDruck})`);
        const imPdf = (await gedruckterText(chrome.cdp)).includes("Dieses Feld bleibt, wie es ist.");
        // Gegenprobe: eine Regel, die den Inhalt im Druck versteckt, muss den Text aus dem PDF nehmen (sonst misst das PDF nichts).
        await schleuseEin(chrome, "@media print { details::details-content { content-visibility: hidden !important; } }");
        const versteckt = (await gedruckterText(chrome.cdp)).includes("Dieses Feld bleibt, wie es ist.");
        if (versteckt) throw new Vorbedingung("Gegenprobe: auch mit versteckender Regel steht der Text im PDF; die Messung unterscheidet nichts");
        const sichtbar = imPdf && druck.inhalt === "visible";
        bilanz.record("P11", sichtbar,
          `${chrome.version}; Bildschirm: ${zeige(schirm)}; Druck: ${zeige(druck)}; Text im gedruckten PDF ${imPdf ? "ja" : "NEIN"}, mit versteckender Regel ${versteckt ? "ja" : "nein (Gegenprobe wirkt)"}; ` +
          `Range.getBoundingClientRect trennt Bildschirm und Druck nicht (Bildschirm ${schirm.text.h}, Druck ${druck.text.h} hoch); Kinder des details: ${druck.kinder.join(",")}`);
      } finally {
        await chrome.stoppe();
      }
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
  const chromePort = args.value("chrome-port") ?? env.HT_CHROME_PORT;
  if (chromePort !== undefined && chromePort !== "") {
    if (!Number.isInteger(Number(chromePort)) || Number(chromePort) === PORT || Number(chromePort) === 9222) throw new Error("--chrome-port muss eine ganze Zahl sein, nicht 9222 und nicht der Port der Zweitinstanz.");
    CHROME_PORT = Number(chromePort);
  }

  if (args.has("setup")) return setup();

  if (!existsSync(join(REPO_ROOT, "main.js"))) {
    throw new Error("main.js fehlt — erst `npm run build`.");
  }
  await lauf(args.has("gegenprobe"));
}

runDriver(main);
