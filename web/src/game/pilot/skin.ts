/**
 * Model skins: an avatar and sprite-strip overrides for any of the base
 * fighter's animations. Uploaded strips are merged over the base sprite set,
 * so anything not overridden keeps the original art. Skins are cosmetic only:
 * hitboxes and frame data stay the base fighter's.
 */

import { art, type SpriteFrame, type SpriteSet } from "../assets";
import { CHARS, charIndex } from "../chars";
import { bridge, type AnimSkin, type ArenaModel } from "./bridge";

export interface FighterSkin {
  set: SpriteSet | null; // base + overrides; null = no overrides
  avatar: HTMLImageElement | null;
  color: string | null;
}

/** Fighters stand about this tall (game units); the default height for an uploaded frame. */
export const SKIN_HEIGHT = 100;

function imageFrom(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Loads a skin image. `keepUrl` leaves its object URL alive so the page can also show it as an <img>. */
export async function skinImage(modelId: string, file: string, keepUrl = false): Promise<HTMLImageElement | null> {
  try {
    const url = await bridge.file(modelId, file);
    const img = await imageFrom(url);
    if (!keepUrl) URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

/** The frames of a horizontal strip, anchored at the feet. */
export function stripFrames(img: { width: number; height: number }, meta: Pick<AnimSkin, "frames" | "height" | "anchorX">, page: number): SpriteFrame[] {
  const n = Math.max(1, meta.frames);
  const w = Math.floor(img.width / n);
  const h = img.height;
  return Array.from({ length: n }, (_, i) => ({ p: page, x: i * w, y: 0, w, h, ax: meta.anchorX * w, ay: h, s: h / meta.height }));
}

/** Base sprite set of a body with the given strips laid over it. */
export function mergeSkin(body: string, strips: { anim: string; img: HTMLImageElement; meta: AnimSkin }[]): SpriteSet | null {
  if (!strips.length) return null;
  const base = art.sprites[body] ?? null;
  const pages = [...(base?.pages ?? [])];
  const custom = pages.length;
  const anims = { ...(base?.anims ?? {}) };
  for (const s of strips) {
    anims[s.anim] = { frames: stripFrames(s.img, s.meta, pages.length), fps: s.meta.fps, loop: true };
    pages.push(s.img);
  }
  return { pages, scale: base?.scale ?? 2.5, anims, custom };
}

export async function loadFighterSkin(m: ArenaModel): Promise<FighterSkin> {
  const body = CHARS[Math.max(0, charIndex(m.body))].id;
  let data: Awaited<ReturnType<typeof bridge.skin>> = { anims: {} };
  try {
    if (m.avatar || m.skinAnims?.length) data = await bridge.skin(m.id);
  } catch {
    /* the fight goes on with the base look */
  }
  const [avatar, ...imgs] = await Promise.all([
    data.avatar ? skinImage(m.id, data.avatar, true) : Promise.resolve(null),
    ...Object.values(data.anims).map((a) => skinImage(m.id, a.file)),
  ]);
  const strips = Object.entries(data.anims)
    .map(([anim, meta], i) => ({ anim, meta, img: imgs[i] }))
    .filter((s): s is { anim: string; meta: AnimSkin; img: HTMLImageElement } => !!s.img);
  return { set: mergeSkin(body, strips), avatar, color: m.color ?? null };
}
