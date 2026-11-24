/**
 * Aufnahme-Treiber fuer die README-Bilder — faehrt den Vertrag aus `docs/images/README.md` gegen eine **laufende Zweitinstanz**
 * und gegen headless Chrome (die erzeugte Seite), statt die Bilder von Hand zu machen.
 *
 * Bruecke, Aufnahme-Primitive und Fixture→Vault kommen zentral aus dem Dach (`obsidian-plugins/tools/obsidian-cdp/`); dieser Treiber importiert sie.
 * Im Repo bleiben das Rezept (dieses Skript) und das Fixture (`docs/images/fixture/`: erfundene, englische Wandernotizen und die Vault-Konfiguration).
 *
 * Lauf (eine Befehlszeile, Staging-Vault `hypertext-exporter-smoke`, Zweitinstanz 9845, headless Chrome 9844; beide Locks vorher, `--exclusive focus`):
 *   export REPO=hypertext-exporter VAULT=hypertext-exporter-smoke PORT=9845 RUNNER=shots SETUP_BEFEHL='npm run shots -- --setup' \
 *     && python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label hypertext-exporter --intent "README-Bilder" --exclusive focus --port 9845 --ttl 600 --warten 540 \
 *     && ../tools/obsidian-cdp/messlauf.sh
 * Der Treiber startet Chrome selbst (eigenes Profil, Port 9844, `--chrome-port` aendert ihn; nie 9222, nie der Port der Zweitinstanz) und beendet es am Ende.
 *
 * Schalter:
 *   --setup        Staging-Vault aus `docs/images/fixture/` herstellen (kein Port noetig)
 *   --port <port>  Pflicht beim Aufnehmen (auch `CDP_PORT`); kein Default, 9222 ist die regulaere Instanz
 *   --chrome-port  Port der headless Chrome-Instanz (Standard 9844)
 *   --bilder <ordner>  Ausgabeordner (Standard `docs/images`)
 *   --only <name>  nur dieses Bild
 *   --list         Vertrag anzeigen
 *
 * Nach jedem Lauf alle Bilder ansehen (Skill `readme-shots`): der Lauf prueft Form, nicht Aussage.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { argv, cwd, env } from "node:process";

import {
  attachTo,
  bereiteInstanzVor,
  clearNotices,
  closeExtraLeaves,
  ladePluginNeu,
  openExisting,
  pollUntil,
  requireVisible,
  setAppConfig,
  type Cdp,
} from "../../tools/obsidian-cdp/cdp.js";
import { createBilanz, parseArgs, runDriver, Vorbedingung, type Bilanz } from "../../tools/obsidian-cdp/bilanz.js";
import { boxOf, capture, setWindowSize, writeShot, type Rect } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";
import { CHROME_PORT_STANDARD, oeffneSeiteInChrome, type ChromeSeite } from "./gui-smoke-live.js";

const REPO_NAME = "hypertext-exporter";
const PLUGIN_ID = "hypertext-exporter";
/** Gleicher Staging-Vault wie der GUI-Smoke; `--setup` baut ihn aus dem Fixture dieses Treibers neu (nie der Vault `hypertext-exporter`: der traegt private Daten). */
const VAULT_NAME = `${REPO_NAME}-smoke`;
const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "docs", "images", "fixture");
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const PADDING = 8;

const ENTRY = "Trail Notes/Trail Notes.md";
const ENTRY_HTML = "Trail Notes/Trail Notes.html";
const ENTRY_JSON = "Trail Notes/Trail Notes.export.json";
const SUCHWORT = "lake";

type Klasse = "hero" | "feature" | "detail";
interface Shot { name: string; klasse: Klasse; quelle: "obsidian" | "chrome"; zeigt: string }

/** Soll-Liste (Nenner der Bilanz) und Vertrag in einem. */
const SHOTS: Shot[] = [
  { name: "findings.png", klasse: "detail", quelle: "obsidian", zeigt: "Panel Findings nach einem Export des Beispielordners: Zusammenfassung und die Befunde mit Schwere, Code, Schluessel der Bauanleitung und Sprung zur Notiz" },
  { name: "recipe-in-note.png", klasse: "feature", quelle: "obsidian", zeigt: "die Einstiegsnotiz im Quelltext mit dem Block hypertext im Frontmatter, rechts das Panel Export auf dem Ordner Trail Notes" },
  { name: "hero.png", klasse: "hero", quelle: "chrome", zeigt: `die erzeugte Seite als file:// in Chrome, Suche nach "${SUCHWORT}": Bereiche ohne Treffer ausgeblendet, Treffer geoeffnet und hervorgehoben, Zahl der Treffer` },
  { name: "page-mobile.png", klasse: "detail", quelle: "chrome", zeigt: "dieselbe Seite bei 390 Pixel Breite, ohne waagerechtes Scrollen" },
];

