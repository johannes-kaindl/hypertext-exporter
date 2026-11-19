import { describe, expect, it } from 'vitest';
import { CODES } from '../../src/core/finding-codes';
import { filterMathCss } from '../../src/core/math-css';

// Selbst geschriebene Testdaten im Format des gemessenen MJX-CHTML-styles (Zeichenregeln `mjx-c.mjx-c<HEX>`, `@font-face` mit relativen Adressen).
// Welche Regel welche Schrift nennt, ist erfunden; die Messung (Zusatzmessung 5) trägt nur Selektoren mit Codepunkt und 24 `@font-face`.
const QE = ':root {\n  --mjx-fg-red: 255, 0, 0;\n}';
const TY = '.MJX_HoverRegion {\n  display: block;\n}';
const MENU = '.CtxtMenu_Menu {\n  position: absolute;\n}';

const FACES = {
  zero: '@font-face /* 0 */ {\n  font-family: MJXZERO;\n  src: url("/lib/mathjax/tex-font/chtml/woff2/mjx-tex-zero.woff2") format("woff2");\n}',
  main: '@font-face /* 1 */ {\n  font-family: MJXTEX;\n  src: url("/lib/mathjax/tex-font/chtml/woff2/mjx-tex-n.woff2") format("woff2");\n}',
  italic: '@font-face /* 2 */ {\n  font-family: MJXTEX-I;\n  src: url("/lib/mathjax/tex-font/chtml/woff2/mjx-tex-i.woff2") format("woff2");\n}',
  bold: '@font-face /* 3 */ {\n  font-family: MJXTEX-B;\n  src: url("/lib/mathjax/tex-font/chtml/woff2/mjx-tex-b.woff2") format("woff2");\n}',
};

const BASE_RULES = [
  '\nmjx-container[overflow="scroll"][display] {\n  overflow: auto clip;\n}',
  FACES.zero,
  FACES.main,
  FACES.italic,
  FACES.bold,
  'mjx-c::before {\n  display: block;\n  width: 0;\n}',
  '.TEX-N {\n  font-family: MJXZERO, MJXTEX;\n}',
];

const CHAR = {
  a: 'mjx-c.mjx-c1D44E::before {\n  padding: 0.441em 0.529em 0.01em 0;\n  font-family: "MJXTEX-I";\n  content: "a";\n}',
  two: 'mjx-c.mjx-c32::before {\n  padding: 0.666em 0.5em 0 0;\n  content: "2";\n}',
  bold: 'mjx-c.mjx-c1D400::before {\n  padding: 0.686em 0.869em 0 0;\n  font-family: MJXTEX-B;\n  content: "A";\n}',
  arrow: 'mjx-c.mjx-c2192::before {\n  padding: 0.511em 1em 0.011em 0;\n  content: "\\2192";\n}',
};

function chtml(...chars: string[]): string {
  return [...BASE_RULES, ...chars].join('\n');
}
const cps = (...c: string[]): Set<string> => new Set(c);

