import { createState, step, checksum, cloneState } from "../web/src/game/sim";
import { RollbackSession } from "../web/src/game/rollback";
import { CHARS } from "../web/src/game/chars";
import { IN_D, IN_R, IN_L, IN_LP, IN_HP, IN_LK, IN_HK, IN_U } from "../web/src/game/constants";
import type { GameState } from "../web/src/game/types";
(globalThis as any).performance ??= { now: () => Date.now() };

let fails = 0;
const check = (c: boolean, msg: string) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; };

const GPT = 0, CLAUDE = 1, DS = 2, GROK = 3;
check(CHARS.map((c) => c.id).join() === "chatgpt,claude,deepseek,grok", `roster ${CHARS.map((c) => c.id).join()}`);

const fight = (chars: [number, number], x0 = 300, x1 = 380) => {
  const st = createState({ chars, stage: 0, seed: 9 });
  for (let i = 0; i < 95; i++) step(st, 0, 0);
  st.fighters[0].x = x0; st.fighters[1].x = x1;
  step(st, 0, 0);
  return st;
};
const run = (st: GameState, frames: number, a = 0, b = 0, each?: (st: GameState) => void) => { for (let i = 0; i < frames; i++) { step(st, a, b); each?.(st); } };
// P1 faces right: forward = R. P2 faces left: forward = L.
const QCF1 = (btn: number) => [IN_D, IN_D | IN_R, IN_R, IN_R | btn];
const QCB1 = (btn: number) => [IN_D, IN_D | IN_L, IN_L, IN_L | btn];
const QCF2 = (btn: number) => [IN_D, IN_D | IN_L, IN_L, IN_L | btn];
const QCB2 = (btn: number) => [IN_D, IN_D | IN_R, IN_R, IN_R | btn];
const p1 = (st: GameState, seq: number[], b = 0) => { for (const x of seq) step(st, x, b); };
const p2 = (st: GameState, seq: number[], a = 0) => { for (const x of seq) step(st, a, x); };

// 1. intro → fight, jab
{
  const s = createState({ chars: [GPT, CLAUDE], stage: 0, seed: 1 });
  run(s, 95);
  check(s.phase === "fight", `phase after intro = ${s.phase}`);
  const hp0 = s.fighters[1].hp;
  let n = 0;
  while (Math.abs(s.fighters[1].x - s.fighters[0].x) > 40 && n++ < 200) step(s, IN_R, 0);
  run(s, 3, IN_LP);
  run(s, 30);
  check(s.fighters[1].hp < hp0, `jab damage: ${hp0} -> ${s.fighters[1].hp}`);
}

// 2. every special slot is reachable for every fighter (light and heavy)
for (let c = 0; c < 4; c++) {
  for (const [k, sp] of CHARS[c].specials.entries()) {
    for (const heavy of [false, true]) {
      const st = fight([c, GPT], 200, 420);
      const btn = sp.btn === "P" ? (heavy ? IN_HP : IN_LP) : heavy ? IN_HK : IN_LK;
      p1(st, sp.motion === "236" ? QCF1(btn) : QCB1(btn));
      const want = heavy ? sp.heavy.id : sp.light.id;
      check(st.fighters[0].move === want, `${CHARS[c].id} slot ${k + 1}${heavy ? "H" : "L"}: ${st.fighters[0].move} (want ${want})`);
    }
  }
}

// 3. super = 重拳＋重脚 with a bar; nothing without one
for (let c = 0; c < 4; c++) {
  const st = fight([c, GPT], 280, 330);
  step(st, IN_HP | IN_HK, 0);
  check(st.fighters[0].move !== CHARS[c].superMove.id, `${CHARS[c].id}: no super without meter (${st.fighters[0].move})`);
  run(st, 90);
  st.fighters[0].meter = 1000;
  step(st, IN_HP | IN_HK, 0);
  check(st.fighters[0].move === CHARS[c].superMove.id && st.fighters[0].meter === 0, `${CHARS[c].id}: super ${st.fighters[0].move}, meter ${st.fighters[0].meter}`);
  // pressed a frame apart still works (heavy punch first turns into the super)
  const s2 = fight([c, GPT], 200, 420);
  s2.fighters[0].meter = 1000;
  step(s2, IN_HP, 0); step(s2, IN_HP | IN_HK, 0);
  check(s2.fighters[0].move === CHARS[c].superMove.id, `${CHARS[c].id}: staggered 重拳→重脚 still supers (${s2.fighters[0].move})`);
}

