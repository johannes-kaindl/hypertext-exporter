// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { windowMathStyles } from '../../src/obsidian/pipeline';
import { installObsidianDom } from './dom-polyfill';

beforeAll(() => {
  installObsidianDom();
  (globalThis as unknown as Record<string, unknown>).activeDocument = document;
});
afterEach(() => { document.head.replaceChildren(); });

function mathStyle(text: string): HTMLStyleElement {
  const el = document.createElement('style');
  el.id = 'MJX-CHTML-styles';
  el.textContent = text;
  document.head.appendChild(el);
  return el;
}

describe('windowMathStyles: Regeln aus dem Stylesheet statt aus dem Textinhalt', () => {
  it('liefert auch Regeln, die MathJax per insertRule angehängt hat und die im Text fehlen', () => {
    const el = mathStyle('mjx-container { display: inline-block; }');
    const sheet = el.sheet as CSSStyleSheet;
    sheet.insertRule('mjx-frac { display: inline-block; }', sheet.cssRules.length);
    sheet.insertRule('mjx-c.mjx-c32::before { padding: 0.666em 0.5em 0 0; }', sheet.cssRules.length);
    expect(el.textContent).not.toContain('mjx-frac');
    const [text] = windowMathStyles();
    expect(text).toContain('mjx-container');
    expect(text).toContain('mjx-frac');
    expect(text).toContain('mjx-c32');
  });

  it('gibt für jede Regel eine eigene Fassung und ohne Element nichts zurück', () => {
    expect(windowMathStyles()).toEqual([]);
    mathStyle('a { color: red; }\nb { color: blue; }');
    const [text] = windowMathStyles();
    expect((text ?? '').split('\n')).toHaveLength(2);
  });
});
