/**
 * Deterministic fighting-game simulation.
 *
 * step() advances exactly one 1/60 s frame from two input bytes. It must give
 * identical results on every machine (rollback netcode re-simulates frames),
 * so it uses only + - * / and Math.round/abs/min/max — no Math.random, no
 * trig, no wall-clock time. All state lives in the plain GameState object so
 * it can be snapshotted with structuredClone.
 */

import {
  BTN_MASK, IN_D, IN_HK, IN_HP, IN_L, IN_LK, IN_LP, IN_R, IN_U,
  MAX_SEP, METER_MAX, ROUND_SECONDS, ROUNDS_TO_WIN, STAGE_W, W, WALL_PAD,
} from "./constants";
import {
  BAN_COOLDOWN, BAN_LEN, BLAST, BUSY_LEN, CHARS, CINE_BAN, CINE_ULTRA, DODGE_COST, GPL_LEN, MUSCLE_LEN, MUSCLE_MAP,
  NOTE_LEN, ULTRA_LEN, findMove, type NormalId,
} from "./chars";
import type { Box, Fighter, FState, Fx, GameState, HitFx, Level, MatchConfig, MoveDef, OnHit, Projectile } from "./types";

const BUFFER = 7;
const BTN_BITS = [IN_LP, IN_HP, IN_LK, IN_HK];
const LP = 0, HP = 1, LK = 2, HK = 3;

const MOTIONS: Record<string, number[][]> = {
  "236": [[2], [3], [6, 9]],
  "214": [[2], [1], [4, 7]],
};
const MOTION_WINDOW: Record<string, number> = { "236": 14, "214": 14 };

const NEUTRAL: FState[] = ["idle", "walkF", "walkB", "crouch", "run"];
const BLOCKABLE: FState[] = ["idle", "walkF", "walkB", "crouch", "blockstun"];
const HELPLESS: FState[] = ["hitstun", "blockstun", "kd", "down", "getup", "thrown", "dead"];

// dodge roll (轻拳＋轻脚): invulnerable at first, rolls through the opponent, punishable at the end
export const DODGE = { len: 30, roll: 22, invuln: 12, fwd: 3.8, back: 3.0 };

// ───────────────────────── setup ─────────────────────────

export function createFighter(char: number, side: 0 | 1): Fighter {
  return {
    char,
    x: STAGE_W / 2 + (side === 0 ? -70 : 70),
    y: 0, vx: 0, vy: 0,
    facing: side === 0 ? 1 : -1,
    state: "intro", sf: 0, move: null,
    hp: CHARS[char].hp, meter: 0, stun: 0,
    crouching: false, blockCrouch: false,
    hitCount: 0, rehitTimer: 0, pushVx: 0,
    airAttackUsed: false, jumpVx: 0,
    combo: 0, comboDamage: 0, invuln: 0, throwSide: 1,
    dir: 5, prevBits: 0, hist: [], buf: [0, 0, 0, 0],
    wins: 0, voiceAlt: 0,
    dodgeDir: 1, armorUsed: false,
    ban: 0, banCd: 0, unban: 0, ultra: 0, muscle: 0, busy: 0, gpl: 0, noted: 0,
    acquired: false,
  };
}

export function createState(cfg: MatchConfig): GameState {
  return {
    frame: 0,
    phase: "intro",
    phaseFrame: 0,
    round: 1,
    timer: ROUND_SECONDS * 60,
    fighters: [createFighter(cfg.chars[0], 0), createFighter(cfg.chars[1], 1)],
    projectiles: [],
    fx: [],
    freeze: 0,
    superFreeze: 0,
    superOwner: -1,
    cineT: 0,
    cineOwner: -1,
    cineKind: 0,
    shake: 0,
    camX: (STAGE_W - W) / 2,
    roundWinner: -1,
    matchWinner: -1,
    perfect: false,
    timeOver: false,
    nextId: 1,
    events: [],
    stage: cfg.stage,
    training: !!cfg.training,
    seed: cfg.seed,
  };
}

export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}

/** Cheap checksum of the gameplay-relevant state, used to detect online desyncs. */
export function checksum(s: GameState): number {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= Math.round(v * 64) | 0;
    h = Math.imul(h, 16777619);
  };
  mix(s.frame); mix(s.timer); mix(s.phaseFrame); mix(s.cineT);
  for (const f of s.fighters) {
    mix(f.x); mix(f.y); mix(f.hp); mix(f.meter); mix(f.sf); mix(f.stun);
    mix(f.ban); mix(f.ultra); mix(f.muscle); mix(f.busy); mix(f.gpl); mix(f.noted);
  }
  for (const p of s.projectiles) { mix(p.x); mix(p.y); mix(p.hits); mix(p.mode); mix(p.mt); mix(p.owner); }
  return h >>> 0;
}

function resetRound(s: GameState) {
  s.fighters.forEach((f, i) => {
    const { wins, meter, acquired } = f;
    Object.assign(f, createFighter(f.char, i as 0 | 1));
    f.wins = wins;
    f.meter = meter;
    f.acquired = acquired;
  });
  s.projectiles = [];
  s.fx = [];
  s.phase = "intro";
  s.phaseFrame = 0;
  s.timer = ROUND_SECONDS * 60;
  s.camX = (STAGE_W - W) / 2;
  s.roundWinner = -1;
  s.perfect = false;
  s.timeOver = false;
  s.freeze = 0;
  s.superFreeze = 0;
  s.cineT = 0;
  s.cineOwner = -1;
  s.cineKind = 0;
}

// ───────────────────────── helpers ─────────────────────────

function setState(f: Fighter, st: FState) {
  if (f.state !== st) {
    f.state = st;
    f.sf = 0;
  }
}

function relDir(bits: number, facing: number): number {
  const fwd = facing > 0 ? bits & IN_R : bits & IN_L;
  const back = facing > 0 ? bits & IN_L : bits & IN_R;
  const h = fwd && !back ? 1 : back && !fwd ? -1 : 0;
  const v = bits & IN_U && !(bits & IN_D) ? 1 : bits & IN_D && !(bits & IN_U) ? -1 : 0;
  return 5 + h + v * 3;
}

function matchMotion(hist: number[], motion: string): boolean {
  const seq = MOTIONS[motion];
  const n = hist.length;
  const floor = Math.max(0, n - MOTION_WINDOW[motion]);
  let i = n - 1;
  for (let k = seq.length - 1; k >= 0; k--) {
    const limit = k === seq.length - 1 ? Math.max(0, n - 6) : floor;
    while (i >= limit && !seq[k].includes(hist[i])) i--;
    if (i < limit) return false;
    i--;
  }
  return true;
}

function doubleTap(hist: number[], d: number): boolean {
  const n = hist.length;
  if (n < 3 || hist[n - 1] !== d || hist[n - 2] === d) return false;
  let i = n - 2;
  while (i >= 0 && n - 1 - i <= 12 && hist[i] !== d) i--;
  return i >= 0 && n - 1 - i <= 12;
}

export function totalFrames(mv: MoveDef) {
  return mv.startup + mv.active + mv.recovery;
}

function currentMove(f: Fighter): MoveDef | null {
  return f.move ? findMove(f.char, f.move) : null;
}

function isCrouchingNormal(id: string | null) {
  return !!id && (id.startsWith("cr") || id === "mLow");
}

function toWorld(f: { x: number; y: number; facing: number }, b: Box) {
  const x0 = f.facing > 0 ? f.x + b.x : f.x - b.x - b.w;
  return { x0, x1: x0 + b.w, y0: f.y + b.y, y1: f.y + b.y + b.h };
}

type WBox = ReturnType<typeof toWorld>;

function overlap(a: WBox, b: WBox) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function projBox(p: Projectile): WBox {
  return { x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y, y1: p.y + p.h };
}

/** Body size, bigger in the 梁圣 form. */
export function bodyOf(f: Fighter) {
  const c = CHARS[f.char];
  const big = f.muscle > 0;
  return {
    height: big ? Math.round(c.height * 1.18) : c.height,
    crouch: big ? Math.round(c.crouchHeight * 1.15) : c.crouchHeight,
    hurtHalf: big ? c.hurtHalf + 5 : c.hurtHalf,
    bodyHalf: big ? c.bodyHalf + 6 : c.bodyHalf,
  };
}

function speedMul(f: Fighter) {
  return f.ultra > 0 ? 1.15 : f.muscle > 0 ? 0.8 : 1;
}

