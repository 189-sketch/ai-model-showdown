import type { MoveDef } from "./types";

export type NormalId =
  | "stLP" | "stHP" | "stLK" | "stHK"
  | "crLP" | "crHP" | "crLK" | "crHK"
  | "jLP" | "jHP" | "jLK" | "jHK";

/** Every fighter uses the same three slots: ↓↘→+拳, ↓↙←+拳, ↓↙←+脚 (light / heavy button = light / heavy version). */
export interface SpecialDef {
  motion: "236" | "214";
  btn: "P" | "K";
  light: MoveDef;
  heavy: MoveDef;
  role: "zoner" | "counter" | "antiAir" | "rush" | "summon" | "trap";
}

export interface CharDef {
  id: string;
  name: string;
  en: string;
  title: string;
  quote: string; // select-screen line
  color: string;
  hp: number;
  normalDmg: number; // the multiplier baked into this fighter's normals (undone in equal-stats matches)
  walkF: number;
  walkB: number;
  runSpeed: number;
  jumpVy: number;
  jumpVx: number;
  gravity: number;
  height: number; // standing hurtbox height
  crouchHeight: number;
  bodyHalf: number; // half-width used for pushing the two bodies apart
  hurtHalf: number; // half-width of the hurtbox
  normals: Record<NormalId, MoveDef>;
  specials: SpecialDef[];
  superMove: MoveDef; // 重拳＋重脚, 1 bar
  throwMove: MoveDef;
  moveList: { input: string; name: string }[];
  victory: string; // caption over the victory video
  koText: string; // shown in the KO screen
}

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

// cut-ins (GameState.cineKind)
export const CINE_BAN = 1;
export const CINE_ULTRA = 2;

// status lengths, frames
export const BAN_LEN = 60;
export const BAN_COOLDOWN = 240;
export const ULTRA_LEN = 480;
export const MUSCLE_LEN = 600;
export const BUSY_LEN = 90;
export const GPL_LEN = 240;
export const NOTE_LEN = 300;
export const DODGE_COST = 500; // dodging out of blockstun

