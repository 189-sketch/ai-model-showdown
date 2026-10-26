/**
 * The trailer (≈47 s), cut to the title theme: the film starts 25 s into bgm_title (154 BPM, first beat at
 * 0.104 s), so its beats land every 0.389 s from t = 0 and the big section of the track arrives with the
 * gameplay montage. Every segment is a whole number of beats.
 */

import { CHARS } from "@/game/chars";
import { IN_HK, IN_HP, IN_LP } from "@/game/constants";
import { tx } from "@/lib/i18n";
import { ACCENT, Director, FONT_NUM, FONT_UI, OUT_H, OUT_W, cover, ease, loadVideo, seek, textWidth, txt } from "./engine";
import { heroCard } from "./kit";

const LP = IN_LP, HP = IN_HP, HK = IN_HK;
const GPT = 0, CLAUDE = 1, DS = 2, GROK = 3;
const LAUNCH = 0, DATACENTER = 1, COLOSSEUM = 2;

export const TRAILER_MUSIC = { bgm: "bgm_title", offset: 25.0 };
const BEAT = 0.389 * 60; // frames

export const TRAILER_TEXT = [
  "谁才是", "最强AI大模型", "WHO IS THE STRONGEST AI MODEL", "01 / 04", "02 / 04", "03 / 04", "04 / 04", "WINS",
  "单人闯关", "本地双人", "联机对战", "房间码 / 快速匹配", "中英双语", "浏览器打开就能玩", "your-app.edgespark.app",
];

const TITLE = "最强AI大模型";

/**
 * The title lockup, deliberately plain: a small 「谁才是」 over 「最强AI大模型」 in heavy Noto Sans, a hairline and the
 * English line, white on black. `small` / `big` / `line` are 0..1 reveal amounts (fade, left-to-right wipe, grow).
 */
function titleLockup(ctx: CanvasRenderingContext2D, cy: number, small: number, big: number, line: number) {
  const cx = OUT_W / 2;
  if (small > 0) {
    ctx.globalAlpha = small;
    ctx.letterSpacing = "14px";
    txt(ctx, tx("谁才是"), cx + 7, cy - 132 + (1 - small) * 14, 42, "rgba(255,255,255,0.7)", FONT_UI, "center", "500");
  }
  if (big > 0) {
    ctx.globalAlpha = 1;
    ctx.letterSpacing = "10px";
    const w = textWidth(ctx, tx(TITLE), 150, FONT_UI) + 120;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - w / 2, cy - 110, w * big, 220);
    ctx.clip();
    txt(ctx, tx(TITLE), cx + 5, cy, 150, "#fff", FONT_UI, "center", "900");
    ctx.restore();
  }
  if (line > 0) {
    ctx.globalAlpha = line;
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(cx - 240 * line, cy + 112, 480 * line, 2);
    ctx.letterSpacing = "9px";
    txt(ctx, "WHO IS THE STRONGEST AI MODEL", cx + 4, cy + 164, 26, "rgba(255,255,255,0.55)", FONT_NUM, "center", "700");
  }
  ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;
}

