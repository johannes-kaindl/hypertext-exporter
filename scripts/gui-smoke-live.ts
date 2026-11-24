/**
 * Bausteine fuer die Live-Reste der Abnahme Etappe 5 (Pruefpunkte P7 bis P10 in `gui-smoke.ts`):
 * eine headless Chrome-Instanz fuer die exportierte Seite (`file://`) und die Messausdruecke, die dort und in Obsidian laufen.
 *
 * Chrome lauscht auf einem eigenen Port (Standard 9844, nie 9222 und nie der Port der Zweitinstanz) mit eigenem, wegwerfbarem Profil.
 * Der Treiber haelt dafuer den Lock des Ports; Prozess und Profil raeumt `stoppe` auf, auch nach einem Fehler.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Cdp, pollUntil, type CdpTarget } from "../../tools/obsidian-cdp/cdp.js";
import { Vorbedingung } from "../../tools/obsidian-cdp/bilanz.js";

export const CHROME_PORT_STANDARD = 9844;
const CHROME_PFAD = process.env.HT_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export interface ChromeSeite {
  cdp: Cdp;
  /** Versionszeile von `/json/version` (`Chrome/…`). */
  version: string;
  stoppe(): Promise<void>;
}

/** Startet headless Chrome mit der Seite und verbindet auf sie; `Vorbedingung`, wenn Chrome fehlt oder der Port belegt ist. */
export async function oeffneSeiteInChrome(htmlPfad: string, port: number): Promise<ChromeSeite> {
  if (!existsSync(CHROME_PFAD)) throw new Vorbedingung(`Chrome nicht gefunden (${CHROME_PFAD}); Pfad ueber HT_CHROME setzen`);
  const belegt = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (belegt) throw new Vorbedingung(`Port ${port} ist belegt (fremde Instanz); nicht angefasst`);
  const profil = mkdtempSync(join(tmpdir(), "ht-chrome-"));
  const url = pathToFileURL(htmlPfad).href;
  const proc = spawn(
    CHROME_PFAD,
    [
      "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profil}`, "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--window-size=1000,800", url,
    ],
    { stdio: "ignore" },
  );
  let cdp: Cdp | null = null;
  const stoppe = async (): Promise<void> => {
    if (cdp) cdp.close();
    cdp = null;
    if (proc.exitCode === null) {
      const ende = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
      proc.kill("SIGTERM");
      await Promise.race([ende, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }
    rmSync(profil, { recursive: true, force: true });
  };
  try {
    let version = "";
    let ziel: CdpTarget | undefined;
    for (let i = 0; i < 60 && !ziel; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const v = (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })).json()) as { Browser?: string };
        version = v.Browser ?? "";
        const liste = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json()) as CdpTarget[];
        ziel = liste.find((t) => t.type === "page" && t.url.startsWith("file://") && t.webSocketDebuggerUrl);
      } catch { /* Chrome startet noch */ }
    }
    if (!ziel?.webSocketDebuggerUrl) throw new Vorbedingung(`Chrome zeigte die Seite nicht (30 s, Port ${port})`);
    cdp = await Cdp.connect(ziel.webSocketDebuggerUrl);
    const bereit = await pollUntil<boolean>(cdp, `return document.readyState === "complete";`, 30_000, 200);
    if (!bereit) throw new Vorbedingung("die Seite wurde in Chrome nicht fertig geladen (30 s)");
    return { cdp, version, stoppe };
  } catch (e) {
    await stoppe();
    throw e;
  }
}

/**
 * Funktionskoerper fuer `Cdp.evaluate`: je `mjx-container` unter `scope` eine Zeile je Element (Container und alle Nachfahren) mit den berechneten Werten
 * der tragenden Eigenschaften. Laengen werden auf die Schriftgroesse des Elements bezogen (em), die Schriftgroesse auf die des Elternelements: so haengt der
 * Wert nicht an der Umgebung (Obsidians Lesefenster gegen die Seite), sondern nur an den Regeln, die die Formel selbst treffen.
 */
