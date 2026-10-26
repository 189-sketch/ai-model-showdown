/**
 * HD renderer. Game logic runs in 480×270 units; the canvas is larger and
 * scaled, so sprites, stages and text stay sharp. The HUD is styled like a
 * livestream PK room: red-vs-blue health bars, a PK timer badge, a LIVE
 * viewer counter, scrolling danmaku comments and gift banners.
 */

import { BAN_COOLDOWN, CHARS, CINE_BAN, CINE_ULTRA, STAGES, findMove } from "./chars";
import { GROUND_Y, H, METER_STOCK, ROUNDS_TO_WIN, STAGE_W, W } from "./constants";
import { BAN_STAMP_AT, CINE_LEN, DODGE, MAID, activeHitbox, bodyOf, hurtboxes, projectileHitbox } from "./sim";
import { altPages, art, type SpriteAnim, type SpriteFrame, type SpriteSet } from "./assets";
import type { Fighter, Fx, GameState, MoveDef, Projectile } from "./types";
import { getLang, tx } from "@/lib/i18n";

export interface RenderOpts {
  names: [string, string];
  showBoxes?: boolean;
  localSide?: 0 | 1 | -1; // which side is "you" (for the result text)
  ping?: number | null;
}

interface Danmaku {
  text: string;
  x: number;
  y: number;
  speed: number;
  color: string;
  size: number;
}

interface Gift {
  text: string;
  icon: string;
  age: number;
  side: 0 | 1;
}

export interface RenderState {
  lagHp: [number, number];
  t: number;
  danmaku: Danmaku[];
  nextDanmaku: number;
  gifts: Gift[];
  viewers: number;
  lastPhase: string;
  lastCombo: [number, number];
  lastSuper: number;
  lastHp: [number, number];
  lastAcquired: [boolean, boolean];
  seenSay: string[];
}

export function createRenderState(): RenderState {
  return {
    lagHp: [1, 1],
    t: 0,
    danmaku: [],
    nextDanmaku: 40,
    gifts: [],
    viewers: 8000 + Math.floor(Math.random() * 30000),
    lastPhase: "",
    lastCombo: [0, 0],
    lastSuper: 0,
    lastHp: [1, 1],
    lastAcquired: [false, false],
    seenSay: [],
  };
}

const NUM_FONT = '"Bungee", "Russo One", "Arial Black", sans-serif';
const CN_FONT = '"ZCOOL QingKe HuangYou", "PingFang SC", "Microsoft YaHei", sans-serif';
const UI_FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const RED = ["#ff2d55", "#ff7a1a"];
const BLUE = ["#2f6bff", "#22d3ee"];

// ───────────────────────── stage ─────────────────────────