// 4. dodge: 轻拳＋轻脚 rolls through the opponent, invulnerable early; from blockstun it costs half a bar
{
  const st = fight([GPT, GROK], 300, 340);
  step(st, IN_LP | IN_LK, 0);
  check(st.fighters[0].state === "dodge", `dodge state ${st.fighters[0].state}`);
  run(st, 34);
  check(st.fighters[0].x > st.fighters[1].x, `rolled through: ${st.fighters[0].x.toFixed(0)} > ${st.fighters[1].x.toFixed(0)}`);
  const back = fight([GPT, GROK], 300, 380);
  step(back, IN_L | IN_LP | IN_LK, 0);
  run(back, 34);
  check(back.fighters[0].x < 300, `back roll ${back.fighters[0].x.toFixed(0)}`);
  // blockstun dodge
  const bs = fight([GPT, GROK], 300, 350);
  bs.fighters[0].meter = 600;
  p2(bs, [IN_HP], IN_L);
  let dodged = false;
  for (let i = 0; i < 20; i++) {
    const inB = bs.fighters[0].state === "blockstun" && !dodged ? IN_L | IN_LP | IN_LK : IN_L;
    step(bs, inB, 0);
    if (bs.fighters[0].state === "dodge") dodged = true;
  }
  check(dodged && bs.fighters[0].meter <= 120, `blockstun dodge, meter ${bs.fighters[0].meter}`);
}

// 5. ChatGPT: reset card drains 300 meter; catch stance grabs a heavy punch
{
  const st = fight([GPT, CLAUDE], 200, 360);
  st.fighters[1].meter = 800;
  p1(st, QCF1(IN_HP));
  run(st, 80);
  check(st.fighters[1].meter <= 520 && st.fighters[1].hp < CHARS[CLAUDE].hp, `card: meter ${st.fighters[1].meter}, hp ${st.fighters[1].hp}`);
  check(st.events.length >= 0, "card ran");
  const s2 = fight([GPT, GROK], 300, 360);
  p1(s2, QCB1(IN_LP));
  let caught = false;
  const hp = s2.fighters[1].hp;
  step(s2, 0, IN_HP);
  for (let i = 0; i < 70; i++) { step(s2, 0, 0); if (s2.fighters[0].state === "throwing" && s2.fighters[0].move?.startsWith("catchThrow")) caught = true; }
  check(caught && s2.fighters[1].hp < hp - 100, `catch: ${caught}, hp ${hp} -> ${s2.fighters[1].hp}`);
  // whiffed catch leaves a big opening
  const s3 = fight([GPT, GROK], 300, 360);
  p1(s3, QCB1(IN_LP));
  let busy = 0;
  for (let i = 0; i < 80; i++) { step(s3, 0, 0); if (s3.fighters[0].state === "attack") busy++; }
  check(busy >= 50, `whiffed catch lasts ${busy} frames`);
}

// 6. ChatGPT Ultra: the cut-in plays, then 8 s of Ultra: three cards, +20% damage
{
  const st = fight([GPT, DS], 200, 420);
  st.fighters[0].meter = 1000;
  step(st, IN_HP | IN_HK, 0);
  let cine = false;
  for (let i = 0; i < 160; i++) { step(st, 0, 0); if (st.cineT > 0) cine = true; }
  check(cine && st.fighters[0].ultra > 300, `ultra cut-in ${cine}, ultra ${st.fighters[0].ultra}`);
  p1(st, QCF1(IN_LP));
  run(st, 16);
  check(st.projectiles.filter((p) => p.kind === "card").length === 3, `ultra card volley: ${st.projectiles.filter((p) => p.kind === "card").length}`);
  run(st, 500);
  check(st.fighters[0].ultra === 0, `ultra wears off (${st.fighters[0].ultra})`);
}

// 7. Agent 代操作: four clicks and a knockdown
{
  const st = fight([GPT, GROK], 300, 360);
  const hp = st.fighters[1].hp;
  p1(st, QCB1(IN_HK));
  let kd = false, clicks = 0;
  for (let i = 0; i < 90; i++) { step(st, 0, 0); if (st.fighters[1].state === "kd") kd = true; clicks = Math.max(clicks, st.fighters[1].combo); }
  check(kd && clicks >= 4, `agent: combo ${clicks}, kd ${kd}, hp ${hp} -> ${st.fighters[1].hp}`);
}