export function hurtboxes(f: Fighter): WBox[] {
  if (f.invuln > 0) return [];
  if (["down", "getup", "dead", "thrown", "throwing", "kd", "intro", "win", "lose"].includes(f.state)) return [];
  if (f.state === "dodge" && f.sf <= DODGE.invuln) return [];
  const mv = currentMove(f);
  if (mv && mv.invuln && f.state === "attack" && f.sf >= mv.invuln[0] && f.sf <= mv.invuln[1]) return [];
  const b = bodyOf(f);
  const out: WBox[] = [];
  const low = f.state === "crouch" || f.state === "dodge" || (f.state === "attack" && isCrouchingNormal(f.move)) ||
    (f.state === "blockstun" && f.blockCrouch) || (f.state === "hitstun" && f.crouching);
  if (f.y > 0 || f.state === "air") out.push(toWorld(f, { x: -b.hurtHalf + 1, y: 10, w: b.hurtHalf * 2 - 2, h: Math.round(b.height * 0.72) }));
  else out.push(toWorld(f, { x: -b.hurtHalf, y: 0, w: b.hurtHalf * 2, h: low ? b.crouch : b.height }));
  if (mv && mv.hurtExt && f.state === "attack" && f.sf >= mv.startup - 1 && f.sf <= mv.startup + mv.active + 5) {
    out.push(toWorld(f, mv.hurtExt));
  }
  return out;
}

export function activeHitbox(f: Fighter): WBox | null {
  if (f.state !== "attack") return null;
  const mv = currentMove(f);
  if (!mv || !mv.hitbox) return null;
  if (f.sf <= mv.startup || f.sf > mv.startup + mv.active) return null;
  if (f.hitCount >= (mv.hits ?? 1) || f.rehitTimer > 0) return null;
  return toWorld(f, mv.hitbox);
}

/** Is the fighter inside the live window of a guard stance (接住 / 反弹)? */
export function counterWindow(f: Fighter): MoveDef["counter"] | null {
  if (f.state !== "attack") return null;
  const mv = currentMove(f);
  if (!mv?.counter) return null;
  return f.sf > mv.startup && f.sf <= mv.startup + mv.active ? mv.counter : null;
}

function emit(s: GameState, t: "sfx" | "voice" | "announce", id: string, who?: 0 | 1) {
  s.events.push({ t, id, who });
}

function voice(s: GameState, i: 0 | 1, id: string) {
  emit(s, "voice", id, i);
}

function addFx(s: GameState, kind: Fx["kind"], x: number, y: number, facing: 1 | -1, life = 14) {
  s.fx.push({ kind, x, y, age: 0, life, facing });
  if (s.fx.length > 28) s.fx.shift();
}

/** Big callout text over a fighter (「额度已重置」, 「你说得完全对！」…). */
function say(s: GameState, who: 0 | 1, text: string, life = 70) {
  const f = s.fighters[who];
  s.fx.push({ kind: "say", x: f.x, y: f.y + bodyOf(f).height + 34, age: 0, life, facing: f.facing, text, who });
  if (s.fx.length > 28) s.fx.shift();
}

function gainMeter(f: Fighter, n: number) {
  f.meter = Math.min(METER_MAX, f.meter + n);
}

function nearWall(s: GameState, f: Fighter, dir: number) {
  const left = Math.max(0, s.camX) + WALL_PAD + 2;
  const right = Math.min(STAGE_W, s.camX + W) - WALL_PAD - 2;
  return dir > 0 ? f.x >= right : f.x <= left;
}

function charId(f: Fighter) {
  return CHARS[f.char].id;
}

// ───────────────────────── actions ─────────────────────────

function startMove(s: GameState, i: 0 | 1, mv: MoveDef) {
  const f = s.fighters[i];
  f.state = "attack";
  f.sf = 0;
  f.move = mv.id;
  f.hitCount = 0;
  f.rehitTimer = 0;
  f.armorUsed = false;
  f.buf = [0, 0, 0, 0];
  if (!mv.air) f.vx = 0;
  if (mv.cost) f.meter -= mv.cost;
  if (mv.kind === "super") {
    if (mv.id === "ultra") startCinematic(s, CINE_ULTRA, i, (1 - i) as 0 | 1);
    else {
      s.superFreeze = 42;
      s.superOwner = i;
    }
    emit(s, "sfx", "super");
  }
  if (mv.kind === "normal") gainMeter(f, 3);
  else if (mv.kind === "special") gainMeter(f, 8);
  if (mv.voice) {
    // light normals only grunt occasionally
    f.voiceAlt = (f.voiceAlt + 1) % 3;
    if (mv.voice !== "atk" || f.voiceAlt === 0 || mv.kind !== "normal") voice(s, i, mv.voice);
  }
  if (mv.say) say(s, i, mv.say);
}

function pressed(f: Fighter, b: number) {
  return f.buf[b] > 0;
}

/** Two buttons pressed together (within a few frames of each other). */
function pair(f: Fighter, a: number, b: number) {
  return f.buf[a] > 0 && f.buf[b] > 0 && Math.abs(f.buf[a] - f.buf[b]) <= 3;
}

function ownProjectile(s: GameState, owner: number, kinds: Projectile["kind"][]) {
  return s.projectiles.some((p) => p.owner === owner && kinds.includes(p.kind) && (p.hits > 0 || p.kind === "maid"));
}

function canAttack(f: Fighter) {
  return f.ban <= 0;
}

// the button that, pressed right after a normal came out, turns it into the super (heavies) or a dodge (lights)
const KARA: Record<string, number> = { HP: HK, HK: HP, LP: LK, LK: LP };

function trySuper(s: GameState, i: 0 | 1, kara = false): boolean {
  const f = s.fighters[i];
  if ((!kara && !pair(f, HP, HK)) || !canAttack(f) || f.muscle > 0 || f.busy > 0) return false;
  const mv = CHARS[f.char].superMove;
  if (f.meter < (mv.cost ?? 0) || (f.ultra > 0 && mv.id === "ultra")) return false;
  startMove(s, i, mv);
  return true;
}

function tryDodge(s: GameState, i: 0 | 1, kara = false): boolean {
  const f = s.fighters[i];
  if (!kara && !pair(f, LP, LK)) return false;
  if (f.state === "blockstun") {
    if (f.meter < DODGE_COST) return false;
    f.meter -= DODGE_COST;
  }
  f.dodgeDir = [1, 4, 7].includes(f.dir) ? -1 : 1;
  f.state = "dodge";
  f.sf = 0;
  f.move = null;
  f.vx = 0;
  f.buf = [0, 0, 0, 0];
  emit(s, "sfx", "whiff");
  return true;
}

function trySpecial(s: GameState, i: 0 | 1): boolean {
  const f = s.fighters[i];
  if (!canAttack(f) || f.muscle > 0 || f.busy > 0) return false;
  const c = CHARS[f.char];
  for (const sp of c.specials) {
    const lb = sp.btn === "P" ? LP : LK;
    const hb = sp.btn === "P" ? HP : HK;
    if (!pressed(f, lb) && !pressed(f, hb)) continue;
    if (!matchMotion(f.hist, sp.motion)) continue;
    const mv = pressed(f, hb) ? sp.heavy : sp.light;
    if (mv.projectile && ownProjectile(s, i, [mv.projectile.kind])) continue;
    startMove(s, i, mv);
    return true;
  }
  return false;
}

function canBeThrown(f: Fighter) {
  if (f.y > 0 || f.invuln > 0) return false;
  if (["idle", "walkF", "walkB", "crouch", "run", "land"].includes(f.state)) return true;
  if (f.state === "attack") {
    const mv = currentMove(f);
    return !!mv && !mv.air && !mv.airborne && mv.kind === "normal";
  }
  return false;
}

function grab(s: GameState, i: 0 | 1, mv: MoveDef) {
  const f = s.fighters[i];
  const o = s.fighters[1 - i];
  f.state = "throwing";
  f.sf = 0;
  f.move = mv.id;
  f.buf = [0, 0, 0, 0];
  o.state = "thrown";
  o.sf = 0;
  o.move = null;
  o.vx = 0;
  o.vy = 0;
  o.facing = (f.facing * -1) as 1 | -1;
  o.throwSide = f.facing;
  emit(s, "sfx", "whiff");
  if (mv.voice) voice(s, i, mv.voice);
  if (mv.say) say(s, i, mv.say);
}

