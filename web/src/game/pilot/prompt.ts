/**
 * What a model pilot is told: the rules and both move lists once (system
 * prompt), then a snapshot of the fight at every decision.
 * Frame data comes straight from CHARS, so it never drifts from the sim.
 */

import { CHARS, findMove, type CharDef } from "../chars";
import { METER_STOCK, STAGE_W, WALL_PAD } from "../constants";
import type { Fighter, GameState, MoveDef } from "../types";
import { CONDITIONS } from "./plan";

const NORMAL_IDS = ["stLP", "stHP", "stLK", "stHK", "crLP", "crHP", "crLK", "crHK", "jLP", "jHP", "jLK", "jHK"] as const;

function reach(mv: MoveDef) {
  if (mv.hitbox) return `${mv.hitbox.x + mv.hitbox.w}px`;
  if (mv.projectile) return mv.projectile.speed ? "projectile" : "trap";
  return "-";
}

function notes(mv: MoveDef) {
  const n: string[] = [];
  if (mv.chain) n.push("chains");
  if (mv.cancel) n.push("cancelable");
  if (mv.knockdown) n.push("knockdown");
  if (mv.unblockable) n.push("UNBLOCKABLE");
  if (mv.invuln) n.push(`invuln f${mv.invuln[0]}-${mv.invuln[1]}`);
  if (mv.counter === "catch") n.push("counter stance: catches punches/kicks/jump-ins");
  if (mv.counter === "reflect") n.push("counter stance: reflects projectiles, parries punches/kicks");
  if (mv.hits && mv.hits > 1) n.push(`${mv.hits} hits`);
  if (mv.projectile) n.push(`${mv.projectile.kind} speed ${mv.projectile.speed}`);
  if (mv.cost) n.push(`costs ${mv.cost / METER_STOCK} bar`);
  return n.join(", ");
}

function row(label: string, mv: MoveDef) {
  const dmg = mv.projectile ? mv.projectile.damage : mv.damage;
  return `| ${label} | ${mv.startup}/${mv.active}/${mv.recovery} | ${dmg} | ${mv.projectile?.level ?? mv.level} | ${reach(mv)} | ${notes(mv)} |`;
}

/** Move list, keeping the original (Chinese) names: they say what the moves do. */
function moveTable(c: CharDef, full: boolean) {
  const out = [`### ${c.name} — ${c.hp} HP, walk ${c.walkF} px/f, run ${c.runSpeed} px/f, air time ≈${Math.round((2 * c.jumpVy) / c.gravity)} f`];
  out.push("| move | startup/active/recovery (frames) | damage | level | reach | notes |", "|---|---|---|---|---|---|");
  if (full) for (const id of NORMAL_IDS) out.push(row(`normal ${id}`, c.normals[id]));
  c.specials.forEach((sp, i) => {
    out.push(row(`special slot ${i + 1} light`, sp.light));
    out.push(row(`special slot ${i + 1} heavy`, sp.heavy));
  });
  out.push(row("super", c.superMove), row("throw", c.throwMove));
  out.push("", "Move descriptions:");
  c.specials.forEach((sp, i) => out.push(`- slot ${i + 1}: ${c.moveList[i]?.name ?? sp.light.name}`));
  out.push(`- super: ${c.moveList[3]?.name ?? c.superMove.name}`);
  if (c.id === "grok") out.push('- {"do":"detonate"} blows up your rocket wherever it is in flight.');
  return out.join("\n");
}