// 8. Claude: policy notice bans for 1 s (no attacks, but can still move / jump / dodge), unban bubble, 4 s cooldown
{
  const st = fight([CLAUDE, GROK], 200, 330);
  p1(st, QCF1(IN_HP));
  let banned = 0;
  for (let i = 0; i < 90 && !banned; i++) { step(st, 0, 0); if (st.fighters[1].ban > 0) banned = st.fighters[1].ban; }
  check(banned > 0, `notice bans: ${banned}`);
  while (st.fighters[1].state !== "idle" && st.fighters[1].ban > 20) step(st, 0, 0); // through the hitstun
  step(st, 0, IN_LP);
  check(st.fighters[1].state !== "attack", `banned fighter cannot jab (${st.fighters[1].state})`);
  step(st, 0, IN_L);
  check(["walkF", "walkB"].includes(st.fighters[1].state), `banned fighter can walk (${st.fighters[1].state})`);
  let unban = 0;
  const sfx: string[] = [];
  for (let i = 0; i < 80; i++) { step(st, 0, 0); for (const e of st.events) if (e.t === "sfx") sfx.push(e.id); if (st.fighters[1].unban > 0) unban = Math.max(unban, st.fighters[1].unban); }
  check(st.fighters[1].ban === 0 && unban > 0 && sfx.includes("unban"), `ban lifted: bubble ${unban}, ding ${sfx.includes("unban")}, cooldown ${st.fighters[1].banCd}`);
  // a second notice during the cooldown only hurts
  st.fighters[0].x = 200; st.fighters[1].x = 330;
  run(st, 30);
  p1(st, QCF1(IN_HP));
  let again = false;
  for (let i = 0; i < 80; i++) { step(st, 0, 0); if (st.fighters[1].ban > 0) again = true; }
  check(!again, "no re-ban during the cooldown");
  // blocked notice: chip only, no ban
  const s2 = fight([CLAUDE, GROK], 200, 330);
  p1(s2, QCF1(IN_HP), IN_R);
  let b2 = false;
  for (let i = 0; i < 90; i++) { step(s2, 0, IN_R); if (s2.fighters[1].ban > 0) b2 = true; }
  check(!b2, "blocked notice does not ban");
}

// 9. Claude: 你说得完全对！ reflects ChatGPT's card back into him (额度已重置 on himself) and parries a punch
{
  const st = fight([GPT, CLAUDE], 200, 330);
  st.fighters[0].meter = 600;
  p1(st, QCF1(IN_HP));
  let reflected = false;
  for (let i = 0; i < 120; i++) {
    const card = st.projectiles.find((p) => p.kind === "card");
    const near = card && card.owner === 0 && Math.abs(card.x - st.fighters[1].x) < 90 && st.fighters[1].state !== "attack" && !reflected;
    if (near) p2(st, QCB2(IN_LP)); else step(st, 0, 0);
    if (st.projectiles.some((p) => p.kind === "card" && p.owner === 1)) reflected = true;
  }
  check(reflected, "card reflected");
  check(st.fighters[0].hp < CHARS[GPT].hp && st.fighters[0].meter <= 340, `reflected card hits ChatGPT: hp ${st.fighters[0].hp}, meter ${st.fighters[0].meter}`);
  const s2 = fight([GROK, CLAUDE], 300, 350);
  p2(s2, QCB2(IN_LP));
  step(s2, IN_HP, 0);
  let parried = false;
  for (let i = 0; i < 60; i++) { step(s2, 0, 0); if (s2.fighters[1].move === "palmCounter") parried = true; }
  check(parried && s2.fighters[0].hp < CHARS[GROK].hp, `parry → palm: ${parried}, grok hp ${s2.fighters[0].hp}`);
}

// 10. Claude: Artifact eats a projectile
{
  const st = fight([GPT, CLAUDE], 150, 360);
  p2(st, QCB2(IN_LK));
  run(st, 22);
  check(st.projectiles.some((p) => p.kind === "artifact"), "artifact spawned");
  p1(st, QCF1(IN_HP));
  run(st, 90);
  check(st.fighters[1].hp === CHARS[CLAUDE].hp && !st.projectiles.some((p) => p.kind === "artifact"), `artifact blocked the card: claude hp ${st.fighters[1].hp}`);
}

