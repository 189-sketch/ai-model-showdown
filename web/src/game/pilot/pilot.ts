/**
 * A model playing one side. The runner asks `wants()` before every frame;
 * when a pilot needs a decision the world stays frozen until `decide()`
 * resolves, so model latency never costs game time. Between decisions
 * `input()` plays the plan back one frame at a time.
 */

import { CHARS } from "../chars";
import type { FState, GameState } from "../types";
import { toBits, type Intent } from "../ai";
import { bridge, type ArenaModel } from "./bridge";
import { INTERRUPTIBLE, compile, conditionMet, describe, parsePlan, type Reaction, type Step } from "./plan";
import { observation, systemPrompt, type Recap } from "./prompt";

const FREE: FState[] = ["idle", "walkF", "walkB", "crouch", "run"];
const HURT: FState[] = ["hitstun", "kd", "down", "getup", "thrown", "dead"];
const STALL = 120; // frames a step may wait for the fighter to become free before it is dropped
// when the model can't be reached or answers nonsense: crouch-block for half a second
const FALLBACK: Step[] = [{ do: "block", height: "low", frames: 30 }];

export interface PilotLog {
  at: number; // game frame
  say: string;
  plan: string;
  ms: number;
  error?: string;
}

export class Pilot {
  readonly model: ArenaModel;
  readonly side: 0 | 1;
  // decision lifecycle
  pending = false;
  thinkingSince = 0;
  decisions = 0;
  errors = 0;
  failStreak = 0; // failed decisions in a row (the arena stops to ask after a few)
  totalMs = 0;
  log: PilotLog[] = [];
  // plan playback
  private steps: Step[] = [];
  private reactions: Reaction[] = [];
  private armed: boolean[] = []; // reactions fire when their condition turns true, not while it stays true
  private seq: Intent[] = [];
  private seqStep: Step | null = null;
  private stall = 0;
  private holdDir = 5;
  private lastDir = 5;
  private planEnd = "was completed";
  // recap since the last decision
  private hp0 = [0, 0];
  private frame0 = 0;
  private oppMoves: string[] = [];
  private lastOppMove: string | null = null;
  private fresh = true; // no recap at the start of a round
  private system = "";
  private systemFor = "";

  constructor(model: ArenaModel, side: 0 | 1) {
    this.model = model;
    this.side = side;
  }

  get busy() {
    return this.steps.length > 0 || this.seq.length > 0;
  }

  /** New round (or not fighting): forget the plan. */
  reset() {
    this.steps = [];
    this.reactions = [];
    this.armed = [];
    this.seq = [];
    this.seqStep = null;
    this.holdDir = 5;
    this.lastDir = 5;
    this.planEnd = "was completed";
    this.oppMoves = [];
    this.lastOppMove = null;
    this.fresh = true;
  }

  /** Does this pilot need a new decision before the next frame? */
  wants(s: GameState): boolean {
    if (this.pending || s.phase !== "fight" || this.busy) return false;
    const f = s.fighters[this.side];
    return FREE.includes(f.state) || f.state === "air";
  }

  async decide(s: GameState) {
    const me = this.side;
    const f = s.fighters[me];
    const o = s.fighters[1 - me];
    const key = `${f.char}/${o.char}/${s.equal}`;
    if (this.systemFor !== key) {
      this.system = systemPrompt(CHARS[f.char], CHARS[o.char], s.equal);
      this.systemFor = key;
    }
    const recap: Recap | null = !this.fresh
      ? {
          seconds: (s.frame - this.frame0) / 60,
          dealt: Math.max(0, Math.round(this.hp0[1] - o.hp)),
          taken: Math.max(0, Math.round(this.hp0[0] - f.hp)),
          oppMoves: this.oppMoves.slice(-8),
          planEnd: this.planEnd,
        }
      : null;
    const prompt = observation(s, me, recap);
    this.hp0 = [f.hp, o.hp];
    this.frame0 = s.frame;
    this.oppMoves = [];
    this.fresh = false;

    this.pending = true;
    this.thinkingSince = performance.now();
    let entry: PilotLog;
    try {
      const r = await bridge.decide(this.model.id, this.system, prompt);
      const plan = r.ok && r.text ? parsePlan(r.text) : null;
      if (!plan) throw Object.assign(new Error(r.error ?? `the reply had no valid plan JSON: …${(r.text ?? "").trim().slice(-160)}`), { ms: r.ms });
      this.failStreak = 0;
      this.steps = plan.steps;
      this.reactions = plan.reactions;
      this.armed = plan.reactions.map((r) => !conditionMet(r.if, s, me));
      this.totalMs += r.ms;
      entry = { at: s.frame, say: plan.say, plan: plan.steps.map(describe).join(" · "), ms: r.ms };
    } catch (e) {
      this.errors++;
      this.failStreak++;
      this.steps = [...FALLBACK];
      this.reactions = [];
      const ms = (e as { ms?: number }).ms ?? Math.round(performance.now() - this.thinkingSince);
      this.totalMs += ms;
      entry = { at: s.frame, say: "", plan: "", ms, error: (e as Error).message };
    }
    this.decisions++;
    this.planEnd = "was completed";
    this.log.push(entry);
    if (this.log.length > 60) this.log.shift();
    this.pending = false;
  }