export function systemPrompt(me: CharDef, opp: CharDef): string {
  return `You are the pilot of a fighter in a 2D fighting game, playing a real best-of-3 match against another AI model. Win each round by bringing the opponent to 0 HP, or by having more HP when the 60 s timer runs out.

## How time works
- The game runs at 60 frames per second (1 s = 60 f). Distances are in pixels; the stage is ${STAGE_W} px wide.
- The game pauses while you think, so thinking is free. But each reply only sets your next plan (about 0.3–2 s of play), plus standing reactions that the engine checks every frame for you.
- You are asked again when your plan is used up, or when you get hit (the rest of your plan is thrown away).

## Core mechanics
- Blocking: "block high" (hold back) stops mid and overhead attacks. "block low" (crouch back) stops mid and low attacks. Jump-ins and "overhead" moves must be blocked high; "low" moves must be blocked low. Blocked special moves still deal a little chip damage.
- Throws work at ≤54 px, can't be blocked, and beat a blocking opponent. They don't work on airborne or attacking (special) opponents.
- Startup = frames before the hit can land; active = frames it can hit; recovery = frames you are stuck afterwards. A big recovery is a punish window for whoever blocked it.
- Combos: light normals chain into other normals, and "cancelable" normals cancel into specials or the super if they connect. Steps marked "cancel": true are only performed if the attack before them connected (hit or blocked); otherwise they are skipped. Use this for safe hit-confirms.
- Meter: you gain it by attacking and taking hits (max 2 bars). The super costs 1 bar; without the meter (or while ChatGPT's Ultra is already running) the super input comes out as a standing heavy kick instead. A dodge out of blockstun costs 0.5 bar.
- Dodge roll: briefly invulnerable, rolls through the opponent, punishable at the end.
- Jumping attacks must be done while airborne: jump, wait a few frames, then use a j* normal. One air attack per jump.
- Projectiles: you can only have one of each kind on screen.

## Your fighter
${moveTable(me, true)}

## Opponent's fighter (their normals are similar to yours)
${moveTable(opp, false)}

## Your reply
Reply with ONE JSON object and nothing else:
{"say": "optional taunt, max 30 chars", "plan": [step, ...], "reactions": [{"if": condition, "do": step}, ...]}

Steps (frames are 1–60, default 15):
- {"do":"walk","dir":"forward"|"back","frames":n}   (walking back also blocks high)
- {"do":"dash","dir":"forward"|"back","frames":n}   (forward = run for n frames; back = backdash)
- {"do":"block","height":"high"|"low","frames":n}
- {"do":"crouch","frames":n}
- {"do":"wait","frames":n}
- {"do":"jump","dir":"up"|"forward"|"back"}
- {"do":"normal","move":"stLP|stHP|stLK|stHK|crLP|crHP|crLK|crHK|jLP|jHP|jLK|jHK","cancel":false}
- {"do":"special","slot":1|2|3,"strength":"light"|"heavy","cancel":false}
- {"do":"super","cancel":false}
- {"do":"throw","dir":"forward"|"back"}   (back throws them behind you)
- {"do":"dodge","dir":"forward"|"back"}
Use 1–8 steps per plan. An attack step waits until you can act again before the next step starts, unless the next step has "cancel": true.

Reactions (0–4) interrupt walking, blocking, crouching and waiting steps the moment their condition becomes true. They run once, and then the plan carries on. Conditions:
${CONDITIONS.map((c) => `- "${c.id}": ${c.desc}`).join("\n")}

Example:
{"say":"Too slow.","plan":[{"do":"walk","dir":"forward","frames":12},{"do":"normal","move":"crLK"},{"do":"special","slot":1,"strength":"light","cancel":true},{"do":"block","height":"low","frames":20}],"reactions":[{"if":"opponent_jumps_in","do":{"do":"normal","move":"crHP"}},{"if":"opponent_attacks_low","do":{"do":"block","height":"low","frames":16}}]}`;
}

// ───────────────────────── per-decision snapshot ─────────────────────────

const STATE_TEXT: Record<string, string> = {
  idle: "standing", walkF: "walking forward", walkB: "walking back", run: "running", crouch: "crouching",
  backdash: "backdashing", dodge: "dodge-rolling", jumpSquat: "about to jump", air: "airborne", land: "landing",
  attack: "attacking", hitstun: "in hitstun", blockstun: "in blockstun", kd: "knocked down", down: "on the floor",
  getup: "getting up", throwing: "throwing", thrown: "being thrown", fall: "falling",
};

