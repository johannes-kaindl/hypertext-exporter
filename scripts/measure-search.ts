/**
 * Tempo der Suche auf einer grossen Seite (Spec 10.14, Bauplan Etappe 7, letzter Punkt).
 *
 * Aus einer exportierten Beispielseite entsteht eine Probeseite von rund 10 MB: der Inhalt von `main#inhalt` wird vervielfacht (Kopf, Stil, Skript und CSP bleiben
 * Byte fuer Byte die der Beispielseite, die Pruefsummen gelten also weiter). Sie wird in headless Chrome (eigenes Profil, eigener Port, Lock davor) als `file://` geoeffnet;
 * gemessen wird per CDP die Zeit vom `input`-Ereignis bis zum Ende des Handlers (`dispatchEvent` laeuft synchron durch alle Handler) und, in einer zweiten Spalte, bis zum
 * erzwungenen Layout danach. Der erste Lauf (das Skript liest beim ersten Tippen den Text aller Bereiche und baut den Schluessel) steht getrennt, je frischem Laden der Seite.
 *
 * Aufruf (Lock auf den Port zuerst, nie 9222, nie der Port der Zweitinstanz):
 *   npm run measure:search -- --seite <html> --ordner <ausgabeordner ausserhalb des Repos> --port <port> [--ziel-mb 10] [--drossel 4]
 * Ergebnis: `<ordner>/probe.html` (die Probeseite), `<ordner>/messung.json` und eine Tabelle auf der Standardausgabe.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { argv, cwd } from "node:process";

import { parseArgs, runDriver, Vorbedingung } from "../../tools/obsidian-cdp/bilanz.js";
import { oeffneSeiteInChrome } from "./gui-smoke-live.js";

const REPO_ROOT = cwd();

interface Zeile { art: string; laenge: number; abfrage: string; treffer: number | null; handlerMs: number[]; layoutMs: number[] }

/** Probeseite: den Inhalt von `main#inhalt` so oft hintereinander setzen, bis die Datei das Ziel erreicht. */
export function baueProbe(html: string, zielBytes: number): { html: string; kopien: number; inhaltBytes: number } {
  const auf = html.indexOf('<main id="inhalt">');
  const zu = html.lastIndexOf("</main>");
  if (auf < 0 || zu < auf) throw new Vorbedingung('die Seite hat kein <main id="inhalt">');
  const von = auf + '<main id="inhalt">'.length;
  const inhalt = html.slice(von, zu);
  const rest = Buffer.byteLength(html, "utf8") - Buffer.byteLength(inhalt, "utf8");
  const kopien = Math.max(1, Math.round((zielBytes - rest) / Buffer.byteLength(inhalt, "utf8")));
  return { html: html.slice(0, von) + inhalt.repeat(kopien) + html.slice(zu), kopien, inhaltBytes: Buffer.byteLength(inhalt, "utf8") };
}

/** Funktionskoerper im Renderer: Statistik der Seite und zwei Abfragen (haeufigstes und seltenes Wort, jeweils ab 5 Buchstaben). */
const SEITE_LESEN = `
  const blaetter = [...document.querySelectorAll("main#inhalt details[data-ht-note], main#inhalt details[data-export-fold='section']")];
  const w = document.createTreeWalker(document.querySelector("main#inhalt"), NodeFilter.SHOW_TEXT);
  const teile = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) teile.push(n.data);
  const text = teile.join(" ").toLowerCase();
  const zaehl = new Map();
  for (const w of text.match(/[a-zäöüß]{5,}/g) ?? []) zaehl.set(w, (zaehl.get(w) ?? 0) + 1);
  const sortiert = [...zaehl].sort((a, b) => b[1] - a[1]);
  const haeufig = sortiert[0]?.[0] ?? "";
  const selten = (sortiert.filter((e) => e[1] <= 3).sort((a, b) => b[0].length - a[0].length)[0] ?? sortiert[sortiert.length - 1])?.[0] ?? "";
  return { einheiten: blaetter.length, textZeichen: text.length, knoten: document.getElementsByTagName("*").length, haeufig, haeufigAnzahl: zaehl.get(haeufig) ?? 0, selten, seltenAnzahl: zaehl.get(selten) ?? 0 };
`;

