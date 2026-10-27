/** Turning picked image files into the uploads the Model Arena bridge stores. */

import { tx } from "./i18n";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(tx("读不了这张图片")));
    img.src = src;
  });
}

function canvasUrl(c: HTMLCanvasElement) {
  const webp = c.toDataURL("image/webp", 0.92);
  return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/png");
}

/** One strip from the picked files: a single strip as-is, or several frame images laid side by side (by file name). */
export async function filesToStrip(files: File[]): Promise<{ data: string; frames?: number }> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (sorted.length === 1) {
    const url = await readAsDataUrl(sorted[0]);
    if (/^data:image\/(png|webp|jpeg);/.test(url)) return { data: url };
    const img = await loadImg(url); // e.g. a GIF: keep its first frame
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return { data: c.toDataURL("image/png") };
  }
  const imgs = await Promise.all(sorted.map(async (f) => loadImg(await readAsDataUrl(f))));
  const w = Math.max(...imgs.map((i) => i.width));
  const h = Math.max(...imgs.map((i) => i.height));
  const c = document.createElement("canvas");
  c.width = w * imgs.length;
  c.height = h;
  const ctx = c.getContext("2d")!;
  // centred, standing on the bottom edge
  imgs.forEach((img, i) => ctx.drawImage(img, i * w + (w - img.width) / 2, h - img.height));
  return { data: canvasUrl(c), frames: imgs.length };
}

/** A square avatar, at most 256 px. */
export async function fileToAvatar(file: File): Promise<string> {
  const img = await loadImg(await readAsDataUrl(file));
  const side = Math.min(img.width, img.height);
  const out = Math.min(256, side);
  const c = document.createElement("canvas");
  c.width = c.height = out;
  c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
  return canvasUrl(c);
}
