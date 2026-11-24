// Harte Endprüfung (Bauplan Task 10, Spec 10.4 und 10.8): sieht nur den fertigen Text der Seite.
// Die Marken-Prüfung über die ganze Seite (`mark.duplicate`, `mark.missing-target`) macht allein die Kit-Funktion `checkAnchors` (Bestellung 6).
import { checkAnchors } from '../vendor/kit/anchor-check';
import { dataUrlToBytes } from '../vendor/kit/data-url';
import { guardExportTree, type ExportGuardFinding } from '../vendor/kit/export-guard';
import { escapeHtmlAttr, escapeHtmlText } from '../vendor/kit/html-escape';
import { checkSvg } from '../vendor/kit/svg-guard';
import { CODES } from './finding-codes';
import type { Finding } from './types';

// Gesucht wird in der Form, die der Browser aus der Schreibweise macht (Review Etappe 10, Befund 5): ohne Groß und Klein, mit aufgelösten Entities und Prozentkodierung,
// ohne Tab und Zeilenumbruch (die ein Browser aus einer Adresse streicht). `file:` ist ein Sonderschema: `file:/` und `file:\` führen ebenso zu einer Datei.
const FORBIDDEN: Array<{ needle: string; message: string }> = [
  { needle: 'app://', message: 'Die Seite enthält eine app://-Adresse.' },
  { needle: 'capacitor://', message: 'Die Seite enthält eine capacitor://-Adresse.' },
  { needle: 'file:/', message: 'Die Seite enthält eine file://-Adresse.' },
  { needle: 'file:\\', message: 'Die Seite enthält eine file://-Adresse.' },
];

/** Benannte Entities, die ein Zeichen aus dem Ascii-Bereich ergeben (Adressen bestehen daraus); die Zahlenform löst `decodeEntities` ohne Tabelle. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  tab: '\t', newline: '\n', excl: '!', quot: '"', num: '#', dollar: '$', percnt: '%', amp: '&', apos: "'", lpar: '(', rpar: ')', ast: '*', plus: '+', comma: ',',
  period: '.', sol: '/', colon: ':', semi: ';', lt: '<', equals: '=', gt: '>', quest: '?', commat: '@', lsqb: '[', lbrack: '[', bsol: '\\', rsqb: ']', rbrack: ']',
  hat: '^', lowbar: '_', grave: '`', lcub: '{', lbrace: '{', verbar: '|', vert: '|', rcub: '}', rbrace: '}',
};

function codePointText(code: number): string {
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
}

/** Löst Zahlen-Entities (mit und ohne Semikolon, wie der Browser) und die benannten aus der Tabelle auf; was nicht lesbar ist, bleibt stehen. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+);?|#([0-9]+);?|([a-z]+);)/gi, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (hex !== undefined) return codePointText(parseInt(hex, 16)) || whole;
    if (dec !== undefined) return codePointText(parseInt(dec, 10)) || whole;
    return NAMED_ENTITIES[(name ?? '').toLowerCase()] ?? whole;
  });
}

/** Löst Prozentkodierung auf; eine Folge, die kein gültiges UTF-8 ist, wird nur in ihren Ascii-Bytes aufgelöst, damit sie nichts verbirgt. */
function decodePercent(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try { return decodeURIComponent(run); } catch { return run.replace(/%([0-7][0-9a-f])/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))); }
  });
}

/** Der Text der Seite, wie ein Browser ihn als Adresse läse: Entities und Prozent aufgelöst (bis nichts mehr ändert), klein geschrieben. Tab und Umbruch bleiben für die Pfadsuche stehen. */
function readAsBrowser(html: string): string {
  let text = html;
  for (let i = 0; i < 3; i++) {
    const next = decodePercent(decodeEntities(text));
    if (next === text) break;
    text = next;
  }
  return text.toLowerCase();
}

const USER_PATHS: Array<{ needle: string; message: string }> = [
  { needle: '/Users/', message: 'Die Seite enthält Text, der wie ein Benutzerordner aussieht (/Users/).' },
  { needle: '/home/', message: 'Die Seite enthält Text, der wie ein Benutzerordner aussieht (/home/).' },
  { needle: 'C:\\Users', message: 'Die Seite enthält Text, der wie ein Benutzerordner aussieht (C:\\Users).' },
];

/**
 * `error` `final.forbidden` für `app://`, `capacitor://`, `file://` (ohne Groß und Klein, auch als Entity oder Prozentkodierung geschrieben) und den Vault-Basispfad
 * (roh, `encodeURI`, `encodeURIComponent`, HTML-maskiert, in NFC und NFD, ohne Groß und Klein, auch mit aufgelösten Entities und Prozent);
 * `warning` `final.user-path` für `/Users/`, `/home/`, `C:\Users` (dürfen als Text einer Notiz vorkommen). Ein Befund je Muster, feste Reihenfolge.
 * Die Meldung nennt den Basispfad nie. `basePath` ist `null` oder leer, wo es keinen gibt (Handy): dann entfällt diese Prüfung.
 *
 * Danach die Marken der fertigen Seite `page` über `checkAnchors` (Kit): jede doppelte id `error` `mark.duplicate`, jeder Sprung `#…` ohne Ziel `error` `mark.missing-target`, in der Reihenfolge des Kits.
 */
