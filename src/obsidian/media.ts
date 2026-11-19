// Medien in Etappe 5 (Bauplan Task 8): Bilder werden eingebettet, alles andere wird ein Hinweis mit Dateiname.
// Nach einem Fehlschlag bleibt nie eine `app://`-Adresse oder ein Benutzerpfad im Baum (Spec 10.8, Review Focus).
import type { App } from 'obsidian';
import { CODES } from '../core/finding-codes';
import type { Finding, Recipe, SetNote } from '../core/types';
import { bytesToBase64, dataUrlToBytes } from '../vendor/kit/data-url';
import { imageSourceKind } from '../vendor/kit/image-source';
import { checkSvg } from '../vendor/kit/svg-guard';
import { inlineImages, type InlineImagesPorts } from '../vendor/kit-obsidian/inline-images';

/** Texte, die die Seite selbst setzt, je `lang` (Spec 10.10: nie aus der Obsidian-Sprache). Task 10 führt sie in `page-texts.ts` zusammen. */
const MEDIA_TEXTS = {
  en: {
    notEmbedded: 'Not embedded:',
    remoteSkipped: 'Remote image not loaded:',
    later: 'Not embedded in this version:',
    fallbackName: 'file',
  },
  de: {
    notEmbedded: 'Nicht eingebettet:',
    remoteSkipped: 'Bild aus dem Netz nicht geladen:',
    later: 'In dieser Version nicht eingebettet:',
    fallbackName: 'Datei',
  },
} as const;

type Texts = (typeof MEDIA_TEXTS)[Recipe['lang']];

const EMBED_SELECTOR = 'span.internal-embed, div.internal-embed';