function zeigeVertrag(): void {
  console.log(`Bilder — ${SHOTS.length}\n`);
  for (const s of SHOTS) console.log(`  ${s.name.padEnd(20)} ${s.klasse.padEnd(8)} ${s.quelle.padEnd(9)} ${s.zeigt}`);
}

/** Staging-Vault aus dem Fixture herstellen: `notes/` (Wandernotizen, Bild) und `obsidian/` (Vault-Konfiguration, nur dieses Plugin aktiv). */
function setup(): void {
  const vaultDir = stagingVaultDir(VAULT_NAME);
  const arbeit = mkdtempSync(join(tmpdir(), "ht-shots-fixture-"));
  try {
    cpSync(join(FIXTURE_DIR, "notes"), join(arbeit, "notes"), { recursive: true });
    cpSync(join(FIXTURE_DIR, "obsidian"), join(arbeit, "obsidian"), { recursive: true });
    const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: arbeit, pluginId: PLUGIN_ID, pluginFiles: ["main.js", "manifest.json", "styles.css"] });
    console.log(`Staging-Vault: ${vaultDir}`);
    for (const zeile of log) console.log(`  ${zeile}`);
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

function befehl(id: string): string {
  return `${PLUGIN_ID}:${id}`;
}

/** mtime einer Vault-Datei oder `null`. */
function mtime(cdp: Cdp, pfad: string): Promise<number | null> {
  return cdp.evaluate<number | null>(`const st = await app.vault.adapter.stat(${JSON.stringify(pfad)}); return st ? st.mtime : null;`);
}

/** Den Export der Einstiegsnotiz ueber den Befehl ausloesen und warten, bis die Ergebnisdatei neuer ist. */
async function exportiere(cdp: Cdp): Promise<void> {
  const vorher = (await mtime(cdp, ENTRY_JSON)) ?? 0;
  if (!(await openExisting(cdp, ENTRY, "preview"))) throw new Vorbedingung(`${ENTRY} liess sich nicht oeffnen`);
  const ok = await cdp.evaluate<boolean>(`return app.commands.executeCommandById(${JSON.stringify(befehl("export-current-note"))}) === true;`);
  if (!ok) throw new Vorbedingung("Befehl export-current-note nicht verfuegbar");
  const da = await pollUntil<boolean>(cdp, `const st = await app.vault.adapter.stat(${JSON.stringify(ENTRY_JSON)}); return Boolean(st) && st.mtime > ${vorher};`, 60_000, 200);
  if (!da) throw new Vorbedingung("der Export wurde in 60 s nicht fertig");
}

/** Seitenleiste rechts aufnehmen: das Panel Findings von oben bis zum letzten Befund (nicht bis zum Fensterrand). */
async function findingsBox(cdp: Cdp): Promise<Rect | null> {
  const bereit = await pollUntil<boolean>(cdp, `return [...document.querySelectorAll(".ht-finding")].some((e) => e.getBoundingClientRect().width > 1);`, 15_000, 250);
  if (!bereit) return null;
  const roh = await cdp.evaluate<string | null>(`
    const sichtbar = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const view = [...document.querySelectorAll(".ht-hub-view")].find(sichtbar);
    const items = [...document.querySelectorAll(".ht-finding")].filter(sichtbar);
    if (!view || items.length === 0) return null;
    const v = view.getBoundingClientRect();
    const letzte = items[items.length - 1].getBoundingClientRect();
    return JSON.stringify({ x: v.x, y: v.y, width: v.width, height: Math.min(letzte.bottom, v.bottom) - v.y, anzahl: items.length, ueberlaeuft: letzte.bottom > v.bottom });
  `);
  if (roh === null) return null;
  const r = JSON.parse(roh) as Rect & { anzahl: number; ueberlaeuft: boolean };
  console.log(`  Befunde im Panel: ${r.anzahl}${r.ueberlaeuft ? " (laufen ueber den Rand: Fenster hoeher stellen)" : ""}`);
  return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height + PADDING, r.height + PADDING) };
}

