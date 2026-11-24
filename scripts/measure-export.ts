/**
 * Messtreiber — exportiert eine Einstiegsnotiz in einer **laufenden** Zweitinstanz mehrfach und misst Seite und Ergebnisdatei (Bauplan Task 14).
 *
 * Allgemein gebaut: er kennt keinen bestimmten Ordner, keine Bauanleitung und keine Zahlen. Er sagt, was er gemessen hat; ob es ein Soll trifft, entscheidet der Aufrufer.
 * Bruecke und Vault-Aufbau kommen zentral aus dem Dach (`obsidian-plugins/tools/obsidian-cdp/`); der Treiber importiert sie und vendort nichts.
 *
 * Lauf: `tools/obsidian-cdp/messlauf.sh` mit `RUNNER=measure` startet die Zweitinstanz, baut und raeumt auf; das Rezept steht nur dort (Dateikopf). Der Lock steht davor.
 * Das Setup (Vault herstellen) ist hier kein `smoke:gui`, sondern `SETUP_BEFEHL='npm run measure -- --setup --port $PORT --vault <name> --quelle <ordner> …'`.
 *
 * Schalter (jeweils `--name wert`):
 *   --port <port>        Pflicht (auch `CDP_PORT`); kein Default, 9222 ist die regulaere Instanz
 *   --vault <name>       Pflicht: Name des Staging-Vaults (Ort ueber `stagingVaultDir`, nie ein Pfad)
 *   --setup              Vault herstellen statt messen; verlangt --quelle
 *   --quelle <ordner>    (Setup) Ordner, dessen Dateien den Vault fuellen (ohne `.git` und `.obsidian`)
 *   --ersetze <pfad>     (Setup, optional) Vault-Pfad einer Datei, die nach dem Kopieren durch --ersetze-mit ersetzt wird (die Quelle bleibt unberuehrt)
 *   --ersetze-mit <datei> (Setup) die Datei dazu
 *   --entry <vault-pfad> Pflicht beim Messen: die Einstiegsnotiz
 *   --runs <n>           Zahl der Exporte hintereinander (Standard 2, mindestens 1)
 *   --out <datei>        Pflicht beim Messen: das JSON der Messwerte; muss ausserhalb des Repos liegen
 *   --bilder <ordner>    wird angenommen (messlauf reicht ihn durch), der Treiber nimmt keine Bilder auf
 *   --list               Vertrag anzeigen
 *
 * Gemessen wird die Seite an der Datei, wie der Vault sie hat (DOMParser auf dem gelesenen Text, nicht am DOM der Instanz). Die Laufzeit steht nur im JSON, nie in der Seite.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { argv, cwd, env } from "node:process";

import {
  attachTo,
  bereiteInstanzVor,
  closeExtraLeaves,
  ladePluginNeu,
  pollUntil,
  requireVisible,
  type Cdp,
} from "../../tools/obsidian-cdp/cdp.js";
import { createBilanz, parseArgs, runDriver, Vorbedingung } from "../../tools/obsidian-cdp/bilanz.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "hypertext-exporter";
const REPO_ROOT = cwd();
const FIXTURES_DIR = join(REPO_ROOT, "tests", "fixtures");
/** Pflicht: `--port` oder `CDP_PORT`; gesetzt in `main()`. */
let PORT = 0;

const PUNKTE = ["M1", "M2", "M3", "M4"] as const;

function zeigeVertrag(): void {
  console.log(`Messpunkte — ${PUNKTE.length}\n`);
  console.log(`  M1   Plugin ${PLUGIN_ID} geladen, der Vault ist indiziert (jede Markdown-Datei im metadataCache, Einstiegsnotiz traegt den Block hypertext)`);
  console.log("  M2   jeder Export liefert Ergebnisdatei ok:true ohne error-Befund");
  console.log("  M3   alle Laeufe: Seite und Ergebnisdatei SHA-256-gleich (bei einem Lauf: nicht anwendbar)");
  console.log("  M4   die Seite: jeder interne Sprung hat ein Ziel, keine doppelte id, kein app://, capacitor:// oder file://");
  console.log("\nDie Zahlen (Notizen, Spruenge, Groesse, Laufzeit, Befunde je Code) stehen im JSON unter --out; sie sind Messwerte, kein Soll.");
}