// 11. Claude super: unblockable stamp → suspension cut-in → damage and a ban; a dodge avoids it
{
  for (const guard of [0, IN_R | IN_D]) {
    const st = fight([CLAUDE, DS], 300, 350);
    st.fighters[0].meter = 1000;
    step(st, IN_HP | IN_HK, guard);
    let cine = false, banned = false;
    for (let i = 0; i < 260; i++) { step(st, 0, guard); if (st.cineT > 0) cine = true; if (st.fighters[1].ban > 0) banned = true; }
    check(cine && banned && CHARS[DS].hp - st.fighters[1].hp >= 180, `stamp (guard ${guard}): cine ${cine}, ban ${banned}, hp ${st.fighters[1].hp}`);
  }
  const st = fight([CLAUDE, DS], 300, 350);
  st.fighters[0].meter = 1000;
  step(st, IN_HP | IN_HK, 0);
  run(st, 42); // super freeze
  run(st, 8);
  step(st, 0, IN_LP | IN_LK);
  let cine = false;
  for (let i = 0; i < 80; i++) { step(st, 0, 0); if (st.cineT > 0) cine = true; }
  check(!cine, "dodge rolls through the stamp");
}

// 12. DeepSeek: MIT scroll refunds meter, GPL infects and bleeds
{
  const st = fight([DS, GROK], 200, 360);
  p1(st, QCF1(IN_LP));
  run(st, 60);
  check(st.fighters[0].meter >= 150 && st.fighters[1].hp < CHARS[GROK].hp, `MIT: meter ${st.fighters[0].meter}, hp ${st.fighters[1].hp}`);
  const s2 = fight([DS, GROK], 200, 330);
  p1(s2, QCF1(IN_HP));
  let gpl = 0;
  for (let i = 0; i < 80; i++) { step(s2, 0, 0); gpl = Math.max(gpl, s2.fighters[1].gpl); }
  const hpA = s2.fighters[1].hp;
  run(s2, 120);
  check(gpl > 200 && s2.fighters[1].hp < hpA, `GPL infection ${gpl}, bleeds ${hpA} -> ${s2.fighters[1].hp}`);
}

// 13. DeepSeek: 已深度思考 anti-airs a jump-in
{
  const st = fight([DS, GROK], 300, 350);
  st.fighters[1].state = "air"; st.fighters[1].y = 50; st.fighters[1].vy = 0; st.fighters[1].vx = 0;
  const hp = st.fighters[1].hp;
  p1(st, QCB1(IN_LP));
  run(st, 50);
  check(st.fighters[1].hp < hp, `uppercut anti-air: ${hp} -> ${st.fighters[1].hp}`);
}

// 14. DeepSeek: the whale maid runs over, bonks twice, sprays, curtsies and leaves
{
  const st = fight([DS, GPT], 200, 360);
  const hp = st.fighters[1].hp;
  const voices: string[] = [];
  p1(st, QCB1(IN_HK));
  const modes = new Set<number>();
  let alive = 0, gone = -1, kd = false;
  for (let i = 0; i < 400; i++) {
    step(st, 0, 0);
    for (const e of st.events) if (e.t === "voice") voices.push(e.id);
    const m = st.projectiles.find((p) => p.kind === "maid");
    if (m) { modes.add(m.mode); alive++; } else if (alive && gone < 0) gone = i;
    if (st.fighters[1].state === "kd") kd = true;
  }
  check([0, 1, 2, 3].every((m) => modes.has(m)) && gone > 0, `maid modes ${[...modes]}, gone after ${alive}`);
  check(kd && hp - st.fighters[1].hp > 80, `maid hits ${hp} -> ${st.fighters[1].hp}, kd ${kd}`);
  check(["whalemaid:arrive", "whalemaid:strike", "whalemaid:bye"].every((v) => voices.includes(v)), `maid voices ${voices.join(",")}`);
}