function lastSegment(path: string): string {
  const cleaned = path.split('|')[0]?.split('#')[0] ?? '';
  const seg = cleaned.split('/').pop() ?? '';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function extensionOf(path: string): string {
  const name = lastSegment(path.split('?')[0] ?? '');
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Dateiname für den Hinweis: `src` der umgebenden Einbettung, sonst `alt`, sonst bei einem rohen Vault-Pfad dessen letztes Stück; nie aus einer `app://`-Adresse. */
function fileNameFor(el: Element, embed: Element | null, texts: Texts): string {
  const embedSrc = embed?.getAttribute('src');
  if (embedSrc) {
    const name = lastSegment(embedSrc);
    if (name) return name;
  }
  const alt = el.getAttribute('alt') ?? embed?.getAttribute('alt');
  if (alt) return alt;
  const src = el.getAttribute('src');
  if (src && imageSourceKind(src) === 'vault') {
    const name = lastSegment(src);
    if (name) return name;
  }
  return texts.fallbackName;
}

function hint(cls: string, lead: string, name: string): HTMLElement {
  return createSpan({ cls, text: `${lead} ${name}` });
}

function dataUrlInfo(src: string): { mime: string; bytes: number } | null {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(src);
  if (m === null) return null;
  const b64 = m[2] ?? '';
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return { mime: (m[1] ?? '').toLowerCase(), bytes: (b64.length / 4) * 3 - pad };
}

/**
 * Bettet die Bilder unter `root` ein. Reihenfolge:
 * (1) `remote_images: skip` ersetzt Bilder mit `http(s):`-Adresse, bevor das Kit sie laden kann;
 * (2) `inlineImages` lädt den Rest; was dabei als SVG ankommt (nach den Bytes erkannt), geht durch `checkSvg` und wird aus dem geprüften Baum neu serialisiert;
 * (3) Fehlschläge werden Hinweise mit Dateiname; `<video>`, `<audio>` und andere Anhänge sind in Etappe 5 nur ein Hinweis.
 * `mediaBytes` zählt die eingebetteten Bytes je MIME-Typ.
 */
export async function embedMedia(
  app: App,
  root: HTMLElement,
  note: SetNote,
  recipe: Recipe,
  ports?: InlineImagesPorts,
): Promise<{ findings: Finding[]; mediaBytes: Record<string, number> }> {
  void app; // Die Quellen kommen als app://-Adresse aus dem Zeichner; das Kit lädt sie selbst.
  const texts = MEDIA_TEXTS[recipe.lang];
  const findings: Finding[] = [];
  const mediaBytes: Record<string, number> = {};
  const embedOf = (el: Element): Element | null => el.closest(EMBED_SELECTOR);
  /** Ersetzt die ganze Einbettung, wenn das Medium ihr einziger Inhalt ist, sonst nur das Medium. */
  const replace = (el: Element, embed: Element | null, by: HTMLElement): void => {
    const sole = embed !== null && embed.querySelectorAll('img, video, audio').length === 1;
    (sole && embed !== null ? embed : el).replaceWith(by);
  };
  const add = (severity: Finding['severity'], code: string, message: string): void => {
    findings.push({ severity, code, message, notePath: note.path });
  };

  const alreadyData = new Set<Element>(
    Array.from(root.querySelectorAll('img')).filter((img) => /^data:/i.test(img.getAttribute('src') ?? '')),
  );

  // (1) Bilder aus dem Netz.
  if (recipe.remoteImages === 'skip') {
    for (const img of Array.from(root.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? '';
      if (imageSourceKind(src) !== 'remote') continue;
      const label = img.getAttribute('alt') || src;
      const wrap = createSpan({ cls: 'ht-media-remote' });
      wrap.appendText(`${texts.remoteSkipped} `);
      wrap.createEl('a', { text: label, href: src, attr: { rel: 'noopener' } });
      replace(img, embedOf(img), wrap);
      add('info', CODES.mediaRemoteSkipped, `${texts.remoteSkipped} ${label}`);
    }
  }

  // (2) Laden und einbetten; SVG nach checkSvg.
  await inlineImages(root, { ports });
  for (const img of Array.from(root.querySelectorAll('img'))) {
    if (alreadyData.has(img)) continue;
    const src = img.getAttribute('src') ?? '';
    if (!/^data:image\/svg\+xml/i.test(src)) continue;
    const embed = embedOf(img);
    const name = fileNameFor(img, embed, texts);
    const reject = (detail: string): void => {
      add('warning', CODES.mediaSvgRejected, `${texts.notEmbedded} ${name}${detail}`);
      replace(img, embed, hint('ht-media-missing', texts.notEmbedded, name));
    };
    let text: string;
    try {
      text = new TextDecoder().decode(dataUrlToBytes(src));
    } catch {
      reject('');
      continue;
    }
    const verdict = checkSvg(text);
    if (!verdict.ok) {
      reject(` (${verdict.problems.map((p) => p.code).join(', ')})`);
      continue;
    }
    const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(verdict.svg));
    img.setAttribute('src', `data:image/svg+xml;base64,${bytesToBase64(bytes)}`);
  }

  // (3) Was nicht eingebettet werden konnte: Hinweis mit Dateiname, nie die alte Adresse.
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (/^data:/i.test(src)) {
      if (!alreadyData.has(img)) {
        const info = dataUrlInfo(src);
        if (info !== null) mediaBytes[info.mime] = (mediaBytes[info.mime] ?? 0) + info.bytes;
      }
      continue;
    }
    const embed = embedOf(img);
    const name = fileNameFor(img, embed, texts);
    replace(img, embed, hint('ht-media-missing', texts.notEmbedded, name));
    add('warning', CODES.mediaNotEmbedded, `${texts.notEmbedded} ${name}`);
  }

  // Audio, Video und andere Anhänge: in Etappe 5 nur ein Hinweis (Etappe 6 ersetzt das).
  for (const el of Array.from(root.querySelectorAll('video, audio'))) {
    const embed = embedOf(el);
    const name = fileNameFor(el, embed, texts);
    replace(el, embed, hint('ht-media-later', texts.later, name));
    add('info', CODES.mediaLater, `${texts.later} ${name}`);
  }
  for (const embed of Array.from(root.querySelectorAll(EMBED_SELECTOR))) {
    if (embed.classList.contains('markdown-embed')) continue;
    // Schon behandelt oder mit Inhalt (Bild, Hinweis): nur leere Anhang-Einbettungen bleiben übrig.
    if (embed.querySelector('img, video, audio, .ht-media-missing, .ht-media-later, .ht-media-remote') !== null) continue;
    const ext = extensionOf(embed.getAttribute('src') ?? '');
    if (ext === '' || ext === 'md') continue;
    const name = fileNameFor(embed, embed, texts);
    if (embed.classList.contains('is-unresolved')) {
      embed.replaceWith(hint('ht-media-missing', texts.notEmbedded, name));
      add('warning', CODES.mediaNotEmbedded, `${texts.notEmbedded} ${name}`);
    } else {
      embed.replaceWith(hint('ht-media-later', texts.later, name));
      add('info', CODES.mediaLater, `${texts.later} ${name}`);
    }
  }

  return { findings, mediaBytes };
}
