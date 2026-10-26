/**
 * CPU opponent. Runs only locally (single player / training), so it may use
 * Math.random. It produces the same input byte a human would.
 */

import { IN_D, IN_HK, IN_HP, IN_L, IN_LK, IN_LP, IN_R, IN_U } from "./constants";
import { CHARS, findMove, type SpecialDef } from "./chars";
import type { GameState } from "./types";

interface Intent {
  dir: number; // relative numpad direction
  btn: number;
}

export interface Cpu {
  level: 1 | 2 | 3;
  queue: Intent[];
  hold: Intent | null;
  holdFrames: number;
  wait: number;
}

export function createCpu(level: 1 | 2 | 3): Cpu {
  return { level, queue: [], hold: null, holdFrames: 0, wait: 30 };
}

const REACT = { 1: 20, 2: 11, 3: 5 };
const BLOCK = { 1: 0.25, 2: 0.6, 3: 0.88 };
const ANTI_AIR = { 1: 0.12, 2: 0.4, 3: 0.75 };
const COMBO = { 1: 0.1, 2: 0.45, 3: 0.85 };
const DODGE = { 1: 0.02, 2: 0.06, 3: 0.12 };

function toBits(it: Intent, facing: number) {
  let b = it.btn;
  const fwd = facing > 0 ? IN_R : IN_L;
  const back = facing > 0 ? IN_L : IN_R;
  if ([7, 8, 9].includes(it.dir)) b |= IN_U;
  if ([1, 2, 3].includes(it.dir)) b |= IN_D;
  if ([3, 6, 9].includes(it.dir)) b |= fwd;
  if ([1, 4, 7].includes(it.dir)) b |= back;
  return b;
}

function motion(dirs: number[], btn: number): Intent[] {
  const out: Intent[] = [];
  for (const d of dirs) out.push({ dir: d, btn: 0 }, { dir: d, btn: 0 });
  out.push({ dir: dirs[dirs.length - 1], btn });
  out.push({ dir: 5, btn: 0 });
  return out;
}

const MOTION_DIRS: Record<SpecialDef["motion"], number[]> = {
  "236": [2, 3, 6],
  "214": [2, 1, 4],
};

function special(sp: SpecialDef | undefined, heavy: boolean): Intent[] | null {
  if (!sp) return null;
  const btn = sp.btn === "P" ? (heavy ? IN_HP : IN_LP) : heavy ? IN_HK : IN_LK;
  return motion(MOTION_DIRS[sp.motion], btn);
}

const SUPER: Intent[] = [{ dir: 5, btn: IN_HP | IN_HK }, { dir: 5, btn: 0 }];
const dodge = (dir: number): Intent[] => [{ dir, btn: IN_LP | IN_LK }, { dir, btn: 0 }];

/** What this character's specials are good for. */
function kit(char: number) {
  const sp = CHARS[char].specials;
  return {
    zoner: sp.find((x) => x.role === "zoner"),
    antiAir: sp.find((x) => x.role === "antiAir"),
    counter: sp.find((x) => x.role === "counter"),
    rush: sp.find((x) => x.role === "rush"),
    other: sp.find((x) => x.role === "summon" || x.role === "trap"),
    any: sp,
  };
}

