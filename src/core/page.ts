// Seitenaufbau (Bauplan Task 10, Spec 10.2 und 12): setzt Navigation, Inhalt, Stile und Stempel zusammen.
// Das vollständige Dokument (Kopf, CSP mit der Prüfsumme genau des ausgegebenen `<style>`-Inhalts, Zeilenenden) baut das Kit (`buildScreenDocument`, Bestellung 9).
import { escapeHtmlAttr, escapeHtmlText } from '../vendor/kit/html-escape';
import { buildScreenDocument } from '../vendor/kit/screen-document';
import { PAGE_TEXTS, type PageLang } from './page-texts';

export interface PageInput {
  title: string;
  lang: PageLang;
  /** Einstieg, Gruppen und lose Notizen der obersten Ebene für die Navigation, in der Reihenfolge der Seite; `anchor` ist die Marke ohne `#`. */
  toc: Array<{ anchor: string; title: string }>;
  /** Der fertige Inhalt (Kinder werden in `<main id="inhalt">` übernommen); wird nur gelesen, nie verändert. */
  body: HTMLElement;
  /** Grundgestaltung und Thema, schon zu einem Text verbunden. */
  css: string;
  /** MathJax-Stile nach `filterMathCss`; "" wenn die Seite keine Formel trägt. */
  mathCss: string;
  /** `stampMeta(...)`: `<meta>`-Zeilen für den Kopf; "" schreibt nichts. */
  stamp: string;
}

const HEAD_ANCHOR = '</title>\n';

function navigation(input: PageInput): string {
  const texts = PAGE_TEXTS[input.lang];
  const items = input.toc.map((e) => `<li><a href="#${escapeHtmlAttr(e.anchor)}">${escapeHtmlText(e.title)}</a></li>`);
  return (
    `<nav aria-label="${escapeHtmlAttr(texts.tocHeading)}">\n` +
    `<a class="ht-skip" href="#inhalt">${escapeHtmlText(texts.skipLink)}</a>\n` +
    (items.length > 0 ? `<ul>\n${items.join('\n')}\n</ul>\n` : '') +
    '</nav>'
  );
}

/**
 * Der Inhalt als Text; jedes `<pre>` bekommt `tabindex="0"`, jede Tabelle ohne Behälter einen `div.ht-table[tabindex=0]` (waagerecht scrollbar und per Tastatur erreichbar,
 * wie die Übersicht der Gruppen). Gearbeitet wird an einer Kopie.
 */
function contentHtml(body: HTMLElement): string {
  const copy = body.cloneNode(true) as HTMLElement;
  for (const pre of Array.from(copy.querySelectorAll('pre'))) pre.setAttribute('tabindex', '0');
  for (const table of Array.from(copy.querySelectorAll('table'))) {
    if (table.parentElement?.classList.contains('ht-table') === true) continue;
    const box = copy.ownerDocument.createElement('div');
    box.className = 'ht-table';
    box.setAttribute('tabindex', '0');
    table.replaceWith(box);
    box.appendChild(table);
  }
  return copy.innerHTML;
}

/**
 * Das vollständige, eigenständige HTML-Dokument. Ein `<style>` (Grundgestaltung und Thema, dann MathJax-Stile), kein Skript, nur `\n`; gleiche Eingabe ergibt gleiche Bytes.
 *
 * Der Stempel steht im Kopf direkt hinter `<title>`: `buildScreenDocument` kennt keinen Platz für zusätzliche Kopfzeilen, und die Prüfsumme der CSP deckt nur den Inhalt
 * zwischen `<style>` und `</style>`, den der Einschub nicht berührt. Der Titel ist maskiert, das erste `</title>\n` ist also das echte.
 *
 * Ohne Skript kann das Kit nicht scheitern (Fehler gibt es nur für `</script` und `<!--` im Skript); der Fehlerzweig ist deshalb ein Programmfehler und wirft.
 */
export function buildPage(input: PageInput): string {
  const css = input.mathCss === '' ? input.css : `${input.css}\n${input.mathCss}`;
  const bodyHtml = `${navigation(input)}\n<main id="inhalt">\n${contentHtml(input.body)}\n</main>`;
  const result = buildScreenDocument({ title: input.title, lang: input.lang, css, bodyHtml });
  if (!result.ok) throw new Error(`buildPage: Kit-Dokument abgelehnt (${result.error})`);
  if (input.stamp === '') return result.html;
  const at = result.html.indexOf(HEAD_ANCHOR);
  if (at < 0) throw new Error('buildPage: kein </title> im Kit-Dokument');
  const cut = at + HEAD_ANCHOR.length;
  return `${result.html.slice(0, cut)}${input.stamp.replace(/\r\n?/g, '\n')}\n${result.html.slice(cut)}`;
}