function tryThrow(s: GameState, i: 0 | 1): boolean {
  const f = s.fighters[i];
  const o = s.fighters[1 - i];
  if (!pressed(f, HP) || (f.dir !== 4 && f.dir !== 6) || !canAttack(f)) return false;
  if (Math.abs(o.x - f.x) > 54 + (f.muscle > 0 ? 10 : 0) || !canBeThrown(o) || s.phase !== "fight") return false;
  if (f.dir === 4) {
    // back throw: swap sides so the victim lands behind
    const tx = f.x;
    f.x = o.x;
    o.x = tx;
    f.facing = (f.facing * -1) as 1 | -1;
  }
  grab(s, i, f.muscle > 0 ? findMove(f.char, "mHug")! : CHARS[f.char].throwMove);
  return true;
}

function tryNormal(s: GameState, i: 0 | 1, onlyLights: boolean): boolean {
  const f = s.fighters[i];
  if (!canAttack(f)) return false;
  const c = CHARS[f.char];
  const air = f.state === "air";
  if (air && f.airAttackUsed) return false;
  const crouch = !air && f.dir <= 3;
  const order = onlyLights ? [LK, LP] : [HK, HP, LK, LP];
  for (const b of order) {
    if (!pressed(f, b)) continue;
    const suffix = ["LP", "HP", "LK", "HK"][b];
    const id = ((air ? "j" : crouch ? "cr" : "st") + suffix) as NormalId;
    const mv = f.muscle > 0 ? findMove(f.char, MUSCLE_MAP[id])! : c.normals[id];
    startMove(s, i, mv);
    if (air) f.airAttackUsed = true;
    return true;
  }
  return false;
}

/** Grok: a punch while his rocket is in the air blows it up on the spot. */
function tryDetonate(s: GameState, i: 0 | 1): boolean {
  const f = s.fighters[i];
  if (charId(f) !== "grok" || HELPLESS.includes(f.state)) return false;
  if (f.buf[LP] !== BUFFER && f.buf[HP] !== BUFFER) return false; // pressed this very frame
  const r = s.projectiles.find((p) => p.owner === i && p.kind === "rocket" && p.hits > 0 && p.age > 6);
  if (!r) return false;
  r.hits = 0;
  spawnBlast(s, i, r.x, r.y + r.h / 2);
  f.buf[LP] = 0;
  f.buf[HP] = 0;
  voice(s, i, "detonate");
  say(s, i, "快速计划外解体！", 60);
  return true;
}

function think(s: GameState, i: 0 | 1) {
  const f = s.fighters[i];
  const o = s.fighters[1 - i];
  const c = CHARS[f.char];

  tryDetonate(s, i);

  if (f.state === "attack") {
    const mv = currentMove(f);
    if (!mv) return;
    // a heavy normal that just came out turns into the super when 重脚 joins in; a light one into a dodge
    if (mv.kind === "normal" && f.sf <= 3 && !mv.air) {
      const b = KARA[mv.id.slice(-2)];
      if (b !== undefined && pressed(f, b) && (b === HK || b === HP ? trySuper(s, i, true) : tryDodge(s, i, true))) return;
    }
    // specials cancel into the super
    if (mv.kind === "special" && f.sf > mv.startup && trySuper(s, i)) return;
    if (mv.kind !== "normal" || f.hitCount === 0) return;
    // cancel window: from the first active frame to a few frames into recovery
    if (f.sf < mv.startup + 1 || f.sf > mv.startup + mv.active + 10) return;
    if (trySuper(s, i)) return;
    if (mv.cancel && trySpecial(s, i)) return;
    // lights chain into lights; on a clean hit they also chain into heavies
    if (mv.chain && f.sf > mv.startup + mv.active - 1 && !mv.air) tryNormal(s, i, o.state !== "hitstun");
    return;
  }

  if (f.state === "blockstun") {
    tryDodge(s, i);
    return;
  }

  if (f.state === "air") {
    tryNormal(s, i, false);
    return;
  }

  if (!NEUTRAL.includes(f.state)) return;

  if (trySuper(s, i)) return;
  if (tryDodge(s, i)) return;
  if (trySpecial(s, i)) return;
  if (tryThrow(s, i)) return;
  if (tryNormal(s, i, false)) return;

  const d = f.dir;
  if (d >= 7) {
    const fromRun = f.state === "run";
    setState(f, "jumpSquat");
    f.jumpVx = (d === 9 ? 1 : d === 7 ? -1 : 0) * c.jumpVx * (fromRun ? 1.35 : 1) * speedMul(f);
  } else if (d <= 3) {
    setState(f, "crouch");
  } else if (d === 6) {
    if (f.state === "run" || doubleTap(f.hist, 6)) setState(f, "run");
    else setState(f, "walkF");
  } else if (d === 4) {
    if (doubleTap(f.hist, 4)) {
      setState(f, "backdash");
      f.vy = 3;
      f.y = 0.01;
    } else setState(f, "walkB");
  } else {
    setState(f, "idle");
  }
}

// ───────────────────────── projectiles ─────────────────────────

function clampStage(x: number) {
  return Math.min(STAGE_W - WALL_PAD, Math.max(WALL_PAD, x));
}

function newProjectile(s: GameState, owner: 0 | 1, init: Partial<Projectile> & Pick<Projectile, "kind" | "x" | "y" | "w" | "h">): Projectile {
  const p: Projectile = {
    id: s.nextId++, owner, variant: 0, vx: 0, vy: 0, hits: 1, rehit: 0, rehitTimer: 0, damage: 0, chip: 0,
    hitstun: 20, blockstun: 12, level: "mid", knockdown: false, age: 0, dir: 1, mode: 0, mt: 0, tx: 0,
    ...init,
  };
  s.projectiles.push(p);
  return p;
}

// Ultra throws three cards at once, fanned out in height
const ULTRA_CARDS = [-18, 0, 18];
// the starship salvo rains around where the opponent stands
const SALVO_SPREAD = [-12, 8, -4, 14, 2, -8];

function spawnProjectile(s: GameState, i: 0 | 1, mv: MoveDef, k = 0) {
  const f = s.fighters[i];
  const pd = mv.projectile!;
  const base = {
    kind: pd.kind, variant: pd.variant ?? 0, x: clampStage(f.x + f.facing * pd.x), y: pd.y, w: pd.w, h: pd.h,
    vx: f.facing * pd.speed, hits: pd.hits, rehit: pd.rehit, damage: pd.damage, chip: pd.chip, hitstun: pd.hitstun,
    blockstun: pd.blockstun, level: pd.level, knockdown: !!pd.knockdown, dir: f.facing,
  };
  if (pd.kind === "card" && f.ultra > 0) {
    for (const [n, dy] of ULTRA_CARDS.entries()) newProjectile(s, i, { ...base, y: pd.y + dy, vx: base.vx * (1 + n * 0.08) });
    return;
  }
  if (pd.kind === "missile") {
    newProjectile(s, i, { ...base, vx: -f.facing * 0.4, vy: 7, variant: k, knockdown: k === (pd.count ?? 1) - 1 });
    if (k % 2 === 0) emit(s, "sfx", "rocket");
    return;
  }
  if (pd.kind === "rocket" && base.variant === 1) {
    newProjectile(s, i, { ...base, vx: f.facing * 3, vy: 2.6 });
    return;
  }
  const p = newProjectile(s, i, base);
  if (pd.kind === "maid") {
    addFx(s, "smoke", p.x, 30, f.facing, 30);
    emit(s, "sfx", "splash");
    voice(s, i, "whalemaid:arrive");
  }
}

function spawnBlast(s: GameState, owner: 0 | 1, x: number, cy: number) {
  newProjectile(s, owner, {
    kind: "blast", x, y: Math.max(0, cy - BLAST.h / 2), w: BLAST.w, h: BLAST.h, hits: 1, damage: BLAST.damage, chip: BLAST.chip,
    hitstun: 24, blockstun: 16, knockdown: true, dir: s.fighters[owner].facing,
  });
  addFx(s, "explosion", x, cy, 1, 30);
  emit(s, "sfx", "explode");
  s.shake = Math.max(s.shake, 6);
}

/** Rockets and missiles that reach the floor go off harmlessly. */
function groundBurst(s: GameState, p: Projectile) {
  p.y = 0;
  p.hits = 0;
  addFx(s, "explosion", p.x, 14, p.dir, 24);
  emit(s, "sfx", "explode");
  s.shake = Math.max(s.shake, 3);
}