export async function* trailer(d: Director): AsyncGenerator<void> {
  // frames from the film start to the end of beat b
  const at = (b: number) => Math.round(b * BEAT);
  let beat = 0;
  const beats = (n: number) => {
    const f = at(beat + n) - at(beat);
    beat += n;
    return f;
  };

  // ── cold open: 「谁才是」, then the title wipes in on beat 4 and the English line on beat 6
  d.live = false; // no danmaku or gift banners anywhere in the trailer
  d.cue({ kind: "sfx", id: "super" });
  d.cue({ kind: "sfx", id: "hitH" }, at(4) / 60);
  yield* d.card(beats(8), (ctx, i) => {
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    titleLockup(ctx, 560, ease(i / 14), ease((i - at(4)) / 12), ease((i - at(6)) / 14));
  });
  d.flash(6);

  // ── the four fighters
  for (const [k, cid] of ["chatgpt", "claude", "deepseek", "grok"].entries()) {
    d.cue({ kind: "voice", id: "intro", who: 0, char: cid }, 0.05);
    yield* heroCard(d, cid, k, beats(6));
    d.flash(4);
  }

  // ── gameplay montage, no captions: one beat of run-up skipped off camera, then the moment itself
  // (the first two arguments only name the shot)
  const shot = async function* (_what: string, _cid: string, n: number) {
    d.flash(4);
    yield* d.run(beats(n));
    d.unzoom(0.3);
    d.slow = 1;
  };

  // ChatGPT: reset card → 额度已重置
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [260, 420], training: false, meter: [0, 1000] });
  d.pads[0].motion("236", HP);
  d.skipUntil((s) => s.projectiles.some((p) => p.kind === "card" && Math.abs(p.x - s.fighters[1].x) < 70), 120);
  d.focus(1, 1.3, -60, 0.08);
  yield* shot("额度已重置", "chatgpt", 4);
  // Claude: banned
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [260, 380], training: false });
  d.pads[0].motion("236", HP);
  d.skipUntil((s) => s.projectiles.some((p) => p.kind === "notice" && Math.abs(p.x - s.fighters[1].x) < 40), 160);
  d.focus(1, 1.35, -70, 0.1);
  d.slow = 2;
  yield* shot("封禁！", "claude", 4);
  // Claude: reflects the card
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [230, 420], training: false, meter: [0, 1000] });
  d.pads[1].motion("236", LP);
  d.skipUntil((s) => s.projectiles.some((p) => p.kind === "card" && Math.abs(p.x - s.fighters[0].x) < 105), 160);
  d.pads[0].motion("214", LP);
  yield* shot("你说得完全对", "claude", 4);
  // DeepSeek: 梁圣
  d.setup({ chars: [DS, GROK], stage: DATACENTER, x: [300, 400] });
  d.pads[0].both(HP | HK);
  d.skipUntil((s) => s.superFreeze === 0 && s.fighters[0].move === "liangSheng" && s.fighters[0].sf > 20, 200);
  d.focus(0, 1.3, -100, 0.08);
  yield* shot("梁圣降临", "deepseek", 6);
  // DeepSeek: the maid's water spout
  d.setup({ chars: [DS, GROK], stage: DATACENTER, x: [230, 420] });
  d.pads[0].motion("214", HK);
  d.skipUntil((s) => s.projectiles.some((p) => p.kind === "maid" && p.mode === 1 && p.mt > 20), 240);
  yield* shot("鲸鱼女仆", "deepseek", 4);
  // Grok: rocket blown up mid-flight
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [160, 460] });
  d.pads[0].motion("236", LP);
  d.skipUntil((s) => s.projectiles.some((p) => p.kind === "rocket" && Math.abs(p.x - s.fighters[1].x) < 70), 160);
  d.pads[0].clear().wait(8).tap(LP);
  d.focus(1, 1.25, -60, 0.12);
  yield* shot("计划外解体", "grok", 4);
  // Grok: Roadster 2
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [240, 360] });
  d.pads[0].motion("214", HK);
  d.skip(14);
  yield* shot("Roadster 2", "grok", 4);
  // Grok: starship salvo
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [240, 380] });
  d.pads[0].both(HP | HK);
  d.skipUntil((s) => s.projectiles.filter((p) => p.kind === "missile").length >= 3, 200);
  yield* shot("星舰齐射", "grok", 4);
  // ChatGPT: the Ultra slider
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [250, 420] });
  d.pads[0].both(HP | HK);
  d.skipUntil((s) => s.cineT > 0 && s.cineT < 70, 200);
  yield* shot("Effort 拉满", "chatgpt", 4);
  // Claude: the suspension stamp
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [300, 355] });
  d.pads[1].rest = { d: 1, b: 0 };
  d.pads[0].both(HP | HK);
  d.skipUntil((s) => s.cineT > 0 && s.cineT < 112, 260);
  yield* shot("封号", "claude", 6);

  // ── four KO gags, one quick look each
  for (const [a, b, stage] of [[GROK, GPT, LAUNCH], [GPT, CLAUDE, COLOSSEUM], [GROK, DS, DATACENTER], [DS, GROK, DATACENTER]] as const) {
    d.setup({ chars: [a, b], stage, x: [300, 352], training: false, hp: [CHARS[a].hp, 30] });
    d.pads[0].tap(HP);
    d.skipUntil((s) => s.phase === "ko" && s.phaseFrame > 34, 260);
    d.zoom(240, 172, 1.25, 1);
    d.flash(3);
    yield* d.run(beats(3));
    d.unzoom(1);
  }

  // ── four victory cut-scenes
  const victory: [string, number][] = [["chatgpt", 3.4], ["claude", 5.2], ["deepseek", 3.2], ["grok", 4.4]];
  for (const [cid, from] of victory) {
    const v = await loadVideo(`/assets/video/victory_${cid}.mp4`);
    const n = beats(4);
    d.flash(4);
    yield* d.card(n, async (ctx, i) => {
      await seek(v, from + i / 60);
      cover(ctx, v, 0, 0, OUT_W, OUT_H, 0.5);
      const c = CHARS.find((x) => x.id === cid)!;
      const g = ctx.createLinearGradient(0, OUT_H - 220, 0, OUT_H);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, OUT_H - 220, OUT_W, 220);
      ctx.letterSpacing = "4px";
      const nw = txt(ctx, c.name, 80, OUT_H - 80, 44, "#fff", FONT_NUM, "left", "900");
      txt(ctx, "WINS", 80 + nw + 18, OUT_H - 80, 44, "rgba(255,255,255,0.55)", FONT_NUM, "left", "700");
      ctx.letterSpacing = "0px";
      ctx.fillStyle = ACCENT[cid];
      ctx.fillRect(82, OUT_H - 48, 56, 4);
    });
  }

  // ── features
  const feats = ["单人闯关", "本地双人", "联机对战", "房间码 / 快速匹配", "中英双语"];
  d.flash(4);
  yield* d.card(beats(6), (ctx, i) => {
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    // a plain left-aligned list, one line per beat
    feats.forEach((f, k) => {
      const t = ease((i - k * (BEAT * 0.9)) / 10);
      if (t <= 0) return;
      ctx.globalAlpha = t;
      const y = 300 + k * 120 + (1 - t) * 18;
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(680, y - 1, 36, 2);
      txt(ctx, tx(f), 750, y, 58, "#fff", FONT_UI, "left", k < 3 ? "900" : "500");
    });
    ctx.globalAlpha = 1;
  });

  // ── end card
  d.flash(6);
  d.cue({ kind: "sfx", id: "ko" });
  const rest = beats(10);
  yield* d.card(rest, (ctx, i) => {
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    titleLockup(ctx, 470, ease(i / 10), ease(i / 14), ease((i - 8) / 14));
    const k = ease((i - BEAT * 2) / 14);
    if (k > 0) {
      ctx.globalAlpha = k;
      txt(ctx, tx("浏览器打开就能玩"), OUT_W / 2, 790, 32, "rgba(255,255,255,0.7)", FONT_UI, "center", "500");
      ctx.letterSpacing = "2px";
      txt(ctx, "your-app.edgespark.app", OUT_W / 2 + 1, 850, 40, "#fff", FONT_UI, "center", "700");
      ctx.letterSpacing = "0px";
      ctx.globalAlpha = 1;
    }
    if (i > rest - 30) {
      ctx.fillStyle = `rgba(0,0,0,${(i - (rest - 30)) / 30})`;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }
  });
}
