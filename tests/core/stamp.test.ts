import { describe, expect, it } from 'vitest';
import { stampMeta, type StampInput } from '../../src/core/stamp';

const BASE: StampInput = {
  pluginVersion: '0.1.0',
  obsidianVersion: '1.15.1',
  obsidianLang: 'en',
  themeKey: 'default',
  themeSha256: 'a'.repeat(64),
  blocks: 'core',
  embeds: 'static',
  remoteImages: 'skip',
};

describe('stampMeta', () => {
  it('liefert bei zweimaligem Aufruf denselben Text, eine meta-Zeile je Eintrag in fester Reihenfolge', () => {
    const text = stampMeta(BASE);
    expect(stampMeta({ ...BASE })).toBe(text);
    expect(text.split('\n')).toEqual([
      '<meta name="ht-plugin-version" content="0.1.0">',
      '<meta name="ht-obsidian-version" content="1.15.1">',
      '<meta name="ht-obsidian-lang" content="en">',
      '<meta name="ht-theme" content="default">',
      `<meta name="ht-theme-sha256" content="${'a'.repeat(64)}">`,
      '<meta name="ht-blocks" content="core">',
      '<meta name="ht-embeds" content="static">',
      '<meta name="ht-remote-images" content="skip">',
    ]);
  });

  it('enthält keine Ziffernfolge, die einem Datum oder einer Uhrzeit gleicht', () => {
    const text = stampMeta({ ...BASE, plugins: [{ id: 'dataview', version: '0.5.68' }] });
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/\d{4}\/\d{1,2}\/\d{1,2}/);
  });

  it('maskiert < und " in Werten (nichts bricht aus dem Attribut aus)', () => {
    const text = stampMeta({ ...BASE, themeKey: 'a"><script>x</script>', obsidianLang: "d'e<", plugins: [{ id: 'p<q', version: '1"0' }] });
    expect(text).not.toContain('<script>');
    expect(text).toContain('content="a&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
    expect(text).toContain('content="d&#39;e&lt;"');
    expect(text).toContain('content="p&lt;q@1&quot;0"');
    // jede Zeile bleibt genau ein meta-Element
    for (const line of text.split('\n')) expect(line).toMatch(/^<meta name="ht-[a-z0-9-]+" content="[^"<>]*">$/);
  });

  it('ohne plugins keine ht-plugin-Zeile, mit plugins eine je Eintrag nach id sortiert, unabhängig von der Eingabereihenfolge', () => {
    expect(stampMeta(BASE)).not.toContain('"ht-plugin"');
    const list = [
      { id: 'templater', version: '2.0.0' },
      { id: 'Dataview', version: '1.0.0' },
      { id: 'dataview', version: '0.5.68' },
      { id: 'banner', version: '3.1.0' },
    ];
    const lines = (plugins: StampInput['plugins']): string[] => stampMeta({ ...BASE, plugins }).split('\n').filter((l) => l.startsWith('<meta name="ht-plugin"'));
    const expected = [
      '<meta name="ht-plugin" content="Dataview@1.0.0">',
      '<meta name="ht-plugin" content="banner@3.1.0">',
      '<meta name="ht-plugin" content="dataview@0.5.68">',
      '<meta name="ht-plugin" content="templater@2.0.0">',
    ];
    expect(lines(list)).toEqual(expected);
    expect(lines([...list].reverse())).toEqual(expected);
    expect(lines([list[2] as { id: string; version: string }, list[0] as { id: string; version: string }, list[3] as { id: string; version: string }, list[1] as { id: string; version: string }])).toEqual(expected);
  });

  it('stamp: full schreibt den vollen Stempel: alle Felder von minimal in fester Reihenfolge, dann je ein ht-plugin-Eintrag je beteiligtem Plugin (Spec 10.8)', () => {
    const minimal = stampMeta(BASE).split('\n');
    const full = stampMeta({ ...BASE, plugins: [{ id: 'templater', version: '2.0.0' }, { id: 'dataview', version: '0.5.68' }] }).split('\n');
    expect(full).toEqual([
      ...minimal,
      '<meta name="ht-plugin" content="dataview@0.5.68">',
      '<meta name="ht-plugin" content="templater@2.0.0">',
    ]);
    expect(full).toHaveLength(minimal.length + 2);
  });

  it('ordnet die Plugins nach Codepunkt und nicht nach UTF-16-Einheit: U+FF5E vor U+1F600', () => {
    const lines = (plugins: StampInput['plugins']): string[] => stampMeta({ ...BASE, plugins }).split('\n').filter((l) => l.startsWith('<meta name="ht-plugin"'));
    const list = [{ id: '\u{1F600}', version: '1' }, { id: '\uFF5E', version: '1' }];
    const expected = ['<meta name="ht-plugin" content="\uFF5E@1">', '<meta name="ht-plugin" content="\u{1F600}@1">'];
    expect(lines(list)).toEqual(expected);
    expect(lines([...list].reverse())).toEqual(expected);
  });

  it('ändert die übergebene Liste nicht', () => {
    const plugins = [{ id: 'b', version: '1' }, { id: 'a', version: '1' }];
    stampMeta({ ...BASE, plugins });
    expect(plugins.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('eine geänderte Umgebung ändert den Text an dieser Stelle', () => {
    expect(stampMeta({ ...BASE, obsidianLang: 'de' })).not.toBe(stampMeta(BASE));
  });
});