/** Der Vault aus dem Ordner `--quelle`: Notizen kopieren, Vault-Konfiguration aus `tests/fixtures/obsidian`, Plugin aus dem gebauten Repo, optional eine Datei ersetzen. */
function setup(quelle: string, vaultName: string, ersetze: string | undefined, ersetzeMit: string | undefined): void {
  if (!existsSync(quelle)) throw new Error(`--quelle ${quelle} gibt es nicht.`);
  if ((ersetze === undefined) !== (ersetzeMit === undefined)) throw new Error("--ersetze und --ersetze-mit gehoeren zusammen.");
  const vaultDir = stagingVaultDir(vaultName);
  const arbeit = mkdtempSync(join(tmpdir(), "ht-measure-fixture-"));
  try {
    cpSync(quelle, join(arbeit, "notes"), {
      recursive: true,
      filter: (pfad) => {
        const erster = relative(quelle, pfad).split("/")[0];
        return erster !== ".git" && erster !== ".obsidian";
      },
    });
    cpSync(join(FIXTURES_DIR, "obsidian"), join(arbeit, "obsidian"), { recursive: true });
    const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: arbeit, pluginId: PLUGIN_ID, pluginFiles: ["main.js", "manifest.json"] });
    console.log(`Staging-Vault: ${vaultDir}`);
    for (const zeile of log) console.log(`  ${zeile}`);
    if (ersetze !== undefined && ersetzeMit !== undefined) {
      const ziel = join(vaultDir, ersetze);
      if (!existsSync(ziel)) throw new Error(`--ersetze ${ersetze}: die Datei gibt es im Vault nicht.`);
      copyFileSync(ersetzeMit, ziel);
      console.log(`  ${ersetze} ersetzt durch ${ersetzeMit}`);
    }
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

interface Zaehler { code: string; severity: string; anzahl: number; beispiele: Array<{ message: string; notePath?: string; recipePath?: string }> }
interface Ergebnis {
  ok: boolean;
  path: string | null;
  errors: number;
  warnings: number;
  infos: number;
  /** SHA-256 des Textes der Ergebnisdatei, wie der Lauf ihn zurueckgab. */
  sha256: string;
  befunde: Zaehler[];
}
interface SeitenMass {
  bytes: number;
  sha256: string;
  notizen: number;
  spruenge: { gesamt: number; mitZiel: number; ohneZiel: number; ohneZielListe: string[]; leer: number };
  doppelteIds: { anzahl: number; liste: string[] };
  adressen: { app: number; capacitor: number; file: number; beispiele: string[] };
  ressourcen: { srcOhneData: number; linkElemente: number; importRegeln: number; urlOhneData: number; skripte: number };
  elemente: { details: number; detailsOffen: number; summary: number; tabellenBehaelter: number; svg: number; ids: number };
}
interface LaufMass { nr: number; laufzeitMs: number; ergebnis: Ergebnis; seite: SeitenMass | null }

/** Einen Auftrag im Renderer anstossen und von aussen abwarten: `Cdp.send` bricht nach 30 s ab, ein Export dauert laenger. Der Rumpf liefert den Wert, der unter `window.__htMessung[name]` landet. */
async function starteUndWarte<T>(cdp: Cdp, name: string, rumpf: string, frist: number): Promise<T> {
  await cdp.evaluate<boolean>(`
    const w = window;
    w.__htMessung = w.__htMessung || {};
    w.__htMessung[${JSON.stringify(name)}] = { fertig: false };
    (async () => { ${rumpf} })().then(
      (wert) => { w.__htMessung[${JSON.stringify(name)}] = { fertig: true, wert }; },
      (e) => { w.__htMessung[${JSON.stringify(name)}] = { fertig: true, fehler: String((e && e.stack) || e) }; },
    );
    return true;
  `);
  const stand = await pollUntil<{ wert?: T; fehler?: string }>(cdp, `
    const s = window.__htMessung[${JSON.stringify(name)}];
    return s && s.fertig ? s : null;
  `, frist, 1000);
  if (stand === null) throw new Vorbedingung(`${name}: nach ${Math.round(frist / 1000)} s nicht fertig`);
  if (stand.fehler !== undefined) throw new Error(`${name}: ${stand.fehler}`);
  return stand.wert as T;
}