export function cpuInput(s: GameState, me: 0 | 1, cpu: Cpu): number {
  const f = s.fighters[me];
  const o = s.fighters[1 - me];
  const k = kit(f.char);
  const r = Math.random;
  const L = cpu.level;
  const sid = CHARS[f.char].id;

  if (s.phase !== "fight") {
    cpu.queue = [];
    cpu.hold = null;
    return 0;
  }
  if (cpu.queue.length) return toBits(cpu.queue.shift()!, f.facing);

  const dist = Math.abs(o.x - f.x);
  const towardMe = Math.sign(f.x - o.x);
  const oMove = o.state === "attack" && o.move ? findMove(o.char, o.move) : null;
  const incoming = s.projectiles.find((p) =>
    p.owner !== me && (p.kind === "maid" ? Math.abs(p.x - f.x) < 100 : p.kind !== "artifact" && Math.sign(p.vx || towardMe) === towardMe && Math.abs(p.x - f.x) < 150));
  const banned = f.ban > 0;
  const noSpecials = banned || f.muscle > 0 || f.busy > 0;
  const queue = (it: Intent[] | null) => {
    if (!it?.length) return 0;
    cpu.queue = [...it]; // shared sequences (SUPER) must not be consumed
    return toBits(cpu.queue.shift()!, f.facing);
  };

  // Grok: blow the rocket up as it reaches the opponent
  if (sid === "grok") {
    const rocket = s.projectiles.find((p) => p.owner === me && p.kind === "rocket" && p.age > 8);
    if (rocket && Math.abs(rocket.x - o.x) < 34 && Math.abs(rocket.y - o.y - 40) < 50 && r() < 0.3 * L) return queue([{ dir: 5, btn: IN_LP }, { dir: 5, btn: 0 }]);
  }

  // react to threats every frame (blocking is about reflexes)
  const threat = (oMove && dist < 110 && !oMove.air) || incoming || (o.y > 0 && dist < 90 && o.state === "attack");
  if (threat) {
    // Claude reflects projectiles; ChatGPT catches jump-ins and punches
    if (!noSpecials && k.counter && r() < BLOCK[L] / 10) {
      if (sid === "claude" && incoming && incoming.kind !== "maid" && Math.abs(incoming.x - f.x) < 70) return queue(special(k.counter, false));
      if (sid === "chatgpt" && oMove && dist < 70 && oMove.kind === "normal") return queue(special(k.counter, false));
    }
    if (r() < DODGE[L] / 3 && (oMove?.unblockable || oMove?.kind === "super")) return queue(dodge(r() < 0.5 ? 6 : 4));
    if (cpu.hold && cpu.hold.dir <= 4 && cpu.holdFrames > 0) {
      cpu.holdFrames--;
      return toBits(cpu.hold, f.facing);
    }
    if (r() < BLOCK[L] / 6) {
      const low = (oMove && oMove.level === "low") || incoming?.level === "low";
      const high = (oMove && oMove.level === "overhead") || o.y > 0;
      cpu.hold = { dir: low ? 1 : high ? 4 : r() < 0.5 ? 1 : 4, btn: 0 };
      cpu.holdFrames = 14;
      return toBits(cpu.hold, f.facing);
    }
  }

  // anti-air
  if (o.y > 20 && o.vy < 2 && dist < 110 && Math.sign(o.vx) === towardMe && f.state !== "attack" && r() < ANTI_AIR[L] / 4) {
    if (!noSpecials && k.antiAir) return queue(special(k.antiAir, true));
    if (!noSpecials && sid === "chatgpt" && k.counter) return queue(special(k.counter, true));
    return queue([{ dir: 2, btn: 0 }, { dir: 2, btn: IN_HP }]);
  }

  // confirm a connected normal into a special (or the super)
  if (f.state === "attack" && f.hitCount > 0 && f.move && /^(st|cr)/.test(f.move) && r() < COMBO[L] / 3) {
    if (f.meter >= 1000 && !noSpecials && r() < 0.3) return queue(SUPER);
    if (!noSpecials) return queue(special(k.rush ?? k.zoner, r() < 0.5));
  }

  if (cpu.hold && cpu.holdFrames > 0) {
    cpu.holdFrames--;
    return toBits(cpu.hold, f.facing);
  }
  cpu.hold = null;

  if (cpu.wait > 0) {
    cpu.wait--;
    return 0;
  }
  cpu.wait = REACT[L] + Math.floor(r() * REACT[L]);

  const hold = (dir: number, frames: number) => {
    cpu.hold = { dir, btn: 0 };
    cpu.holdFrames = frames;
    return toBits(cpu.hold, f.facing);
  };
  const press = (dir: number, btn: number) => queue([{ dir, btn }, { dir, btn: 0 }]);

  // banned: only move, jump and dodge until the ban lifts
  if (banned) {
    const x = r();
    if (x < 0.15) return queue(dodge(4));
    if (x < 0.4) return hold(4, 16);
    if (x < 0.55) return hold(7, 6);
    return hold(1, 14);
  }

  // super when it would connect (the Ultra and 梁圣 are buffs: just use them)
  const buff = sid === "chatgpt" || sid === "deepseek";
  const superRange = sid === "claude" ? 70 : sid === "grok" ? 260 : 9999;
  if (!noSpecials && f.meter >= 1000 && f.ultra <= 0 && dist < superRange && r() < 0.04 * L * (buff ? 1.5 : 1)) return queue(SUPER);

  const zoning = s.projectiles.some((p) => p.owner === me && p.kind !== "artifact" && p.kind !== "maid");
  if (dist > 210) {
    if (!noSpecials && k.zoner && r() < 0.25 + 0.1 * L && !zoning) return queue(special(k.zoner, r() < 0.5));
    if (!noSpecials && k.other && r() < 0.12) return queue(special(k.other, r() < 0.5));
    return hold(6, 20);
  }
  if (dist > 110) {
    const x = r();
    if (x < 0.12 * L) return hold(9, 6);
    if (x < 0.35 && !zoning && !noSpecials) return queue(special(k.zoner ?? k.any[Math.floor(r() * k.any.length)], false));
    if (x < 0.45 && !noSpecials && k.other) return queue(special(k.other, r() < 0.5));
    if (x < 0.5 && !noSpecials && sid === "grok") return queue(special(k.antiAir, r() < 0.5)); // Roadster hop in
    return hold(6, 14);
  }
  if (dist > 58) {
    const x = r();
    if (x < 0.25) return press(5, IN_LK);
    if (x < 0.42) return press(3, IN_LK);
    if (x < 0.55) return press(5, IN_HK);
    if (x < 0.65) return press(3, IN_HK);
    if (x < 0.72 && L > 1) return hold(9, 6);
    if (x < 0.78 && !noSpecials && k.rush) return queue(special(k.rush, r() < 0.5));
    return hold(6, 10);
  }
  const x = r();
  if (x < 0.14 * L) return press(6, IN_HP); // throw attempt
  if (x < 0.45) {
    return queue([
      { dir: 3, btn: IN_LK }, { dir: 3, btn: 0 }, { dir: 3, btn: 0 }, { dir: 3, btn: 0 },
      { dir: 3, btn: 0 }, { dir: 3, btn: 0 }, { dir: 3, btn: IN_LK }, { dir: 3, btn: 0 },
    ]);
  }
  if (x < 0.6) return press(5, IN_LP);
  if (x < 0.7) return press(5, IN_HP);
  if (x < 0.74) return queue(dodge(4));
  if (x < 0.8) return hold(4, 14);
  return hold(1, 16);
}

/** Training dummy: stands still, or blocks everything when `block` is on. */
export function dummyInput(s: GameState, me: 0 | 1, mode: "stand" | "crouch" | "block" | "jump"): number {
  const f = s.fighters[me];
  const o = s.fighters[1 - me];
  const awayBit = o.x < f.x ? IN_R : IN_L;
  if (mode === "crouch") return IN_D;
  if (mode === "jump") return IN_U;
  if (mode === "block") {
    const mv = o.state === "attack" && o.move ? findMove(o.char, o.move) : null;
    const proj = s.projectiles.find((p) => p.owner !== me);
    if (mv?.level === "low" || proj?.level === "low") return awayBit | IN_D;
    if (mv?.level === "overhead" || o.y > 0) return awayBit;
    return awayBit | IN_D;
  }
  return 0;
}
