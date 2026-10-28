/**
 * Owns a match: fixed-timestep loop, input sources, audio cues and rendering.
 */

import { CHARS, STAGES } from "./chars";
import { FRAME_MS, H, W } from "./constants";
import { audio } from "./audio";
import { createCpu, cpuInput, dummyInput, type Cpu } from "./ai";
import { readPlayer } from "./input";
import { createRenderState, render, type RenderState } from "./render";
import { RollbackSession } from "./rollback";
import { createState, step } from "./sim";
import type { Pilot } from "./pilot/pilot";
import type { FighterSkin } from "./pilot/skin";
import type { PeerLink } from "./rtc";
import type { GameEvent, GameState, MatchConfig } from "./types";

export type Mode = "cpu" | "local" | "training" | "online" | "arena";
export type DummyMode = "stand" | "crouch" | "block" | "jump";

export interface RunnerOpts {
  canvas: HTMLCanvasElement;
  mode: Mode;
  config: MatchConfig;
  names: [string, string];
  cpuLevel?: 1 | 2 | 3;
  link?: PeerLink;
  pilots?: [Pilot, Pilot]; // arena: both sides are played by models
  localSide?: 0 | 1;
  inputDelay?: number;
  onMatchEnd?: (winner: number) => void;
  onDisconnect?: () => void;
}

export class GameRunner {
  state: GameState;
  private ctx: CanvasRenderingContext2D;
  private rs: RenderState = createRenderState();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private cpu: Cpu | null = null;
  private session: RollbackSession | null = null;
  private ended = false;
  private silentChecks = 0;
  skins: [FighterSkin | null, FighterSkin | null] | undefined; // Model Arena looks, set once they have loaded
  paused = false;
  showBoxes = false;
  dummy: DummyMode = "stand";

  constructor(private o: RunnerOpts) {
    const ctx = o.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", this.resize);
    this.state = createState(o.config);
    if (o.mode === "cpu") this.cpu = createCpu(o.cpuLevel ?? 2);
    if (o.mode === "training") this.showBoxes = true;
    if (o.mode === "online" && o.link) {
      const link = o.link;
      this.session = new RollbackSession(this.state, o.localSide ?? 0, (b) => link.sendGame(b), { delay: o.inputDelay ?? 2 });
      link.onGame = (buf) => this.session?.receive(buf);
    }
    void audio.bgm(STAGES[o.config.stage]?.bgm ?? "launch");
    // exposed for automated browser tests in development
    if (import.meta.env.DEV) (window as unknown as { __pk?: GameRunner }).__pk = this;
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      let dt = now - this.last;
      this.last = now;
      if (dt > 250) dt = FRAME_MS; // tab was hidden
      if (!this.paused || this.o.mode === "online") this.acc += dt;
      let n = 0;
      while (this.acc >= FRAME_MS && n < 5) {
        this.tick();
        this.acc -= FRAME_MS;
        n++;
      }
      if (n === 5) this.acc = 0;
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Render at the display's pixel density (capped) on top of the 480×270 game grid. */
  private resize = () => {
    const canvas = this.o.canvas;
    const cssW = canvas.getBoundingClientRect().width || 960;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const width = Math.round(Math.min(1440, Math.max(W * 2, cssW * dpr)));
    const height = Math.round((width * H) / W);
    if (canvas.width !== width) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  stop() {
    window.removeEventListener("resize", this.resize);
    cancelAnimationFrame(this.raf);
    if (this.o.link) this.o.link.onGame = null;
  }

  get rollbackStats() {
    return this.session?.stats ?? null;
  }

  /** Turn-based arena: the world is frozen while a model is thinking (real-time pilots never freeze it). */
  get thinking() {
    return !!this.o.pilots?.some((p) => p.pending && !p.realtime);
  }

  private tick() {
    let events: GameEvent[] | null;
    const pilots = this.o.pilots;
    if (pilots) {
      for (const p of pilots) if (p.wants(this.state)) void p.decide(this.state);
      if (this.thinking) {
        this.acc = 0;
        return;
      }
    }
    const solo = this.o.mode !== "local";
    if (this.session) {
      if (this.o.link) this.session.rtt = this.o.link.rtt;
      events = this.session.tick(readPlayer("p1", true));
      this.state = this.session.state;
      if (this.session.silentFor > 5000 && ++this.silentChecks > 10 && !this.ended) {
        this.ended = true;
        this.o.onDisconnect?.();
      }
    } else if (pilots) {
      step(this.state, pilots[0].input(this.state), pilots[1].input(this.state));
      events = this.state.events;
    } else {
      const in0 = readPlayer("p1", solo);
      let in1 = 0;
      if (this.o.mode === "cpu" && this.cpu) in1 = cpuInput(this.state, 1, this.cpu);
      else if (this.o.mode === "training") in1 = dummyInput(this.state, 1, this.dummy);
      else in1 = readPlayer("p2", false);
      step(this.state, in0, in1);
      events = this.state.events;
    }
    if (events) this.playEvents(events);

    const s = this.state;
    if (s.phase === "matchEnd" && s.phaseFrame === 150 && !this.ended) {
      this.ended = true;
      this.o.onMatchEnd?.(s.matchWinner);
    }
  }

  private playEvents(events: GameEvent[]) {
    for (const e of events) {
      if (e.t === "sfx") audio.sfx(e.id);
      else if (e.t === "voice" && e.who !== undefined) audio.voice(e.who, CHARS[this.state.fighters[e.who].char].id, e.id);
      else if (e.t === "announce") {
        let id = e.id;
        const side = this.localSide();
        if ((id === "p1wins" || id === "p2wins") && side !== -1) id = (id === "p1wins" ? 0 : 1) === side ? "youwin" : "youlose";
        audio.announce(id);
      }
    }
  }

  private localSide(): 0 | 1 | -1 {
    if (this.o.mode === "online") return this.o.localSide ?? 0;
    if (this.o.mode === "cpu") return 0;
    return -1;
  }

  private draw() {
    render(this.ctx, this.state, this.rs, {
      names: this.o.names,
      skins: this.skins,
      showBoxes: this.showBoxes,
      localSide: this.localSide(),
      ping: this.o.mode === "online" ? this.o.link?.rtt ?? null : null,
    });
  }
}