  /** This frame's input byte. Only called on frames that are actually simulated. */
  input(s: GameState): number {
    const me = this.side;
    const f = s.fighters[me];
    const o = s.fighters[1 - me];
    if (s.phase !== "fight") {
      this.reset();
      return 0;
    }

    if (o.state === "attack" && o.move && o.move !== this.lastOppMove) this.oppMoves.push(o.move);
    this.lastOppMove = o.state === "attack" ? o.move : null;

    // got hit: the rest of the plan no longer makes sense
    if (HURT.includes(f.state)) {
      if (this.busy) {
        this.planEnd = "was interrupted when you got hit";
        this.steps = [];
        this.seq = [];
        this.seqStep = null;
      }
      return 0;
    }

    // hitstop, super flash or cut-in: the sim ignores movement, so pause the plan and keep holding
    if (s.freeze > 0 || s.superFreeze > 0 || s.cineT > 0) return toBits({ dir: this.lastDir, btn: 0 }, f.facing);

    // standing reactions cut into walking / blocking / waiting
    const free = FREE.includes(f.state);
    const cuttable = !this.seq.length || (this.seqStep && INTERRUPTIBLE.has(this.seqStep.do));
    let fire: Reaction | null = null;
    this.reactions.forEach((r, i) => {
      const met = conditionMet(r.if, s, me);
      if (met && this.armed[i] && free && cuttable && !fire) {
        fire = r;
        this.armed[i] = false;
      } else if (!met) this.armed[i] = true;
    });
    if (fire) this.start((fire as Reaction).do, f.char);

    if (this.seq.length) return this.bits(this.seq.shift()!, f.facing);
    this.seqStep = null;

    const next = this.steps[0];
    if (!next) return f.state === "blockstun" ? this.bits({ dir: this.holdDir, btn: 0 }, f.facing) : 0;

    if ("cancel" in next && next.cancel) {
      // hit-confirm: only cancel out of an attack that connected
      if (f.state === "attack" && f.hitCount > 0) return this.go(f.char, f.facing);
      if (f.state === "attack" && ++this.stall < STALL) return 0;
      // the attack missed or is over: skip this and any further cancels
      while (this.steps[0] && "cancel" in this.steps[0] && this.steps[0].cancel) this.steps.shift();
      this.stall = 0;
      return 0;
    }

    const ready =
      next.do === "normal" && next.move.startsWith("j") ? f.state === "air" && !f.airAttackUsed : next.do === "wait" || FREE.includes(f.state);
    if (ready) return this.go(f.char, f.facing);
    if (++this.stall > STALL) {
      this.steps.shift();
      this.stall = 0;
    }
    return f.state === "blockstun" ? this.bits({ dir: this.holdDir, btn: 0 }, f.facing) : 0;
  }

  private go(char: number, facing: number) {
    this.start(this.steps.shift()!, char);
    this.stall = 0;
    return this.seq.length ? this.bits(this.seq.shift()!, facing) : 0;
  }

  private start(step: Step, char: number) {
    this.seq = compile(step, char);
    this.seqStep = step;
  }

  private bits(it: Intent, facing: number) {
    this.lastDir = it.dir;
    if (it.dir === 4 || it.dir === 1) this.holdDir = it.dir;
    else if (it.dir !== 5) this.holdDir = 5;
    return toBits(it, facing);
  }

  get stats() {
    const ok = this.decisions - this.errors;
    return { decisions: this.decisions, errors: this.errors, avgMs: this.decisions ? Math.round(this.totalMs / this.decisions) : 0, ok };
  }
}
