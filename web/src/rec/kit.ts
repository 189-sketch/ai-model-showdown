/** Captions, cards and transitions shared by the promo films. All sizes are 1920×1080 output pixels. */

import { tx } from "@/lib/i18n";
import {
  ACCENT, CHARS, Director, FONT_BRUSH, FONT_CN, FONT_NUM, FONT_UI, OUT_H, OUT_W, cover, ease, loadVideo, roundRect, seek,
  slant, stageImage, textWidth, txt,
} from "./engine";

const GOLD = "#ffd23f";
const CYAN = "#25f4ee";
const INK = "rgba(10,6,18,0.86)";

/** Input chips: "↓↘→ + 拳" → a cyan direction chip and a gold button chip. Returns the drawn width (draw=false only measures). */
export function inputChips(ctx: CanvasRenderingContext2D, input: string, x: number, y: number, size = 34, draw = true) {
  const parts = input.split(" + ");
  let cx = x;
  parts.forEach((p, k) => {
    const isDir = /[↓↘→↙←↑]/.test(p);
    const w = textWidth(ctx, p, size, FONT_UI) + size * 0.9;
    if (draw) {
      ctx.save();
      ctx.translate(cx, y);
      ctx.transform(1, 0, -0.18, 1, 0, 0);
      ctx.fillStyle = isDir ? "rgba(37,244,238,0.16)" : GOLD;
      roundRect(ctx, 0, -size * 0.72, w, size * 1.44, 5);
      ctx.fill();
      if (isDir) {
        ctx.strokeStyle = "rgba(37,244,238,0.7)";
        ctx.lineWidth = 2;
        roundRect(ctx, 0, -size * 0.72, w, size * 1.44, 5);
        ctx.stroke();
      }
      ctx.restore();
      txt(ctx, p, cx + w / 2, y + 1, size, isDir ? CYAN : "#120a1e", FONT_UI, "center", "900");
    }
    cx += w;
    if (k < parts.length - 1) {
      if (draw) txt(ctx, "+", cx + size * 0.45, y, size * 0.9, "rgba(255,255,255,0.8)", FONT_UI, "center", "900");
      cx += size * 0.9;
    }
  });
  return cx - x;
}

/**
 * Compact move caption top-left under the section chip, kept small so the fight stays visible: one line of input
 * chips + move name, and an optional short note under it. Slides in from the left, holds, slides out.
 */
export function moveCaption(d: Director, o: { input?: string; name: string; note?: string; accent: string }, life: number, delay = 0) {
  d.overlay(life, (ctx, age, lifeN) => {
    const k = Math.min(ease(age / 10), ease((lifeN - age) / 8));
    const y = 290;
    const h = o.note ? 92 : 58;
    const chipsW = o.input ? inputChips(ctx, tx(o.input), 0, 0, 19, false) + 14 : 0;
    const nameW = textWidth(ctx, tx(o.name), 36, FONT_UI);
    const noteW = o.note ? textWidth(ctx, tx(o.note), 21, FONT_UI, "700") : 0;
    const w = Math.max(chipsW + nameW, noteW) + 46;
    const x = 50 - (1 - k) * (w + 80);
    ctx.globalAlpha = Math.min(1, k * 1.4);
    ctx.fillStyle = INK;
    slant(ctx, x, y, w, h, 0.1);
    ctx.fill();
    ctx.fillStyle = o.accent;
    slant(ctx, x - 9, y, 6, h, 0.1);
    ctx.fill();
    if (o.input) inputChips(ctx, tx(o.input), x + 24, y + 30, 19);
    txt(ctx, tx(o.name), x + 22 + chipsW, y + 30, 36, "#fff", FONT_UI, "left", "900", 0);
    if (o.note) txt(ctx, tx(o.note), x + 24, y + 70, 21, "rgba(255,255,255,0.84)", FONT_UI, "left", "700");
  }, delay);
}