// Shared normal-move skeleton; each character tweaks numbers and hitboxes
// (hitboxes are matched to the reach of that character's sprite frames)
function normals(
  o: { dmg: number; kickReach: number; fast: number },
  hitboxes: Partial<Record<NormalId, ReturnType<typeof box>>> = {}
): Record<NormalId, MoveDef> {
  const d = (n: number) => Math.round(n * o.dmg);
  const moves: Record<NormalId, MoveDef> = {
    stLP: {
      id: "stLP", anim: "stLP", kind: "normal", startup: 4, active: 3, recovery: 7,
      damage: d(30), hitstun: 13, blockstun: 9, level: "mid", hitbox: box(14, 64, 34, 12),
      hurtExt: box(10, 60, 30, 16), push: 3, chain: true, cancel: true, sfx: "whiff",
    },
    stHP: {
      id: "stHP", anim: "stHP", kind: "normal", startup: 7, active: 4, recovery: 17,
      damage: d(85), hitstun: 19, blockstun: 14, level: "mid", hitbox: box(16, 58, 42, 18),
      hurtExt: box(12, 56, 36, 20), push: 5, cancel: true, hitstop: 11, sfx: "whiff", voice: "atk",
    },
    stLK: {
      id: "stLK", anim: "stLK", kind: "normal", startup: 5 - o.fast, active: 3, recovery: 10,
      damage: d(35), hitstun: 13, blockstun: 9, level: "mid", hitbox: box(12, 20, 32 + o.kickReach, 18),
      hurtExt: box(10, 18, 30, 18), push: 3, chain: true, cancel: true, sfx: "whiff",
    },
    stHK: {
      id: "stHK", anim: "stHK", kind: "normal", startup: 10 - o.fast, active: 4, recovery: 20,
      damage: d(95), hitstun: 20, blockstun: 15, level: "mid", hitbox: box(14, 64, 46 + o.kickReach, 26),
      hurtExt: box(10, 58, 40, 28), push: 6, hitstop: 12, sfx: "whiff", voice: "atk",
    },
    crLP: {
      id: "crLP", anim: "crLP", kind: "normal", startup: 4, active: 2, recovery: 7,
      damage: d(25), hitstun: 12, blockstun: 8, level: "mid", hitbox: box(14, 24, 32, 14),
      hurtExt: box(10, 22, 28, 14), push: 3, chain: true, cancel: true, sfx: "whiff",
    },
    crHP: {
      id: "crHP", anim: "crHP", kind: "normal", startup: 6, active: 5, recovery: 18,
      damage: d(70), hitstun: 18, blockstun: 13, level: "mid", hitbox: box(14, 26, 38, 18),
      hurtExt: box(10, 22, 32, 18), push: 4, cancel: true, hitstop: 11, sfx: "whiff", voice: "atk",
    },
    crLK: {
      id: "crLK", anim: "crLK", kind: "normal", startup: 4, active: 3, recovery: 8,
      damage: d(25), hitstun: 12, blockstun: 8, level: "low", hitbox: box(12, 0, 38 + o.kickReach, 14),
      hurtExt: box(10, 0, 32, 14), push: 3, chain: true, cancel: true, sfx: "whiff",
    },
    crHK: {
      id: "crHK", anim: "crHK", kind: "normal", startup: 9 - o.fast, active: 4, recovery: 22,
      damage: d(80), hitstun: 0, blockstun: 14, level: "low", hitbox: box(10, 0, 52 + o.kickReach, 16),
      hurtExt: box(8, 0, 46, 16), push: 6, knockdown: true, launch: [2.5, 3], hitstop: 11, sfx: "whiff", voice: "atk",
    },
    jLP: {
      id: "jLP", anim: "jLP", kind: "normal", air: true, startup: 4, active: 8, recovery: 4,
      damage: d(35), hitstun: 14, blockstun: 10, level: "overhead", hitbox: box(8, 30, 28, 22),
      push: 2, sfx: "whiff",
    },
    jHP: {
      id: "jHP", anim: "jHP", kind: "normal", air: true, startup: 7, active: 6, recovery: 4,
      damage: d(75), hitstun: 18, blockstun: 13, level: "overhead", hitbox: box(6, 14, 38, 30),
      push: 3, hitstop: 11, sfx: "whiff", voice: "atk",
    },
    jLK: {
      id: "jLK", anim: "jLK", kind: "normal", air: true, startup: 4, active: 10, recovery: 4,
      damage: d(35), hitstun: 14, blockstun: 10, level: "overhead", hitbox: box(6, 8, 34 + o.kickReach, 22),
      push: 2, sfx: "whiff",
    },
    jHK: {
      id: "jHK", anim: "jHK", kind: "normal", air: true, startup: 7, active: 6, recovery: 4,
      damage: d(80), hitstun: 18, blockstun: 13, level: "overhead", hitbox: box(8, 4, 44 + o.kickReach, 26),
      push: 3, hitstop: 11, sfx: "whiff", voice: "atk",
    },
  };
  for (const [id, hb] of Object.entries(hitboxes)) moves[id as NormalId].hitbox = hb;
  return moves;
}

// throws: the victim is released on frame `startup`, the thrower recovers at the end
const throwMove: MoveDef = {
  id: "throw", anim: "throw", kind: "throw", startup: 14, active: 1, recovery: 15,
  damage: 110, hitstun: 0, blockstun: 0, level: "mid", knockdown: true, launch: [4, 5], voice: "atk",
};

// ───────────────────────── ChatGPT · all-rounder ─────────────────────────
const resetCard = (heavy: boolean): MoveDef => ({
  id: heavy ? "cardH" : "cardL", name: "重置卡", anim: "card", kind: "special",
  startup: 13, active: 2, recovery: heavy ? 24 : 21, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  voice: "special", sfx: "card",
  projectile: {
    kind: "card", frame: 13, speed: heavy ? 6.2 : 3.8, x: 40, y: 56, w: 24, h: 24,
    hits: 1, rehit: 0, damage: heavy ? 62 : 55, chip: 8, hitstun: 18, blockstun: 14, level: "mid",
  },
});