function diveAt(p: Projectile, tx: number, fall: number) {
  const n = Math.max(6, Math.round(p.y / fall));
  p.vx = Math.max(-7, Math.min(7, (tx - p.x) / n));
  p.vy = -fall;
}

function updateProjectile(s: GameState, p: Projectile) {
  p.age++;
  p.mt++;
  const o = s.fighters[1 - p.owner];
  switch (p.kind) {
    case "rocket":
      if (p.variant === 1 && p.mode === 0 && p.mt >= 22) {
        p.mode = 1;
        diveAt(p, o.x, 5.5);
      }
      p.x += p.vx;
      p.y += p.vy;
      if (p.y <= 0 && p.vy < 0) groundBurst(s, p);
      break;
    case "missile": {
      // climb, cruise over to the opponent, then drop straight down on them
      const tx = o.x + SALVO_SPREAD[p.variant % SALVO_SPREAD.length];
      if (p.mode === 0 && p.mt >= 12) {
        p.mode = 1;
        p.mt = 0;
        p.vy = 0;
      }
      if (p.mode === 1) {
        p.dir = tx >= p.x ? 1 : -1;
        p.vx = p.dir * Math.min(8, Math.abs(tx - p.x));
        if (Math.abs(tx - p.x) < 10 || p.mt > 60) {
          p.mode = 2;
          diveAt(p, tx, 8);
        }
      }
      p.x += p.vx;
      p.y += p.vy;
      if (p.y <= 0 && p.vy < 0) groundBurst(s, p);
      break;
    }
    case "artifact":
      if (p.age >= 180) p.hits = 0;
      break;
    case "blast":
      if (p.age >= 10) p.hits = 0;
      break;
    case "maid":
      updateMaid(s, p);
      break;
    default:
      p.x += p.vx;
      p.y += p.vy;
  }
}

// ───────────────────────── the whale maid ─────────────────────────
// mode 0: runs at the opponent · 1: two tray bonks · 2: water spout · 3: hop and curtsy, then gone (4)
// frame numbers line up with the whalemaid sprite (bonk, blow, curtsy anims)
export const MAID = {
  runMax: 90,
  reach: 40,
  bonk: 40,
  bonkWindows: [[10, 14], [26, 30]] as const,
  blow: 40,
  blowWindow: [12, 26] as const,
  bye: 48,
  box: { x: 4, y: 10, w: 34, h: 50 },
  spout: { x: 14, y: 12, w: 64, h: 30 },
};

function updateMaid(s: GameState, p: Projectile) {
  const o = s.fighters[1 - p.owner];
  if (p.mode === 0) {
    p.x = clampStage(p.x + p.vx);
    const ahead = (o.x - p.x) * p.dir;
    if ((ahead > 0 && ahead <= MAID.reach) || p.mt >= MAID.runMax || p.x <= WALL_PAD || p.x >= STAGE_W - WALL_PAD) {
      p.mode = 1;
      p.mt = 0;
      p.vx = 0;
      if (o.x !== p.x) p.dir = o.x > p.x ? 1 : -1;
      voice(s, p.owner, "whalemaid:strike");
    }
  } else if (p.mode === 1) {
    // a window that passes without connecting is spent
    const [w1, w2] = MAID.bonkWindows;
    if (p.mt === w1[1] + 1 && p.hits > 2) p.hits = 2;
    if (p.mt === w2[1] + 1 && p.hits > 1) p.hits = 1;
    if (p.mt === w1[0] || p.mt === w2[0]) emit(s, "sfx", "whiff");
    if (p.mt >= MAID.bonk) {
      p.mode = 2;
      p.mt = 0;
    }
  } else if (p.mode === 2) {
    if (p.mt === MAID.blowWindow[0]) {
      emit(s, "sfx", "splash");
      addFx(s, "spout", p.x + p.dir * 16, 34, p.dir, 24);
    }
    if (p.mt === MAID.blowWindow[1] + 1) p.hits = 0;
    if (p.mt >= MAID.blow) {
      p.mode = 3;
      p.mt = 0;
      voice(s, p.owner, "whalemaid:bye");
    }
  } else if (p.mode === 3 && p.mt >= MAID.bye) {
    p.mode = 4;
    addFx(s, "smoke", p.x, 30, p.dir, 30);
  }
}

function maidHitbox(p: Projectile): WBox | null {
  if (p.hits <= 0) return null;
  const at = { x: p.x, y: p.y, facing: p.dir };
  if (p.mode === 1) {
    const w = MAID.bonkWindows[p.hits > 2 ? 0 : 1];
    if (p.hits > 1 && p.mt >= w[0] && p.mt <= w[1]) return toWorld(at, MAID.box);
  }
  if (p.mode === 2 && p.mt >= MAID.blowWindow[0] && p.mt <= MAID.blowWindow[1]) return toWorld(at, MAID.spout);
  return null;
}

export function projectileHitbox(p: Projectile): WBox | null {
  if (p.kind === "maid") return maidHitbox(p);
  if (p.hits <= 0) return null;
  return projBox(p);
}

function reflectable(p: Projectile) {
  return ["card", "notice", "scroll", "rocket", "missile"].includes(p.kind);
}

// ───────────────────────── per-frame fighter update ─────────────────────────

function land(s: GameState, f: Fighter, lag: number) {
  f.y = 0;
  f.vy = 0;
  f.vx = 0;
  f.move = null;
  f.state = "land";
  f.sf = 0;
  f.stun = lag;
  emit(s, "sfx", "land");
}

function tickStatuses(s: GameState, i: 0 | 1) {
  const f = s.fighters[i];
  if (f.ban > 0 && !["kd", "down", "getup", "thrown"].includes(f.state)) {
    if (--f.ban === 0) {
      f.unban = 90;
      f.banCd = BAN_COOLDOWN;
      emit(s, "sfx", "unban");
    }
  } else if (f.banCd > 0) f.banCd--;
  if (f.unban > 0) f.unban--;
  if (f.ultra > 0) f.ultra--;
  if (f.noted > 0) f.noted--;
  if (f.gpl > 0) {
    f.gpl--;
    if (f.gpl % 6 === 0) f.hp = Math.max(1, f.hp - 1);
  }
  if (f.busy > 0) {
    f.busy--;
    if (f.busy % 24 === 0) addFx(s, "smoke", f.x, bodyOf(f).height - 10, f.facing, 26);
  }
  if (f.muscle > 0 && --f.muscle === 0) {
    // 梁圣 runs out: deflate and pant (服务器繁忙 for a while, no specials)
    const revert = findMove(f.char, "revert")!;
    if (NEUTRAL.includes(f.state) || f.state === "land") {
      startMove(s, i, revert);
      f.busy = BUSY_LEN + totalFrames(revert);
    } else {
      f.busy = BUSY_LEN;
      voice(s, i, "revert");
      emit(s, "sfx", "busy");
    }
    say(s, i, "服务器繁忙", 80);
  }
}

