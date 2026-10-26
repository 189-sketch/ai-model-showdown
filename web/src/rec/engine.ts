/**
 * Frame-by-frame film engine for the promo videos (dev only, `?rec=<film>`).
 *
 * A film is an async generator that yields once per output frame (60 fps). Gameplay shots drive the real
 * simulation with scripted pads for both fighters and draw it with the real renderer; intro / outro cards
 * draw video clips (seeked frame by frame) and text. Every frame is composed onto one 1920×1080 canvas,
 * and every game sound event is logged with its time so the soundtrack can be mixed offline.
 */

import { art } from "@/game/assets";
import { CHARS, STAGES } from "@/game/chars";
import { IN_D, IN_L, IN_R, IN_U, W, H } from "@/game/constants";
import { createRenderState, render, type RenderState } from "@/game/render";
import { createState, step } from "@/game/sim";
import type { GameState } from "@/game/types";

export const FPS = 60;
export const OUT_W = 1920;
export const OUT_H = 1080;
const GAME_W = 2560; // the game is rendered a bit larger than the output so camera push-ins stay sharp
const GAME_H = 1440;

export interface Cue {
  t: number; // seconds
  kind: "sfx" | "voice" | "announce" | "clip";
  id: string;
  char?: string;
  who?: number;
  gain?: number;
  // clip: an audio file played from `from` for `dur` seconds
  file?: string;
  from?: number;
  dur?: number;
}

export const FONT_NUM = '"Big Shoulders Display", "Bungee", sans-serif';
export const FONT_CN = '"ZCOOL QingKe HuangYou", "Noto Sans SC", sans-serif';
export const FONT_UI = '"Noto Sans SC", "PingFang SC", sans-serif';
export const FONT_BRUSH = '"Ma Shan Zheng", serif';

export const ACCENT: Record<string, string> = { chatgpt: "#8f7dff", claude: "#ff8a3d", deepseek: "#3f86ff", grok: "#ff5b3a" };

// ───────────────────────── pads ─────────────────────────

interface PadStep {
  d: number; // relative numpad direction
  b: number; // button bits
}

/** Scripted controller: a queue of relative inputs, read one per simulated frame. */
export class Pad {
  q: PadStep[] = [];
  rest: PadStep = { d: 5, b: 0 };

  push(d: number, b = 0, n = 1) {
    for (let i = 0; i < n; i++) this.q.push({ d, b });
    return this;
  }
  wait(n: number) {
    return this.push(5, 0, n);
  }
  hold(d: number, n: number) {
    return this.push(d, 0, n);
  }
  tap(b: number, d = 5) {
    return this.push(d, b).push(d, 0);
  }
  /** ↓↘→ (236) or ↓↙← (214) + a button. */
  motion(m: "236" | "214", b: number) {
    const mid = m === "236" ? 3 : 1;
    const end = m === "236" ? 6 : 4;
    return this.push(2).push(2).push(mid).push(mid).push(end).push(end, b).push(5);
  }
  /** Two buttons together (super = HP+HK, dodge = LP+LK). */
  both(b: number, d = 5) {
    return this.push(d, b).push(d, 0);
  }
  clear() {
    this.q = [];
    return this;
  }
  next(facing: number): number {
    const st = this.q.shift() ?? this.rest;
    let bits = st.b;
    const fwd = facing > 0 ? IN_R : IN_L;
    const back = facing > 0 ? IN_L : IN_R;
    if ([7, 8, 9].includes(st.d)) bits |= IN_U;
    if ([1, 2, 3].includes(st.d)) bits |= IN_D;
    if ([3, 6, 9].includes(st.d)) bits |= fwd;
    if ([1, 4, 7].includes(st.d)) bits |= back;
    return bits;
  }
}

// ───────────────────────── overlays ─────────────────────────

type Draw = (ctx: CanvasRenderingContext2D, age: number, life: number) => void;
interface Overlay {
  start: number;
  life: number;
  draw: Draw;
}