/** Die Seite an der Datei messen (Text aus dem Vault, `DOMParser` auf dem Text). */
const MESS_SEITE = (pfad: string): string => `
  const a = app.vault.adapter;
  const hex = (d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const roh = await a.readBinary(${JSON.stringify(pfad)});
  const sha256 = hex(await crypto.subtle.digest("SHA-256", roh));
  const text = new TextDecoder("utf-8").decode(roh);
  const doc = new DOMParser().parseFromString(text, "text/html");
  const ids = new Map();
  for (const e of doc.querySelectorAll("[id]")) ids.set(e.id, (ids.get(e.id) || 0) + 1);
  for (const e of doc.querySelectorAll("a[name]")) { const n = e.getAttribute("name"); if (!ids.has(n)) ids.set(n, 1); }
  const doppelt = [...ids].filter(([, n]) => n > 1).map(([id]) => id);
  const hrefs = [...doc.querySelectorAll('a[href^="#"]')].map((x) => x.getAttribute("href"));
  const echte = hrefs.filter((h) => h.length > 1);
  const ziel = (h) => { let x = h.slice(1); try { x = decodeURIComponent(x); } catch {} return x; };
  const ohne = echte.filter((h) => !ids.has(ziel(h)));
  const zaehle = (re) => (text.match(re) || []).length;
  const beispiele = [];
  for (const re of [/app:\\/\\//g, /capacitor:\\/\\//g, /file:\\/\\//g]) {
    const m = re.exec(text);
    if (m) beispiele.push(text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\\s+/g, " "));
  }
  return {
    bytes: roh.byteLength,
    sha256,
    notizen: doc.querySelectorAll("[data-ht-note]").length,
    spruenge: { gesamt: echte.length, mitZiel: echte.length - ohne.length, ohneZiel: ohne.length, ohneZielListe: [...new Set(ohne)].slice(0, 50), leer: hrefs.length - echte.length },
    doppelteIds: { anzahl: doppelt.length, liste: doppelt.slice(0, 50) },
    adressen: { app: zaehle(/app:\\/\\//g), capacitor: zaehle(/capacitor:\\/\\//g), file: zaehle(/file:\\/\\//g), beispiele },
    ressourcen: {
      srcOhneData: [...doc.querySelectorAll("[src]")].filter((e) => !(e.getAttribute("src") || "").startsWith("data:")).length,
      linkElemente: doc.querySelectorAll("link").length,
      importRegeln: zaehle(/@import/g),
      urlOhneData: zaehle(/url\\(\\s*(?!['"]?data:)/gi),
      skripte: doc.querySelectorAll("script").length,
    },
    elemente: {
      details: doc.querySelectorAll("details").length,
      detailsOffen: doc.querySelectorAll("details[open]").length,
      summary: doc.querySelectorAll("summary").length,
      tabellenBehaelter: doc.querySelectorAll(".ht-table").length,
      svg: doc.querySelectorAll("svg").length,
      ids: ids.size,
    },
  };
`;

/** Der Export ueber die Schnittstelle des Plugins; liefert die Laufzeit und die Zusammenfassung des Textes der Ergebnisdatei (die Befunde nach Code, je Code wenige Beispiele). */
const MESS_EXPORT = (eintrag: string): string => `
  const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
  if (!plugin || !plugin.api) throw new Error("Plugin oder plugin.api fehlt");
  const t0 = performance.now();
  const text = await plugin.api.exportAndWait(${JSON.stringify(eintrag)});
  const laufzeitMs = Math.round(performance.now() - t0);
  const hex = (d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sha256 = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const j = JSON.parse(text);
  const je = new Map();
  for (const f of j.findings || []) {
    const k = f.code + "|" + f.severity;
    const z = je.get(k) || { code: f.code, severity: f.severity, anzahl: 0, beispiele: [] };
    z.anzahl++;
    if (z.beispiele.length < 3) z.beispiele.push({ message: f.message, ...(f.notePath ? { notePath: f.notePath } : {}), ...(f.recipePath ? { recipePath: f.recipePath } : {}) });
    je.set(k, z);
  }
  return { laufzeitMs, ergebnis: { ok: j.ok, path: j.path, errors: j.errors, warnings: j.warnings, infos: j.infos, sha256, befunde: [...je.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.severity < b.severity ? -1 : 1)) } };
`;

/** Pfad der Seite zur Einstiegsnotiz, wenn die Ergebnisdatei keinen nennt (Ziel „neben der Einstiegsnotiz“). */
const seitenPfadNeben = (entry: string): string => entry.replace(/\.md$/i, ".html");
const ergebnisPfadNeben = (entry: string): string => entry.replace(/\.md$/i, ".export.json");