function updateFighter(s: GameState, i: 0 | 1) {
  const f = s.fighters[i];
  const c = CHARS[f.char];
  f.sf++;
  if (f.invuln > 0) f.invuln--;
  if (s.phase === "fight") tickStatuses(s, i);

  // decaying pushback from hits/blocks
  if (f.pushVx !== 0) {
    f.x += f.pushVx;
    f.pushVx *= 0.78;
    if (Math.abs(f.pushVx) < 0.08) f.pushVx = 0;
  }

  if (!["hitstun", "blockstun", "kd", "down", "thrown", "getup"].includes(f.state) && f.combo > 0) {
    f.combo = 0;
    f.comboDamage = 0;
  }

  const k = speedMul(f);
  switch (f.state) {
    case "intro":
    case "win":
    case "lose":
      f.vx = 0;
      break;
    case "idle":
    case "crouch":
      f.vx = 0;
      break;
    case "walkF":
      f.x += c.walkF * k * f.facing;
      break;
    case "walkB":
      f.x -= c.walkB * k * f.facing;
      break;
    case "run":
      f.vx = c.runSpeed * k * f.facing;
      f.x += f.vx;
      if (f.sf % 12 === 1) addFx(s, "dust", f.x - f.facing * 10, 2, f.facing, 12);
      break;
    case "backdash": {
      f.invuln = f.sf <= 8 ? 1 : f.invuln;
      f.x -= f.facing * Math.max(1, 6 - f.sf * 0.25);
      f.y += f.vy;
      f.vy -= 0.5;
      if (f.y <= 0 && f.sf > 2) {
        f.y = 0;
        f.vy = 0;
        if (f.sf >= 18) setState(f, "idle");
      }
      if (f.sf >= 24) {
        f.y = 0;
        setState(f, "idle");
      }
      break;
    }
    case "dodge":
      if (f.sf <= DODGE.roll) f.x += f.facing * f.dodgeDir * (f.dodgeDir > 0 ? DODGE.fwd : DODGE.back);
      if (f.sf === 2) addFx(s, "dust", f.x, 2, f.facing, 14);
      if (f.sf >= DODGE.len) setState(f, f.dir <= 3 ? "crouch" : "idle");
      break;
    case "jumpSquat":
      if (f.sf >= 4) {
        f.state = "air";
        f.sf = 0;
        f.vy = c.jumpVy;
        f.vx = f.jumpVx * f.facing;
        f.y = 0.01;
        f.airAttackUsed = false;
        emit(s, "sfx", "jump");
      }
      break;
    case "air":
    case "fall":
      f.x += f.vx;
      f.y += f.vy;
      f.vy -= c.gravity;
      if (f.y <= 0) land(s, f, f.state === "fall" ? 8 : 3);
      break;
    case "land":
      if (f.sf >= f.stun) setState(f, "idle");
      break;
    case "attack": {
      const mv = currentMove(f)!;
      if (f.rehitTimer > 0) f.rehitTimer--;
      let moving = false;
      for (const v of mv.vel ?? []) {
        if (f.sf >= v[0] && f.sf <= v[1]) {
          f.vx = v[2] * f.facing * k;
          moving = true;
          if (f.sf === v[0] && v[3] !== undefined) {
            f.vy = v[3];
            f.y = Math.max(f.y, 0.01);
          }
        }
      }
      const pj = mv.projectile;
      if (pj) {
        const n = f.sf - pj.frame;
        const every = pj.every ?? 1;
        if (n >= 0 && n % every === 0 && n / every < (pj.count ?? 1)) spawnProjectile(s, i, mv, n / every);
      }
      if (mv.sfx && f.sf === mv.startup) emit(s, "sfx", mv.sfx);
      if (mv.id === "liangSheng" && f.sf === mv.startup) {
        f.muscle = MUSCLE_LEN;
        f.busy = 0;
        say(s, i, "梁圣降临！", 90);
        addFx(s, "aura", f.x, 50, f.facing, 40);
        s.shake = Math.max(s.shake, 8);
      }

      const total = totalFrames(mv);
      if (mv.air || mv.airborne || f.y > 0) {
        f.x += f.vx;
        f.y += f.vy;
        const activeEnd = mv.startup + mv.active;
        const g = mv.floaty && f.sf <= activeEnd ? c.gravity * 0.12 : c.gravity;
        f.vy -= g;
        if (f.y <= 0) {
          if (mv.air) {
            land(s, f, 3);
            break;
          }
          if (f.sf > mv.startup) {
            land(s, f, f.sf < activeEnd ? 4 : 10);
            break;
          }
          f.y = 0;
          f.vy = 0;
        }
        if (f.sf >= total) {
          f.move = null;
          setState(f, f.y > 0 ? (mv.air ? "air" : "fall") : "idle");
        }
      } else {
        if (moving) f.x += f.vx;
        else f.vx = 0;
        if (f.sf >= total) {
          f.move = null;
          setState(f, f.dir <= 3 ? "crouch" : "idle");
        }
      }
      break;
    }
    case "hitstun":
    case "blockstun":
      if (f.y > 0) {
        f.y += f.vy;
        f.vy -= c.gravity;
        if (f.y <= 0) f.y = 0;
      }
      if (--f.stun <= 0) {
        setState(f, f.dir <= 3 ? "crouch" : "idle");
      }
      break;
    case "kd":
      f.x += f.vx;
      f.y += f.vy;
      f.vy -= 0.5;
      if (f.y <= 0) {
        f.y = 0;
        f.vy = 0;
        f.vx = 0;
        setState(f, f.hp <= 0 ? "dead" : "down");
        emit(s, "sfx", "fall");
        addFx(s, "dust", f.x, 2, f.facing, 16);
        s.shake = Math.max(s.shake, 4);
      }
      break;
    case "down":
      if (f.sf >= 34) setState(f, "getup");
      break;
    case "getup":
      if (f.sf >= 16) {
        setState(f, "idle");
        f.invuln = 2;
      }
      break;
    case "throwing": {
      const mv = currentMove(f) ?? c.throwMove;
      const o = s.fighters[1 - i];
      if (o.state === "thrown" && f.sf <= mv.startup) {
        o.x = f.x + f.facing * 30;
        o.y = mv.anim === "throw" ? 0 : Math.min(18, f.sf * 2);
      }
      if (f.sf === mv.startup && o.state === "thrown") {
        const dmg = Math.round(mv.damage * damageMul(f, o));
        o.hp = Math.max(0, o.hp - dmg);
        if (s.training) o.hp = Math.max(1, o.hp);
        o.state = "kd";
        o.sf = 0;
        o.vx = f.facing * mv.launch![0];
        o.vy = mv.launch![1];
        o.y = Math.max(o.y, 0.01);
        o.combo = 1;
        o.comboDamage = dmg;
        gainMeter(f, 40);
        gainMeter(o, 20);
        emit(s, "sfx", "hitH");
        voice(s, (1 - i) as 0 | 1, o.hp <= 0 ? "ko" : "hurtH");
        s.shake = 6;
        addFx(s, "heavy", o.x, 50, f.facing, 16);
        if (f.muscle > 0) addFx(s, "stomp", o.x, 0, f.facing, 22);
      }
      if (f.sf >= totalFrames(mv)) {
        f.move = null;
        setState(f, "idle");
      }
      break;
    }
    case "thrown": {
      const o = s.fighters[1 - i];
      if (o.state !== "throwing") {
        // the thrower was interrupted (round over, …): drop the victim
        f.move = null;
        if (f.y > 0) setState(f, "fall");
        else setState(f, "idle");
        break;
      }
      // throw escape: press heavy punch within the first frames (a counter-catch can't be escaped)
      const caught = !!o.move && o.move.startsWith("catchThrow");
      if (f.sf <= 7 && pressed(f, HP) && !caught && o.state === "throwing") {
        for (const g of [f, o]) {
          g.state = "blockstun";
          g.sf = 0;
          g.stun = 14;
          g.move = null;
          g.y = 0;
        }
        f.pushVx = -f.facing * 4;
        o.pushVx = -o.facing * 4;
        emit(s, "sfx", "block");
        addFx(s, "spark", (f.x + o.x) / 2, 60, f.facing, 12);
      }
      break;
    }
    case "dead":
      break;
  }
}

// ───────────────────────── hits ─────────────────────────

interface HitData {
  damage: number;
  chip: number;
  hitstun: number;
  blockstun: number;
  level: Level;
  push: number;
  knockdown: boolean;
  launch: [number, number];
  hitstop: number;
  heavy: boolean;
  kick: boolean;
  special: boolean;
  unblockable?: boolean;
  onHit?: OnHit;
  fx?: HitFx | "explosion";
}

function moveHitData(mv: MoveDef, f: Fighter): HitData {
  const lastHit = f.hitCount + 1 >= (mv.hits ?? 1);
  return {
    damage: mv.damage,
    chip: mv.chip ?? 0,
    hitstun: mv.hitstun,
    blockstun: mv.blockstun,
    level: mv.level,
    push: mv.push ?? 4,
    knockdown: !!mv.knockdown && lastHit,
    launch: mv.launch ?? [3, 6],
    hitstop: mv.hitstop ?? (mv.damage >= 70 ? 11 : 7),
    heavy: mv.damage >= 70 || mv.kind !== "normal",
    kick: mv.id.endsWith("K") || mv.id === "mStomp",
    special: mv.kind !== "normal",
    unblockable: mv.unblockable,
    onHit: mv.onHit,
    fx: mv.hitFx,
  };
}

const PROJ_EFFECT: Partial<Record<Projectile["kind"], OnHit>> = { card: "drain", notice: "ban" };

