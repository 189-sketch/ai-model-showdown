/**
 * The action language a model pilot answers in: a short plan of steps plus
 * standing reactions. Parsing is forgiving about the reply's wrapping (prose,
 * code fences) but strict about the steps themselves. Anything unknown is dropped.
 */

import { CHARS, findMove } from "../chars";
import { IN_HK, IN_HP, IN_LK, IN_LP } from "../constants";
import type { Fighter, GameState } from "../types";
import { MOTION_DIRS, motion, type Intent } from "../ai";

export type Dir = "forward" | "back";

export type Step =
  | { do: "walk"; dir: Dir; frames: number }
  | { do: "dash"; dir: Dir; frames: number }
  | { do: "block"; height: "high" | "low"; frames: number }
  | { do: "crouch"; frames: number }
  | { do: "wait"; frames: number }
  | { do: "jump"; dir: "up" | Dir }
  | { do: "normal"; move: string; cancel?: boolean }
  | { do: "special"; slot: number; strength: "light" | "heavy"; cancel?: boolean }
  | { do: "super"; cancel?: boolean }
  | { do: "throw"; dir: Dir }
  | { do: "dodge"; dir: Dir }
  | { do: "detonate" };

export interface Reaction {
  if: string;
  do: Step;
}

export interface Plan {
  say: string;
  steps: Step[];
  reactions: Reaction[];
}

const NORMALS = new Set(["stLP", "stHP", "stLK", "stHK", "crLP", "crHP", "crLK", "crHK", "jLP", "jHP", "jLK", "jHK"]);
const MAX_STEPS = 8;
const MAX_REACTIONS = 4;

// ───────────────────────── conditions ─────────────────────────

interface Ctx {
  f: Fighter;
  o: Fighter;
  s: GameState;
  me: 0 | 1;
  dist: number;
}

function oppAttack(c: Ctx) {
  const { o } = c;
  if (o.state !== "attack" || !o.move) return null;
  const mv = findMove(o.char, o.move);
  if (!mv || o.sf >= mv.startup + mv.active) return null;
  return mv;
}

export const CONDITIONS: { id: string; desc: string; test: (c: Ctx) => boolean }[] = [
  {
    id: "opponent_attacks",
    desc: "the opponent starts any ground attack within 130 px",
    test: (c) => !!oppAttack(c) && c.o.y === 0 && c.dist < 130,
  },
  {
    id: "opponent_attacks_low",
    desc: "the opponent starts a low attack within 130 px",
    test: (c) => oppAttack(c)?.level === "low" && c.dist < 130,
  },
  {
    id: "opponent_attacks_high",
    desc: "the opponent starts an overhead or an air attack within 130 px",
    test: (c) => {
      const mv = oppAttack(c);
      return !!mv && (mv.level === "overhead" || c.o.y > 0) && c.dist < 130;
    },
  },
  {
    id: "opponent_jumps_in",
    desc: "the opponent is airborne, moving toward you, within 140 px",
    test: (c) => c.o.y > 15 && c.dist < 140 && Math.sign(c.o.vx || c.o.jumpVx) === Math.sign(c.f.x - c.o.x),
  },
  {
    id: "projectile_incoming",
    desc: "an opponent projectile is flying at you within 150 px",
    test: (c) =>
      c.s.projectiles.some((p) => p.owner !== c.me && p.kind !== "artifact" && Math.abs(p.x - c.f.x) < 150 && (p.kind === "maid" || Math.sign(p.vx) === Math.sign(c.f.x - p.x))),
  },
  {
    id: "opponent_whiffed",
    desc: "the opponent is recovering from an attack that missed, within 110 px (a punish window)",
    test: (c) => {
      const { o } = c;
      if (o.state !== "attack" || !o.move || o.hitCount > 0) return false;
      const mv = findMove(o.char, o.move);
      return !!mv && o.sf >= mv.startup + mv.active && c.dist < 110;
    },
  },
  {
    id: "opponent_close",
    desc: "the opponent is within 55 px (throw range)",
    test: (c) => c.dist < 55,
  },
  {
    id: "opponent_far",
    desc: "the opponent is more than 220 px away",
    test: (c) => c.dist > 220,
  },
];

export function conditionMet(id: string, s: GameState, me: 0 | 1) {
  const f = s.fighters[me];
  const o = s.fighters[1 - me];
  const cond = CONDITIONS.find((c) => c.id === id);
  return !!cond && cond.test({ f, o, s, me, dist: Math.abs(o.x - f.x) });
}

// ───────────────────────── parsing ─────────────────────────

