/**
 * A model playing one side. The runner asks `wants()` before every frame and
 * starts `decide()` when it says yes; `input()` plays the plan back one frame
 * at a time.
 *
 * Real time (the default): the fight never stops. Each model thinks in
 * parallel and is asked for its next plan early (when what is left of the
 * current one is about as long as it usually takes to answer), and a new plan
 * takes over the moment it arrives. While a model thinks, its standing
 * reactions still work; otherwise its fighter stands still.
 *
 * Turn-based: the runner freezes the world while any model thinks, so latency
 * costs nothing and only decision quality counts.
 */

import { CHARS, type NormalId } from "../chars";
import { totalFrames } from "../sim";
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
const FIRST_GUESS_MS = 3000; // expected answer time before a model has answered at all
const MAX_LEAD_MS = 20000; // never ask for the next plan more than this far ahead

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
  readonly realtime: boolean;
  // decision lifecycle
  pending = false;
  thinkingSince = 0;
  decisions = 0;
  errors = 0;
  failStreak = 0; // failed decisions in a row (the arena stops to ask after a few)
  totalMs = 0;
  okMs = 0; // answer time of successful decisions, for asking early enough
  lastMs = 0;
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
  private hurt = false;
  private hitAt = -1; // frame the fighter last got hit: plans based on an earlier snapshot are stale
  private planEnd = "was completed";
  // recap since the last decision
  private hp0 = [0, 0];
  private frame0 = 0;
  private oppMoves: string[] = [];
  private lastOppMove: string | null = null;
  private fresh = true; // no recap at the start of a round
  private system = "";
  private systemFor = "";

  constructor(model: ArenaModel, side: 0 | 1, realtime = true) {
    this.model = model;
    this.side = side;
    this.realtime = realtime;
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
    this.hurt = false;
    this.hitAt = -1;
    this.planEnd = "was completed";
    this.oppMoves = [];
    this.lastOppMove = null;
    this.fresh = true;
  }

  /** Does this pilot need a new decision before the next frame? */
  wants(s: GameState): boolean {
    if (this.pending || s.phase !== "fight") return false;
    const f = s.fighters[this.side];
    // turn-based: ask once the plan is used up and the fighter can act on the answer
    if (!this.realtime) return !this.busy && (FREE.includes(f.state) || f.state === "air");
    // real time: ask early enough that the answer lands about when the current plan runs out
    // (knocked down counts too: thinking overlaps the time on the floor)
    if (f.state === "dead") return false;
    return !this.busy || this.remaining(f.char) <= this.leadFrames();
  }

  /** How far ahead (frames) to ask: this model's usual answer time. */
  private leadFrames() {
    const ok = this.decisions - this.errors;
    const ms = ok > 0 ? this.okMs / ok : FIRST_GUESS_MS;
    return (Math.min(ms, MAX_LEAD_MS) / 1000) * 60;
  }

  /** Rough frames of plan left to play. */
  private remaining(char: number): number {
    const c = CHARS[char];
    let n = this.seq.length;
    for (const st of this.steps) {
      if ("frames" in st) n += st.frames;
      else if (st.do === "normal") n += totalFrames(c.normals[st.move as NormalId]);
      else if (st.do === "special") {
        const sp = c.specials[st.slot - 1];
        n += sp ? totalFrames(st.strength === "heavy" ? sp.heavy : sp.light) : 0;
      } else if (st.do === "super") n += totalFrames(c.superMove);
      else n += 30; // jump, throw, dodge
    }
    return n;
  }

  async decide(s: GameState) {
    const me = this.side;
    const f = s.fighters[me];
    const o = s.fighters[1 - me];
    const key = `${f.char}/${o.char}/${s.equal}/${this.realtime}`;
    if (this.systemFor !== key) {
      this.system = systemPrompt(CHARS[f.char], CHARS[o.char], s.equal, this.realtime);
      this.systemFor = key;
    }
    const recap: Recap | null = !this.fresh
      ? {
          seconds: (s.frame - this.frame0) / 60,
          dealt: Math.max(0, Math.round(this.hp0[1] - o.hp)),
          taken: Math.max(0, Math.round(this.hp0[0] - f.hp)),
          oppMoves: this.oppMoves.slice(-8),
          planEnd: this.busy ? `is still running (${this.steps.length} steps left); your new plan replaces those steps` : this.planEnd,
          thinkSeconds: this.realtime && this.lastMs ? this.lastMs / 1000 : undefined,
        }
      : null;
    const prompt = observation(s, me, recap);
    this.hp0 = [f.hp, o.hp];
    this.frame0 = s.frame;
    this.oppMoves = [];
    this.fresh = false;

    this.pending = true;
    this.thinkingSince = performance.now();
    const round = s.round;
    const askedAt = s.frame;
    let entry: PilotLog;
    try {
      const r = await bridge.decide(this.model.id, this.system, prompt);
      // real time: the round may have ended while it was thinking (`s` is the live state)
      if (s.round !== round || s.phase !== "fight") {
        this.pending = false;
        return;
      }
      const plan = r.ok && r.text ? parsePlan(r.text) : null;
      if (!plan) throw Object.assign(new Error(r.error ?? `the reply had no valid plan JSON: …${(r.text ?? "").trim().slice(-160)}`), { ms: r.ms });
      this.failStreak = 0;
      this.totalMs += r.ms;
      this.okMs += r.ms;
      this.lastMs = r.ms;
      const summary = plan.steps.map(describe).join(" · ");
      if (this.hitAt > askedAt) {
        // real time: it got hit after the snapshot this plan was made from; ask again instead
        this.planEnd = "was dropped: you got hit before it arrived";
        entry = { at: s.frame, say: plan.say, plan: `✗ ${summary}`, ms: r.ms };
      } else {
        // the new plan takes over after the step being played right now
        this.steps = plan.steps;
        this.reactions = plan.reactions;
        this.armed = plan.reactions.map((r) => !conditionMet(r.if, s, me));
        this.planEnd = "was completed";
        entry = { at: s.frame, say: plan.say, plan: summary, ms: r.ms };
      }
    } catch (e) {
      if (s.round !== round || s.phase !== "fight") {
        this.pending = false;
        return;
      }
      this.errors++;
      this.failStreak++;
      // keep playing whatever is left of the last plan; with nothing left, crouch-block
      if (!this.busy) {
        this.steps = [...FALLBACK];
        this.reactions = [];
      }
      const ms = (e as { ms?: number }).ms ?? Math.round(performance.now() - this.thinkingSince);
      this.totalMs += ms;
      this.lastMs = ms;
      entry = { at: s.frame, say: "", plan: "", ms, error: (e as Error).message };
    }
    this.decisions++;
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

    // got hit: the rest of the plan no longer makes sense (a plan asked for after the hit,
    // e.g. while knocked down, is kept: it was made knowing about it)
    if (HURT.includes(f.state)) {
      if (!this.hurt) {
        this.hitAt = s.frame;
        if (this.busy) {
          this.planEnd = "was interrupted when you got hit";
          this.steps = [];
          this.seq = [];
          this.seqStep = null;
        }
      }
      this.hurt = true;
      return 0;
    }
    this.hurt = false;

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