function projectileHitData(p: Projectile): HitData {
  const lastHit = p.hits <= 1;
  const maid = p.kind === "maid";
  const spout = maid && p.mode === 2;
  return {
    damage: spout ? Math.round(p.damage * 1.25) : p.damage,
    chip: p.chip,
    hitstun: p.hitstun,
    blockstun: p.blockstun,
    level: p.level,
    push: maid ? (spout ? 6 : 3) : 4,
    knockdown: spout || (p.knockdown && lastHit),
    launch: spout ? [5, 6] : p.kind === "blast" ? [4, 7] : [3, 6],
    hitstop: p.kind === "blast" ? 14 : maid ? (spout ? 12 : 8) : lastHit ? 10 : 5,
    heavy: true,
    kick: false,
    special: true,
    onHit: p.kind === "scroll" ? (p.variant ? "gpl" : "mit") : PROJ_EFFECT[p.kind],
    fx: p.kind === "blast" || p.kind === "rocket" || p.kind === "missile" ? "explosion" : undefined,
  };
}

function canBlock(f: Fighter, fromLeft: boolean, level: Level) {
  if (f.y > 0 || !BLOCKABLE.includes(f.state)) return false;
  const bits = f.prevBits;
  const away = fromLeft ? IN_R : IN_L;
  if (!(bits & away) || bits & IN_U) return false;
  const down = !!(bits & IN_D);
  if (level === "low" && !down) return false;
  if (level === "overhead" && down) return false;
  return true;
}

/** Damage scaling from statuses: Ultra +20%, 梁圣 +30%, a community note on the victim +15%. */
function damageMul(a: Fighter, b: Fighter) {
  return (a.ultra > 0 ? 1.2 : 1) * (a.muscle > 0 ? 1.3 : 1) * (b.noted > 0 ? 1.15 : 1);
}

function applyEffect(s: GameState, ai: 0 | 1, vi: 0 | 1, eff: OnHit) {
  const A = s.fighters[ai];
  const B = s.fighters[vi];
  switch (eff) {
    case "drain":
      B.meter = Math.max(0, B.meter - 300);
      say(s, vi, "额度已重置", 60);
      break;
    case "ban":
      if (B.ban <= 0 && B.banCd <= 0) {
        B.ban = BAN_LEN;
        emit(s, "sfx", "ban");
        say(s, vi, "违反使用政策", 60);
      }
      break;
    case "mit":
      gainMeter(A, 150);
      say(s, ai, "MIT 开源 · 能量 +150", 50);
      break;
    case "gpl":
      B.gpl = GPL_LEN;
      say(s, vi, "GPL 感染", 60);
      break;
    case "note":
      B.noted = NOTE_LEN;
      say(s, vi, "读者补充了背景信息", 80);
      break;
  }
}

function applyHit(s: GameState, ai: 0 | 1, vi: 0 | 1, d: HitData, srcX: number, srcY: number, projectile: boolean) {
  const A = s.fighters[ai];
  const B = s.fighters[vi];
  const fromLeft = srcX < B.x || (srcX === B.x && A.facing > 0);
  const wasCrouching = B.state === "crouch" || isCrouchingNormal(B.move) || (B.prevBits & IN_D) !== 0;
  const pushDir = fromLeft ? 1 : -1;
  const cx = (srcX + B.x) / 2;

  if (!d.unblockable && canBlock(B, fromLeft, d.level)) {
    B.state = "blockstun";
    B.sf = 0;
    B.stun = d.blockstun;
    B.blockCrouch = !!(B.prevBits & IN_D);
    B.move = null;
    B.hp = Math.max(s.training ? 1 : 0, B.hp - d.chip);
    B.pushVx = pushDir * d.push;
    if (!projectile && nearWall(s, B, pushDir)) A.pushVx = -pushDir * d.push;
    gainMeter(A, 10);
    gainMeter(B, 14);
    addFx(s, "block", cx, srcY, (fromLeft ? -1 : 1) as 1 | -1, 12);
    emit(s, "sfx", "block");
    s.freeze = Math.max(s.freeze, 6);
    return;
  }

  const scale = B.combo >= 1 ? Math.max(0.4, 1 - 0.12 * B.combo) : 1;
  const dmg = Math.round(d.damage * scale * damageMul(A, B));

  // 梁圣 super armour: each of his attacks shrugs off one hit
  const bm = B.state === "attack" ? currentMove(B) : null;
  if (bm?.armor && B.muscle > 0 && !B.armorUsed && B.hp - dmg > 0) {
    B.armorUsed = true;
    B.hp -= dmg;
    gainMeter(A, 10);
    addFx(s, "block", cx, srcY, (fromLeft ? -1 : 1) as 1 | -1, 12);
    addFx(s, "aura", B.x, 50, B.facing, 16);
    emit(s, "sfx", "block");
    s.freeze = Math.max(s.freeze, 8);
    return;
  }

  B.hp = Math.max(0, B.hp - dmg);
  if (s.training) B.hp = Math.max(1, B.hp);
  B.combo++;
  B.comboDamage += dmg;
  B.move = null;
  gainMeter(A, d.special ? 20 : 30);
  gainMeter(B, 16);

  const airborne = B.y > 0 || B.state === "kd";
  if (B.hp <= 0 || d.knockdown || airborne) {
    B.state = "kd";
    B.sf = 0;
    B.vx = pushDir * (B.hp <= 0 ? 3 : d.launch[0]);
    B.vy = B.hp <= 0 ? 7 : d.launch[1];
    B.y = Math.max(B.y, 0.01);
    B.facing = (fromLeft ? -1 : 1) as 1 | -1;
  } else {
    B.crouching = wasCrouching && B.y <= 0;
    B.state = "hitstun";
    B.sf = 0;
    B.stun = d.hitstun + (B.crouching ? 2 : 0);
    B.pushVx = pushDir * d.push;
    if (!projectile && nearWall(s, B, pushDir)) A.pushVx = -pushDir * d.push;
  }
  if (d.onHit) applyEffect(s, ai, vi, d.onHit);
  if (d.fx === "click" && d.knockdown) say(s, ai, "确认 ✓", 44); // Agent's last click

  addFx(s, d.fx ?? (d.heavy ? "heavy" : "hit"), cx, srcY, (fromLeft ? -1 : 1) as 1 | -1, d.fx === "explosion" ? 26 : d.heavy ? 16 : 12);
  emit(s, "sfx", d.fx === "explosion" ? "explode" : d.fx === "click" ? "click" : d.special && projectile ? "hitH" : d.heavy ? (d.kick ? "kick" : "hitH") : "hitL");
  B.voiceAlt = (B.voiceAlt + 1) % 2;
  if (B.hp <= 0) voice(s, vi, "ko");
  else voice(s, vi, d.heavy || B.state === "kd" ? "hurtH" : "hurt");
  s.freeze = Math.max(s.freeze, B.hp <= 0 ? 20 : d.hitstop);
  if (d.heavy) s.shake = Math.max(s.shake, B.hp <= 0 ? 10 : 5);
}

/** B was in a guard stance when A's punch or kick landed. */
function counterMelee(s: GameState, ai: 0 | 1, bi: 0 | 1, kind: MoveDef["counter"]) {
  const A = s.fighters[ai];
  const B = s.fighters[bi];
  const heavy = !!B.move?.endsWith("H");
  if (kind === "catch") {
    B.facing = A.x >= B.x ? 1 : -1;
    grab(s, bi, findMove(B.char, heavy ? "catchThrowH" : "catchThrowL")!);
    A.y = Math.max(0, A.y);
  } else {
    // parry: the attacker staggers, Claude answers with a palm strike
    A.state = "hitstun";
    A.sf = 0;
    A.stun = 26;
    A.move = null;
    A.vx = 0;
    A.pushVx = (A.x >= B.x ? 1 : -1) * 2;
    if (A.y > 0) A.vy = Math.min(A.vy, 0);
    addFx(s, "reflect", (A.x + B.x) / 2, 60, B.facing, 16);
    emit(s, "sfx", "reflect");
    startMove(s, bi, findMove(B.char, "palmCounter")!);
    say(s, bi, "你说得完全对！", 70);
  }
  s.freeze = Math.max(s.freeze, 10);
}

/** B was in a guard stance when A's projectile reached it. Returns true if it was handled. */
function counterProjectile(s: GameState, p: Projectile, bi: 0 | 1, kind: MoveDef["counter"]): boolean {
  const B = s.fighters[bi];
  if (kind === "reflect" && reflectable(p)) {
    p.owner = bi;
    p.dir = (-p.dir) as 1 | -1;
    p.vx = Math.abs(p.vx) > 1 ? -p.vx * 1.15 : p.dir * 4.5;
    p.vy = 0;
    p.mode = 9; // straight flight from now on
    p.age = 0;
    p.rehitTimer = 0;
    p.hits = Math.max(1, p.hits);
    addFx(s, "reflect", p.x, p.y + p.h / 2, B.facing, 16);
    emit(s, "sfx", "reflect");
    startMove(s, bi, findMove(B.char, "agreeNod")!);
    say(s, bi, "你说得完全对！", 70);
    s.freeze = Math.max(s.freeze, 8);
    return true;
  }
  if (kind === "catch" && B.ultra > 0 && p.kind !== "blast" && p.kind !== "maid") {
    p.hits = 0;
    gainMeter(B, 60);
    addFx(s, "spark", p.x, p.y + p.h / 2, B.facing, 14);
    emit(s, "sfx", "card");
    say(s, bi, "稳稳接住了", 60);
    return true;
  }
  return false;
}