async function obsidianShots(cdp: Cdp, out: string, nur: ReadonlySet<string>, bilanz: Bilanz): Promise<void> {
  const opts = (s: Shot) => ({ outDir: out, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH, thumb: s.klasse === "detail" });
  const schreibe = async (s: Shot, box: Rect | null, scale = 2): Promise<void> => {
    if (box === null) { bilanz.unmeasured(s.name, "kein Ausschnitt (Element nicht sichtbar)"); return; }
    await clearNotices(cdp);
    await new Promise((r) => setTimeout(r, 400));
    const png = await capture(cdp, box, scale);
    bilanz.record(s.name, true, await writeShot(cdp, s.name, png, opts(s)));
  };

  await setWindowSize(cdp, 1300, 1000);
  await exportiere(cdp);
  const findings = SHOTS.find((s) => s.name === "findings.png")!;
  if (nur.has(findings.name)) await schreibe(findings, await findingsBox(cdp));

  const recipe = SHOTS.find((s) => s.name === "recipe-in-note.png")!;
  if (nur.has(recipe.name)) {
    // Quelltext statt Live Preview: das Frontmatter steht dann als Text da, nicht als Eigenschaften-Feld.
    await setAppConfig(cdp, "livePreview", false);
    await setWindowSize(cdp, 1300, 720);
    await setAppConfig(cdp, "propertiesInDocument", "source");
    // Die Statusleiste traegt ein fremdes Sync-Symbol (nicht dieses Plugin): fuer das Bild ausblenden.
    await cdp.evaluate(`for (const e of document.querySelectorAll(".status-bar")) e.style.display = "none"; return true;`);
    if (!(await openExisting(cdp, ENTRY, "source"))) { bilanz.unmeasured(recipe.name, `${ENTRY} liess sich nicht oeffnen`); return; }
    // `mode: "source"` allein ist Live Preview; der Quelltext-Modus braucht zusaetzlich `source: true`.
    await cdp.evaluate(`
      const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
      await leaf.setViewState({ type: "markdown", state: { ...leaf.view.getState(), mode: "source", source: true }, active: true });
      await new Promise((r) => setTimeout(r, 500));
      return true;
    `);
    await cdp.evaluate(`app.workspace.leftSplit.collapse(); return true;`);
    await cdp.evaluate(`return app.commands.executeCommandById(${JSON.stringify(befehl("export-folder"))}) === true;`);
    const panel = await pollUntil<boolean>(cdp, `
      const f = [...document.querySelectorAll("#ht-source")].find((e) => e.getBoundingClientRect().width > 1);
      return Boolean(f) && f.value === "Trail Notes";
    `, 15_000, 250);
    if (!panel) { bilanz.unmeasured(recipe.name, "das Panel Export zeigt den Ordner Trail Notes nicht"); return; }
    const box = await boxOf(cdp, ".horizontal-main-container");
    await schreibe(recipe, box);
  }
}

/** Die Seite als Datei ausserhalb des Repos (Chrome oeffnet `file://`). */
async function legeSeiteAb(cdp: Cdp): Promise<{ dir: string; datei: string }> {
  const html = await cdp.evaluate<string | null>(`const a = app.vault.adapter; return (await a.exists(${JSON.stringify(ENTRY_HTML)})) ? await a.read(${JSON.stringify(ENTRY_HTML)}) : null;`);
  if (html === null) throw new Vorbedingung(`${ENTRY_HTML} fehlt im Vault`);
  const dir = mkdtempSync(join(tmpdir(), "ht-shots-seite-"));
  const datei = join(dir, "trail-notes.html");
  writeFileSync(datei, html, "utf8");
  return { dir, datei };
}

/** Das Suchwort eingeben (Ereignis per Protokoll, wie im Smoke P12) und warten, bis die Zahl der Treffer steht. */
async function sucheNach(chrome: Cdp, wort: string): Promise<string> {
  const zahl = await pollUntil<string>(chrome, `
    const i = document.getElementById("suche");
    const z = document.getElementById("werkzeug--zahl");
    if (!i || !z || i.closest("[hidden]")) return null;
    i.focus();
    i.value = ${JSON.stringify(wort)};
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return z.textContent && z.textContent.trim() !== "" ? z.textContent.trim() : null;
  `, 15_000, 250);
  if (zahl === null) throw new Vorbedingung("die Suche der Seite antwortet nicht (Werkzeug-Block verborgen?)");
  return zahl;
}

