// Obsidians DOM-Helfer (createEl, createSpan, appendText) für jsdom-Tests. Nur Tests.
interface Info { cls?: string; text?: string; href?: string; attr?: Record<string, string> }

function build<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Info | string): HTMLElementTagNameMap[K] {
  const info: Info = typeof o === 'string' ? { cls: o } : (o ?? {});
  const el = document.createElement(tag);
  if (info.cls) el.className = info.cls;
  if (info.text !== undefined) el.textContent = info.text;
  if (info.href !== undefined) el.setAttribute('href', info.href);
  for (const [k, v] of Object.entries(info.attr ?? {})) el.setAttribute(k, v);
  return el;
}

export function installObsidianDom(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.createEl = build;
  g.createSpan = (o?: Info | string) => build('span', o);
  const proto = Node.prototype as unknown as Record<string, unknown>;
  proto.createEl = function (this: Node, tag: keyof HTMLElementTagNameMap, o?: Info | string) {
    const el = build(tag, o);
    this.appendChild(el);
    return el;
  };
  proto.appendText = function (this: Node, text: string) {
    this.appendChild(document.createTextNode(text));
  };
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.createDiv = function (this: Element, o?: Info | string) {
    const child = build('div', o);
    this.appendChild(child);
    return child;
  };
  el.createSpan = function (this: Element, o?: Info | string) {
    const child = build('span', o);
    this.appendChild(child);
    return child;
  };
  el.empty = function (this: Element) { this.replaceChildren(); };
  el.addClass = function (this: Element, ...cls: string[]) { this.classList.add(...cls); };
  el.removeClass = function (this: Element, ...cls: string[]) { this.classList.remove(...cls); };
  el.toggleClass = function (this: Element, cls: string, on: boolean) { this.classList.toggle(cls, on); };
  el.setText = function (this: Element, text: string) { this.textContent = text; };
}