function drawStage(ctx: CanvasRenderingContext2D, s: GameState, ox: number, oy: number) {
  const stage = STAGES[s.stage] ?? STAGES[0];
  const img = art.stages[s.stage];
  if (img) {
    const scale = H / img.height;
    const bw = img.width * scale;
    const range = Math.max(0, bw - W);
    const offset = (s.camX / Math.max(1, STAGE_W - W)) * range;
    ctx.drawImage(img, -offset + ox - 4, oy - 4, bw + 8, H + 8);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, stage.sky);
    g.addColorStop(1, stage.floor);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // soft vignette so fighters pop
  const v = ctx.createLinearGradient(0, H * 0.55, 0, H);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ───────────────────────── sprite selection ─────────────────────────

function phaseFrame(anim: SpriteAnim, mv: Pick<MoveDef, "startup" | "active" | "recovery">, sf: number): number {
  const n = anim.frames.length;
  const ph = anim.phases;
  const end = mv.startup + mv.active;
  const pick = (list: number[] | undefined, t: number, from: number, to: number) => {
    if (list && list.length) return list[Math.min(list.length - 1, Math.floor(t * list.length))];
    return Math.min(n - 1, Math.floor(from + t * (to - from + 1)));
  };
  const third = Math.max(1, Math.floor(n / 3));
  if (sf <= mv.startup) return pick(ph?.startup, (sf - 1) / Math.max(1, mv.startup), 0, third - 1);
  if (sf <= end) return pick(ph?.active, (sf - mv.startup - 1) / Math.max(1, mv.active), third, 2 * third - 1);
  return pick(ph?.recovery, (sf - end - 1) / Math.max(1, mv.recovery), 2 * third, n - 1);
}

function animFor(set: SpriteSet, names: string[]): SpriteAnim | null {
  for (const n of names) if (set.anims[n]?.frames.length) return set.anims[n];
  return null;
}

/** The sprite set a fighter is drawn from right now (梁圣 form, the Roadster, …). */
function spriteSetFor(f: Fighter): SpriteSet | null {
  const own = art.sprites[CHARS[f.char].id] ?? null;
  const mv = f.move && (f.state === "attack" || f.state === "throwing") ? findMove(f.char, f.move) : null;
  if (mv?.sprite) return art.sprites[mv.sprite] ?? own;
  if (f.muscle > 0) return art.sprites.muscle ?? own;
  return own;
}

function spriteFrame(set: SpriteSet, f: Fighter, t: number): SpriteFrame | null {
  return pickFrame(set, f, t) ?? set.anims.idle?.frames[0] ?? null;
}

function pickFrame(set: SpriteSet, f: Fighter, t: number): SpriteFrame | null {
  const loop = (a: SpriteAnim | null, fps = 10) => (a ? a.frames[Math.floor((t * (a.fps ?? fps)) / 60) % a.frames.length] : null);
  const hold = (a: SpriteAnim | null, p: number) => (a ? a.frames[Math.max(0, Math.min(a.frames.length - 1, Math.floor(p * a.frames.length)))] : null);
  switch (f.state) {
    case "intro":
    case "idle":
      return loop(animFor(set, ["idle"]), 9);
    case "walkF":
      return loop(animFor(set, ["walkF", "idle"]), 12);
    case "walkB":
      return loop(animFor(set, ["walkB", "walkF", "idle"]), 12);
    case "run":
      return loop(animFor(set, ["run", "walkF", "idle"]), 22);
    case "backdash":
      return hold(animFor(set, ["walkB", "idle"]), f.sf / 24);
    case "dodge":
      return hold(animFor(set, [f.dodgeDir > 0 ? "dodgeF" : "dodgeB", "dodgeF", "crouch", "idle"]), f.sf / DODGE.len);
    case "crouch":
      return hold(animFor(set, ["crouch", "crLP", "idle"]), set.anims.crouch ? Math.min(1, f.sf / 4) : 0);
    case "jumpSquat":
    case "land":
      return hold(animFor(set, ["crouch", "crLP", "idle"]), set.anims.crouch ? 0.4 : 0);
    case "air":
    case "fall": {
      const c = CHARS[f.char];
      return hold(animFor(set, ["jump", "idle"]), Math.min(0.999, Math.max(0, (c.jumpVy - f.vy) / (2 * c.jumpVy))));
    }
    case "attack": {
      const mv = f.move ? findMove(f.char, f.move) : null;
      if (!mv) return loop(animFor(set, ["idle"]));
      const pre = mv.preAnim && mv.preFrames ? mv.preFrames : 0;
      if (pre && f.sf <= pre) {
        const pa = animFor(set, [mv.preAnim!]);
        if (pa) return hold(pa, f.sf / (pre + 1));
      }
      const a = animFor(set, [mv.anim, mv.anim.replace(/^(cr|j)/, "st"), mv.animAlt ?? "", "idle"]);
      if (a && mv.linearAnim) return hold(a, Math.min(0.999, f.sf / (mv.startup + mv.active)));
      const timing = pre ? { startup: mv.startup - pre, active: mv.active, recovery: mv.recovery } : mv;
      return a ? a.frames[phaseFrame(a, timing, f.sf - pre)] : null;
    }
    case "hitstun":
      return hold(animFor(set, f.crouching ? ["hitLow", "hit"] : ["hit"]), Math.min(0.999, f.sf / Math.max(1, f.sf + f.stun)));
    case "blockstun":
      return f.blockCrouch ? hold(animFor(set, ["crouchBlock", "crouch", "block"]), 0.999) : hold(animFor(set, ["block", "idle"]), 0.5);
    case "kd":
    case "thrown":
      return hold(animFor(set, ["kd", "hit"]), Math.min(0.6, f.sf / 30));
    case "down":
    case "dead":
      return hold(animFor(set, ["kd", "hit"]), f.state === "dead" ? 0.999 : Math.min(0.999, 0.6 + f.sf / 40));
    case "getup":
      return hold(animFor(set, ["getup", "idle"]), f.sf / 16);
    case "throwing": {
      const mv = f.move ? findMove(f.char, f.move) : null;
      const total = mv ? mv.startup + mv.active + mv.recovery : 30;
      return hold(animFor(set, [mv?.anim ?? "throw", "throw", "stHP"]), Math.min(0.999, f.sf / total));
    }
    case "win":
      return hold(animFor(set, ["win", "idle"]), Math.min(0.999, f.sf / 70));
    case "lose":
      return loop(animFor(set, ["idle"]), 6);
  }
  return null;
}

// ───────────────────────── fighters ─────────────────────────

function blit(ctx: CanvasRenderingContext2D, set: SpriteSet, pages: CanvasImageSource[], frame: SpriteFrame, x: number, y: number, facing: number) {
  const k = 1 / set.scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.drawImage(pages[frame.p ?? 0], frame.x, frame.y, frame.w, frame.h, -frame.ax * k, -frame.ay * k, frame.w * k, frame.h * k);
  ctx.restore();
}

function drawFighter(ctx: CanvasRenderingContext2D, s: GameState, i: 0 | 1, ox: number, oy: number, t: number) {
  const f = s.fighters[i];
  const c = CHARS[f.char];
  const body = bodyOf(f);
  const x = f.x - s.camX + ox;
  const y = GROUND_Y - f.y + oy;
  const car = f.state === "attack" && !!f.move && findMove(f.char, f.move)?.sprite === "roadster";

  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(x, GROUND_Y + oy + 1, Math.max(8, (car ? 40 : body.hurtHalf * 1.6) - f.y * 0.12), 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (f.state === "getup" && Math.floor(t / 3) % 2 === 0) ctx.globalAlpha = 0.65;
  if (f.state === "dodge" && f.sf <= DODGE.invuln) ctx.globalAlpha = 0.75;
  const set = spriteSetFor(f);
  const frame = set ? spriteFrame(set, f, t + i * 13) : null;
  if (set && frame) {
    const mirror = i === 1 && s.fighters[0].char === f.char;
    const pages = mirror ? altPages(set) ?? set.pages : set.pages;
    // status glows: Ultra purple-blue, 梁圣 gold, GPL green
    const glow = f.ultra > 0 ? "rgba(150,120,255,0.95)" : f.muscle > 0 ? "rgba(255,200,60,0.9)" : f.gpl > 0 ? "rgba(80,230,120,0.7)" : "";
    if (glow) {
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = (f.ultra > 0 ? 18 : 14) * (0.8 + 0.2 * Math.sin(t * 0.2)) * (ctx.canvas.width / W);
      blit(ctx, set, pages, frame, x, y, f.facing);
      ctx.restore();
    } else blit(ctx, set, pages, frame, x, y, f.facing);
  } else {
    // placeholder silhouette while sprites load
    const h = f.state === "crouch" ? body.crouch : body.height;
    ctx.fillStyle = c.color;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, x - body.hurtHalf, y - h, body.hurtHalf * 2, h, body.hurtHalf);
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // the community note sticks to his chest
  if (f.noted > 0 && !car) {
    const nx = x + f.facing * 2;
    const ny = y - body.height * 0.62;
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(-0.12 * f.facing);
    ctx.fillStyle = "#ffe14a";
    ctx.fillRect(-9, -7, 18, 14);
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(-6, -3, 12, 1.2);
    ctx.fillRect(-6, 0, 10, 1.2);
    ctx.fillRect(-6, 3, 8, 1.2);
    ctx.restore();
  }
}

/** Overhead markers: 封禁中 / 已解封 / 梁圣 / 服务器繁忙. */
function drawOverhead(ctx: CanvasRenderingContext2D, s: GameState, i: 0 | 1, ox: number, oy: number, t: number) {
  const f = s.fighters[i];
  if (["dead", "kd", "down"].includes(f.state) || s.cineT > 0) return;
  const x = f.x - s.camX + ox;
  const top = GROUND_Y - f.y - bodyOf(f).height - 14 + oy;
  if (f.ban > 0) {
    pill(ctx, tx("⛔ 封禁中 {0}s", (f.ban / 60).toFixed(1)), x, top, 8, "#fff", "rgba(220,30,50,0.92)");
  } else if (f.unban > 0) {
    const pop = Math.min(1, (90 - f.unban) / 6);
    ctx.save();
    ctx.translate(x, top - (90 - f.unban) * 0.08);
    ctx.scale(pop, pop);
    ctx.globalAlpha = Math.min(1, f.unban / 15);
    pill(ctx, tx("✔ 已解封，可以出手了！"), 0, 0, 8, "#fff", "rgba(24,170,90,0.95)");
    ctx.restore();
  } else if (f.muscle > 0) {
    ctx.save();
    ctx.shadowColor = "rgba(255,200,40,0.95)";
    ctx.shadowBlur = 10 * (ctx.canvas.width / W);
    const g = ctx.createLinearGradient(0, top - 10, 0, top + 6);
    g.addColorStop(0, "#fff6c2");
    g.addColorStop(1, "#ffb800");
    text(ctx, tx("梁圣"), x, top - 6 + Math.sin(t * 0.12) * 1.5, 16, g, "center", CN_FONT, 3, "rgba(80,40,0,0.9)");
    ctx.restore();
  } else if (f.busy > 0) {
    pill(ctx, "   " + tx("服务器繁忙"), x, top, 7.5, "#e5e7eb", "rgba(60,64,72,0.92)");
    // loading spinner inside the pill
    const sx = x - 26;
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(sx, top, 3, t * 0.25, t * 0.25 + Math.PI * 1.4);
    ctx.stroke();
  }
}

function pill(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, color: string, bg: string) {
  ctx.font = `${size}px ${UI_FONT}`;
  const w = ctx.measureText(str).width + 10;
  ctx.fillStyle = bg;
  roundRect(ctx, x - w / 2, y - size * 0.75, w, size * 1.5, size * 0.75);
  ctx.fill();
  text(ctx, str, x, y + 0.5, size, color, "center", UI_FONT, 0);
}

// ───────────────────────── projectiles, summons, fx ─────────────────────────

// `from`: first sheet frame to play
const FX_ROW: Record<string, { row: string; scale: number; from?: number; additive?: boolean }> = {
  hit: { row: "hit", scale: 0.55, additive: true },
  heavy: { row: "heavy", scale: 0.75, additive: true },
  block: { row: "block", scale: 0.6, additive: true },
  dust: { row: "dust", scale: 0.55 },
  spark: { row: "hit", scale: 0.7, additive: true },
  wave: { row: "wave", scale: 0.8, additive: true },
  hearts: { row: "hearts", scale: 1.1 },
  smoke: { row: "smoke", scale: 1.0 },
  spiral: { row: "spiral", scale: 0.8, additive: true },
  explosion: { row: "explosion", scale: 0.85 },
  burst: { row: "burst", scale: 0.8, additive: true },
  stamp: { row: "burst", scale: 0.8, additive: true },
  spout: { row: "spout", scale: 1.0 },
  stomp: { row: "stomp", scale: 0.9 },
};

function drawSheetFrame(ctx: CanvasRenderingContext2D, row: string, idx: number, x: number, y: number, scale: number, flip: number, angle = 0) {
  const sheet = art.fx;
  const r = sheet?.rows[row];
  if (!sheet || !r || !r.frames.length) return false;
  const fr = r.frames[Math.max(0, Math.min(r.frames.length - 1, idx))];
  const k = scale / sheet.scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip * k, k);
  if (angle) ctx.rotate(angle);
  ctx.drawImage(sheet.img, fr.x, fr.y, fr.w, fr.h, -fr.ax, -fr.ay, fr.w, fr.h);
  ctx.restore();
  return true;
}

function maidFrame(set: SpriteSet, p: Projectile): SpriteFrame | null {
  const pick = (name: string, k: number) => {
    const a = set.anims[name];
    return a?.frames.length ? a.frames[Math.max(0, Math.min(a.frames.length - 1, Math.floor(k * a.frames.length)))] : null;
  };
  if (p.mode === 0) {
    const a = set.anims.run;
    return a?.frames.length ? a.frames[Math.floor((p.mt * (a.fps ?? 14)) / 60) % a.frames.length] : null;
  }
  if (p.mode === 1) return pick("bonk", p.mt / MAID.bonk);
  if (p.mode === 2) return pick("blow", p.mt / MAID.blow);
  return p.mt < 16 ? pick("hop", p.mt / 16) : pick("curtsy", (p.mt - 16) / (MAID.bye - 16));
}

function drawMaid(ctx: CanvasRenderingContext2D, s: GameState, p: Projectile, ox: number, oy: number) {
  const x = p.x - s.camX + ox;
  const y = GROUND_Y - p.y + oy;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(x, GROUND_Y + oy + 1, 14, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const fade = p.mode === 0 ? Math.min(1, p.mt / 8) : p.mode === 3 ? Math.min(1, (MAID.bye - p.mt) / 8) : 1;
  ctx.globalAlpha = Math.max(0, fade);
  const set = art.sprites.whalemaid;
  const frame = set ? maidFrame(set, p) : null;
  if (set && frame) blit(ctx, set, set.pages, frame, x, y, p.dir);
  else {
    ctx.fillStyle = "#2f4f9f";
    roundRect(ctx, x - 12, y - 52, 24, 52, 10);
    ctx.fill();
    ctx.fillStyle = "#fff";
    roundRect(ctx, x - 8, y - 30, 16, 20, 4);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Claude's Artifact: an orange-framed code window hanging in the air. */
function drawArtifact(ctx: CanvasRenderingContext2D, s: GameState, p: Projectile, ox: number, oy: number, t: number) {
  const w = 40, h = 66;
  const x = p.x - s.camX + ox - w / 2;
  const y = GROUND_Y - p.y - 12 - h + oy;
  const life = Math.min(1, p.age / 8) * Math.min(1, (180 - p.age) / 12);
  ctx.save();
  ctx.globalAlpha = Math.max(0, life) * (p.age > 150 && Math.floor(t / 3) % 2 ? 0.5 : 0.92);
  ctx.shadowColor = "rgba(255,140,50,0.8)";
  ctx.shadowBlur = 8 * (ctx.canvas.width / W);
  ctx.fillStyle = "rgba(28,24,22,0.94)";
  roundRect(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ff8a3d";
  ctx.lineWidth = 1.4;
  roundRect(ctx, x, y, w, h, 3);
  ctx.stroke();
  ctx.fillStyle = "#ff8a3d";
  ctx.fillRect(x, y, w, 6);
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = ["#ff5f57", "#febc2e", "#28c840"][k];
    ctx.beginPath();
    ctx.arc(x + 4 + k * 4, y + 3, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  const lines = [[2, 18, "#c792ea"], [6, 24, "#82aaff"], [6, 14, "#c3e88d"], [10, 20, "#f78c6c"], [6, 26, "#82aaff"], [2, 10, "#c792ea"], [2, 22, "#c3e88d"], [6, 16, "#ffcb6b"], [10, 12, "#82aaff"]] as const;
  const shown = Math.min(lines.length, Math.floor(p.age / 3));
  for (let k = 0; k < shown; k++) {
    const [ind, len, col] = lines[k];
    ctx.fillStyle = col;
    ctx.fillRect(x + 4 + ind, y + 10 + k * 6, len, 2);
  }
  text(ctx, "Artifact", x + w - 2, y + h - 4, 5, "rgba(255,180,120,0.9)", "right", UI_FONT, 0);
  ctx.restore();
}

function drawProjectile(ctx: CanvasRenderingContext2D, s: GameState, p: Projectile, ox: number, oy: number, t: number) {
  const x = p.x - s.camX + ox;
  const y = GROUND_Y - p.y - p.h / 2 + oy;
  const spin = Math.floor(p.age / 3);
  let ok = true;
  switch (p.kind) {
    case "card":
      ctx.globalCompositeOperation = "lighter";
      ok = drawSheetFrame(ctx, "card", spin % 6, x, y, 0.62, p.dir);
      break;
    case "notice":
      ok = drawSheetFrame(ctx, "notice", Math.floor(p.age / 5) % 6, x, y, 0.75, p.dir);
      break;
    case "scroll":
      // GPL is the generated green scroll; MIT is the same scroll recoloured blue and smaller
      if (!p.variant) ctx.filter = "hue-rotate(95deg) saturate(1.2)";
      ok = drawSheetFrame(ctx, "scroll", spin % 6, x, y, p.variant ? 0.72 : 0.58, p.dir);
      ctx.filter = "none";
      break;
    case "rocket":
    case "missile": {
      const dir = p.vx < 0 ? -1 : 1;
      const angle = Math.atan2(-p.vy, Math.abs(p.vx) || 0.01);
      ok = drawSheetFrame(ctx, "rocket", Math.floor(p.age / 3) % 6, x, y, p.kind === "missile" ? 0.6 : 0.72, dir, angle);
      break;
    }
    case "artifact":
      drawArtifact(ctx, s, p, ox, oy, t);
      return;
    case "maid":
    case "blast":
      return;
  }
  ctx.globalCompositeOperation = "source-over";
  if (!ok) {
    const g = ctx.createRadialGradient(x, y, 2, x, y, p.w / 2);
    g.addColorStop(0, "#fff");
    g.addColorStop(1, "rgba(255,160,90,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawProjectiles(ctx: CanvasRenderingContext2D, s: GameState, ox: number, oy: number, t: number) {
  for (const p of s.projectiles) if (p.kind === "maid") drawMaid(ctx, s, p, ox, oy);
  for (const p of s.projectiles) if (p.kind !== "maid") drawProjectile(ctx, s, p, ox, oy, t);
}

/** A big mouse cursor with a click ripple (Agent 代操作). */
function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, facing: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 4 + k * 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = Math.min(1, 1.6 - k);
  ctx.scale(-facing * 1.1, 1.1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16);
  ctx.lineTo(4, 12);
  ctx.lineTo(7, 19);
  ctx.lineTo(10, 18);
  ctx.lineTo(7, 11);
  ctx.lineTo(12, 11);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function drawSay(ctx: CanvasRenderingContext2D, s: GameState, fx: Fx, ox: number, oy: number) {
  const k = fx.age / fx.life;
  const x = Math.min(W - 40, Math.max(40, fx.x - s.camX + ox));
  const y = GROUND_Y - fx.y + oy - Math.min(12, fx.age * 0.5);
  const pop = fx.age < 6 ? 0.6 + (fx.age / 6) * 0.5 : 1.1 - Math.min(0.1, (fx.age - 6) / 40);
  const col = fx.who === 0 ? RED : BLUE;
  ctx.save();
  ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
  ctx.translate(x, y);
  ctx.scale(pop, pop);
  const g = ctx.createLinearGradient(0, -8, 0, 8);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, col[1]);
  text(ctx, tx(fx.text ?? ""), 0, 0, 13, g, "center", CN_FONT, 4, "rgba(10,6,20,0.95)");
  ctx.restore();
}

function drawFx(ctx: CanvasRenderingContext2D, s: GameState, ox: number, oy: number) {
  for (const fx of s.fx) {
    const x = fx.x - s.camX + ox;
    const y = GROUND_Y - fx.y + oy;
    const p = fx.age / fx.life;
    if (fx.kind === "say") continue; // drawn above the HUD layer
    if (fx.kind === "click") {
      drawCursor(ctx, x, y, p, fx.facing);
      continue;
    }
    if (fx.kind === "reflect" || fx.kind === "aura") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = fx.kind === "reflect" ? "#ffd28a" : "#c4b5fd";
      ctx.lineWidth = 2.2 * (1 - p) + 0.6;
      ctx.beginPath();
      if (fx.kind === "reflect") ctx.arc(x, y, 6 + p * 22, 0, Math.PI * 2);
      else ctx.ellipse(x, y, 16 + p * 28, 30 + p * 40, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    const def = FX_ROW[fx.kind] ?? FX_ROW.hit;
    const from = def.from ?? 0;
    const idx = from + Math.floor(p * (6 - from));
    if (def.additive) ctx.globalCompositeOperation = "lighter";
    const ok = drawSheetFrame(ctx, def.row, idx, x, y, def.scale, fx.facing);
    ctx.globalCompositeOperation = "source-over";
    if (!ok) {
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = fx.kind === "block" ? "#8fd3ff" : fx.kind === "dust" || fx.kind === "smoke" ? "#ddd" : fx.kind === "spout" ? "#7cc7ff" : "#fff2a8";
      ctx.beginPath();
      ctx.arc(x, y, (fx.kind === "heavy" || fx.kind === "explosion" ? 16 : 10) * (0.5 + p), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function drawBoxes(ctx: CanvasRenderingContext2D, s: GameState) {
  ctx.lineWidth = 0.8;
  for (const f of s.fighters) {
    ctx.strokeStyle = "rgba(80,170,255,0.95)";
    for (const b of hurtboxes(f)) ctx.strokeRect(b.x0 - s.camX, GROUND_Y - b.y1, b.x1 - b.x0, b.y1 - b.y0);
    const hb = activeHitbox(f);
    if (hb) {
      ctx.fillStyle = "rgba(255,40,40,0.35)";
      ctx.fillRect(hb.x0 - s.camX, GROUND_Y - hb.y1, hb.x1 - hb.x0, hb.y1 - hb.y0);
    }
  }
  for (const p of s.projectiles) {
    ctx.strokeStyle = "rgba(255,40,40,0.9)";
    const b = projectileHitbox(p);
    if (b) ctx.strokeRect(b.x0 - s.camX, GROUND_Y - b.y1, b.x1 - b.x0, b.y1 - b.y0);
  }
}

// ───────────────────────── HUD helpers ─────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, h / 2, w / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function text(
  ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, fill: string | CanvasGradient,
  align: CanvasTextAlign = "left", font = CN_FONT, outline = 2.2, outlineColor = "rgba(10,6,20,0.9)"
) {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  if (outline) {
    ctx.lineWidth = outline;
    ctx.strokeStyle = outlineColor;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
}

function formatViewers(n: number) {
  if (getLang() === "en") return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
}

// where each portrait's face sits (fractions of the portrait), for the round HUD avatars
const FACE_CROP: Record<string, [number, number, number]> = {
  chatgpt: [0.5, 0.3, 0.5],
  claude: [0.5, 0.3, 0.5],
  deepseek: [0.5, 0.3, 0.5],
  grok: [0.5, 0.3, 0.5],
};

function drawAvatar(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, r: number, ring: string[], flip: boolean) {
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, ring[0]);
  g.addColorStop(1, ring[1]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#222";
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  const p = art.portraits[id];
  if (p) {
    const [fx, fy, fw] = FACE_CROP[id] ?? [0.5, 0.3, 0.55];
    const sw = p.width * fw;
    if (flip) {
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(p, p.width * fx - sw / 2, p.height * fy - sw / 2, sw, sw, cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}

interface Status {
  label: string;
  frames: number;
  max: number;
  color: string;
}

function statuses(f: Fighter): Status[] {
  const out: Status[] = [];
  if (f.ban > 0) out.push({ label: "封禁", frames: f.ban, max: 60, color: "#ff3b4f" });
  else if (f.banCd > 0) out.push({ label: "免封", frames: f.banCd, max: BAN_COOLDOWN, color: "#8b93a3" });
  if (f.ultra > 0) out.push({ label: "Ultra", frames: f.ultra, max: 480, color: "#a78bfa" });
  if (f.muscle > 0) out.push({ label: "梁圣", frames: f.muscle, max: 600, color: "#ffc93c" });
  if (f.busy > 0) out.push({ label: "繁忙", frames: f.busy, max: 140, color: "#9ca3af" });
  if (f.gpl > 0) out.push({ label: "GPL", frames: f.gpl, max: 240, color: "#3ddc84" });
  if (f.noted > 0) out.push({ label: "注记", frames: f.noted, max: 300, color: "#ffe14a" });
  return out;
}

// ───────────────────────── HUD ─────────────────────────

function drawHud(ctx: CanvasRenderingContext2D, s: GameState, rs: RenderState, o: RenderOpts) {
  const BW = 168;
  for (const i of [0, 1] as const) {
    const f = s.fighters[i];
    const c = CHARS[f.char];
    const col = i === 0 ? RED : BLUE;
    const ratio = Math.max(0, f.hp / c.hp);
    rs.lagHp[i] = ratio < rs.lagHp[i] ? Math.max(ratio, rs.lagHp[i] - 0.005) : ratio;
    const x0 = i === 0 ? 38 : W - 38 - BW;
    const y0 = 8;

    drawAvatar(ctx, c.id, i === 0 ? 20 : W - 20, 18, 13, col, i === 1);

    // bar
    ctx.fillStyle = "rgba(10,6,20,0.75)";
    roundRect(ctx, x0 - 2, y0 - 2, BW + 4, 14, 7);
    ctx.fill();
    const lagW = BW * rs.lagHp[i];
    const hpW = BW * ratio;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    roundRect(ctx, i === 0 ? x0 + BW - lagW : x0, y0, lagW, 10, 5);
    ctx.fill();
    const g = ctx.createLinearGradient(x0, 0, x0 + BW, 0);
    g.addColorStop(0, i === 0 ? col[1] : col[0]);
    g.addColorStop(1, i === 0 ? col[0] : col[1]);
    ctx.fillStyle = ratio < 0.25 && Math.floor(rs.t / 8) % 2 ? "#fff" : f.gpl > 0 ? "#3ddc84" : g;
    if (hpW > 0) {
      roundRect(ctx, i === 0 ? x0 + BW - hpW : x0, y0, hpW, 10, 5);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      roundRect(ctx, i === 0 ? x0 + BW - hpW + 2 : x0 + 2, y0 + 1.5, Math.max(0, hpW - 4), 2.5, 1.2);
      ctx.fill();
    }

    // name (+ 「（已被收购）」 after losing a round to Grok) and round wins
    const name = (o.names[i] || c.name) + (f.acquired ? tx("（已被收购）") : "");
    text(ctx, name, i === 0 ? x0 + 2 : x0 + BW - 2, y0 + 19, 10, f.acquired ? "#ffd166" : "#fff", i === 0 ? "left" : "right", CN_FONT, 2.4);
    for (let r = 0; r < ROUNDS_TO_WIN; r++) {
      const hx = i === 0 ? x0 + BW - 6 - r * 11 : x0 + 6 + r * 11;
      text(ctx, r < f.wins ? "♥" : "♡", hx, y0 + 19, 10, r < f.wins ? col[0] : "rgba(255,255,255,0.5)", "center", CN_FONT, 2);
    }

    // status pills under the name, each with a draining bar and the seconds left
    let sx = i === 0 ? x0 : x0 + BW;
    for (const st of statuses(f)) {
      const label = `${tx(st.label)} ${Math.ceil(st.frames / 60)}`;
      ctx.font = `7px ${UI_FONT}`;
      const w = ctx.measureText(label).width + 8;
      const px = i === 0 ? sx : sx - w;
      const flash = st.label === "封禁" || f.unban > 80;
      ctx.fillStyle = "rgba(10,6,20,0.8)";
      roundRect(ctx, px, y0 + 27, w, 9, 3);
      ctx.fill();
      ctx.fillStyle = st.color;
      ctx.globalAlpha = flash && Math.floor(rs.t / 6) % 2 ? 0.55 : 0.85;
      roundRect(ctx, px, y0 + 27, w * Math.min(1, st.frames / st.max), 9, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      text(ctx, label, px + w / 2, y0 + 31.8, 7, "#fff", "center", UI_FONT, 1.6);
      sx += (i === 0 ? 1 : -1) * (w + 3);
    }
    if (f.unban > 0) {
      // the HUD flashes green for a moment when the ban lifts
      ctx.globalAlpha = (f.unban / 90) * 0.6;
      ctx.strokeStyle = "#3ddc84";
      ctx.lineWidth = 2;
      roundRect(ctx, x0 - 3, y0 - 3, BW + 6, 16, 8);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // power gauge
    const gw = 118;
    const gx = i === 0 ? 12 : W - 12 - gw;
    const gy = H - 15;
    const stocks = Math.floor(f.meter / METER_STOCK);
    const part = (f.meter % METER_STOCK) / METER_STOCK;
    ctx.fillStyle = "rgba(10,6,20,0.7)";
    roundRect(ctx, gx - 2, gy - 2, gw + 4, 9, 4.5);
    ctx.fill();
    const pw = stocks >= 2 ? gw : gw * part;
    const pg = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    pg.addColorStop(0, i === 0 ? "#ff5ac8" : "#36e0ff");
    pg.addColorStop(1, i === 0 ? "#ffd166" : "#a78bfa");
    ctx.fillStyle = pg;
    if (pw > 0) {
      roundRect(ctx, i === 0 ? gx : gx + gw - pw, gy, pw, 5, 2.5);
      ctx.fill();
    }
    const bx = i === 0 ? gx + gw + 10 : gx - 10;
    ctx.fillStyle = stocks ? (i === 0 ? "#ff5ac8" : "#36e0ff") : "rgba(10,6,20,0.7)";
    ctx.beginPath();
    ctx.arc(bx, gy + 2.5, 6.5, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, String(stocks), bx, gy + 3, 8, "#fff", "center", NUM_FONT, 0);
    if (stocks > 0 && Math.floor(rs.t / 10) % 2) text(ctx, tx("大招就绪"), i === 0 ? gx : gx + gw, gy - 7, 7, "#ffe14a", i === 0 ? "left" : "right", CN_FONT, 2);

    // combo counter on the attacker's side
    const victim = s.fighters[1 - i];
    if (victim.combo >= 2) {
      const cx = i === 0 ? 16 : W - 16;
      const cg = ctx.createLinearGradient(0, 60, 0, 86);
      cg.addColorStop(0, "#fff7b0");
      cg.addColorStop(1, i === 0 ? "#ff7a1a" : "#22d3ee");
      text(ctx, String(victim.combo), cx, 74, 22, cg, i === 0 ? "left" : "right", NUM_FONT, 3);
      text(ctx, tx("连击"), cx + (i === 0 ? 2 : -2), 92, 10, "#fff", i === 0 ? "left" : "right", CN_FONT, 2.4);
    }
  }

  // PK timer badge
  const cx = W / 2, cy = 17;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 15.5, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = RED[0];
  ctx.fillRect(cx - 16, cy - 16, 16, 32);
  ctx.fillStyle = BLUE[0];
  ctx.fillRect(cx, cy - 16, 16, 32);
  ctx.restore();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, 15.5, 0, Math.PI * 2);
  ctx.stroke();
  const secs = s.training ? "∞" : String(Math.ceil(s.timer / 60)).padStart(2, "0");
  text(ctx, secs, cx, cy + 1, 13, s.timer < 600 && !s.training && Math.floor(rs.t / 15) % 2 ? "#ffe14a" : "#fff", "center", NUM_FONT, 2.2);
  text(ctx, "PK", cx, 39, 9, "#fff", "center", NUM_FONT, 2.2);

  // LIVE + viewers
  ctx.fillStyle = "#ff2d55";
  roundRect(ctx, 6, 46, 28, 10, 5);
  ctx.fill();
  text(ctx, "● LIVE", 20, 51.5, 6, "#fff", "center", NUM_FONT, 0);
  text(ctx, tx("{0}人在看", formatViewers(rs.viewers)), 38, 51.5, 7.5, "#fff", "left", CN_FONT, 2);

  if (o.ping != null) text(ctx, `${Math.round(o.ping)}ms`, W - 8, 51.5, 6.5, o.ping < 80 ? "#7dff9a" : o.ping < 150 ? "#ffe14a" : "#ff6b6b", "right", NUM_FONT, 1.6);
}

// ───────────────────────── livestream flavour: danmaku + gifts ─────────────────────────

const COMMENTS = [
  "666", "前方高能", "冲冲冲", "这波操作可以", "哈哈哈哈", "关注了关注了", "打得好！", "就这？", "笑死", "稳住！", "太秀了",
  "名场面", "啊啊啊啊", "模型大乱斗", "哪个模型最强？", "AI 打 AI 笑死", "已深度思考", "你说得完全对", "稳稳接住了", "点火！",
  "服务器繁忙", "我的额度呢", "开源万岁", "Grok，这是真的吗？",
];

// callouts the room reacts to
const SAY_DANMAKU: Record<string, string[]> = {
  "我会稳稳接住你": ["稳稳接住了！", "被接住了哈哈哈"],
  "你说得完全对！": ["你说得完全对", "Claude 又在附和"],
  "额度已重置": ["额度没了😭", "我的额度呢"],
  "违反使用政策": ["又被封了", "封号警告⚠"],
  "梁圣降临！": ["梁圣降临！！", "肌肉开源了"],
  "服务器繁忙": ["服务器繁忙", "又繁忙了"],
  "快速计划外解体！": ["火箭炸了🚀", "计划外解体！"],
  "读者补充了背景信息": ["Grok，这是真的吗？", "社群注记来了"],
  "GPL 感染": ["GPL 传染了", "开源病毒😂"],
};

function pushDanmaku(rs: RenderState, textStr: string, color = "#fff") {
  rs.danmaku.push({
    text: tx(textStr),
    x: W + 10 + Math.random() * 40,
    y: 64 + Math.floor(Math.random() * 6) * 10,
    speed: 0.9 + Math.random() * 0.8,
    color,
    size: 8 + Math.random() * 2,
  });
}

function pushGift(rs: RenderState, side: 0 | 1, icon: string, textStr: string) {
  rs.gifts.push({ text: textStr, icon, age: 0, side });
  if (rs.gifts.length > 3) rs.gifts.shift();
}

function updateLive(s: GameState, rs: RenderState) {
  const names = s.fighters.map((f) => CHARS[f.char].name);
  // ambient chatter
  if (--rs.nextDanmaku <= 0 && s.phase !== "matchEnd") {
    const r = Math.random();
    const pick = r < 0.35 ? tx("{0}加油！", names[Math.floor(Math.random() * 2)]) : COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
    pushDanmaku(rs, pick, Math.random() < 0.2 ? "#ffd166" : "#fff");
    rs.nextDanmaku = 50 + Math.floor(Math.random() * 90);
  }
  // reactions to what happens on stage
  for (const i of [0, 1] as const) {
    const victim = s.fighters[1 - i];
    if (victim.combo >= 3 && victim.combo > rs.lastCombo[i]) {
      pushDanmaku(rs, tx("{0}连击！{1}太秀了", victim.combo, names[i]), "#ffd166");
      rs.viewers += 120 + victim.combo * 40;
      if (victim.combo === 4) pushGift(rs, i, "🌹", tx("观众送给{0} 玫瑰 x{1}", names[i], victim.combo));
    }
    rs.lastCombo[i] = victim.combo;
    const hp = s.fighters[i].hp / CHARS[s.fighters[i].char].hp;
    if (hp < rs.lastHp[i] - 0.06) rs.viewers += 60;
    rs.lastHp[i] = hp;
    const f = s.fighters[i];
    if (f.acquired && !rs.lastAcquired[i]) {
      pushDanmaku(rs, tx("{0}已被收购", names[i]), "#ffd166");
      pushDanmaku(rs, "收购成功！", "#ff7ad9");
    }
    rs.lastAcquired[i] = f.acquired;
  }
  for (const fx of s.fx) {
    if (fx.kind !== "say" || !fx.text) continue;
    const key = `${fx.text}@${s.frame - fx.age}`;
    if (rs.seenSay.includes(key)) continue;
    rs.seenSay.push(key);
    if (rs.seenSay.length > 30) rs.seenSay.shift();
    const lines = SAY_DANMAKU[fx.text];
    if (lines) pushDanmaku(rs, lines[Math.floor(Math.random() * lines.length)], "#7dfcff");
  }
  if (s.superFreeze === 41 || (s.cineT === CINE_LEN[CINE_ULTRA] - 1 && s.cineKind === CINE_ULTRA)) {
    const who = s.superFreeze === 41 ? s.superOwner : s.cineOwner;
    pushDanmaku(rs, "大招来了！！", "#ff7ad9");
    pushGift(rs, who as 0 | 1, "🚀", tx("观众送给{0} 火箭 x1", names[who]));
    rs.viewers += 800;
  }
  if (s.phase !== rs.lastPhase) {
    if (s.phase === "ko" && !s.timeOver) {
      ["KO!!!", "好家伙", "666666", "名场面！"].forEach((t) => pushDanmaku(rs, t, "#ff7ad9"));
      if (s.roundWinner === 0 || s.roundWinner === 1) pushGift(rs, s.roundWinner, "👑", tx("观众送给{0} 皇冠 x1", names[s.roundWinner]));
      rs.viewers += 1500;
    }
    if (s.phase === "intro") rs.lastHp = [1, 1];
    rs.lastPhase = s.phase;
  }
  for (const d of rs.danmaku) d.x -= d.speed;
  rs.danmaku = rs.danmaku.filter((d) => d.x > -160);
  for (const g of rs.gifts) g.age++;
  rs.gifts = rs.gifts.filter((g) => g.age < 170);
  if (rs.t % 30 === 0) rs.viewers += Math.floor(Math.random() * 25);
}

function drawLive(ctx: CanvasRenderingContext2D, rs: RenderState) {
  ctx.globalAlpha = 0.9;
  for (const d of rs.danmaku) text(ctx, d.text, d.x, d.y, d.size, d.color, "left", CN_FONT, 2);
  ctx.globalAlpha = 1;
  rs.gifts.forEach((g, k) => {
    const slide = Math.min(1, g.age / 10) * (g.age > 150 ? Math.max(0, 1 - (g.age - 150) / 20) : 1);
    const w = 132;
    const xx = g.side === 0 ? -w + (w + 8) * slide : W - (w + 8) * slide;
    const y = 122 + k * 18;
    const gg = ctx.createLinearGradient(xx, 0, xx + w, 0);
    gg.addColorStop(0, g.side === 0 ? "rgba(255,45,85,0.85)" : "rgba(47,107,255,0.85)");
    gg.addColorStop(1, "rgba(255,255,255,0.08)");
    ctx.fillStyle = gg;
    roundRect(ctx, xx, y, w, 14, 7);
    ctx.fill();
    text(ctx, g.icon, xx + 9, y + 7.5, 9, "#fff", "center", CN_FONT, 0);
    text(ctx, g.text, xx + 18, y + 7.5, 7.5, "#fff", "left", CN_FONT, 1.6);
  });
}

// ───────────────────────── announcements ─────────────────────────

function announceText(s: GameState, o: RenderOpts): { main: string; color: [string, string]; scale: number } | null {
  const pf = s.phaseFrame;
  const pop = (start: number) => Math.min(1, (pf - start) / 8);
  if (s.phase === "intro") {
    const [a, b] = s.fighters;
    const final = a.wins === ROUNDS_TO_WIN - 1 && b.wins === ROUNDS_TO_WIN - 1;
    if (pf < 68) return { main: final ? "FINAL ROUND" : `ROUND ${s.round}`, color: ["#ffffff", "#ffd166"], scale: pop(0) };
    return { main: "FIGHT!", color: ["#fff1a8", "#ff2d55"], scale: 1 + Math.max(0, 1 - (pf - 68) / 6) * 0.6 };
  }
  if (s.phase === "ko") {
    if (pf < 100) return { main: s.timeOver ? "TIME OVER" : "K.O.", color: s.timeOver ? ["#fff", "#ffd166"] : ["#fff", "#ff2d55"], scale: 1 + Math.max(0, 1 - pf / 8) * 1.2 };
    if (s.roundWinner === 2) return { main: "DRAW", color: ["#fff", "#cbd5e1"], scale: 1 };
    const w = s.fighters[s.roundWinner];
    const name = o.names[s.roundWinner] || CHARS[w.char].name;
    return { main: s.perfect ? "PERFECT" : tx("{0} 胜", name), color: s.perfect ? ["#fff", "#7dfcff"] : ["#fff", "#ffd166"], scale: pop(100) };
  }
  if (s.phase === "matchEnd") {
    if (s.matchWinner === 2) return { main: "DRAW GAME", color: ["#fff", "#cbd5e1"], scale: pop(0) };
    if (o.localSide === 0 || o.localSide === 1) {
      const win = s.matchWinner === o.localSide;
      return { main: win ? "YOU WIN" : "YOU LOSE", color: win ? ["#fff", "#ffd166"] : ["#e2e8f0", "#64748b"], scale: pop(0) };
    }
    const name = o.names[s.matchWinner] || CHARS[s.fighters[s.matchWinner].char].name;
    return { main: tx("{0} 获胜", name), color: ["#fff", "#ffd166"], scale: pop(0) };
  }
  return null;
}

function drawAnnounce(ctx: CanvasRenderingContext2D, s: GameState, o: RenderOpts) {
  const a = announceText(s, o);
  if (!a || a.scale <= 0) return;
  const cn = /[一-鿿]/.test(a.main);
  const size = cn ? 34 : 30;
  ctx.save();
  ctx.translate(W / 2, H / 2 - 28);
  ctx.scale(a.scale, a.scale);
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, a.color[0]);
  g.addColorStop(1, a.color[1]);
  ctx.shadowColor = a.color[1];
  ctx.shadowBlur = 12;
  text(ctx, a.main, 0, 0, size, g, "center", cn ? CN_FONT : NUM_FONT, 6);
  ctx.restore();
}

// ───────────────────────── KO gags ─────────────────────────
// Each fighter's KO is a product error screen: ChatGPT's 「Something went wrong」 with a 重新生成 button that
// presses itself and greys out, Claude's 「对话已达长度上限」, DeepSeek's 「服务器繁忙」 and Grok's rapid unscheduled
// disassembly card.

function textWidth(ctx: CanvasRenderingContext2D, str: string, size: number, font = UI_FONT) {
  ctx.font = `${size}px ${font}`;
  return ctx.measureText(str).width;
}

function dialog(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bg: string, border: string) {
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, x + 2, y + 3, w, h, 5);
  ctx.fill();
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.2;
  roundRect(ctx, x, y, w, h, 5);
  ctx.stroke();
}

function drawKoGag(ctx: CanvasRenderingContext2D, s: GameState, t: number) {
  if (s.phase !== "ko" || s.timeOver || s.phaseFrame < 24) return;
  const losers = s.fighters.filter((f) => f.hp <= 0);
  if (losers.length !== 1) return;
  const f = losers[0];
  const id = CHARS[f.char].id;
  const k = Math.min(1, (s.phaseFrame - 24) / 8);
  const cx = Math.min(W - 112, Math.max(112, f.x - s.camX));
  const cy = 176;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k);
  ctx.globalAlpha = k;
  if (id === "chatgpt") {
    dialog(ctx, -84, -24, 168, 48, "rgba(32,33,35,0.96)", "#ef4444");
    text(ctx, "⚠ Something went wrong.", -74, -10, 9, "#fca5a5", "left", UI_FONT, 0);
    const pressed = s.phaseFrame > 70;
    const grey = s.phaseFrame > 82;
    ctx.fillStyle = grey ? "#4b5563" : pressed ? "#d1d5db" : "#f3f4f6";
    roundRect(ctx, -30 + (pressed && !grey ? 1 : 0), 2 + (pressed && !grey ? 1 : 0), 60, 14, 7);
    ctx.fill();
    text(ctx, tx("↻ 重新生成"), 0 + (pressed && !grey ? 1 : 0), 9.5, 7.5, grey ? "#9ca3af" : "#111827", "center", UI_FONT, 0);
    if (s.phaseFrame > 50 && s.phaseFrame < 72) drawCursor(ctx, 20 - (s.phaseFrame - 50) * 0.6, 22 - (s.phaseFrame - 50) * 0.5, 0.2, -1);
  } else if (id === "claude") {
    // dialogs grow with their text so the English lines fit too
    const half = Math.max(92, textWidth(ctx, tx("这段对话已达长度上限。"), 9) / 2 + 12);
    dialog(ctx, -half, -26, half * 2, 52, "rgba(250,247,240,0.97)", "#d97757");
    text(ctx, tx("这段对话已达长度上限。"), -half + 10, -12, 9, "#3d2b1f", "left", UI_FONT, 0);
    text(ctx, tx("开启新对话？"), -half + 10, 2, 7.5, "#6b5545", "left", UI_FONT, 0);
    ctx.fillStyle = "#d97757";
    roundRect(ctx, half - 66, 6, 56, 13, 4);
    ctx.fill();
    text(ctx, tx("新对话"), half - 38, 13, 7, "#fff", "center", UI_FONT, 0);
  } else if (id === "deepseek") {
    const half = Math.max(96, textWidth(ctx, tx("服务器繁忙，请稍后再试。"), 10) / 2 + 30);
    dialog(ctx, -half, -22, half * 2, 44, "rgba(229,231,235,0.97)", "#9ca3af");
    ctx.strokeStyle = "#4d6bfe";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-half + 18, 0, 7, t * 0.2, t * 0.2 + Math.PI * 1.3);
    ctx.stroke();
    text(ctx, tx("服务器繁忙，请稍后再试。"), -half + 32, 0, 10, "#374151", "left", UI_FONT, 0);
  } else if (id === "grok") {
    dialog(ctx, -100, -24, 200, 48, "rgba(12,12,14,0.95)", "#e5e7eb");
    text(ctx, tx("快速计划外解体"), 0, -9, 12, "#fff", "center", CN_FONT, 0);
    text(ctx, tx("收集到了宝贵数据 ✓"), 0, 9, 8, "#86efac", "center", UI_FONT, 0);
    // confetti
    for (let n = 0; n < 18; n++) {
      const a = n * 2.4 + 0.3;
      const r = 30 + ((n * 37) % 70) * Math.min(1, (s.phaseFrame - 24) / 30);
      ctx.fillStyle = ["#ff5f57", "#febc2e", "#28c840", "#60a5fa", "#f472b6"][n % 5];
      ctx.fillRect(Math.cos(a) * r * 1.4, Math.sin(a) * r * 0.6 - 10 + (s.phaseFrame - 24) * 0.25, 3, 2);
    }
  }
  ctx.restore();
}

// ───────────────────────── full-screen cut-ins ─────────────────────────

/** Claude's super lands: the screen turns into an account-suspension page and the red stamp comes down. */
function drawBanCine(ctx: CanvasRenderingContext2D, s: GameState) {
  const len = CINE_LEN[CINE_BAN];
  const t = len - s.cineT;
  const victim = s.fighters[1 - s.cineOwner];
  const name = CHARS[victim.char].name;
  const k = Math.min(1, t / 10);
  ctx.fillStyle = `rgba(245,242,235,${0.97 * k})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = k;
  ctx.fillStyle = "#d97757";
  ctx.fillRect(0, 0, W, 4);
  text(ctx, tx("账号状态"), 40, 78, 9, "#8a7a6a", "left", UI_FONT, 0);
  text(ctx, tx("你的账号已被封禁"), 40, 102, 22, "#2b2118", "left", UI_FONT, 0);
  text(ctx, tx("用户：{0}", name), 40, 128, 10, "#5c4a3a", "left", UI_FONT, 0);
  const small = getLang() === "en" ? 8 : 9;
  text(ctx, tx("原因：检测到违反使用政策的行为（在格斗游戏里出拳）"), 40, 144, small, "#5c4a3a", "left", UI_FONT, 0);
  text(ctx, tx("如果你认为这是误判，可以在 1 秒后提交申诉。"), 40, 160, small, "#5c4a3a", "left", UI_FONT, 0);
  ctx.fillStyle = "#e9e3d8";
  roundRect(ctx, 40, 176, 120, 22, 5);
  ctx.fill();
  text(ctx, tx("提交申诉（不可用）"), 100, 187, 8.5, "#a89c8c", "center", UI_FONT, 0);
  ctx.globalAlpha = 1;
  // the stamp falls, slams and leaves its mark
  const at = BAN_STAMP_AT;
  const cx = W * 0.74, cy = H * 0.7;
  if (t < at) {
    const fall = Math.max(0, (at - t) / 16);
    if (t > at - 22) {
      ctx.save();
      ctx.translate(cx, cy - fall * 140);
      ctx.scale(1 + fall * 0.6, 1 + fall * 0.6);
      ctx.fillStyle = "#7a4a2a";
      ctx.fillRect(-10, -62, 20, 36);
      ctx.fillStyle = "#c81e1e";
      ctx.fillRect(-40, -28, 80, 26);
      ctx.restore();
    }
  } else {
    const p = Math.min(1, (t - at) / 6);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.16);
    ctx.scale(1.25 - 0.25 * p, 1.25 - 0.25 * p);
    ctx.strokeStyle = "rgba(200,20,30,0.92)";
    ctx.lineWidth = 5;
    roundRect(ctx, -82, -34, 164, 68, 8);
    ctx.stroke();
    ctx.lineWidth = 1.6;
    roundRect(ctx, -74, -26, 148, 52, 6);
    ctx.stroke();
    text(ctx, tx("已封禁"), 0, 2, getLang() === "en" ? 26 : 34, "rgba(200,20,30,0.92)", "center", CN_FONT, 0);
    ctx.restore();
    if (t - at < 14) {
      ctx.globalCompositeOperation = "lighter";
      drawSheetFrame(ctx, "burst", Math.floor(((t - at) / 14) * 6), cx, cy, 1.3, 1);
      ctx.globalCompositeOperation = "source-over";
    }
  }
}

const EFFORT = ["Low", "Medium", "High", "Ultra"];

/** ChatGPT's Ultra: the model card pops up and the Effort slider is dragged all the way. */
function drawUltraCine(ctx: CanvasRenderingContext2D, s: GameState, t0: number) {
  const len = CINE_LEN[CINE_ULTRA];
  const t = len - s.cineT;
  const k = Math.min(1, t / 10);
  ctx.fillStyle = `rgba(8,6,20,${0.78 * k})`;
  ctx.fillRect(0, 0, W, H);
  const portrait = art.portraits.chatgpt;
  if (portrait) {
    ctx.save();
    ctx.globalAlpha = 0.85 * k;
    const ph = H * 1.05;
    const pw = (portrait.width / portrait.height) * ph;
    ctx.drawImage(portrait, (s.cineOwner === 0 ? -30 : W - pw + 30) + (1 - k) * (s.cineOwner === 0 ? -60 : 60), H - ph + 10, pw, ph);
    ctx.restore();
  }
  // the card
  const cw = 210, ch = 118;
  const x = s.cineOwner === 0 ? W - cw - 30 : 30;
  const y = 60 + (1 - k) * 30;
  ctx.globalAlpha = k;
  ctx.fillStyle = "rgba(24,24,32,0.97)";
  roundRect(ctx, x, y, cw, ch, 10);
  ctx.fill();
  const glow = Math.max(0, (t - 86) / 20);
  ctx.strokeStyle = glow > 0 ? `rgba(167,139,250,${0.5 + 0.5 * Math.min(1, glow)})` : "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.4 + glow * 1.5;
  roundRect(ctx, x, y, cw, ch, 10);
  ctx.stroke();
  text(ctx, "Ultra", x + 14, y + 20, 15, "#fff", "left", UI_FONT, 0);
  text(ctx, "›  GPT-6 Astra", x + 58, y + 21, 10, "rgba(255,255,255,0.7)", "left", UI_FONT, 0);
  text(ctx, "Select effort", x + 14, y + 46, 8.5, "rgba(255,255,255,0.6)", "left", UI_FONT, 0);
  // slider: dragged from frame 24 to 86
  const p = Math.max(0, Math.min(1, (t - 24) / 62));
  const ease = p * p * (3 - 2 * p);
  const sx = x + 16, sw = cw - 32, sy = y + 70;
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  roundRect(ctx, sx, sy - 2.5, sw, 5, 2.5);
  ctx.fill();
  const g = ctx.createLinearGradient(sx, 0, sx + sw, 0);
  g.addColorStop(0, "#60a5fa");
  g.addColorStop(1, "#a78bfa");
  ctx.fillStyle = g;
  roundRect(ctx, sx, sy - 2.5, Math.max(5, sw * ease), 5, 2.5);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(sx + sw * ease, sy, 6, 0, Math.PI * 2);
  ctx.fill();
  const level = Math.min(3, Math.floor(ease * 3.999));
  EFFORT.forEach((label, n) => {
    const lx = sx + (sw * n) / 3;
    text(ctx, label, lx, sy + 16, 7.5, n === level ? "#fff" : "rgba(255,255,255,0.35)", n === 0 ? "left" : n === 3 ? "right" : "center", UI_FONT, 0);
  });
  text(ctx, EFFORT[level], x + cw - 14, y + 46, 10, level === 3 ? "#c4b5fd" : "#fff", "right", UI_FONT, 0);
  if (glow > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, glow);
    ctx.shadowColor = "#a78bfa";
    ctx.shadowBlur = 16;
    text(ctx, tx("Effort，拉满。"), s.cineOwner === 0 ? W - 135 : 135, y + ch + 28, 22, "#e9d5ff", "center", CN_FONT, 4);
    ctx.restore();
  }
  // a little sparkle field once Ultra kicks in
  if (glow > 0) {
    ctx.fillStyle = "rgba(196,181,253,0.8)";
    for (let n = 0; n < 24; n++) {
      const px = (n * 97 + t0 * (1 + (n % 3))) % W;
      const py = H - ((n * 53 + t0 * 2) % H);
      ctx.fillRect(px, py, 1.5, 1.5);
    }
  }
  ctx.globalAlpha = 1;
}

function drawSuperFlash(ctx: CanvasRenderingContext2D, s: GameState) {
  const f = s.fighters[s.superOwner] ?? s.fighters[0];
  const c = CHARS[f.char];
  const k = s.superFreeze / 42;
  ctx.fillStyle = "rgba(8,4,20,0.6)";
  ctx.fillRect(0, 0, W, H);
  const bandY = 74;
  const left = s.superOwner === 0;
  const bg = ctx.createLinearGradient(0, 0, W, 0);
  bg.addColorStop(0, left ? "rgba(255,45,85,0.95)" : "rgba(47,107,255,0.4)");
  bg.addColorStop(1, left ? "rgba(255,122,26,0.4)" : "rgba(34,211,238,0.95)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, bandY, W, 66);
  const portrait = art.portraits[c.id];
  const slide = (1 - Math.min(1, (1 - k) * 5)) * 80;
  if (portrait) {
    const ph = 66;
    const pw = (portrait.width / portrait.height) * ph * 1.5;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bandY, W, 66);
    ctx.clip();
    ctx.drawImage(portrait, 0, portrait.height * 0.05, portrait.width, portrait.height * 0.62, left ? 24 - slide : W - 24 - pw + slide, bandY - 6, pw, ph * 1.35);
    ctx.restore();
  }
  const mv = f.move ? findMove(f.char, f.move) : null;
  text(ctx, tx(mv?.name ?? "超必杀"), left ? W - 26 : 26, bandY + 33, 26, "#fff", left ? "right" : "left", CN_FONT, 5);
}

// ───────────────────────── main ─────────────────────────

export function render(ctx: CanvasRenderingContext2D, s: GameState, rs: RenderState, o: RenderOpts) {
  rs.t++;
  const scale = ctx.canvas.width / W;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const t = rs.t;
  const shake = s.shake > 0 ? Math.min(4, s.shake) : 0;
  const ox = shake ? (s.frame % 2 ? 1 : -1) * shake * 0.7 : 0;
  const oy = shake ? (s.frame % 3 === 0 ? -1 : 1) * shake * 0.4 : 0;

  updateLive(s, rs);
  drawStage(ctx, s, ox, oy);
  if (s.superFreeze > 0) drawSuperFlash(ctx, s);
  drawLive(ctx, rs);

  // the attacker draws on top
  const order: (0 | 1)[] = s.fighters[1].state === "attack" && s.fighters[0].state !== "attack" ? [0, 1] : [1, 0];
  for (const i of order) drawFighter(ctx, s, i, ox, oy, t);
  drawProjectiles(ctx, s, ox, oy, t);
  drawFx(ctx, s, ox, oy);
  for (const i of order) drawOverhead(ctx, s, i, ox, oy, t);
  if (s.cineT > 0 && s.cineKind === CINE_BAN) drawBanCine(ctx, s);
  if (s.cineT > 0 && s.cineKind === CINE_ULTRA) drawUltraCine(ctx, s, t);
  if (o.showBoxes && s.cineT <= 0) drawBoxes(ctx, s);
  drawHud(ctx, s, rs, o);
  for (const fx of s.fx) if (fx.kind === "say" && s.cineT <= 0) drawSay(ctx, s, fx, ox, oy);
  drawKoGag(ctx, s, t);
  drawAnnounce(ctx, s, o);
}