// a guard stance: a punch, kick or jump-in that lands during it is caught and thrown back
const catchStance = (heavy: boolean): MoveDef => ({
  id: heavy ? "catchH" : "catchL", name: "稳稳接住你", anim: "catch", kind: "special",
  startup: 4, active: heavy ? 32 : 26, recovery: 26, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  counter: "catch", sfx: "whiff",
});

const catchThrow = (heavy: boolean): MoveDef => ({
  id: heavy ? "catchThrowH" : "catchThrowL", name: "稳稳接住你", anim: "catchThrow", kind: "throw",
  startup: 22, active: 1, recovery: 16, damage: heavy ? 150 : 130, hitstun: 0, blockstun: 0, level: "mid",
  knockdown: true, launch: [5, 6], voice: "special2", say: "我会稳稳接住你",
});

// a giant mouse cursor: four clicks, then 「确认」 knocks down
const agentRush = (heavy: boolean): MoveDef => ({
  id: heavy ? "agentH" : "agentL", name: "Agent 代操作", anim: "agent", kind: "special",
  startup: 10, active: heavy ? 42 : 36, recovery: 18, damage: heavy ? 24 : 21, chip: 4,
  hitstun: 16, blockstun: 10, level: "mid", hitbox: box(16, 46, 38, 36), hurtExt: box(10, 46, 36, 34),
  hits: 5, rehit: heavy ? 8 : 7, knockdown: true, launch: [4, 5.5], hitstop: 6,
  vel: [[10, heavy ? 52 : 46, heavy ? 2.6 : 2.2]], voice: "special3", sfx: "click", hitFx: "click",
});

// the super itself is the Ultra cut-in (CINE_ULTRA); the buff starts when it ends
const ultraMove: MoveDef = {
  id: "ultra", name: "Ultra · Effort 拉满", anim: "ultra", kind: "super", cost: 1000,
  startup: 4, active: 2, recovery: 24, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  invuln: [1, 30], voice: "super", sfx: "ultra",
};

// ───────────────────────── Claude · controller ─────────────────────────
const policyNotice = (heavy: boolean): MoveDef => ({
  id: heavy ? "policyH" : "policyL", name: "使用政策审查", anim: "policy", kind: "special",
  startup: 16, active: 2, recovery: 24, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  voice: "special", sfx: "note",
  projectile: {
    kind: "notice", frame: 16, speed: heavy ? 3.4 : 2.4, x: 44, y: 44, w: 28, h: 34,
    hits: 1, rehit: 0, damage: 42, chip: 6, hitstun: 20, blockstun: 14, level: "mid",
  },
});

// reflects projectiles; parries punches and kicks into a palm strike
const agreeStance = (heavy: boolean): MoveDef => ({
  id: heavy ? "agreeH" : "agreeL", name: "你说得完全对！", anim: "parry", kind: "special",
  startup: 3, active: heavy ? 28 : 24, recovery: 20, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  counter: "reflect", sfx: "whiff",
});

const palmCounter: MoveDef = {
  id: "palmCounter", name: "你说得完全对！", anim: "palm", kind: "special",
  startup: 5, active: 4, recovery: 16, damage: 70, hitstun: 22, blockstun: 14, level: "mid",
  hitbox: box(14, 46, 36, 30), push: 6, knockdown: true, launch: [4, 4.5], hitstop: 12, voice: "special2", sfx: "reflect",
};

const agreeNod: MoveDef = {
  id: "agreeNod", name: "你说得完全对！", anim: "agree", kind: "special",
  startup: 1, active: 1, recovery: 26, damage: 0, hitstun: 0, blockstun: 0, level: "mid", voice: "special2",
};

