/**
 * GGPO-style rollback session for two peers.
 *
 * Every tick we simulate immediately using the local input (with a small
 * input delay) and a *prediction* of the remote input (their last known
 * input). When the real remote input for an already-simulated frame arrives
 * and differs from the prediction, we restore the snapshot taken before that
 * frame and re-simulate up to the present. Inputs travel over an unreliable,
 * unordered DataChannel; every packet repeats all inputs the peer has not
 * acknowledged yet, so losses heal themselves.
 */

import { checksum, cloneState, step } from "./sim";
import type { GameEvent, GameState } from "./types";

const MSG_INPUT = 1;
const MSG_CHECK = 2;
const MAX_SEND = 48;
const CHECK_EVERY = 120;

export interface RollbackStats {
  rollbacks: number;
  maxRollback: number;
  stalls: number;
  desync: boolean;
  advantage: number;
}

export class RollbackSession {
  state: GameState;
  frame = 0; // frames simulated so far (== index of the next frame to simulate)
  readonly local: 0 | 1;
  readonly delay: number;
  readonly maxRollback: number;

  private localInputs = new Map<number, number>();
  private remoteInputs = new Map<number, number>();
  private usedRemote = new Map<number, number>();
  private saved = new Map<number, GameState>();
  private myChecks = new Map<number, number>();
  private theirChecks = new Map<number, number>();

  private lastRemote = -1; // highest contiguous remote frame received
  private remoteAck = -1; // highest local frame the peer has confirmed
  private remoteFrame = 0; // the peer's reported simulation frame
  private firstMismatch = Infinity;
  private lastPacketAt = performance.now();
  private skipCooldown = 0;
  rtt = 60;

  stats: RollbackStats = { rollbacks: 0, maxRollback: 0, stalls: 0, desync: false, advantage: 0 };

  constructor(initial: GameState, local: 0 | 1, private send: (buf: ArrayBuffer) => void, opts?: { delay?: number; maxRollback?: number }) {
    this.state = initial;
    this.local = local;
    this.delay = opts?.delay ?? 2;
    this.maxRollback = opts?.maxRollback ?? 10;
    for (let f = 0; f < this.delay; f++) this.localInputs.set(f, 0);
  }

  get silentFor() {
    return performance.now() - this.lastPacketAt;
  }

  /** Feed a packet received on the game channel. */
  receive(buf: ArrayBuffer) {
    const v = new DataView(buf);
    const type = v.getUint8(0);
    this.lastPacketAt = performance.now();
    if (type === MSG_INPUT) {
      const start = v.getInt32(1);
      const ack = v.getInt32(5);
      const theirFrame = v.getInt32(9);
      const count = v.getUint8(13);
      if (ack > this.remoteAck) this.remoteAck = ack;
      if (theirFrame > this.remoteFrame) this.remoteFrame = theirFrame;
      for (let k = 0; k < count; k++) {
        const f = start + k;
        if (this.remoteInputs.has(f) || f <= this.lastRemote - 64) continue;
        const bits = v.getUint8(14 + k);
        this.remoteInputs.set(f, bits);
        const used = this.usedRemote.get(f);
        if (used !== undefined && used !== bits && f < this.firstMismatch) this.firstMismatch = f;
      }
      while (this.remoteInputs.has(this.lastRemote + 1)) this.lastRemote++;
    } else if (type === MSG_CHECK) {
      const f = v.getInt32(1);
      const sum = v.getUint32(5);
      this.theirChecks.set(f, sum);
      this.compareChecks(f);
    }
  }

  private compareChecks(f: number) {
    const a = this.myChecks.get(f);
    const b = this.theirChecks.get(f);
    if (a !== undefined && b !== undefined && a !== b && !this.stats.desync) {
      this.stats.desync = true;
      console.warn(`[netcode] desync detected at frame ${f}`);
    }
  }