function moveText(f: Fighter) {
  const mv = f.move ? findMove(f.char, f.move) : null;
  if (!mv || f.state !== "attack") return "";
  const phase = f.sf < mv.startup ? `startup, hits in ${mv.startup - f.sf} f` : f.sf < mv.startup + mv.active ? "ACTIVE now" : `recovering, ${mv.startup + mv.active + mv.recovery - f.sf} f left`;
  return ` using ${mv.id}${mv.name ? ` (${mv.name})` : ""}, ${mv.projectile?.level ?? mv.level}, ${phase}${f.hitCount ? ", it connected" : ""}`;
}

function statuses(f: Fighter) {
  const s: string[] = [];
  const sec = (n: number) => `${(n / 60).toFixed(1)} s`;
  if (f.ban > 0) s.push(`BANNED (cannot attack) ${sec(f.ban)}`);
  if (f.ultra > 0) s.push(`Ultra buff ${sec(f.ultra)}`);
  if (f.muscle > 0) s.push(`梁圣 armored form ${sec(f.muscle)} (no specials)`);
  if (f.busy > 0) s.push(`服务器繁忙 (no specials) ${sec(f.busy)}`);
  if (f.gpl > 0) s.push(`GPL bleed ${sec(f.gpl)}`);
  if (f.noted > 0) s.push(`noted: takes +15% damage ${sec(f.noted)}`);
  if (f.acquired) s.push("acquired");
  return s.length ? ` Status: ${s.join("; ")}.` : "";
}

function fighterLine(label: string, f: Fighter) {
  const c = CHARS[f.char];
  const air = f.y > 0 ? `, ${Math.round(f.y)} px in the air` : "";
  const back = f.facing > 0 ? f.x - WALL_PAD : STAGE_W - WALL_PAD - f.x;
  return `${label} (${c.name}): HP ${Math.max(0, Math.round(f.hp))}/${c.hp}, meter ${(f.meter / METER_STOCK).toFixed(2)} bars, ${STATE_TEXT[f.state] ?? f.state}${moveText(f)}${air}; ${Math.round(back)} px of room behind.${statuses(f)}`;
}

export interface Recap {
  seconds: number;
  dealt: number;
  taken: number;
  oppMoves: string[];
  planEnd: string;
}

export function observation(s: GameState, me: 0 | 1, recap: Recap | null): string {
  const f = s.fighters[me];
  const o = s.fighters[1 - me];
  const toward = Math.sign(o.x - f.x) || f.facing;
  const lines = [
    `Round ${s.round} · ${(s.timer / 60).toFixed(1)} s left · round wins: you ${f.wins}, opponent ${o.wins}`,
    fighterLine("YOU", f),
    fighterLine("OPPONENT", o),
    `Distance: ${Math.round(Math.abs(o.x - f.x))} px (opponent is ${toward > 0 ? "to your right" : "to your left"}).`,
  ];
  const shots = s.projectiles.map((p) => {
    const dx = (p.x - f.x) * toward;
    const v = p.vx * -toward; // positive = flying at you
    const who = p.owner === me ? "yours" : "OPPONENT's";
    return `${who} ${p.kind} ${Math.round(dx)} px ${dx >= 0 ? "in front of" : "behind"} you${v > 0.1 ? `, coming at you at ${v.toFixed(1)} px/f` : v < -0.1 ? ", moving away from you" : ""}, ${p.level}`;
  });
  if (shots.length) lines.push(`Projectiles: ${shots.join("; ")}.`);
  if (recap) {
    lines.push(
      `Since your last decision (${recap.seconds.toFixed(1)} s): you dealt ${recap.dealt}, took ${recap.taken}. Opponent used: ${recap.oppMoves.join(", ") || "nothing"}. Your last plan ${recap.planEnd}.`
    );
  }
  lines.push("Your move: reply with the JSON object.");
  return lines.join("\n");
}
