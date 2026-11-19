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
}