async function lauf(vaultName: string, entry: string, runs: number, out: string): Promise<void> {
  const cdp = await attachTo("workspace", PORT, vaultName);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Fenster fuer Vault "${vaultName}" auf Port ${PORT}. ` +
      "Laeuft die Zweitinstanz (Profil, Port, Vault in obsidian.json — siehe messlauf.sh)?",
    );
  }

  const konsole: string[] = [];
  const bilanz = createBilanz({ punkte: PUNKTE });
  const laeufe: LaufMass[] = [];
  let indexMs = 0;
  let version = "";

  try {
    await cdp.mitschnitt((zeile) => konsole.push(zeile));
    await requireVisible(cdp);
    const instanz = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: vaultName, sprache: "en" });
    console.log(`Instanz vorbereitet: ${instanz.hinweis}`);
    await closeExtraLeaves(cdp);
    const neu = await ladePluginNeu(cdp, PLUGIN_ID, { repoMainJs: join(REPO_ROOT, "main.js") });
    if (!neu.geladen) throw new Error(`Plugin ${PLUGIN_ID} nicht aktiv — ${neu.hinweis}`);
    if (!neu.aktuell) throw new Error(neu.hinweis);
    console.log(`${neu.hinweis}\n`);

    await bilanz.punkt("M1", async () => {
      const t0 = Date.now();
      const stand = await pollUntil<{ dateien: number; version: string }>(cdp, `
        const dateien = app.vault.getMarkdownFiles();
        if (dateien.length === 0) return null;
        if (!dateien.every((f) => app.metadataCache.getFileCache(f))) return null;
        const fm = app.metadataCache.getCache(${JSON.stringify(entry)})?.frontmatter;
        if (!fm || !Object.prototype.hasOwnProperty.call(fm, "hypertext")) return null;
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (!p || !p.api) return null;
        return { dateien: dateien.length, version: p.manifest.version };
      `, 300_000, 1000);
      if (stand === null) throw new Vorbedingung(`der Vault wurde nicht fertig indiziert (300 s), oder ${entry} traegt keinen Block hypertext, oder plugin.api fehlt`);
      indexMs = Date.now() - t0;
      version = stand.version;
      bilanz.record("M1", true, `${stand.dateien} Markdown-Dateien indiziert (${indexMs} ms nach dem Laden), Plugin ${stand.version}, ${entry} traegt den Block hypertext`);
    });

    if (!bilanz.eintraege().some((e) => e.name === "M1" && e.zustand === "gruen")) throw new Vorbedingung("M1 ist nicht gruen, es wird nicht exportiert");

    const seitenPfad = seitenPfadNeben(entry);
    const ergebnisPfad = ergebnisPfadNeben(entry);
    for (let nr = 1; nr <= runs; nr++) {
      // Eine Seite von einem frueheren Lauf soll nicht als neue gelten.
      await cdp.evaluate<boolean>(`
        for (const p of [${JSON.stringify(seitenPfad)}, ${JSON.stringify(ergebnisPfad)}]) if (await app.vault.adapter.exists(p)) await app.vault.adapter.remove(p);
        return true;
      `);
      console.log(`Lauf ${nr} von ${runs}: Export ${entry} …`);
      const roh = await starteUndWarte<{ laufzeitMs: number; ergebnis: Ergebnis }>(cdp, `export${nr}`, MESS_EXPORT(entry), 40 * 60_000);
      const pfad = roh.ergebnis.path ?? seitenPfad;
      const vorhanden = await cdp.evaluate<boolean>(`return await app.vault.adapter.exists(${JSON.stringify(pfad)});`);
      const seite = vorhanden ? await starteUndWarte<SeitenMass>(cdp, `seite${nr}`, MESS_SEITE(pfad), 10 * 60_000) : null;
      laeufe.push({ nr, laufzeitMs: roh.laufzeitMs, ergebnis: roh.ergebnis, seite });
      console.log(`  ${roh.laufzeitMs} ms, ok:${String(roh.ergebnis.ok)}, Fehler ${roh.ergebnis.errors}, Warnungen ${roh.ergebnis.warnings}, Hinweise ${roh.ergebnis.infos}, Seite ${seite === null ? "fehlt" : `${seite.bytes} Byte, ${seite.notizen} Notizen, ${seite.spruenge.gesamt} Spruenge`}`);
    }

    await bilanz.punkt("M2", async () => {
      const schlecht = laeufe.filter((l) => !l.ergebnis.ok || l.ergebnis.errors > 0 || l.seite === null);
      bilanz.record("M2", schlecht.length === 0, schlecht.length === 0
        ? `${laeufe.length} Exporte ok:true, keine Fehlerbefunde`
        : `Lauf ${schlecht.map((l) => l.nr).join(", ")}: ok:false, Fehlerbefund oder keine Seite`);
    });

    await bilanz.punkt("M3", async () => {
      if (laeufe.length < 2) { bilanz.skipped("M3", "nur ein Lauf"); return; }
      const erste = laeufe[0]!;
      const alleGleich = laeufe.every((l) => l.seite !== null && erste.seite !== null && l.seite.sha256 === erste.seite.sha256 && l.ergebnis.sha256 === erste.ergebnis.sha256);
      bilanz.record("M3", alleGleich, alleGleich
        ? `${laeufe.length} Laeufe byte-gleich (Seite ${erste.seite?.sha256.slice(0, 12)}, Ergebnisdatei ${erste.ergebnis.sha256.slice(0, 12)})`
        : laeufe.map((l) => `Lauf ${l.nr}: Seite ${l.seite?.sha256.slice(0, 12) ?? "fehlt"}, Ergebnisdatei ${l.ergebnis.sha256.slice(0, 12)}`).join("; "));
    });

    await bilanz.punkt("M4", async () => {
      const seite = laeufe.find((l) => l.seite !== null)?.seite;
      if (seite === null || seite === undefined) throw new Vorbedingung("kein Lauf lieferte eine Seite");
      const ok = seite.spruenge.ohneZiel === 0 && seite.doppelteIds.anzahl === 0 && seite.adressen.app + seite.adressen.capacitor + seite.adressen.file === 0;
      bilanz.record("M4", ok, `${seite.spruenge.gesamt} Spruenge, ohne Ziel ${seite.spruenge.ohneZiel}; doppelte ids ${seite.doppelteIds.anzahl}; app:// ${seite.adressen.app}, capacitor:// ${seite.adressen.capacitor}, file:// ${seite.adressen.file}`);
    });
  } finally {
    // Die Messwerte stehen auch bei einem roten Punkt oder Abbruch im JSON, soweit gemessen.
    const ziel = resolve(out);
    mkdirSync(dirname(ziel), { recursive: true });
    writeFileSync(ziel, `${JSON.stringify({
      vault: vaultName,
      entry,
      plugin: version,
      laeufe: runs,
      indexierungMs: indexMs,
      konsole: konsole.slice(0, 50),
      laeufeMass: laeufe,
    }, null, 2)}\n`);
    console.log(`\nMesswerte: ${ziel}`);
    cdp.close();
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

  const vaultName = args.value("vault");
  if (vaultName === undefined) throw new Error("--vault <name> fehlt (Name des Staging-Vaults).");

  if (args.has("setup")) {
    const quelle = args.value("quelle");
    if (quelle === undefined) throw new Error("--quelle <ordner> fehlt (Ordner, dessen Dateien den Vault fuellen).");
    if (!existsSync(join(REPO_ROOT, "main.js"))) throw new Error("main.js fehlt — erst `npm run build`.");
    return setup(resolve(quelle), vaultName, args.value("ersetze"), args.value("ersetze-mit"));
  }

  const entry = args.value("entry");
  if (entry === undefined) throw new Error("--entry <vault-pfad> fehlt (die Einstiegsnotiz).");
  const out = args.value("out");
  if (out === undefined) throw new Error("--out <datei> fehlt (JSON der Messwerte, ausserhalb des Repos).");
  const rel = relative(REPO_ROOT, resolve(out));
  if (!(rel.startsWith("..") || isAbsolute(rel))) throw new Error(`--out ${out} liegt im Repo; die Messwerte gehoeren nicht in einen Commit.`);
  const runsText = args.value("runs") ?? "2";
  const runs = Number(runsText);
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs erwartet eine ganze Zahl ab 1, bekam ${JSON.stringify(runsText)}`);
  if (!existsSync(join(REPO_ROOT, "main.js"))) throw new Error("main.js fehlt — erst `npm run build`.");
  await lauf(vaultName, entry, runs, out);
}

runDriver(main);