const artifactWall = (heavy: boolean): MoveDef => ({
  id: heavy ? "artifactH" : "artifactL", name: "Artifact 生成", anim: "artifact", kind: "special",
  startup: 18, active: 2, recovery: 22, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  voice: "special3", sfx: "artifact",
  projectile: {
    kind: "artifact", frame: 18, speed: 0, x: heavy ? 76 : 56, y: 0, w: 30, h: 84,
    hits: 1, rehit: 0, damage: 45, chip: 6, hitstun: 20, blockstun: 12, level: "mid",
  },
});

const banStamp: MoveDef = {
  id: "banStamp", name: "你的账号已被封禁", anim: "stamp", kind: "super", cost: 1000,
  startup: 22, active: 6, recovery: 30, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  hitbox: box(20, 0, 76, 110), hurtExt: box(10, 30, 50, 60), unblockable: true, cinematic: CINE_BAN,
  invuln: [1, 12], voice: "super", sfx: "stamp",
};

// ───────────────────────── DeepSeek · power / transformation ─────────────────────────
const openScroll = (heavy: boolean): MoveDef => ({
  id: heavy ? "gplScroll" : "mitScroll", name: heavy ? "GPL 卷轴" : "MIT 卷轴", anim: "wave", kind: "special",
  startup: heavy ? 16 : 12, active: 2, recovery: heavy ? 24 : 20, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  voice: "special", sfx: "scroll", say: heavy ? "GPL，传染给你！" : "MIT，随便用！",
  projectile: {
    kind: "scroll", variant: heavy ? 1 : 0, frame: heavy ? 16 : 12, speed: heavy ? 3.0 : 6.2, x: 44, y: 50, w: 28, h: 28,
    hits: 1, rehit: 0, damage: heavy ? 55 : 48, chip: 8, hitstun: 18, blockstun: 14, level: "mid",
  },
});

// thinks first (the bubble says how long), then a rising uppercut
const deepThink = (heavy: boolean): MoveDef => ({
  id: heavy ? "thinkH" : "thinkL", name: "已深度思考", anim: "uppercut", preAnim: "think", preFrames: heavy ? 12 : 5,
  kind: "special", startup: heavy ? 18 : 10, active: 8, recovery: 24, damage: heavy ? 125 : 95, chip: 12,
  hitstun: 0, blockstun: 16, level: "mid", hitbox: box(2, 40, 38, 110), hurtExt: box(0, 40, 34, 90),
  knockdown: true, launch: [2.5, 9], invuln: heavy ? [1, 20] : [1, 11], hitstop: 13,
  voice: "special2", sfx: "whiff", say: heavy ? "已深度思考（用时 0.8 秒）" : "已深度思考（用时 0.3 秒）",
});

const summonMaid = (heavy: boolean): MoveDef => ({
  id: heavy ? "maidH" : "maidL", name: "召唤鲸鱼女仆", anim: "summon", kind: "special",
  startup: 20, active: 2, recovery: 26, damage: 0, hitstun: 0, blockstun: 0, level: "mid", voice: "special3",
  projectile: {
    kind: "maid", frame: 20, speed: heavy ? 3.6 : 3.0, x: -6, y: 0, w: 30, h: 56,
    hits: 3, rehit: 0, damage: 40, chip: 6, hitstun: 24, blockstun: 14, level: "mid",
  },
});

const liangSheng: MoveDef = {
  id: "liangSheng", name: "梁圣降临", anim: "transform", kind: "super", cost: 1000,
  startup: 48, active: 2, recovery: 8, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  invuln: [1, 58], voice: "super", sfx: "transform",
};

// back to normal: the 梁圣 form deflates and he pants (服务器繁忙 follows)
const revertMove: MoveDef = {
  id: "revert", name: "服务器繁忙", anim: "revert", sprite: "muscle", kind: "special",
  startup: 30, active: 1, recovery: 20, damage: 0, hitstun: 0, blockstun: 0, level: "mid", voice: "revert", sfx: "busy",
};