function resolveHits(s: GameState) {
  type Pending = { ai: 0 | 1; vi: 0 | 1; d: HitData; x: number; y: number; proj: Projectile | null };
  const pending: Pending[] = [];

  for (const ai of [0, 1] as const) {
    const A = s.fighters[ai];
    const bi = (1 - ai) as 0 | 1;
    const B = s.fighters[bi];
    const hb = activeHitbox(A);
    if (!hb) continue;
    const hurts = hurtboxes(B);
    if (!hurts.some((h) => overlap(hb, h))) continue;
    const mv = currentMove(A)!;
    const guard = counterWindow(B);
    if (guard && !mv.unblockable && A.state === "attack") {
      A.hitCount = mv.hits ?? 1;
      counterMelee(s, ai, bi, guard);
      continue;
    }
    if (mv.cinematic) {
      A.hitCount = mv.hits ?? 1;
      startCinematic(s, mv.cinematic, ai, bi);
      continue;
    }
    pending.push({
      ai, vi: bi, d: moveHitData(mv, A),
      x: A.facing > 0 ? Math.min(hb.x1, B.x) : Math.max(hb.x0, B.x),
      y: (Math.max(hb.y0, B.y) + Math.min(hb.y1, B.y + 70)) / 2, proj: null,
    });
  }

  // projectile clashes; an Artifact window eats one enemy projectile and disappears
  for (const p of s.projectiles) {
    for (const q of s.projectiles) {
      if (p.owner === q.owner || p.hits <= 0 || q.hits <= 0 || p.id > q.id) continue;
      if ([p, q].some((x) => x.kind === "maid" || x.kind === "blast")) continue;
      if (!overlap(projBox(p), projBox(q))) continue;
      if (p.kind === "artifact" || q.kind === "artifact") {
        p.hits = 0;
        q.hits = 0;
        const other = p.kind === "artifact" ? q : p;
        if (other.kind === "rocket" || other.kind === "missile") addFx(s, "explosion", other.x, other.y + other.h / 2, 1, 24);
        else addFx(s, "spark", other.x, other.y + other.h / 2, 1, 14);
        emit(s, "sfx", "artifact");
        continue;
      }
      const n = Math.min(p.hits, q.hits);
      p.hits -= n;
      q.hits -= n;
      addFx(s, "spark", (p.x + q.x) / 2, (p.y + q.y) / 2 + 10, 1, 14);
      emit(s, "sfx", "block");
    }
  }

  for (const p of s.projectiles) {
    if (p.hits <= 0) continue;
    if (p.rehitTimer > 0) {
      p.rehitTimer--;
      continue;
    }
    const vi = (1 - p.owner) as 0 | 1;
    const B = s.fighters[vi];
    const pb = projectileHitbox(p);
    if (!pb) continue;
    if (!hurtboxes(B).some((h) => overlap(pb, h))) continue;
    const guard = counterWindow(B);
    if (guard && counterProjectile(s, p, vi, guard)) continue;
    pending.push({
      ai: p.owner, vi, proj: p, x: p.kind === "maid" ? (pb.x0 + pb.x1) / 2 : p.x, y: p.kind === "maid" ? 40 : p.y + p.h / 2,
      d: projectileHitData(p),
    });
  }

  for (const h of pending) {
    if (h.proj) {
      const p = h.proj;
      p.hits--;
      p.rehitTimer = p.rehit;
      // the maid's spout is one hit; rockets and missiles go off where they land
      if (p.kind === "maid" && p.mode === 2) p.hits = 0;
      if (p.kind === "rocket" || p.kind === "missile") s.shake = Math.max(s.shake, 5);
      if (p.kind === "maid" && p.mode === 1) emit(s, "sfx", "tray");
    } else {
      const A = s.fighters[h.ai];
      A.hitCount++;
      const mv = currentMove(A);
      A.rehitTimer = mv?.rehit ?? 0;
    }
    applyHit(s, h.ai, h.vi, h.d, h.x, h.y, !!h.proj);
  }
}

// ───────────────────────── full-screen cut-ins ─────────────────────────
// CINE_BAN: Claude's stamp lands — the screen becomes a suspension notice and the stamp comes down.
// CINE_ULTRA: ChatGPT's Ultra card, the Effort slider dragged to the end; the buff starts after it.
export const CINE_LEN: Record<number, number> = { [CINE_BAN]: 150, [CINE_ULTRA]: 120 };
export const BAN_STAMP_AT = 56;
const BAN_DAMAGE = 220;

function startCinematic(s: GameState, kind: number, ai: 0 | 1, vi: 0 | 1) {
  s.cineKind = kind;
  s.cineOwner = ai;
  s.cineT = CINE_LEN[kind];
  if (kind === CINE_BAN) {
    const B = s.fighters[vi];
    B.state = "hitstun";
    B.sf = 0;
    B.stun = 999;
    B.move = null;
    B.vx = 0;
    B.pushVx = 0;
    addFx(s, "burst", B.x, B.y + 60, 1, 24);
    emit(s, "sfx", "ban");
    s.shake = 6;
  }
}

function runCinematic(s: GameState) {
  s.cineT--;
  const t = CINE_LEN[s.cineKind] - s.cineT;
  const ai = s.cineOwner as 0 | 1;
  const vi = (1 - ai) as 0 | 1;
  const A = s.fighters[ai];
  const B = s.fighters[vi];
  if (s.cineKind === CINE_BAN) {
    if (t === BAN_STAMP_AT) {
      const dmg = Math.round(BAN_DAMAGE * damageMul(A, B));
      B.hp = Math.max(s.training ? 1 : 0, B.hp - dmg);
      B.combo++;
      B.comboDamage += dmg;
      emit(s, "sfx", "stamp");
      voice(s, vi, B.hp <= 0 ? "ko" : "hurtH");
      s.shake = Math.max(s.shake, 10);
    }
    if (s.cineT === 0) {
      const away = B.x >= A.x ? 1 : -1;
      B.state = "kd";
      B.sf = 0;
      B.vx = away * 3;
      B.vy = 6;
      B.y = Math.max(B.y, 0.01);
      B.facing = (-away) as 1 | -1;
      B.ban = BAN_LEN;
      B.banCd = 0;
      addFx(s, "burst", B.x, B.y + 60, (-away) as 1 | -1, 20);
      emit(s, "sfx", "hitH");
      s.freeze = 10;
    }
  } else if (s.cineKind === CINE_ULTRA && s.cineT === 0) {
    A.ultra = ULTRA_LEN;
    addFx(s, "aura", A.x, 50, A.facing, 40);
    say(s, ai, "Effort：Ultra", 70);
  }
  if (s.cineT === 0) {
    s.cineOwner = -1;
    s.cineKind = 0;
  }
}

// ───────────────────────── positioning ─────────────────────────

