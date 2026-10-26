/**
 * Runtime art: character sprite atlases, stage backgrounds, FX sheet and
 * portraits. Everything is optional — the renderer falls back to simple
 * shapes while (or if) an asset is unavailable.
 *
 * Atlases are high-resolution: `scale` is atlas pixels per game unit, and a
 * character may span several atlas pages (`p` on each frame).
 */

export interface SpriteFrame {
  p?: number; // atlas page
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number; // anchor (feet centre) inside the frame, atlas pixels
  ay: number;
}

export interface SpriteAnim {
  frames: SpriteFrame[];
  fps?: number;
  loop?: boolean;
  phases?: { startup: number[]; active: number[]; recovery: number[] };
}

export interface SpriteSet {
  pages: HTMLImageElement[];
  scale: number;
  anims: Record<string, SpriteAnim>;
  // alternate costume colours for the 2P side of a mirror match (built lazily)
  alt?: HTMLCanvasElement[] | null;
}

export interface FxSheet {
  img: HTMLImageElement;
  scale: number;
  rows: Record<string, { frames: SpriteFrame[] }>;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

async function loadJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const art: {
  sprites: Record<string, SpriteSet | null>;
  stages: (HTMLImageElement | null)[];
  fx: FxSheet | null;
  portraits: Record<string, HTMLImageElement | null>;
  keyart: HTMLImageElement | null;
  progress: number; // 0..1 loading progress for the loading screen
} = { sprites: {}, stages: [], fx: null, portraits: {}, keyart: null, progress: 0 };

/** Hue-shift the costume (saturated, non-skin pixels) for a mirror-match palette. */
function recolor(img: HTMLImageElement): HTMLCanvasElement | null {
  try {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      if (d < 0.12) continue; // greys, black lineart, white
      const sat = d / (1 - Math.abs(2 * l - 1));
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
      if (h > 10 && h < 42 && sat < 0.7 && l > 0.45) continue; // keep skin and cream tones
      h = (h + 150) % 360;
      const C = (1 - Math.abs(2 * l - 1)) * sat;
      const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - C / 2;
      const [rr, gg, bb] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
      px[i] = Math.round((rr + m) * 255);
      px[i + 1] = Math.round((gg + m) * 255);
      px[i + 2] = Math.round((bb + m) * 255);
    }
    ctx.putImageData(data, 0, 0);
    return c;
  } catch {
    return null;
  }
}

/** Alternate-colour pages for mirror matches, computed on first use. */
export function altPages(set: SpriteSet): HTMLCanvasElement[] | null {
  if (set.alt === undefined) {
    const pages = set.pages.map(recolor);
    set.alt = pages.every((p): p is HTMLCanvasElement => !!p) ? pages : null;
  }
  return set.alt;
}

let loaded: Promise<void> | null = null;

// sprite sets that are not selectable characters: DeepSeek's 梁圣 form, the whale maid, Grok's Roadster
const EXTRA_SPRITES = ["muscle", "whalemaid", "roadster"];

async function loadSprites(id: string) {
  const meta = await loadJson<{ pages: string[]; scale: number; anims: Record<string, SpriteAnim> }>(`/assets/sprites/${id}.json`);
  const pages = meta ? await Promise.all(meta.pages.map((pg) => loadImage(`/assets/sprites/${pg}`))) : [];
  art.sprites[id] =
    meta && pages.length && pages.every(Boolean) ? { pages: pages as HTMLImageElement[], scale: meta.scale, anims: meta.anims } : null;
}

export function loadArt(charIds: string[], stageUrls: string[]): Promise<void> {
  if (loaded) return loaded;
  let done = 0;
  const total = charIds.length * 2 + EXTRA_SPRITES.length + 3;
  const track = <T,>(p: Promise<T>) =>
    p.then((v) => {
      done++;
      art.progress = done / total;
      return v;
    });
  loaded = (async () => {
    await Promise.all([
      ...[...charIds, ...EXTRA_SPRITES].map((id) => track(loadSprites(id))),
      ...charIds.map((id) => track(loadImage(`/assets/ui/portrait_${id}.jpg`).then((img) => (art.portraits[id] = img)))),
      track(Promise.all(stageUrls.map((u) => loadImage(u))).then((imgs) => (art.stages = imgs))),
      track(
        (async () => {
          const meta = await loadJson<{ image: string; scale: number; rows: FxSheet["rows"] }>(`/assets/fx/fx.json`);
          const img = meta ? await loadImage(`/assets/fx/${meta.image}`) : null;
          art.fx = meta && img ? { img, scale: meta.scale, rows: meta.rows } : null;
        })()
      ),
      track(loadImage(`/assets/ui/keyart.jpg`).then((img) => (art.keyart = img))),
    ]);
    // the main menu's fight clips: fetch them early so the roster card plays without a wait
    for (const id of charIds) void fetch(`/assets/video/roster_${id}.mp4`).catch(() => undefined);
    art.progress = 1;
  })();
  return loaded;
}
