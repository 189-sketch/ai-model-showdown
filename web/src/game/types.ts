export interface Box {
  x: number; // forward offset from the fighter origin (feet centre)
  y: number; // height above the fighter's feet
  w: number;
  h: number;
}

export type Level = "mid" | "low" | "overhead";
export type HitFx = "click" | "stamp" | "stomp";
export type MoveKind = "normal" | "special" | "super" | "throw";

export type ProjKind = "card" | "notice" | "scroll" | "rocket" | "missile" | "artifact" | "maid" | "blast";

export interface ProjDef {
  kind: ProjKind;
  frame: number; // move frame on which it spawns
  count?: number; // a volley: this many, one every `every` frames
  every?: number;
  variant?: number; // scroll: 0 MIT / 1 GPL · rocket: 0 straight / 1 arcing
  speed: number;
  x: number;
  y: number;
  w: number;
  h: number;
  hits: number;
  rehit: number;
  damage: number;
  chip: number;
  hitstun: number;
  blockstun: number;
  level: Level;
  knockdown?: boolean;
}

/** Side effects a move (or its projectile) applies when it connects. */
export type OnHit = "drain" | "ban" | "mit" | "gpl" | "note";

export interface MoveDef {
  id: string;
  name?: string;
  anim: string;
  animAlt?: string; // sprite to fall back on while `anim` has no frames
  preAnim?: string; // played for the first `preFrames` frames before `anim` (DeepSeek thinks first)
  preFrames?: number;
  sprite?: string; // draw from another sprite set during this move (Grok's Roadster)
  linearAnim?: boolean; // play the sprite straight through startup+active, then hold the last frame
  kind: MoveKind;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  chip?: number;
  hitstun: number;
  blockstun: number;
  level: Level;
  hitbox?: Box;
  hurtExt?: Box; // extra hurtbox while the limb is out
  push?: number;
  knockdown?: boolean;
  launch?: [number, number];
  chain?: boolean; // light attacks chain into other normals on hit (lights only on block)
  cancel?: boolean; // cancellable into specials on hit/block
  hits?: number;
  rehit?: number;
  invuln?: [number, number];
  vel?: [number, number, number, number?][]; // [from, to, vx, vy at `from`]
  airborne?: boolean;
  floaty?: boolean; // reduced gravity while active
  air?: boolean;
  projectile?: ProjDef;
  hitstop?: number;
  hitFx?: HitFx;
  unblockable?: boolean;
  counter?: "catch" | "reflect"; // a guard stance: [startup, startup+active] is the window
  onHit?: OnHit;
  cinematic?: number; // on contact, freeze the match for this full-screen cut-in (CINE_*)
  armor?: boolean; // absorbs one hit (梁圣)
  cost?: number;
  sfx?: string;
  voice?: string;
  say?: string; // big callout text popped when the move starts
}

export type FState =
  | "intro"
  | "idle"
  | "walkF"
  | "walkB"
  | "run"
  | "backdash"
  | "dodge"
  | "crouch"
  | "jumpSquat"
  | "air"
  | "land"
  | "attack"
  | "fall"
  | "hitstun"
  | "blockstun"
  | "kd"
  | "down"
  | "getup"
  | "throwing"
  | "thrown"
  | "dead"
  | "win"
  | "lose";

export interface Fighter {
  char: number;
  x: number;
  y: number; // height above ground
  vx: number;
  vy: number;
  facing: 1 | -1;
  state: FState;
  sf: number; // frames spent in current state
  move: string | null;
  hp: number;
  meter: number;
  stun: number;
  crouching: boolean;
  blockCrouch: boolean;
  hitCount: number; // hits landed by the current move
  rehitTimer: number;
  pushVx: number;
  airAttackUsed: boolean;
  jumpVx: number;
  combo: number;
  comboDamage: number;
  invuln: number;
  throwSide: 1 | -1;
  dir: number; // current relative numpad direction (5 = neutral)
  prevBits: number;
  hist: number[]; // relative numpad directions, newest last
  buf: number[]; // per-button press buffer (frames left) [LP, HP, LK, HK]
  wins: number;
  voiceAlt: number;
  dodgeDir: 1 | -1; // forward / backward roll
  armorUsed: boolean;
  // timed statuses, in frames
  ban: number; // 封禁: no attacks
  banCd: number; // can't be banned again yet
  unban: number; // the 「已解封」 bubble
  ultra: number; // ChatGPT Ultra
  muscle: number; // DeepSeek 梁圣
  busy: number; // DeepSeek 服务器繁忙 after the transformation
  gpl: number; // GPL infection: bleeds HP
  noted: number; // 社群注记: takes +15% damage
  acquired: boolean; // 已被收购 (lost a round to Grok); kept for the whole match
}

export interface Projectile {
  id: number;
  owner: 0 | 1;
  kind: ProjKind;
  variant: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hits: number;
  rehit: number;
  rehitTimer: number;
  damage: number;
  chip: number;
  hitstun: number;
  blockstun: number;
  level: Level;
  knockdown: boolean;
  age: number;
  dir: 1 | -1;
  // summons and homing shots run a little state machine: mode + frames in mode
  mode: number;
  mt: number;
  tx: number; // target x (arcing rockets, missiles)
}

export interface Fx {
  kind:
    | "hit" | "heavy" | "block" | "dust" | "spark" | "wave" | "hearts" | "smoke" | "spiral"
    | "explosion" | "burst" | "spout" | "stomp" | "reflect" | "aura"
    | "say" | HitFx;
  x: number;
  y: number;
  age: number;
  life: number;
  facing: 1 | -1;
  text?: string; // "say": callout text
  who?: number; // "say": whose colour
}

export interface GameEvent {
  t: "sfx" | "voice" | "announce";
  id: string;
  who?: 0 | 1;
}

export type Phase = "intro" | "fight" | "ko" | "roundEnd" | "matchEnd";

export interface MatchConfig {
  chars: [number, number];
  stage: number;
  seed: number;
  training?: boolean;
}

export interface GameState {
  frame: number;
  phase: Phase;
  phaseFrame: number;
  round: number;
  timer: number; // frames left in the round
  fighters: [Fighter, Fighter];
  projectiles: Projectile[];
  fx: Fx[];
  freeze: number; // hitstop
  superFreeze: number;
  superOwner: number;
  cineT: number; // frames left in a full-screen cut-in, 0 when none
  cineOwner: number;
  cineKind: number; // CINE_BAN / CINE_ULTRA
  shake: number;
  camX: number;
  roundWinner: number; // -1 none, 0/1, 2 draw
  matchWinner: number;
  perfect: boolean;
  timeOver: boolean;
  nextId: number;
  events: GameEvent[];
  stage: number;
  training: boolean;
  seed: number;
}