function resolvePositions(s: GameState) {
  const [a, b] = s.fighters;
  const solid = (f: Fighter) => !["thrown", "dead", "down", "dodge"].includes(f.state);
  const dx = b.x - a.x;
  const vertical = Math.abs(a.y - b.y) < 60 && a.y < 70 && b.y < 70;
  const minGap = bodyOf(a).bodyHalf + bodyOf(b).bodyHalf;
  if (solid(a) && solid(b) && vertical && Math.abs(dx) < minGap) {
    const dir = dx !== 0 ? Math.sign(dx) : a.facing;
    const push = (minGap - Math.abs(dx)) / 2;
    a.x -= dir * push;
    b.x += dir * push;
  }
  const sep = Math.abs(b.x - a.x);
  if (sep > MAX_SEP) {
    const excess = (sep - MAX_SEP) / 2;
    const dir = Math.sign(b.x - a.x);
    a.x += dir * excess;
    b.x -= dir * excess;
  }
  for (const f of s.fighters) f.x = Math.min(STAGE_W - WALL_PAD, Math.max(WALL_PAD, f.x));
  // after wall clamping, re-separate bodies so nobody is pushed into the wall
  const dx2 = b.x - a.x;
  if (solid(a) && solid(b) && vertical && Math.abs(dx2) < minGap) {
    const dir = dx2 !== 0 ? Math.sign(dx2) : a.facing;
    const need = minGap - Math.abs(dx2);
    if (a.x <= WALL_PAD + 0.01 || a.x >= STAGE_W - WALL_PAD - 0.01) b.x += dir * need;
    else if (b.x <= WALL_PAD + 0.01 || b.x >= STAGE_W - WALL_PAD - 0.01) a.x -= dir * need;
  }
  const mid = (a.x + b.x) / 2;
  s.camX = Math.min(STAGE_W - W, Math.max(0, mid - W / 2));
  for (const f of s.fighters) f.x = Math.min(s.camX + W - WALL_PAD, Math.max(s.camX + WALL_PAD, f.x));

  // auto-face the opponent when grounded and in control
  for (const [f, o] of [[a, b], [b, a]] as const) {
    if (f.y <= 0 && ["idle", "walkF", "walkB", "crouch", "land", "intro", "blockstun"].includes(f.state)) {
      if (o.x !== f.x) {
        const want = (o.x > f.x ? 1 : -1) as 1 | -1;
        if (want !== f.facing) {
          f.facing = want;
          if (f.state === "walkF") f.state = "walkB";
          else if (f.state === "walkB") f.state = "walkF";
        }
      }
    }
  }
}

// ───────────────────────── round flow ─────────────────────────

function hpRatio(f: Fighter) {
  return f.hp / CHARS[f.char].hp;
}

// each fighter's KO gag has its own sound (the screens themselves are drawn by the renderer)
const KO_SFX: Record<string, string> = { chatgpt: "glitch", claude: "glitch", deepseek: "busy", grok: "explode" };

function updatePhase(s: GameState) {
  s.phaseFrame++;
  const [a, b] = s.fighters;
  switch (s.phase) {
    case "intro":
      if (s.phaseFrame === 1) {
        const final = a.wins === ROUNDS_TO_WIN - 1 && b.wins === ROUNDS_TO_WIN - 1;
        emit(s, "announce", final ? "final" : s.round === 1 ? "round1" : s.round === 2 ? "round2" : "final");
      }
      if (s.round === 1 && s.phaseFrame === 6) voice(s, 0, "intro");
      if (s.round === 1 && s.phaseFrame === 40) voice(s, 1, "intro");
      if (s.phaseFrame === 72) emit(s, "announce", "fight");
      if (s.phaseFrame >= 92) {
        s.phase = "fight";
        s.phaseFrame = 0;
        for (const f of s.fighters) setState(f, "idle");
      }
      break;
    case "fight":
      if (!s.training && s.timer > 0) s.timer--;
      if (a.hp <= 0 || b.hp <= 0) {
        s.phase = "ko";
        s.phaseFrame = 0;
        s.roundWinner = a.hp <= 0 && b.hp <= 0 ? 2 : a.hp <= 0 ? 1 : 0;
        emit(s, "announce", "ko");
        emit(s, "sfx", "ko");
        emit(s, "sfx", "cheer");
        for (const f of s.fighters) {
          if (f.hp > 0) continue;
          const id = charId(f);
          emit(s, "sfx", KO_SFX[id] ?? "glitch");
          if (id === "grok") addFx(s, "explosion", f.x, 50, 1, 34);
          else addFx(s, "hearts", f.x, 70, 1, 40);
        }
      } else if (s.timer <= 0) {
        s.phase = "ko";
        s.phaseFrame = 0;
        s.timeOver = true;
        const ra = hpRatio(a), rb = hpRatio(b);
        s.roundWinner = ra === rb ? 2 : ra > rb ? 0 : 1;
        emit(s, "announce", "timeover");
      }
      break;
    case "ko": {
      const w = s.roundWinner;
      if (s.phaseFrame >= 100 && w !== -1) {
        const winners = w === 2 ? [] : [s.fighters[w]];
        const settled = s.fighters.every((f) => f.y <= 0 && !["attack", "kd", "hitstun", "blockstun", "air", "jumpSquat", "throwing", "thrown", "backdash", "dodge"].includes(f.state));
        if (settled && s.phaseFrame === 100) {
          for (const f of winners) {
            setState(f, "win");
            f.move = null;
            s.perfect = f.hp === CHARS[f.char].hp;
          }
          if (w !== 2) {
            voice(s, w as 0 | 1, "win");
            // a round lost to Grok: the loser's nameplate reads 「（已被收购）」 for the rest of the match
            if (charId(s.fighters[w]) === "grok") s.fighters[1 - w].acquired = true;
          }
          s.fighters.forEach((f, i) => {
            if (i !== w && f.state !== "dead") setState(f, "lose");
          });
          if (s.perfect) emit(s, "announce", "perfect");
        } else if (!settled && s.phaseFrame === 100) {
          s.phaseFrame = 99; // wait for everyone to land
        }
      }
      if (s.phaseFrame >= 220) {
        if (w === 0 || w === 2) a.wins++;
        if (w === 1 || w === 2) b.wins++;
        if (a.wins >= ROUNDS_TO_WIN || b.wins >= ROUNDS_TO_WIN) {
          s.phase = "matchEnd";
          s.phaseFrame = 0;
          s.matchWinner = a.wins >= ROUNDS_TO_WIN && b.wins >= ROUNDS_TO_WIN ? 2 : a.wins >= ROUNDS_TO_WIN ? 0 : 1;
          emit(s, "announce", s.matchWinner === 2 ? "draw" : s.matchWinner === 0 ? "p1wins" : "p2wins");
        } else {
          s.round++;
          resetRound(s);
        }
      }
      break;
    }
    case "matchEnd":
    case "roundEnd":
      break;
  }
}

// ───────────────────────── input ─────────────────────────

function readInput(f: Fighter, bits: number) {
  f.dir = relDir(bits, f.facing);
  f.hist.push(f.dir);
  if (f.hist.length > 34) f.hist.shift();
  const newly = bits & ~f.prevBits & BTN_MASK;
  for (let b = 0; b < 4; b++) if (newly & BTN_BITS[b]) f.buf[b] = BUFFER;
  f.prevBits = bits;
}

function decayBuffers(f: Fighter) {
  for (let b = 0; b < 4; b++) if (f.buf[b] > 0) f.buf[b]--;
}

// ───────────────────────── step ─────────────────────────

export function step(s: GameState, in0: number, in1: number) {
  s.events = [];
  s.frame++;
  const [a, b] = s.fighters;
  const controllable = s.phase === "fight" || (s.phase === "ko" && s.phaseFrame < 100);
  readInput(a, controllable ? in0 : 0);
  readInput(b, controllable ? in1 : 0);

  for (const fx of s.fx) fx.age++;
  s.fx = s.fx.filter((fx) => fx.age < fx.life);
  if (s.shake > 0) s.shake--;

  if (s.superFreeze > 0) {
    s.superFreeze--;
    return;
  }
  if (s.freeze > 0) {
    s.freeze--;
    return;
  }
  if (s.cineT > 0) {
    runCinematic(s);
    return;
  }

  updatePhase(s);
  // K.O. slow motion: simulate every other frame for a moment
  if (s.phase === "ko" && s.phaseFrame < 50 && s.phaseFrame % 2 === 1 && !s.timeOver) return;

  if (s.phase === "fight") {
    think(s, 0);
    think(s, 1);
  }

  updateFighter(s, 0);
  updateFighter(s, 1);

  for (const p of s.projectiles) updateProjectile(s, p);
  s.projectiles = s.projectiles.filter((p) =>
    p.kind === "maid" ? p.mode < 4 : p.hits > 0 && p.x > s.camX - 90 && p.x < s.camX + W + 90 && p.age < 400);

  resolvePositions(s);
  if (s.phase === "fight") resolveHits(s);
  s.projectiles = s.projectiles.filter((p) => p.hits > 0 || (p.kind === "maid" && p.mode < 4));

  if (s.training) {
    for (const f of s.fighters) {
      f.meter = METER_MAX;
      if (f.combo === 0 && ["idle", "crouch", "walkF", "walkB"].includes(f.state)) {
        f.hp = CHARS[f.char].hp;
        f.gpl = 0;
      }
    }
  }

  decayBuffers(a);
  decayBuffers(b);
}