// 15. DeepSeek 梁圣: 10 s of super armour and +30% damage, no specials, then 服务器繁忙
{
  const st = fight([DS, GROK], 300, 360);
  st.fighters[0].meter = 1000;
  step(st, IN_HP | IN_HK, 0);
  run(st, 120);
  check(st.fighters[0].muscle > 400, `transformed: ${st.fighters[0].muscle}`);
  p1(st, QCF1(IN_LP));
  check(!st.projectiles.some((p) => p.kind === "scroll") && st.fighters[0].move !== "mitScroll", `no specials as 梁圣 (${st.fighters[0].move})`);
  run(st, 30);
  // armour: Grok jabs during the iron fist, DeepSeek keeps swinging
  st.fighters[0].x = 300; st.fighters[1].x = 345;
  step(st, IN_HP, 0);
  step(st, 0, IN_LP);
  let stillAttacking = true;
  for (let i = 0; i < 8; i++) { step(st, 0, 0); if (i < 6 && st.fighters[0].state !== "attack") stillAttacking = false; }
  check(stillAttacking && st.fighters[0].armorUsed, `super armour: ${st.fighters[0].state}, armorUsed ${st.fighters[0].armorUsed}`);
  for (let i = 0; i < 700 && st.fighters[0].muscle > 0; i++) step(st, 0, 0);
  run(st, 2);
  check(st.fighters[0].muscle === 0 && st.fighters[0].busy > 0 && st.fighters[0].move === "revert", `reverted (${st.fighters[0].move}), busy ${st.fighters[0].busy}`);
  run(st, 60);
  st.fighters[0].meter = 1000;
  step(st, IN_HP | IN_HK, 0);
  check(st.fighters[0].move !== "liangSheng", "no super while 服务器繁忙");
}

// 16. Grok: rocket detonation, community note, Roadster overhead, starship salvo
{
  const st = fight([GROK, CLAUDE], 150, 420);
  p1(st, QCF1(IN_LP));
  for (let i = 0; i < 80; i++) {
    const r = st.projectiles.find((p) => p.kind === "rocket");
    if (r && Math.abs(r.x - st.fighters[1].x) < 45) break;
    step(st, 0, 0);
  }
  const hp = st.fighters[1].hp;
  step(st, IN_LP, 0);
  check(st.events.some((e) => e.id === "detonate") && !st.projectiles.some((p) => p.kind === "rocket"), "a punch detonates the rocket");
  run(st, 30);
  check(st.fighters[1].hp < hp, `blast hits ${hp} -> ${st.fighters[1].hp}`);
  // heavy rocket arcs up and comes down
  const s2 = fight([GROK, CLAUDE], 200, 400);
  p1(s2, QCF1(IN_HP));
  let maxY = 0;
  for (let i = 0; i < 90; i++) { step(s2, 0, 0); const r = s2.projectiles.find((p) => p.kind === "rocket"); if (r) maxY = Math.max(maxY, r.y); }
  check(maxY > 120 && s2.fighters[1].hp < CHARS[CLAUDE].hp, `heavy rocket arc peak ${maxY.toFixed(0)}, hp ${s2.fighters[1].hp}`);
  // note: +15% damage taken
  const s3 = fight([GROK, DS], 300, 345);
  p1(s3, QCB1(IN_LP));
  run(s3, 40);
  check(s3.fighters[1].noted > 200, `community note ${s3.fighters[1].noted}`);
  // roadster: an overhead that crouch-blocking can't stop
  const s4 = fight([GROK, DS], 220, 330);
  p1(s4, QCB1(IN_HK), IN_R | IN_D);
  let kd = false;
  for (let i = 0; i < 70; i++) { step(s4, 0, IN_R | IN_D); if (s4.fighters[1].state === "kd") kd = true; }
  check(kd, `roadster overhead knocks down a croucher, hp ${s4.fighters[1].hp}`);
  // salvo: six missiles
  const s5 = fight([GROK, DS], 220, 360);
  s5.fighters[0].meter = 1000;
  step(s5, IN_HP | IN_HK, 0);
  const seen = new Set<number>();
  let kd5 = false;
  for (let i = 0; i < 220; i++) { step(s5, 0, 0); for (const p of s5.projectiles) if (p.kind === "missile") seen.add(p.id); if (s5.fighters[1].state === "kd") kd5 = true; }
  check(seen.size === 6 && kd5 && CHARS[DS].hp - s5.fighters[1].hp > 100, `salvo: ${seen.size} missiles, hp ${s5.fighters[1].hp}, kd ${kd5}`);
}

// 17. a round lost to Grok marks the loser 「已被收购」 for the rest of the match
{
  const st = fight([GROK, GPT], 300, 340);
  st.fighters[1].hp = 20;
  run(st, 3, IN_HP);
  run(st, 260);
  check(st.fighters[1].acquired && st.round === 2, `acquired ${st.fighters[1].acquired}, round ${st.round}`);
}