export function finalCheck(html: string, page: HTMLElement, basePath: string | null): Finding[] {
  const findings: Finding[] = [];
  const raw = html.toLowerCase();
  const decoded = readAsBrowser(html);
  const noBreaks = decoded.replace(/[\t\n\r]/g, '');
  for (const { needle, message } of FORBIDDEN) {
    if (raw.includes(needle) || decoded.includes(needle) || noBreaks.includes(needle)) findings.push({ severity: 'error', code: CODES.finalForbidden, message });
  }
  if (basePath !== null && basePath !== '') {
    const needles = new Set<string>();
    for (const form of [basePath.normalize('NFC'), basePath.normalize('NFD')]) {
      for (const v of [form, encodeURI(form), encodeURIComponent(form), escapeHtmlText(form), escapeHtmlAttr(form)]) needles.add(v.toLowerCase());
    }
    // Die Seite trägt den Pfad roh, maskiert oder kodiert; beide Normalformen der Seite werden gegen beide des Pfades gelesen.
    const hay = [raw, decoded, noBreaks, raw.normalize('NFC'), raw.normalize('NFD'), decoded.normalize('NFC'), decoded.normalize('NFD')];
    if (Array.from(needles).some((n) => hay.some((h) => h.includes(n)))) {
      findings.push({ severity: 'error', code: CODES.finalForbidden, message: 'Die Seite enthält den Pfad des Vault-Ordners.' });
    }
  }
  for (const { needle, message } of USER_PATHS) {
    if (html.includes(needle)) findings.push({ severity: 'warning', code: CODES.finalUserPath, message });
  }
  for (const a of checkAnchors(page)) {
    if (a.kind === 'duplicate-id') {
      findings.push({ severity: 'error', code: CODES.markDuplicate, message: `Die Marke „${a.id}“ steht ${a.count}-mal auf der Seite.` });
    } else {
      findings.push({ severity: 'error', code: CODES.markMissingTarget, message: `Der Sprung ${a.href} („${a.text}“) hat kein Ziel auf der Seite.` });
    }
  }
  return findings;
}

/** Ist `src` ein `data:image/svg+xml;base64,…`, dessen Zeichnung `checkSvg` besteht? */
function svgImageIsChecked(src: string): boolean {
  if (!/^data:image\/svg\+xml;base64,/i.test(src)) return false;
  try {
    return checkSvg(new TextDecoder().decode(dataUrlToBytes(src))).ok;
  } catch {
    return false;
  }
}

const GUARD_KIND_LABEL: Record<ExportGuardFinding['kind'], string> = {
  element: 'Element',
  attribute: 'Attribut',
  declaration: 'Stilangabe',
  svg: 'Zeichnung',
  comment: 'Kommentar',
};

/**
 * Zweiter Schutzdurchgang (Review Etappe 10, Befund 2): der Schutzdurchgang je Notiz urteilt über den Baum, den Obsidian zeichnet. Ein Baum, der beim Schreiben und erneuten Lesen
 * etwas anderes ergibt (Mutation-XSS, etwa `<math><mtext><table><mglyph><style><img onerror>`), besteht ihn und wird erst im gelesenen Text der Seite gefährlich. Deshalb läuft
 * `guardExportTree` noch einmal auf dem neu gelesenen Text der fertigen Seite (`page`, aus `DOMParser`). Jeder Befund dort ist ein `error` `final.guard`, der Export schreibt nichts.
 *
 * Geprüft wird der Körper (Navigation und Inhalt), nicht der Kopf: der `<style>` im Kopf ist der eigene Stil der Seite und trägt Angaben (`attr(href)` im Druckblock),
 * die der Durchgang für fremden Text entfernen würde. Der Baum wird dabei verändert; Aufrufer nehmen ihn danach nicht mehr für andere Prüfungen.
 * Eine Zeichnung als Bild (`<img src="data:image/svg+xml;base64,…">`) setzt der Medienschritt nach `checkSvg` ein; der Durchgang lässt `data:image/svg+xml` als Ziel nicht zu (als Rahmen oder
 * Link liefe es). Hier wird ein solches Bild darum erneut mit `checkSvg` geprüft: besteht es, ist es kein Befund, sonst bleibt sein `src` stehen und der Durchgang meldet es.
 * `ownScript` ist der Text des einen Skripts, das die Seite selbst trägt (`pageScript`); es wird vor dem Durchgang aus dem Baum genommen.
 * Alle Stellen gehen in einen Befund (Art, Element, Name, Zahl), sonst wüchse die Liste mit jedem Treffer.
 */
export function finalGuard(page: ParentNode, ownScript?: string): Finding[] {
  const body = page.querySelector('body') ?? page;
  // Das eine Skript der Seite (Suche und Aufklapp-Helfer, Prüfsumme in der CSP) gehört der Seite, nicht dem fremden Text: nur ein Skript mit genau diesem Text bleibt unbeachtet, jedes andere ist ein Befund.
  if (ownScript !== undefined) {
    for (const script of Array.from(body.querySelectorAll('script'))) if (script.textContent === ownScript) script.remove();
  }
  for (const img of Array.from(body.querySelectorAll('img'))) {
    if (svgImageIsChecked(img.getAttribute('src') ?? '')) img.removeAttribute('src');
  }
  const found = guardExportTree(body);
  if (found.length === 0) return [];
  const labels = new Map<string, number>();
  for (const f of found) {
    const label = `${GUARD_KIND_LABEL[f.kind]} ${f.name !== undefined ? `${f.name} an ${f.element}` : f.element}`;
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  const list = Array.from(labels, ([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(', ');
  return [{ severity: 'error', code: CODES.finalGuard, message: `Der Schutzdurchgang fand in der fertigen Seite noch ${found.length} Stelle(n) mit aktivem Inhalt (${list}); die Seite wird nicht geschrieben.` }];
}