/** First balanced {...} in the text that parses as JSON (fenced blocks first). */
export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const src of [...fenced, text]) {
    for (let start = src.indexOf("{"); start >= 0; start = src.indexOf("{", start + 1)) {
      let depth = 0;
      let str = false;
      for (let i = start; i < src.length; i++) {
        const ch = src[i];
        if (str) {
          if (ch === "\\") i++;
          else if (ch === '"') str = false;
        } else if (ch === '"') str = true;
        else if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) {
          try {
            return JSON.parse(src.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

const frames = (v: unknown, def = 15) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.min(60, Math.round(n))) : def;
};
const dir = (v: unknown): Dir => (v === "back" || v === "backward" ? "back" : "forward");

export function parseStep(raw: unknown): Step | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cancel = r.cancel === true;
  switch (r.do) {
    case "walk":
      return { do: "walk", dir: dir(r.dir), frames: frames(r.frames) };
    case "dash":
      return { do: "dash", dir: dir(r.dir), frames: frames(r.frames, 20) };
    case "block":
      return { do: "block", height: r.height === "low" ? "low" : "high", frames: frames(r.frames) };
    case "crouch":
      return { do: "crouch", frames: frames(r.frames) };
    case "wait":
      return { do: "wait", frames: frames(r.frames) };
    case "jump":
      return { do: "jump", dir: r.dir === "up" ? "up" : dir(r.dir) };
    case "normal":
      return typeof r.move === "string" && NORMALS.has(r.move) ? { do: "normal", move: r.move, cancel } : null;
    case "special": {
      const slot = Number(r.slot);
      if (![1, 2, 3].includes(slot)) return null;
      return { do: "special", slot, strength: r.strength === "heavy" ? "heavy" : "light", cancel };
    }
    case "super":
      return { do: "super", cancel };
    case "throw":
      return { do: "throw", dir: dir(r.dir) };
    case "dodge":
      return { do: "dodge", dir: dir(r.dir) };
    case "detonate":
      return { do: "detonate" };
  }
  return null;
}

export function parsePlan(text: string): Plan | null {
  const j = extractJson(text) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return null;
  const steps = (Array.isArray(j.plan) ? j.plan : []).map(parseStep).filter((x): x is Step => !!x).slice(0, MAX_STEPS);
  const reactions = (Array.isArray(j.reactions) ? j.reactions : [])
    .map((r: unknown) => {
      const o = r as Record<string, unknown> | null;
      const step = parseStep(o?.do);
      return o && typeof o.if === "string" && CONDITIONS.some((c) => c.id === o.if) && step ? { if: o.if, do: step } : null;
    })
    .filter((x): x is Reaction => !!x)
    .slice(0, MAX_REACTIONS);
  if (!steps.length && !reactions.length) return null;
  const say = typeof j.say === "string" ? j.say.slice(0, 40) : "";
  return { say, steps, reactions };
}

// ───────────────────────── compiling steps to inputs ─────────────────────────

const hold = (d: number, n: number): Intent[] => Array.from({ length: n }, () => ({ dir: d, btn: 0 }));
const tap = (d: number, btn: number): Intent[] => [{ dir: d, btn }, { dir: d, btn: 0 }];

/** Frame-by-frame relative inputs (numpad directions, 6 = toward the opponent) for one step. */
export function compile(step: Step, char: number): Intent[] {
  switch (step.do) {
    case "walk":
      return hold(step.dir === "forward" ? 6 : 4, step.frames);
    case "dash":
      return step.dir === "forward" ? [{ dir: 6, btn: 0 }, { dir: 5, btn: 0 }, ...hold(6, step.frames)] : [{ dir: 4, btn: 0 }, { dir: 5, btn: 0 }, { dir: 4, btn: 0 }, ...hold(5, 2)];
    case "block":
      return hold(step.height === "low" ? 1 : 4, step.frames);
    case "crouch":
      return hold(2, step.frames);
    case "wait":
      return hold(5, step.frames);
    case "jump":
      return [...hold(step.dir === "up" ? 8 : step.dir === "forward" ? 9 : 7, 2), ...hold(5, 3)];
    case "normal": {
      const btn = { LP: IN_LP, HP: IN_HP, LK: IN_LK, HK: IN_HK }[step.move.slice(-2)] ?? IN_LP;
      return tap(step.move.startsWith("cr") ? 2 : 5, btn);
    }
    case "special": {
      const sp = CHARS[char].specials[step.slot - 1];
      if (!sp) return [];
      const heavy = step.strength === "heavy";
      const btn = sp.btn === "P" ? (heavy ? IN_HP : IN_LP) : heavy ? IN_HK : IN_LK;
      return motion(MOTION_DIRS[sp.motion], btn);
    }
    case "super":
      return tap(5, IN_HP | IN_HK);
    case "throw":
      return tap(step.dir === "forward" ? 6 : 4, IN_HP);
    case "dodge":
      return tap(step.dir === "forward" ? 6 : 4, IN_LP | IN_LK);
    case "detonate":
      return tap(5, IN_LP);
  }
}

/** Steps the reactions are allowed to cut short. */
export const INTERRUPTIBLE = new Set<Step["do"]>(["walk", "block", "crouch", "wait"]);

export function describe(step: Step): string {
  switch (step.do) {
    case "walk":
    case "dash":
    case "dodge":
    case "throw":
      return `${step.do} ${step.dir}`;
    case "block":
      return `block ${step.height}`;
    case "jump":
      return `jump ${step.dir}`;
    case "normal":
      return (step.cancel ? "→" : "") + step.move;
    case "special":
      return `${step.cancel ? "→" : ""}SP${step.slot}${step.strength === "heavy" ? "H" : "L"}`;
    case "super":
      return `${step.cancel ? "→" : ""}SUPER`;
    default:
      return step.do;
  }
}