/** A small tilted yellow "名场面" sticker with the gag line, for the moments worth pausing on. */
export function gagSticker(d: Director, line: string, life: number, delay = 0, at: [number, number] = [OUT_W - 290, 236]) {
  d.overlay(life, (ctx, age, lifeN) => {
    const pop = age < 7 ? 0.4 + (age / 7) * 0.72 : 1.12 - Math.min(0.12, (age - 7) / 24);
    const fade = Math.min(1, (lifeN - age) / 8);
    ctx.globalAlpha = fade;
    ctx.translate(at[0], at[1]);
    ctx.rotate(-0.06 + Math.sin(age * 0.25) * 0.01);
    ctx.scale(pop, pop);
    const w = Math.max(200, textWidth(ctx, tx(line), 28, FONT_UI) + 48);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    roundRect(ctx, -w / 2 + 5, -30 + 6, w, 62, 8);
    ctx.fill();
    ctx.fillStyle = GOLD;
    roundRect(ctx, -w / 2, -30, w, 62, 8);
    ctx.fill();
    ctx.fillStyle = "#ff2d55";
    roundRect(ctx, -w / 2 + 12, -44, 96, 24, 5);
    ctx.fill();
    txt(ctx, tx("名场面"), -w / 2 + 60, -32, 16, "#fff", FONT_UI, "center", "900");
    txt(ctx, tx(line), 0, 4, 28, "#160b22", FONT_UI, "center", "900");
  }, delay);
}

/** Small section chip top-left under the HUD: "SPECIAL 1 · 必杀技". */
export function sectionChip(d: Director, en: string, zh: string, accent: string, life: number) {
  d.overlay(life, (ctx, age, lifeN) => {
    const k = Math.min(ease(age / 10), ease((lifeN - age) / 10));
    ctx.globalAlpha = k;
    const x = 52;
    const y = 244;
    const w = textWidth(ctx, en, 20, FONT_NUM) + textWidth(ctx, tx(zh), 18, FONT_UI) + 52;
    ctx.fillStyle = INK;
    slant(ctx, x, y, w, 34, 0.3);
    ctx.fill();
    ctx.fillStyle = accent;
    slant(ctx, x, y + 31, w, 3, 0);
    ctx.fill();
    const ew = txt(ctx, en, x + 18, y + 17, 20, accent, FONT_NUM, "left", "900");
    txt(ctx, tx(zh), x + 30 + ew, y + 17, 18, "#fff", FONT_UI, "left", "800");
  });
}

// ───────────────────────── intro / outro cards ─────────────────────────