describe('filterMathCss', () => {
  it('behält Zeichenregeln nur für benutzte Codepunkte', () => {
    const { css } = filterMathCss([chtml(CHAR.a, CHAR.two, CHAR.bold, CHAR.arrow)], cps('1D44E', '32'));
    expect(css).toContain('mjx-c1D44E');
    expect(css).toContain('mjx-c32::before');
    expect(css).not.toContain('mjx-c1D400');
    expect(css).not.toContain('mjx-c2192');
    expect(css).toContain('mjx-container[overflow="scroll"][display]');
    expect(css).toContain('mjx-c::before');
  });

  it('meldet nur Schriften der Familien, die eine behaltene Regel nennt', () => {
    const { css, findings } = filterMathCss([chtml(CHAR.a, CHAR.bold)], cps('1D44E'));
    expect(css).not.toContain('mjx-tex-b.woff2');
    expect(findings.map((f) => f.message).join(' ')).not.toContain('mjx-tex-b.woff2');
    expect(findings.map((f) => f.message).join(' ')).toContain('mjx-tex-i.woff2');
  });

  it('nimmt ein @font-face mit einer Adresse, die nicht data: ist, aus der Seite (sie lädt nichts nach, Erwartung 30) und meldet jede Adresse einmal als info math.font-url, nach Zeichenfolge', () => {
    const { css, findings } = filterMathCss([chtml(CHAR.a)], cps('1D44E'));
    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('/lib/mathjax');
    expect(css).toContain('mjx-c1D44E');
    expect(findings.map((f) => f.code)).toEqual([CODES.mathFontUrl, CODES.mathFontUrl, CODES.mathFontUrl]);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
    expect(findings.map((f) => f.message)).toEqual([
      expect.stringContaining('/lib/mathjax/tex-font/chtml/woff2/mjx-tex-i.woff2'),
      expect.stringContaining('/lib/mathjax/tex-font/chtml/woff2/mjx-tex-n.woff2'),
      expect.stringContaining('/lib/mathjax/tex-font/chtml/woff2/mjx-tex-zero.woff2'),
    ]);
  });

  it('behält ein @font-face, dessen Quelle data: ist', () => {
    const css = '@font-face { font-family: Eigen; src: url(data:font/woff2;base64,AAAA); }\n.x { font-family: Eigen; }';
    expect(filterMathCss([css], cps()).css).toContain('@font-face');
  });

  it('meldet keine Adresse für data:-Schriften und keine für entfernte Regeln', () => {
    const css = '@font-face { font-family: Eigen; src: url(data:font/woff2;base64,AAAA); }\n.x { font-family: Eigen; }';
    expect(filterMathCss([css], cps()).findings).toEqual([]);
  });

  it('gleiche Codepunkte ergeben dieselbe Zeichenkette, egal welche weiteren Regeln die Eingabe trägt', () => {
    const wenig = filterMathCss([chtml(CHAR.a, CHAR.two)], cps('1D44E', '32'));
    const viel = filterMathCss([chtml(CHAR.bold, CHAR.a, CHAR.arrow, CHAR.two)], cps('1D44E', '32'));
    expect(viel.css).toBe(wenig.css);
    expect(viel.findings).toEqual(wenig.findings);
  });

  it('Groß-/Kleinschreibung, führende Nullen und U+ ändern nichts', () => {
    const a = filterMathCss([chtml(CHAR.a, CHAR.two)], cps('1D44E', '32'));
    const b = filterMathCss([chtml(CHAR.a, CHAR.two)], cps('U+1d44e', '0032'));
    expect(b.css).toBe(a.css);
  });

  it('vertauschte Reihenfolge der Eingabe-Elemente ändert nichts', () => {
    const sheets = [QE, TY, MENU, chtml(CHAR.a)];
    const used = cps('1D44E');
    const first = filterMathCss(sheets, used).css;
    expect(filterMathCss([...sheets].reverse(), used).css).toBe(first);
    expect(filterMathCss([sheets[2] as string, sheets[0] as string, sheets[3] as string, sheets[1] as string], used).css).toBe(first);
    for (const s of sheets) expect(first).toContain(s.trim().split('\n')[0] as string);
  });

  it('ordnet Blätter nach Codepunkt und nicht nach UTF-16-Einheit: U+FF5E vor U+1F600', () => {
    const emoji = ':root {\n  --x: "\u{1F600}";\n}';
    const tilde = ':root {\n  --x: "\uFF5E";\n}';
    const expected = `${tilde}\n${emoji}`;
    expect(filterMathCss([emoji, tilde], cps()).css).toBe(expected);
    expect(filterMathCss([tilde, emoji], cps()).css).toBe(expected);
  });

  it('zweimal dasselbe Blatt ergibt es einmal; zwei Aufrufe sind gleich', () => {
    const once = filterMathCss([chtml(CHAR.a)], cps('1D44E'));
    expect(filterMathCss([chtml(CHAR.a), chtml(CHAR.a)], cps('1D44E')).css).toBe(once.css);
    expect(filterMathCss([chtml(CHAR.a)], cps('1D44E'))).toEqual(once);
  });

  it('ohne benutzte Codepunkte bleiben nur die festen Regeln und die Schriften, die sie nennen', () => {
    const { css, findings } = filterMathCss([chtml(CHAR.a, CHAR.two)], cps());
    expect(css).not.toContain('mjx-c1D44E');
    expect(css).not.toContain('mjx-c32');
    const urls = findings.map((f) => f.message).join(' ');
    expect(urls).toContain('mjx-tex-n.woff2');
    expect(urls).not.toContain('mjx-tex-i.woff2');
  });

  it('filtert Selektorlisten je Selektor und lässt die Regel stehen, solange einer bleibt', () => {
    const rule = 'mjx-c.mjx-c32::before, mjx-c.mjx-c33::before, .TEX-N {\n  content: "x";\n}';
    const { css } = filterMathCss([rule], cps('33'));
    expect(css).toBe('mjx-c.mjx-c33::before, .TEX-N {\n  content: "x";\n}');
    expect(filterMathCss([rule.replace(', .TEX-N', '')], cps('99')).css).toBe('');
  });

  it('erkennt fremde Klassen nicht als Codepunkt und hält Zeichenketten und Kommentare aus der Zerlegung heraus', () => {
    const css = '/* mjx-c99 { } */\n.mjx-chtml, .mjx-cell {\n  content: "}{;";\n}\n@media print {\n  mjx-c.mjx-c32::before { content: "2"; }\n  mjx-c.mjx-c33::before { content: "3"; }\n}';
    const { css: out } = filterMathCss([css], cps('33'));
    expect(out).toContain('.mjx-chtml, .mjx-cell {\n  content: "}{;";\n}');
    expect(out).toContain('@media print {\nmjx-c.mjx-c33::before { content: "3"; }\n}');
    expect(out).not.toContain('mjx-c32');
    expect(out).not.toContain('mjx-c99');
  });

  it('wirft eine leere Gruppe weg und lässt Anweisungen und Keyframes stehen', () => {
    const css = '@media print { mjx-c.mjx-c32::before { content: "2"; } }\n@keyframes spin { from { opacity: 0; } to { opacity: 1; } }\n@charset "utf-8";';
    const { css: out } = filterMathCss([css], cps());
    expect(out).not.toContain('@media');
    expect(out).toContain('@keyframes spin');
    expect(out).toContain('@charset "utf-8";');
  });

  it('ein unvollständiger Rest und Zeilenenden \\r\\n bleiben ohne Folgen', () => {
    const { css } = filterMathCss(['.a { color: red; }\r\n.b { color: blue;'], cps());
    expect(css).toBe('.a { color: red; }');
  });

  it('leere Eingabe ergibt leeren Text ohne Befund', () => {
    expect(filterMathCss([], cps())).toEqual({ css: '', findings: [] });
  });
});