export function ease(t: number) {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, h / 2, w / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** A slanted panel (parallelogram) from (x, y), w wide, h tall. */
export function slant(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k = 0.22) {
  const o = h * k;
  ctx.beginPath();
  ctx.moveTo(x + o, y);
  ctx.lineTo(x + w + o, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

export function txt(
  ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string | CanvasGradient,
  font = FONT_UI, align: CanvasTextAlign = "left", weight = "900", stroke = 0, strokeColor = "rgba(0,0,0,0.85)"
) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (stroke) {
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke;
    ctx.strokeStyle = strokeColor;
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

function textWidth(ctx: CanvasRenderingContext2D, s: string, size: number, font = FONT_UI, weight = "900") {
  ctx.font = `${weight} ${size}px ${font}`;
  return ctx.measureText(s).width;
}

// ───────────────────────── director ─────────────────────────

export interface SetupOpts {
  chars: [number, number];
  stage: number;
  x?: [number, number];
  training?: boolean;
  meter?: [number, number];
  hp?: [number, number];
  skipIntro?: boolean;
}

export class Director {
  out: CanvasRenderingContext2D;
  game: CanvasRenderingContext2D;
  s: GameState | null = null;
  rs: RenderState = createRenderState();
  names: [string, string] = ["", ""];
  pads: [Pad, Pad] = [new Pad(), new Pad()];
  f = 0; // output frame
  cues: Cue[] = [];
  slow = 1;
  private tickPhase = 0;
  cam = { z: 1, x: W / 2, y: H / 2, tz: 1, tx: W / 2, ty: H / 2, speed: 0.12 };
  overlays: Overlay[] = [];
  flashUntil = -1;
  live = true; // false hides the livestream danmaku and gift banners (the trailer keeps the frame clean)
  log: string[] = []; // script checks, read by the recorder to catch shots that didn't land

  constructor(out: HTMLCanvasElement) {
    this.out = out.getContext("2d")!;
    const g = document.createElement("canvas");
    g.width = GAME_W;
    g.height = GAME_H;
    this.game = g.getContext("2d")!;
  }

  get t() {
    return this.f / FPS;
  }

  cue(c: Omit<Cue, "t">, delay = 0) {
    this.cues.push({ ...c, t: this.t + delay });
  }

  /** Fresh match state for a shot (positions, meters, training on/off). */
  setup(o: SetupOpts) {
    const s = createState({ chars: o.chars, stage: o.stage, seed: 7, training: o.training ?? true });
    if (o.skipIntro ?? true) for (let i = 0; i < 95; i++) step(s, 0, 0);
    s.events = [];
    const xs = o.x ?? [300, 380];
    s.fighters.forEach((f, i) => {
      f.x = xs[i];
      f.facing = xs[i] < xs[1 - i] ? 1 : -1;
      if (o.meter) f.meter = o.meter[i];
      if (o.hp) f.hp = o.hp[i];
    });
    s.camX = Math.min(720 - W, Math.max(0, (xs[0] + xs[1]) / 2 - W / 2));
    this.s = s;
    this.names = [CHARS[o.chars[0]].name, CHARS[o.chars[1]].name];
    this.pads[0].clear().rest = { d: 5, b: 0 };
    this.pads[1].clear().rest = { d: 5, b: 0 };
    this.slow = 1;
    return s;
  }

  /** Push the camera in on a point of the 480×270 game screen (z = 1 resets). */
  zoom(x: number, y: number, z: number, speed = 0.1) {
    this.cam.tx = x;
    this.cam.ty = y;
    this.cam.tz = z;
    this.cam.speed = speed;
  }
  unzoom(speed = 0.12) {
    this.zoom(W / 2, H / 2, 1, speed);
  }
  /** Follow a fighter with the camera at zoom z. */
  focus(i: 0 | 1, z: number, dy = -50, speed = 0.1) {
    const f = this.s!.fighters[i];
    this.zoom(f.x - this.s!.camX, 238 - f.y + dy, z, speed);
  }

  check(ok: boolean, what: string) {
    this.log.push(`${ok ? "ok  " : "MISS"} ${this.t.toFixed(1)}s ${what}`);
  }

  overlay(life: number, draw: Draw, delay = 0) {
    this.overlays.push({ start: this.f + delay, life, draw });
  }

  flash(n = 6) {
    this.flashUntil = this.f + n;
  }

  /** Advance the simulation one tick (unless slowed this frame) and log its sounds. */
  private tick() {
    const s = this.s!;
    this.tickPhase = (this.tickPhase + 1) % this.slow;
    if (this.tickPhase !== 0) return;
    const in0 = this.pads[0].next(s.fighters[0].facing);
    const in1 = this.pads[1].next(s.fighters[1].facing);
    step(s, in0, in1);
    for (const e of s.events) {
      if (e.t === "voice" && e.who !== undefined) this.cue({ kind: "voice", id: e.id, who: e.who, char: CHARS[s.fighters[e.who].char].id });
      else this.cue({ kind: e.t, id: e.id });
    }
  }

  private composeGame() {
    const s = this.s!;
    if (!this.live) {
      // new comments and gifts spawn off-screen, so dropping them every frame means none is ever seen
      this.rs.danmaku = [];
      this.rs.gifts = [];
    }
    render(this.game, s, this.rs, { names: this.names, showBoxes: false, localSide: -1 });
    const c = this.cam;
    c.z += (c.tz - c.z) * c.speed;
    c.x += (c.tx - c.x) * c.speed;
    c.y += (c.ty - c.y) * c.speed;
    // crop of the game canvas that fills the output; clamp so the frame never leaves the stage
    const k = GAME_W / W;
    const sw = GAME_W / c.z;
    const sh = GAME_H / c.z;
    const sx = Math.max(0, Math.min(GAME_W - sw, c.x * k - sw / 2));
    const sy = Math.max(0, Math.min(GAME_H - sh, c.y * k - sh / 2));
    this.out.imageSmoothingQuality = "high";
    this.out.drawImage(this.game.canvas, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
  }

  drawOverlays() {
    const ctx = this.out;
    this.overlays = this.overlays.filter((o) => this.f < o.start + o.life);
    for (const o of this.overlays) {
      if (this.f < o.start) continue;
      ctx.save();
      o.draw(ctx, this.f - o.start, o.life);
      ctx.restore();
    }
    if (this.f < this.flashUntil) {
      ctx.fillStyle = `rgba(255,255,255,${((this.flashUntil - this.f) / 6) * 0.85})`;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }
  }

  /** Advance the match without filming it (and without its sounds): jump to the moment worth showing. */
  skip(n: number) {
    for (let i = 0; i < n; i++) {
      const s = this.s!;
      step(s, this.pads[0].next(s.fighters[0].facing), this.pads[1].next(s.fighters[1].facing));
    }
  }
  skipUntil(cond: (s: GameState) => boolean, max = 600) {
    for (let i = 0; i < max && !cond(this.s!); i++) this.skip(1);
  }

  /** Play the match for n output frames. */
  async *run(n: number): AsyncGenerator<void> {
    for (let i = 0; i < n; i++) {
      this.tick();
      this.composeGame();
      this.drawOverlays();
      this.f++;
      yield;
    }
  }

  /** Play until `cond` holds (checked after each frame), at most `max` frames. */
  async *until(cond: (s: GameState) => boolean, max = 600): AsyncGenerator<void> {
    for (let i = 0; i < max; i++) {
      yield* this.run(1);
      if (cond(this.s!)) return;
    }
  }

  /** Hold a still composed by `draw` (cards) for n frames; draw gets the frame index within the card. */
  async *card(n: number, draw: (ctx: CanvasRenderingContext2D, i: number) => void | Promise<void>): AsyncGenerator<void> {
    for (let i = 0; i < n; i++) {
      await draw(this.out, i);
      this.drawOverlays();
      this.f++;
      yield;
    }
  }
}

// ───────────────────────── video clips ─────────────────────────

const videos = new Map<string, HTMLVideoElement>();

export async function loadVideo(src: string): Promise<HTMLVideoElement> {
  let v = videos.get(src);
  if (v) return v;
  v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = src;
  await new Promise<void>((res, rej) => {
    v!.onloadeddata = () => res();
    v!.onerror = () => rej(new Error(`video ${src}`));
  });
  videos.set(src, v);
  return v;
}

/** Seek a clip to time t (exact frame) and wait until it's drawable. */
export async function seek(v: HTMLVideoElement, t: number) {
  const target = Math.max(0, Math.min(v.duration - 0.02, t));
  if (Math.abs(v.currentTime - target) < 0.001) return;
  await new Promise<void>((res) => {
    v.onseeked = () => res();
    v.currentTime = target;
  });
}

/** Draw a clip to cover a box (object-fit: cover). */
export function cover(ctx: CanvasRenderingContext2D, v: CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number }, x: number, y: number, w: number, h: number, focusY = 0.5) {
  const vw = (v as HTMLVideoElement).videoWidth || (v as HTMLImageElement).width;
  const vh = (v as HTMLVideoElement).videoHeight || (v as HTMLImageElement).height;
  const k = Math.max(w / vw, h / vh);
  const sw = w / k;
  const sh = h / k;
  ctx.drawImage(v, (vw - sw) / 2, (vh - sh) * focusY, sw, sh, x, y, w, h);
}

export function stageImage(stage: number) {
  return art.stages[stage] ?? null;
}

export { STAGES, CHARS, textWidth };