// the 梁圣 form's own moves: heavy and slow, every one shrugs off a hit
const muscle = (m: MoveDef): MoveDef => ({ ...m, sprite: "muscle", armor: true });
const MUSCLE_NORMALS: Record<string, MoveDef> = {
  mJab: muscle({
    id: "mJab", anim: "stLP", kind: "normal", startup: 6, active: 3, recovery: 12, damage: 40,
    hitstun: 15, blockstun: 10, level: "mid", hitbox: box(20, 76, 56, 22), hurtExt: box(12, 70, 46, 24), push: 4,
    chain: true, sfx: "whiff",
  }),
  mFist: muscle({
    id: "mFist", name: "开源铁拳", anim: "stHP", kind: "normal", startup: 12, active: 5, recovery: 22, damage: 92,
    hitstun: 22, blockstun: 16, level: "mid", hitbox: box(22, 66, 54, 30), hurtExt: box(14, 62, 48, 30), push: 8,
    hitstop: 14, sfx: "whiff", voice: "atk",
  }),
  mLow: muscle({
    id: "mLow", anim: "crLP", kind: "normal", startup: 8, active: 4, recovery: 16, damage: 40,
    hitstun: 15, blockstun: 10, level: "low", hitbox: box(18, 0, 70, 24), hurtExt: box(12, 0, 56, 30), push: 4,
    chain: true, sfx: "whiff",
  }),
  mStomp: muscle({
    id: "mStomp", name: "踏地震波", anim: "stHK", kind: "normal", startup: 16, active: 6, recovery: 24, damage: 72,
    hitstun: 0, blockstun: 16, level: "low", hitbox: box(-24, 0, 124, 20), push: 6, knockdown: true, launch: [3, 5],
    hitstop: 13, sfx: "kick", voice: "atk", hitFx: "stomp",
  }),
  mAir: muscle({
    id: "mAir", anim: "stLP", kind: "normal", air: true, startup: 5, active: 8, recovery: 4, damage: 48,
    hitstun: 16, blockstun: 11, level: "overhead", hitbox: box(8, 20, 60, 40), push: 3, sfx: "whiff",
  }),
};
export const MUSCLE_MAP: Record<NormalId, string> = {
  stLP: "mJab", crLP: "mJab", stHP: "mFist", crHP: "mFist",
  stLK: "mLow", crLK: "mLow", stHK: "mStomp", crHK: "mStomp",
  jLP: "mAir", jHP: "mAir", jLK: "mAir", jHK: "mAir",
};
const muscleThrow: MoveDef = {
  ...throwMove, id: "mHug", name: "开源熊抱", anim: "hug", sprite: "muscle", startup: 26, recovery: 14,
  damage: 135, launch: [3, 6],
};

// ───────────────────────── Grok · speed / burst ─────────────────────────
const rocketLaunch = (heavy: boolean): MoveDef => ({
  id: heavy ? "rocketH" : "rocketL", name: "火箭发射", anim: "rocket", kind: "special",
  startup: 14, active: 2, recovery: 24, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  voice: "special", sfx: "rocket",
  projectile: {
    kind: "rocket", variant: heavy ? 1 : 0, frame: 14, speed: heavy ? 3.2 : 5.2, x: 30, y: heavy ? 78 : 62, w: 30, h: 16,
    hits: 1, rehit: 0, damage: heavy ? 70 : 62, chip: 8, hitstun: 20, blockstun: 14, level: "mid", knockdown: heavy,
  },
});

// 「快速计划外解体」: pressing a punch while the rocket flies blows it up on the spot
export const BLAST = { w: 70, h: 70, damage: 80, chip: 10 };

const communityNote = (heavy: boolean): MoveDef => ({
  id: heavy ? "noteH" : "noteL", name: "社群注记", anim: "note", kind: "special",
  startup: heavy ? 12 : 10, active: 4, recovery: 20, damage: 35, chip: 0, hitstun: 22, blockstun: 12, level: "mid",
  hitbox: box(18, 50, heavy ? 56 : 48, 30), hurtExt: box(12, 48, 40, 30), push: 3, onHit: "note",
  voice: "special2", sfx: "note",
});