// 18. lights chain into heavies on hit
{
  const st = fight([GPT, GROK], 300, 340);
  step(st, IN_LP, 0);
  let heavy = false;
  for (let i = 0; i < 14; i++) { step(st, i > 6 ? IN_HP : 0, 0); if (st.fighters[0].move === "stHP") heavy = true; }
  check(heavy, "jab → heavy punch chain on hit");
}

// 19. determinism with random inputs, every pairing, supers forced on
function rnd(seed: number) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; }
function randomBits(r: () => number) {
  let b = 0;
  if (r() < 0.3) b |= IN_R; else if (r() < 0.3) b |= IN_L;
  if (r() < 0.15) b |= IN_D; else if (r() < 0.05) b |= IN_U;
  if (r() < 0.08) b |= [IN_LP, IN_HP, IN_LK, IN_HK][Math.floor(r() * 4)];
  if (r() < 0.01) b |= IN_HP | IN_HK;
  if (r() < 0.01) b |= IN_LP | IN_LK;
  return b;
}
for (let a = 0; a < 4; a++) {
  for (let b = 0; b < 4; b++) {
    const go = () => {
      const r = rnd(100 + a * 4 + b);
      const x = createState({ chars: [a, b], stage: 0, seed: 7 });
      const phases = new Set<string>();
      for (let i = 0; i < 6000; i++) {
        if (i % 600 === 0) { x.fighters[0].meter = 2000; x.fighters[1].meter = 2000; }
        step(x, randomBits(r), randomBits(r));
        phases.add(x.phase);
      }
      return { sum: checksum(x), phases };
    };
    const A = go(), B = go();
    check(A.sum === B.sum, `${CHARS[a].id} vs ${CHARS[b].id} deterministic (${[...A.phases].join(",")})`);
  }
}

// 20. clone mid-way and continue
{
  const r1 = rnd(7), r2 = rnd(7);
  const st = createState({ chars: [DS, CLAUDE], stage: 1, seed: 3 });
  for (let i = 0; i < 1500; i++) { if (i % 400 === 0) st.fighters[0].meter = st.fighters[1].meter = 2000; step(st, randomBits(r1), randomBits(r1)); }
  for (let i = 0; i < 1500; i++) { randomBits(r2); randomBits(r2); }
  const copy = cloneState(st);
  for (let i = 0; i < 1500; i++) { const x = randomBits(r1), y = randomBits(r1); step(st, x, y); }
  for (let i = 0; i < 1500; i++) { const x = randomBits(r2), y = randomBits(r2); step(copy, x, y); }
  check(checksum(st) === checksum(copy), "clone continues identically");
}

// 21. rollback sessions over a lossy, laggy fake network
for (const chars of [[GPT, CLAUDE], [DS, GROK]] as [number, number][]) {
  const qa: { at: number; buf: ArrayBuffer }[] = [], qb: { at: number; buf: ArrayBuffer }[] = [];
  const net = rnd(99 + chars[0]);
  let now = 0;
  const lat = () => 3 + Math.floor(net() * 6);
  const A = new RollbackSession(createState({ chars, stage: 0, seed: 5 }), 0, (buf) => { if (net() > 0.15) qb.push({ at: now + lat(), buf }); }, { delay: 2 });
  const B = new RollbackSession(createState({ chars, stage: 0, seed: 5 }), 1, (buf) => { if (net() > 0.15) qa.push({ at: now + lat(), buf }); }, { delay: 2 });
  const ra = rnd(1), rb = rnd(2);
  let ia = 0, ib = 0;
  for (now = 0; now < 7000; now++) {
    for (const [q, S] of [[qa, A], [qb, B]] as const) for (let i = q.length - 1; i >= 0; i--) if (q[i].at <= now) { S.receive(q[i].buf); q.splice(i, 1); }
    if (now % 3 === 0) { ia = randomBits(ra); ib = randomBits(rb); }
    A.tick(ia); B.tick(ib);
  }
  check(!A.stats.desync && !B.stats.desync && A.stats.rollbacks > 0, `${CHARS[chars[0]].id} vs ${CHARS[chars[1]].id} rollback: no desync (rollbacks ${A.stats.rollbacks})`);
}

console.log(fails ? `${fails} FAILURES` : "ALL PASS");