async function chromeShots(cdp: Cdp, out: string, nur: ReadonlySet<string>, chromePort: number, bilanz: Bilanz): Promise<void> {
  const wanted = SHOTS.filter((s) => s.quelle === "chrome" && nur.has(s.name));
  if (wanted.length === 0) return;
  const { dir, datei } = await legeSeiteAb(cdp);
  let seite: ChromeSeite | null = null;
  try {
    seite = await oeffneSeiteInChrome(datei, chromePort);
    console.log(`  Chrome: ${seite.version}`);
    const c = seite.cdp;
    for (const s of wanted) {
      const mobil = s.name === "page-mobile.png";
      const breite = mobil ? 390 : 1200;
      const hoehe = mobil ? 844 : 840;
      await c.send("Emulation.setDeviceMetricsOverride", { width: breite, height: hoehe, deviceScaleFactor: 1, mobile: mobil });
      await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
      await c.send("Page.reload");
      await pollUntil<boolean>(c, `return document.readyState === "complete";`, 15_000, 200);
      const zahl = await sucheNach(c, SUCHWORT);
      await new Promise((r) => setTimeout(r, 500));
      const breiteGemessen = await c.evaluate<number>(`return document.documentElement.scrollWidth;`);
      console.log(`  ${s.name}: ${zahl}; scrollWidth ${breiteGemessen} bei ${breite}`);
      if (mobil && breiteGemessen > breite) { bilanz.record(s.name, false, `waagerechtes Scrollen: scrollWidth ${breiteGemessen} > ${breite}`); continue; }
      const png = await capture(c, { x: 0, y: 0, width: breite, height: hoehe }, 2, { sichtbarPruefen: false });
      bilanz.record(s.name, true, await writeShot(cdp, s.name, png, { outDir: out, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH, thumb: s.klasse === "detail" }));
    }
  } finally {
    if (seite) await seite.stoppe();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function lauf(port: number, chromePort: number, out: string, nur: ReadonlySet<string>): Promise<void> {
  const cdp = await attachTo("workspace", port, VAULT_NAME);
  if (!cdp) throw new Error(`Kein Obsidian-Fenster fuer Vault "${VAULT_NAME}" auf Port ${port}. Laeuft die Zweitinstanz (messlauf.sh)?`);
  const bilanz = createBilanz({ punkte: SHOTS.map((s) => s.name).filter((n) => nur.has(n)) });
  try {
    await requireVisible(cdp);
    const instanz = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: VAULT_NAME, sprache: "en" });
    console.log(`Instanz vorbereitet: ${instanz.hinweis}`);
    await closeExtraLeaves(cdp);
    const neu = await ladePluginNeu(cdp, PLUGIN_ID, { repoMainJs: join(REPO_ROOT, "main.js") });
    if (!neu.geladen) throw new Error(`Plugin ${PLUGIN_ID} nicht aktiv — ${neu.hinweis}`);
    if (!neu.aktuell) throw new Error(neu.hinweis);
    console.log(`${neu.hinweis}\n`);
    await setAppConfig(cdp, "showInlineTitle", false);

    await obsidianShots(cdp, out, nur, bilanz);
    await chromeShots(cdp, out, nur, chromePort, bilanz);
  } finally {
    cdp.close();
  }
  bilanz.abschluss();
}

async function main(): Promise<void> {
  const args = parseArgs(argv.slice(2));
  if (args.has("list")) return zeigeVertrag();
  if (args.has("setup")) return setup();

  const portText = args.value("port") ?? env.CDP_PORT;
  if (!portText || !Number.isInteger(Number(portText))) throw new Error("--port <port> fehlt (oder CDP_PORT). Kein Default: 9222 ist die regulaere Instanz.");
  const port = Number(portText);
  const chromeText = args.value("chrome-port") ?? env.HT_CHROME_PORT;
  const chromePort = chromeText === undefined || chromeText === "" ? CHROME_PORT_STANDARD : Number(chromeText);
  if (!Number.isInteger(chromePort) || chromePort === 9222 || chromePort === port) throw new Error("--chrome-port muss eine ganze Zahl sein, nicht 9222 und nicht der Port der Zweitinstanz.");
  if (!existsSync(join(REPO_ROOT, "main.js"))) throw new Error("main.js fehlt — erst `npm run build`.");

  const only = args.value("only");
  const nur = new Set(only === undefined ? SHOTS.map((s) => s.name) : [only]);
  for (const n of nur) if (!SHOTS.some((s) => s.name === n)) throw new Error(`--only ${n}: unbekanntes Bild (siehe --list)`);
  const out = resolve(REPO_ROOT, args.value("bilder") ?? "docs/images");
  mkdirSync(out, { recursive: true });
  await lauf(port, chromePort, out, nur);
}

runDriver(main);