// Grok turns into the Roadster 2: the sprite carries the hop and flip, the move slides him forward
const roadsterFlip = (heavy: boolean): MoveDef => ({
  id: heavy ? "roadsterH" : "roadsterL", name: "Roadster 2 翻转飞跃", anim: "flip", sprite: "roadster", kind: "special",
  linearAnim: true, startup: 36, active: 6, recovery: 14, damage: heavy ? 110 : 95, chip: 14, hitstun: 0, blockstun: 18,
  level: "overhead", hitbox: box(-56, 0, 116, 40), knockdown: true, launch: [4, 6], invuln: [1, 30], hitstop: 13,
  vel: [[4, 38, heavy ? 4.4 : 3.4]], voice: "special3", sfx: "car",
});

const salvo: MoveDef = {
  id: "salvo", name: "星舰齐射", anim: "salvo", kind: "super", cost: 1000,
  startup: 20, active: 40, recovery: 30, damage: 0, hitstun: 0, blockstun: 0, level: "mid",
  invuln: [1, 20], voice: "super", sfx: "rocket",
  projectile: {
    kind: "missile", frame: 20, count: 6, every: 7, speed: 0, x: -14, y: 96, w: 26, h: 26,
    hits: 1, rehit: 0, damage: 42, chip: 6, hitstun: 26, blockstun: 12, level: "mid",
  },
};

const MOVES_BASE = {
  ...MUSCLE_NORMALS,
  catchThrowL: catchThrow(false),
  catchThrowH: catchThrow(true),
  palmCounter,
  agreeNod,
  revert: revertMove,
  mHug: muscleThrow,
};