  private sendInputs() {
    const last = this.frame + this.delay - 1;
    let start = Math.max(this.remoteAck + 1, last - MAX_SEND + 1, 0);
    if (start > last) start = last; // always send at least the newest input as a heartbeat
    const count = last - start + 1;
    const buf = new ArrayBuffer(14 + count);
    const v = new DataView(buf);
    v.setUint8(0, MSG_INPUT);
    v.setInt32(1, start);
    v.setInt32(5, this.lastRemote);
    v.setInt32(9, this.frame);
    v.setUint8(13, count);
    for (let k = 0; k < count; k++) v.setUint8(14 + k, this.localInputs.get(start + k) ?? 0);
    this.send(buf);
  }

  private sendCheck(f: number, sum: number) {
    const buf = new ArrayBuffer(9);
    const v = new DataView(buf);
    v.setUint8(0, MSG_CHECK);
    v.setInt32(1, f);
    v.setUint32(5, sum);
    this.send(buf);
  }

  private predicted(f: number) {
    const known = this.remoteInputs.get(f);
    if (known !== undefined) return known;
    return this.remoteInputs.get(this.lastRemote) ?? 0;
  }

  private simulate(f: number): GameEvent[] {
    this.saved.set(f, cloneState(this.state));
    const mine = this.localInputs.get(f) ?? 0;
    const theirs = this.predicted(f);
    this.usedRemote.set(f, theirs);
    if (this.local === 0) step(this.state, mine, theirs);
    else step(this.state, theirs, mine);
    return this.state.events;
  }

  /**
   * Advance by (at most) one frame.
   * Returns the events of the newly simulated frame, or null when stalled
   * waiting for the peer.
   */
  tick(localBits: number): GameEvent[] | null {
    if (!this.localInputs.has(this.frame + this.delay)) this.localInputs.set(this.frame + this.delay, localBits);

    // roll back to the earliest mispredicted frame and re-simulate
    if (this.firstMismatch < this.frame) {
      const from = this.firstMismatch;
      const snap = this.saved.get(from);
      if (snap) {
        this.state = cloneState(snap);
        for (let f = from; f < this.frame; f++) this.simulate(f);
        this.stats.rollbacks++;
        this.stats.maxRollback = Math.max(this.stats.maxRollback, this.frame - from);
      }
    }
    this.firstMismatch = Infinity;

    // confirmed checksums for desync detection
    const confirmed = Math.min(this.lastRemote + 1, this.frame);
    const cf = Math.floor(confirmed / CHECK_EVERY) * CHECK_EVERY;
    if (cf > 0 && !this.myChecks.has(cf) && this.saved.has(cf)) {
      const sum = checksum(this.saved.get(cf)!);
      this.myChecks.set(cf, sum);
      this.sendCheck(cf, sum);
      this.compareChecks(cf);
    }

    this.sendInputs();

    // too far ahead of confirmed remote input: wait for the peer
    if (this.frame - this.lastRemote > this.maxRollback) {
      this.stats.stalls++;
      return null;
    }

    // time sync: if we run ahead of the peer, drop a frame now and then
    const remoteNow = this.remoteFrame + this.rtt / 2 / (1000 / 60);
    const adv = this.frame - remoteNow;
    this.stats.advantage = adv;
    if (this.skipCooldown > 0) this.skipCooldown--;
    else if (adv > 1.5) {
      this.skipCooldown = 12;
      return null;
    }

    const events = this.simulate(this.frame);
    this.frame++;
    this.cleanup();
    return events;
  }

  private cleanup() {
    const keepFrom = Math.min(this.lastRemote, this.frame - this.maxRollback) - 4;
    for (const map of [this.saved, this.usedRemote] as Map<number, unknown>[]) {
      for (const k of map.keys()) if (k < keepFrom) map.delete(k);
    }
    const old = this.frame - 600;
    for (const map of [this.localInputs, this.remoteInputs, this.myChecks, this.theirChecks] as Map<number, unknown>[]) {
      for (const k of map.keys()) if (k < old) map.delete(k);
    }
  }
}