export function stilMessung(scope: string): string {
  return `
    const PROPS = ["font-family", "font-size", "vertical-align", "display", "margin-top", "margin-right", "margin-bottom", "margin-left",
      "padding-top", "padding-right", "padding-bottom", "padding-left", "width"];
    const px = (v) => (/^-?[\\d.]+px$/.test(v) ? parseFloat(v) : null);
    const rund = (x) => Math.round(x * 1000) / 1000;
    const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); };
    const out = [];
    for (const c of document.querySelectorAll(${JSON.stringify(scope)})) {
      const els = [c, ...c.querySelectorAll("*")];
      const kennung = (e) => e.tagName.toLowerCase() + "." + (e.getAttribute("class") || "");
      const rows = els.map((e) => {
        const cs = getComputedStyle(e);
        const fs = parseFloat(cs.fontSize);
        const pfs = e.parentElement ? parseFloat(getComputedStyle(e.parentElement).fontSize) : fs;
        const p = {};
        for (const n of PROPS) {
          const v = cs.getPropertyValue(n);
          if (n === "font-size") p[n] = rund(fs / pfs) + "x Eltern";
          else if (px(v) !== null && fs > 0) p[n] = rund(px(v) / fs) + "em";
          else p[n] = v;
        }
        return { t: kennung(e), p };
      });
      out.push({ key: (c.getAttribute("display") || "") + "|" + hash(els.map(kennung).join("|")), n: els.length, rows });
    }
    return out;
  `;
}

export interface StilZeile { t: string; p: Record<string, string> }
export interface StilContainer { key: string; n: number; rows: StilZeile[] }

export interface StilVergleich {
  containerA: number;
  containerB: number;
  /** Container, die in beiden Seiten vorkommen (gleiche Anzeige und gleiche Folge der Elemente). */
  gepaart: number;
  nurA: number;
  nurB: number;
  elemente: number;
  werte: number;
  abweichungen: number;
  /** Breiten (`width`): sie summieren Zeichenbreiten aus der Schrift und die Breite der Umgebung. Hier gezaehlt, nicht als Abweichung der Regeln, solange die Seite die MathJax-Schriften nicht traegt (`math.font-url`). */
  schriftbedingt: number;
  /** Je Eigenschaft: Zahl der Abweichungen und bis zu drei Beispiele `Element: A -> B`. */
  nachEigenschaft: Record<string, { n: number; beispiele: string[] }>;
}

/** Zwei gemessene Werte gleich? Zahlen mit Einheit (`0.778em`, `1x Eltern`) gelten bis 0.002 als gleich (Rundung der Laengen aus Pixeln). */
function gleicherWert(a: string, b: string | undefined): boolean {
  if (a === b) return true;
  if (b === undefined) return false;
  const m = /^(-?[\d.]+)(em|x Eltern)$/.exec(a);
  const n = /^(-?[\d.]+)(em|x Eltern)$/.exec(b);
  return m !== null && n !== null && m[2] === n[2] && Math.abs(Number(m[1]) - Number(n[1])) <= 0.002;
}

/** Die Schrift des Containers erbt er aus der Umgebung (Obsidians Lesefenster gegen die Seite): kein Befund ueber die Regeln der Formel. */
function umgebungsabhaengig(zeile: StilZeile, eigenschaft: string): boolean {
  return eigenschaft === "font-family" && zeile.t.startsWith("mjx-container.");
}

/** Vergleicht die Messungen zweier Seiten; je Schluessel wird der Reihe nach gepaart (doppelte Formeln stehen in beiden gleich oft). */
export function vergleicheStile(a: readonly StilContainer[], b: readonly StilContainer[]): StilVergleich {
  const rest = new Map<string, StilContainer[]>();
  for (const c of b) rest.set(c.key, [...(rest.get(c.key) ?? []), c]);
  const r: StilVergleich = { containerA: a.length, containerB: b.length, gepaart: 0, nurA: 0, nurB: 0, elemente: 0, werte: 0, abweichungen: 0, schriftbedingt: 0, nachEigenschaft: {} };
  for (const ca of a) {
    const cb = rest.get(ca.key)?.shift();
    if (!cb) { r.nurA += 1; continue; }
    r.gepaart += 1;
    ca.rows.forEach((za, i) => {
      const zb = cb.rows[i];
      if (!zb) return;
      r.elemente += 1;
      for (const [name, wertA] of Object.entries(za.p)) {
        if (umgebungsabhaengig(za, name)) continue;
        r.werte += 1;
        const wertB = zb.p[name];
        if (gleicherWert(wertA, wertB)) continue;
        if (name === "width") { r.schriftbedingt += 1; continue; }
        r.abweichungen += 1;
        const eintrag = (r.nachEigenschaft[name] ??= { n: 0, beispiele: [] });
        eintrag.n += 1;
        if (eintrag.beispiele.length < 3) eintrag.beispiele.push(`${za.t}: ${wertA} -> ${wertB ?? "(fehlt)"}`);
      }
    });
  }
  for (const list of rest.values()) r.nurB += list.length;
  return r;
}