/** Funktionskoerper: ein Tippen. `wert` ins Feld, `input` ausloesen, Zeit bis zum Ende des Handlers und bis zum Layout. Danach (nicht gezaehlt) leeren. */
function tippen(wert: string, leeren: boolean): string {
  return `
    const feld = document.getElementById("suche");
    const t0 = performance.now();
    feld.value = ${JSON.stringify(wert)};
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    const t1 = performance.now();
    void document.body.offsetHeight;
    const t2 = performance.now();
    const zahl = document.getElementById("werkzeug--zahl")?.textContent ?? "";
    ${leeren ? `feld.value = ""; feld.dispatchEvent(new Event("input", { bubbles: true })); void document.body.offsetHeight;` : ""}
    return { handler: t1 - t0, layout: t2 - t0, zahl };
  `;
}

function median(werte: number[]): number {
  const s = [...werte].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}
const fix = (n: number): string => (Number.isFinite(n) ? n.toFixed(n < 10 ? 1 : 0) : "-");

async function main(): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const seite = args.value("seite");
  const ordnerArg = args.value("ordner");
  if (!seite || !ordnerArg) throw new Error("--seite <html> und --ordner <ausgabeordner> fehlen.");
  const ordner = resolve(ordnerArg);
  if (!relative(REPO_ROOT, ordner).startsWith("..") || isAbsolute(relative(REPO_ROOT, ordner))) throw new Error("--ordner muss ausserhalb des Repos liegen.");
  const portText = args.value("port") ?? process.env.CDP_PORT;
  if (!portText || !Number.isInteger(Number(portText)) || Number(portText) === 9222) throw new Error("--port <port> fehlt (oder CDP_PORT); ganze Zahl, nie 9222 (reguläre Instanz).");
  const port = Number(portText);
  const zielMb = Number(args.value("ziel-mb") ?? "10");
  const drossel = Number(args.value("drossel") ?? "4");
  const wiederholungen = Number(args.value("n") ?? "15");
  const frisch = Number(args.value("frisch") ?? "5");

  const quelle = readFileSync(seite, "utf8");
  const probe = baueProbe(quelle, zielMb * 1024 * 1024);
  mkdirSync(ordner, { recursive: true });
  const probePfad = join(ordner, "probe.html");
  writeFileSync(probePfad, probe.html);
  const bytes = Buffer.byteLength(probe.html, "utf8");
  console.log(`Probeseite: ${bytes} Byte (${(bytes / 1048576).toFixed(2)} MB), ${probe.kopien} Kopien des Inhalts (${probe.inhaltBytes} Byte je Kopie); Beispielseite ${Buffer.byteLength(quelle, "utf8")} Byte`);

  interface Seite { einheiten: number; textZeichen: number; knoten: number; haeufig: string; haeufigAnzahl: number; selten: string; seltenAnzahl: number }
  const ergebnis: { seite: Seite | null; version: string; erster: Record<string, number[]>; zeilen: Record<string, Zeile[]> } = { seite: null, version: "", erster: {}, zeilen: {} };

  for (const rate of [1, drossel]) {
    // Erster Lauf je frischem Laden: ein Zeichen, Index wird gebaut.
    const ersterLauf: number[] = [];
    const ersterLayout: number[] = [];
    for (let i = 0; i < frisch; i++) {
      const chrome = await oeffneSeiteInChrome(probePfad, port);
      try {
        ergebnis.version = chrome.version;
        await chrome.cdp.send("Emulation.setCPUThrottlingRate", { rate });
        const s = await chrome.cdp.evaluate<Seite>(SEITE_LESEN);
        ergebnis.seite = s;
        const bereit = await chrome.cdp.evaluate<boolean>(`return !document.getElementById("werkzeug").hasAttribute("hidden");`);
        if (!bereit) throw new Vorbedingung("der Werkzeug-Block ist nicht sichtbar: das Skript lief nicht (CSP?)");
        const abfrage = (s.haeufig || "e").slice(0, 1);
        const m = await chrome.cdp.evaluate<{ handler: number; layout: number; zahl: string }>(tippen(abfrage, true));
        ersterLauf.push(m.handler);
        ersterLayout.push(m.layout);
      } finally {
        await chrome.stoppe();
      }
    }
    ergebnis.erster[`x${rate}`] = ersterLauf;
    ergebnis.erster[`x${rate}-layout`] = ersterLayout;

    // Folgelaeufe auf einer Seite: Index steht, je Laenge und Abfrageart `n` Wiederholungen.
    const chrome = await oeffneSeiteInChrome(probePfad, port);
    try {
      await chrome.cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const s = await chrome.cdp.evaluate<Seite>(SEITE_LESEN);
      await chrome.cdp.evaluate(tippen((s.haeufig || "e").slice(0, 1), true)); // Index bauen, nicht gezaehlt
      const zeilen: Zeile[] = [];
      for (const [art, wort] of [["haeufig", s.haeufig], ["selten", s.selten]] as const) {
        for (const laenge of [1, 3, 5]) {
          const abfrage = wort.slice(0, laenge);
          const z: Zeile = { art, laenge, abfrage, treffer: null, handlerMs: [], layoutMs: [] };
          for (let i = 0; i < wiederholungen; i++) {
            const m = await chrome.cdp.evaluate<{ handler: number; layout: number; zahl: string }>(tippen(abfrage, true));
            z.handlerMs.push(m.handler);
            z.layoutMs.push(m.layout);
            if (i === 0) z.treffer = Number(/\d+/.exec(m.zahl)?.[0] ?? (m.zahl ? 1 : 0));
          }
          zeilen.push(z);
        }
      }
      ergebnis.zeilen[`x${rate}`] = zeilen;
    } finally {
      await chrome.stoppe();
    }
  }

  writeFileSync(join(ordner, "messung.json"), JSON.stringify(ergebnis, null, 2));
  const s = ergebnis.seite;
  console.log(`\n${ergebnis.version}; ${s?.einheiten} Einheiten, ${s?.textZeichen} Zeichen Text, ${s?.knoten} Elemente; haeufiges Wort „${s?.haeufig}“ (${s?.haeufigAnzahl}x), seltenes „${s?.selten}“ (${s?.seltenAnzahl}x)`);
  console.log("\n| Prozessor | Lauf | Zeichen | Abfrage | Bereiche mit Treffer | Handler Median (ms) | Handler groesster (ms) | bis Layout Median (ms) |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const rate of [1, drossel]) {
    const e = ergebnis.erster[`x${rate}`] ?? [];
    const el = ergebnis.erster[`x${rate}-layout`] ?? [];
    console.log(`| ${rate === 1 ? "ungedrosselt" : `${rate}x gedrosselt`} | erster (Index), ${e.length} frische Seiten | 1 | haeufig | - | ${fix(median(e))} | ${fix(Math.max(...e))} | ${fix(median(el))} |`);
    for (const z of ergebnis.zeilen[`x${rate}`] ?? []) {
      console.log(`| ${rate === 1 ? "ungedrosselt" : `${rate}x gedrosselt`} | danach, ${z.handlerMs.length}x | ${z.laenge} | ${z.art} „${z.abfrage}“ | ${z.treffer} | ${fix(median(z.handlerMs))} | ${fix(Math.max(...z.handlerMs))} | ${fix(median(z.layoutMs))} |`);
    }
  }
  if (!existsSync(dirname(probePfad))) throw new Error("Ausgabeordner fehlt");
}

runDriver(main);