/** Opening card: the fighter's AI fight clip in a slanted frame, name, role and line over their stage. */
export async function* introCard(d: Director, cid: string, stage: number, frames = 216): AsyncGenerator<void> {
  const c = CHARS.find((x) => x.id === cid)!;
  const accent = ACCENT[cid];
  const v = await loadVideo(`/assets/video/roster_${cid}.mp4`);
  const bg = stageImage(stage);
  d.cue({ kind: "sfx", id: "super" });
  d.cue({ kind: "voice", id: "intro", who: 0, char: cid }, 0.35);
  yield* d.card(frames, async (ctx, i) => {
    ctx.fillStyle = "#07040d";
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    if (bg) {
      ctx.globalAlpha = 0.32;
      cover(ctx, bg, 0, 0, OUT_W, OUT_H);
      ctx.globalAlpha = 1;
    }
    const g = ctx.createRadialGradient(560, 560, 40, 560, 560, 900);
    g.addColorStop(0, `${accent}55`);
    g.addColorStop(1, "rgba(7,4,13,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    // speed lines
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 3;
    for (let k = 0; k < 22; k++) {
      const x0 = ((k * 137 + i * 9) % 2400) - 300;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 - 520, OUT_H);
      ctx.stroke();
    }
    // the clip in a slanted frame
    await seek(v, Math.min(v.duration - 0.05, i / 60));
    const fx = 150 - (1 - ease(i / 18)) * 600;
    ctx.save();
    slant(ctx, fx, 80, 640, 920, 0.16);
    ctx.clip();
    cover(ctx, v, fx, 80, 640 + 150, 920, 0.2);
    ctx.restore();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 30;
    slant(ctx, fx, 80, 640, 920, 0.16);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // text block
    const k = ease((i - 10) / 20);
    const tx0 = 980 + (1 - k) * 220;
    ctx.globalAlpha = Math.max(0, k);
    txt(ctx, "SKILL SHOWCASE", tx0, 300, 34, accent, FONT_NUM, "left", "900");
    txt(ctx, tx("技能演示"), tx0 + textWidth(ctx, "SKILL SHOWCASE", 34, FONT_NUM) + 26, 300, 30, "rgba(255,255,255,0.7)", FONT_UI, "left", "800");
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 40;
    txt(ctx, c.name, tx0 - 8, 440, 190, "#fff", FONT_NUM, "left", "900");
    ctx.restore();
    txt(ctx, tx(c.title), tx0, 580, 44, accent, FONT_UI, "left", "900");
    const q = `「${tx(c.quote)}」`;
    const qw = textWidth(ctx, q, 40, FONT_UI) + 50;
    ctx.fillStyle = `${accent}33`;
    slant(ctx, tx0, 640, qw, 74, 0.2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(tx0 + 4, 640, 6, 74);
    txt(ctx, q, tx0 + 30, 678, 40, "#fff", FONT_UI, "left", "800");
    ctx.globalAlpha = 1;
    // the game logo, small
    logo(ctx, OUT_W - 60, 980, 0.5, "right");
  });
}

/** The game logo 「谁才是 / 最强AI大模型」 anchored at (x, y) bottom; scale 1 ≈ 150px tall. */
export function logo(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, align: "left" | "center" | "right" = "center") {
  const big = 120 * scale;
  const w = textWidth(ctx, "最强", big, FONT_BRUSH, "400") + textWidth(ctx, "AI", big * 1.05, FONT_NUM) + textWidth(ctx, "大模型", big, FONT_BRUSH, "400") + 10 * scale;
  const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  txt(ctx, "谁才是", x0 + w / 2, y - big * 1.18, big * 0.4, "#fff", FONT_UI, "center", "900", 6 * scale);
  let cx = x0;
  ctx.save();
  ctx.shadowColor = "rgba(255,210,63,0.45)";
  ctx.shadowBlur = 24 * scale;
  cx += txt(ctx, "最强", cx, y - big * 0.45, big, GOLD, FONT_BRUSH, "left", "400", 8 * scale, "#000");
  ctx.restore();
  ctx.save();
  ctx.translate(cx + 4 * scale, 0);
  ctx.transform(1, 0, -0.12, 1, 0, 0);
  // the Douyin-style chromatic split on "AI"
  txt(ctx, "AI", 0 - 4 * scale, y - big * 0.47, big * 1.05, CYAN, FONT_NUM, "left", "900");
  txt(ctx, "AI", 4 * scale, y - big * 0.43, big * 1.05, "#fe2c55", FONT_NUM, "left", "900");
  const aw = txt(ctx, "AI", 0, y - big * 0.45, big * 1.05, "#fff", FONT_NUM, "left", "900");
  ctx.restore();
  cx += aw + 10 * scale;
  ctx.save();
  ctx.shadowColor = "rgba(255,210,63,0.45)";
  ctx.shadowBlur = 24 * scale;
  txt(ctx, "大模型", cx, y - big * 0.45, big, GOLD, FONT_BRUSH, "left", "400", 8 * scale, "#000");
  ctx.restore();
}

/** Closing card: a slice of the fighter's epic victory cut-scene, the logo and where to play. */
export async function* outroCard(d: Director, cid: string, from = 3, frames = 300): AsyncGenerator<void> {
  const v = await loadVideo(`/assets/video/victory_${cid}.mp4`);
  d.cue({ kind: "clip", id: "victory", file: `video/victory_${cid}.mp4`, from, dur: frames / 60, gain: 0.9 });
  yield* d.card(frames, async (ctx, i) => {
    await seek(v, from + i / 60);
    cover(ctx, v, 0, 0, OUT_W, OUT_H, 0.5);
    const g = ctx.createLinearGradient(0, OUT_H * 0.35, 0, OUT_H);
    g.addColorStop(0, "rgba(7,4,13,0)");
    g.addColorStop(1, "rgba(7,4,13,0.92)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    const k = ease((i - 40) / 24);
    ctx.globalAlpha = Math.max(0, k);
    logo(ctx, OUT_W / 2, 880 + (1 - k) * 30, 1, "center");
    txt(ctx, tx("浏览器打开就能玩 · 单人闯关 · 本地双人 · 联机对战"), OUT_W / 2, 950, 34, "rgba(255,255,255,0.92)", FONT_UI, "center", "800", 5);
    txt(ctx, "your-app.edgespark.app", OUT_W / 2, 1010, 38, GOLD, FONT_NUM, "center", "900", 5);
    ctx.globalAlpha = 1;
    if (i > frames - 24) {
      ctx.fillStyle = `rgba(0,0,0,${(i - (frames - 24)) / 24})`;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }
  });
}

/** A huge slanted word slamming in at the lower left (trailer montage). */
export function slam(d: Director, word: string, accent: string, life: number) {
  d.overlay(life, (ctx, age, lifeN) => {
    const k = ease(age / 7);
    const out = Math.min(1, (lifeN - age) / 6);
    ctx.globalAlpha = out;
    const sc = 1.5 - 0.5 * k;
    ctx.translate(56, 300);
    ctx.scale(sc, sc);
    ctx.rotate(-0.05);
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 26;
    txt(ctx, tx(word), 0, 0, 76, "#fff", FONT_UI, "left", "900", 9, "rgba(10,6,18,0.95)");
    ctx.restore();
    ctx.fillStyle = accent;
    ctx.fillRect(3, 42, Math.min(1, age / 10) * textWidth(ctx, tx(word), 76, FONT_UI), 7);
  });
}

/**
 * Trailer hero card, kept plain: the fight clip fills one half of the frame, the other half is flat black with the
 * name, a short accent rule and the role. No glow, no slants.
 */
export async function* heroCard(d: Director, cid: string, index: number, frames: number): AsyncGenerator<void> {
  const c = CHARS.find((x) => x.id === cid)!;
  const accent = ACCENT[cid];
  const v = await loadVideo(`/assets/video/roster_${cid}.mp4`);
  d.cue({ kind: "sfx", id: "whiff" });
  const left = index % 2 === 0; // clip on the left for 01 / 03
  yield* d.card(frames, async (ctx, i) => {
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    await seek(v, 1.2 + i / 60);
    // the clip wipes open from the outer edge
    const half = OUT_W / 2;
    const open = ease(i / 12);
    const vx = left ? 0 : half + half * (1 - open);
    ctx.save();
    ctx.beginPath();
    ctx.rect(vx, 0, half * open, OUT_H);
    ctx.clip();
    cover(ctx, v, left ? 0 : half, 0, half, OUT_H, 0.2);
    ctx.restore();
    const k = ease((i - 6) / 14);
    if (k <= 0) return;
    const x0 = left ? half + 140 : 160;
    const rise = (1 - k) * 24;
    ctx.globalAlpha = k;
    ctx.letterSpacing = "6px";
    txt(ctx, `0${index + 1} / 04`, x0, 380 + rise, 26, "rgba(255,255,255,0.45)", FONT_NUM, "left", "700");
    ctx.letterSpacing = "0px";
    txt(ctx, c.name, x0 - 6, 500 + rise, 168, "#fff", FONT_NUM, "left", "900");
    ctx.fillStyle = accent;
    ctx.fillRect(x0, 600 + rise, 72 * k, 5);
    txt(ctx, tx(c.title), x0, 664 + rise, 38, "rgba(255,255,255,0.78)", FONT_UI, "left", "500");
    ctx.globalAlpha = 1;
  });
}

export { FONT_CN, FONT_NUM, FONT_UI, GOLD };