/** Funktionskoerper: Lage des Textknotens im rohen `details` ("Rohes Aufklappfeld") ueber `Range.getBoundingClientRect`, nicht ueber die Elementhoehe. */
export const DRUCK_MESSUNG = `
  const summary = [...document.querySelectorAll("details > summary")].find((s) => s.textContent.trim() === "Rohes Aufklappfeld");
  if (!summary) return { fehlt: "summary" };
  const d = summary.parentElement;
  const text = [...d.childNodes].find((n) => n.nodeType === 3 && n.data.includes("Dieses Feld bleibt, wie es ist."));
  if (!text) return { fehlt: "Textknoten" };
  const box = (n) => { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
  const vorfahren = [];
  for (let a = d.parentElement; a; a = a.parentElement) if (a.tagName === "DETAILS") vorfahren.push(a.open);
  const inhalt = getComputedStyle(d, "::details-content").contentVisibility;
  return { medienDruck: matchMedia("print").matches, eigenOffen: d.open, vorfahrenOffen: vorfahren, text: box(text), summary: box(summary), inhalt, kinder: [...d.childNodes].map((n) => n.nodeName) };
`;

/** Funktionskoerper: das rohe `details` bzw. alle seine Vorfahren-`details` oeffnen (Gegenproben der Druckmessung). */
export function oeffneDetails(wer: "vorfahren" | "eigenes"): string {
  return `
    const summary = [...document.querySelectorAll("details > summary")].find((s) => s.textContent.trim() === "Rohes Aufklappfeld");
    const d = summary.parentElement;
    ${wer === "eigenes" ? "d.open = true;" : 'for (let a = d.parentElement; a; a = a.parentElement) if (a.tagName === "DETAILS") a.open = true;'}
    return true;
  `;
}

/** Text der gedruckten Seite: `Page.printToPDF` (immer mit Druckstil) und `pdftotext`; `Vorbedingung`, wenn das Werkzeug fehlt. */
export async function gedruckterText(cdp: Cdp): Promise<string> {
  const antwort = (await cdp.send("Page.printToPDF", { printBackground: false })) as unknown as { result?: { data?: string } };
  const daten = antwort.result?.data;
  if (typeof daten !== "string") throw new Vorbedingung("Page.printToPDF lieferte kein PDF");
  const ordner = mkdtempSync(join(tmpdir(), "ht-pdf-"));
  try {
    const datei = join(ordner, "seite.pdf");
    writeFileSync(datei, Buffer.from(daten, "base64"));
    try {
      return execFileSync(process.env.HT_PDFTOTEXT ?? "pdftotext", [datei, "-"], { encoding: "utf8" });
    } catch (e) {
      throw new Vorbedingung(`pdftotext nicht aufrufbar (${(e as Error).message.split("\n")[0]}); Pfad ueber HT_PDFTOTEXT`);
    }
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

const messStile = new WeakMap<Cdp, string>();

/**
 * Setzt einen zusaetzlichen Stil in die Seite (leerer Text nimmt ihn zurueck). Ein `<style>` per Skript liefe gegen die CSP der Seite
 * (`style-src` nur mit Pruefsumme) und bliebe still wirkungslos; `CSS.createStyleSheet` des Protokolls fuegt ein Blatt ein, das die CSP nicht trifft.
 */
export async function setzeMessStil(cdp: Cdp, css: string): Promise<void> {
  let id = messStile.get(cdp);
  if (id === undefined) {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const baum = (await cdp.send("Page.getFrameTree")) as unknown as { result?: { frameTree?: { frame?: { id?: string } } } };
    const frameId = baum.result?.frameTree?.frame?.id;
    if (!frameId) throw new Vorbedingung("Page.getFrameTree nannte keinen Rahmen");
    const neu = (await cdp.send("CSS.createStyleSheet", { frameId })) as unknown as { result?: { styleSheetId?: string } };
    id = neu.result?.styleSheetId;
    if (!id) throw new Vorbedingung("CSS.createStyleSheet lieferte kein Blatt");
    messStile.set(cdp, id);
  }
  await cdp.send("CSS.setStyleSheetText", { styleSheetId: id, text: css });
}