export const CHARS: CharDef[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    en: "CHATGPT",
    title: "全能型 · 稳稳接住你",
    quote: "我会稳稳接住你。",
    color: "#7b8cff",
    hp: 1000,
    normalDmg: 1,
    walkF: 2.6,
    walkB: 2.2,
    runSpeed: 5.8,
    jumpVy: 10.2,
    jumpVx: 3.4,
    gravity: 0.56,
    height: 94,
    crouchHeight: 64,
    bodyHalf: 18,
    hurtHalf: 15,
    normals: normals({ dmg: 1, kickReach: 6, fast: 0 }, {
      stLP: box(18, 70, 32, 14), stHP: box(20, 62, 54, 18), stLK: box(16, 18, 62, 20), stHK: box(16, 70, 50, 26),
      crLP: box(14, 30, 32, 14), crHP: box(14, 30, 32, 16), crLK: box(12, 0, 50, 16), crHK: box(12, 0, 50, 16),
      jLP: box(4, 10, 24, 34), jHP: box(4, 10, 24, 34), jLK: box(8, 4, 50, 26), jHK: box(8, 4, 50, 26),
    }),
    specials: [
      { motion: "236", btn: "P", light: resetCard(false), heavy: resetCard(true), role: "zoner" },
      { motion: "214", btn: "P", light: catchStance(false), heavy: catchStance(true), role: "counter" },
      { motion: "214", btn: "K", light: agentRush(false), heavy: agentRush(true), role: "rush" },
    ],
    superMove: ultraMove,
    throwMove: { ...throwMove, anim: "catchThrow" },
    moveList: [
      { input: "↓↘→ + 拳", name: "重置卡（命中「额度已重置」，对手能量 −300）" },
      { input: "↓↙← + 拳", name: "稳稳接住你（接住拳脚、跳攻，抱起来甩出去）" },
      { input: "↓↙← + 脚", name: "Agent 代操作（游标连点 4 下，最后「确认」击倒）" },
      { input: "重拳 + 重脚", name: "超必杀 · Ultra（8 秒：更快、更痛、一次甩 3 张卡，需 1 格能量）" },
    ],
    victory: "我会稳稳接住你。要我帮你整理一份败因分析吗？",
    koText: "Something went wrong.",
  },
  {
    id: "claude",
    name: "Claude",
    en: "CLAUDE",
    title: "控场型 · 使用政策",
    quote: "你说得完全对！",
    color: "#ff9a4d",
    hp: 960,
    normalDmg: 1.02,
    walkF: 2.4,
    walkB: 2.0,
    runSpeed: 5.3,
    jumpVy: 10.8,
    jumpVx: 3.3,
    gravity: 0.55,
    height: 92,
    crouchHeight: 62,
    bodyHalf: 17,
    hurtHalf: 14,
    normals: normals({ dmg: 1.02, kickReach: 4, fast: 0 }, {
      stLP: box(18, 70, 40, 14), stHP: box(22, 62, 60, 18), stLK: box(16, 18, 62, 20), stHK: box(18, 70, 60, 28),
      crLP: box(16, 28, 46, 14), crHP: box(16, 28, 46, 16), crLK: box(12, 0, 40, 16), crHK: box(12, 0, 40, 16),
      jLP: box(4, 10, 22, 36), jHP: box(4, 10, 22, 36), jLK: box(8, 4, 50, 26), jHK: box(8, 4, 50, 26),
    }),
    specials: [
      { motion: "236", btn: "P", light: policyNotice(false), heavy: policyNotice(true), role: "zoner" },
      { motion: "214", btn: "P", light: agreeStance(false), heavy: agreeStance(true), role: "counter" },
      { motion: "214", btn: "K", light: artifactWall(false), heavy: artifactWall(true), role: "trap" },
    ],
    superMove: banStamp,
    throwMove,
    moveList: [
      { input: "↓↘→ + 拳", name: "使用政策审查（警示单命中封禁 1 秒，不能出招）" },
      { input: "↓↙← + 拳", name: "你说得完全对！（反弹飞行道具，招架拳脚）" },
      { input: "↓↙← + 脚", name: "Artifact 生成（程序窗口挡一发飞行道具）" },
      { input: "重拳 + 重脚", name: "超必杀 · 你的账号已被封禁（不可防御，可闪避，需 1 格能量）" },
    ],
    victory: "你的账号已被封禁。还有什么我可以帮你的吗？",
    koText: "这段对话已达长度上限。",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    en: "DEEPSEEK",
    title: "力量变身型 · 开源之力",
    quote: "已深度思考。",
    color: "#4d8bff",
    hp: 1080,
    normalDmg: 1.15,
    walkF: 2.2,
    walkB: 1.9,
    runSpeed: 5.0,
    jumpVy: 9.8,
    jumpVx: 3.1,
    gravity: 0.58,
    height: 94,
    crouchHeight: 64,
    bodyHalf: 18,
    hurtHalf: 15,
    normals: normals({ dmg: 1.15, kickReach: 4, fast: -1 }, {
      stLP: box(18, 70, 34, 14), stHP: box(20, 60, 48, 18), stLK: box(14, 30, 36, 22), stHK: box(6, 60, 40, 80),
      crLP: box(16, 28, 40, 14), crHP: box(16, 28, 40, 16), crLK: box(12, 0, 52, 16), crHK: box(12, 0, 52, 16),
      jLP: box(4, 10, 38, 34), jHP: box(4, 10, 38, 34), jLK: box(8, 4, 64, 26), jHK: box(8, 4, 64, 26),
    }),
    specials: [
      { motion: "236", btn: "P", light: openScroll(false), heavy: openScroll(true), role: "zoner" },
      { motion: "214", btn: "P", light: deepThink(false), heavy: deepThink(true), role: "antiAir" },
      { motion: "214", btn: "K", light: summonMaid(false), heavy: summonMaid(true), role: "summon" },
    ],
    superMove: liangSheng,
    throwMove,
    moveList: [
      { input: "↓↘→ + 拳", name: "开源卷轴（轻：MIT 回能量；重：GPL 感染持续扣血）" },
      { input: "↓↙← + 拳", name: "已深度思考（先想一下再升龙，对空）" },
      { input: "↓↙← + 脚", name: "召唤鲸鱼女仆（托盘拍两下再喷水柱）" },
      { input: "重拳 + 重脚", name: "超必杀 · 梁圣降临（10 秒壮汉霸体，攻击 +30%，需 1 格能量）" },
    ],
    victory: "本次胜利以 MIT 协议开源，欢迎自由复刻。",
    koText: "服务器繁忙，请稍后再试。",
  },
  {
    id: "grok",
    name: "Grok",
    en: "GROK",
    title: "机动爆发型 · 点火",
    quote: "倒计时，三、二、一，点火！",
    color: "#e5e7eb",
    hp: 980,
    normalDmg: 1.08,
    walkF: 3.0,
    walkB: 2.5,
    runSpeed: 6.4,
    jumpVy: 10.4,
    jumpVx: 3.8,
    gravity: 0.56,
    height: 96,
    crouchHeight: 66,
    bodyHalf: 18,
    hurtHalf: 15,
    normals: normals({ dmg: 1.08, kickReach: 6, fast: 1 }, {
      stLP: box(18, 70, 44, 14), stHP: box(22, 62, 58, 18), stLK: box(18, 30, 70, 22), stHK: box(20, 72, 64, 28),
      crLP: box(16, 28, 52, 14), crHP: box(16, 28, 52, 16), crLK: box(14, 0, 62, 16), crHK: box(14, 0, 62, 16),
      jLP: box(4, 10, 22, 34), jHP: box(4, 10, 22, 34), jLK: box(8, 4, 62, 26), jHK: box(8, 4, 62, 26),
    }),
    specials: [
      { motion: "236", btn: "P", light: rocketLaunch(false), heavy: rocketLaunch(true), role: "zoner" },
      { motion: "214", btn: "P", light: communityNote(false), heavy: communityNote(true), role: "rush" },
      { motion: "214", btn: "K", light: roadsterFlip(false), heavy: roadsterFlip(true), role: "antiAir" },
    ],
    superMove: salvo,
    throwMove,
    moveList: [
      { input: "↓↘→ + 拳", name: "火箭发射（重：先上后砸；飞行中再按拳当场引爆）" },
      { input: "↓↙← + 拳", name: "社群注记（贴上便条，5 秒内受伤 +15%）" },
      { input: "↓↙← + 脚", name: "Roadster 2 翻转飞跃（起手无敌，落地砸人）" },
      { input: "重拳 + 重脚", name: "超必杀 · 星舰齐射（6 枚火箭轰炸，需 1 格能量）" },
    ],
    victory: "恭喜，你被收购了。",
    koText: "快速计划外解体",
  },
];

// each stage has its own battle theme (audio.ts BGM)
export const STAGES = [
  { id: "launch", name: "大模型发布会", bg: "/assets/stages/launch.jpg", sky: "#120818", floor: "#0b0b12", bgm: "launch" },
  { id: "datacenter", name: "算力机房", bg: "/assets/stages/datacenter.jpg", sky: "#06121f", floor: "#0d1418", bgm: "datacenter" },
  { id: "colosseum", name: "巅峰榜单擂台", bg: "/assets/stages/colosseum.jpg", sky: "#2a1630", floor: "#1d1a1f", bgm: "colosseum" },
] as const;

const EXTRA: Record<string, MoveDef> = MOVES_BASE;

export function findMove(charIdx: number, id: string): MoveDef | null {
  const c = CHARS[charIdx];
  if (id in c.normals) return c.normals[id as NormalId];
  if (id === c.throwMove.id) return c.throwMove;
  if (id === c.superMove.id) return c.superMove;
  for (const s of c.specials) {
    if (s.light.id === id) return s.light;
    if (s.heavy.id === id) return s.heavy;
  }
  return EXTRA[id] ?? null;
}

export function charIndex(id: string) {
  return CHARS.findIndex((c) => c.id === id);
}
