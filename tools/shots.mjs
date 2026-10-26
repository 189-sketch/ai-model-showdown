// Screenshot gallery of the v2 roster: drives the dev build in headless Chrome, steps the match frame by frame
// (the runner is paused and ticked by hand) and captures every special, super, status and KO screen.
//   node tools/shots.mjs http://localhost:7776/ <out dir>
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const BASE = process.argv[2] ?? "http://localhost:7776/";
const OUT = process.argv[3] ?? ".";
const ONLY = process.argv[4] ? new RegExp(process.argv[4]) : null;
const PORT = 9343;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pks-"))}`, "--mute-audio", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log("JS error", JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
let n = 0;
const shot = async (name) => {
  n++;
  if (ONLY && !ONLY.test(name)) return;
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 85, clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 } });
  writeFileSync(join(OUT, `v${String(n).padStart(2, "0")}_${name}.jpg`), Buffer.from(r.result.data, "base64"));
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: BASE });
await sleep(1500);
// PK_LANG=en|zh picks the interface language
await ev(`localStorage.setItem('pk-lang', ${JSON.stringify(process.env.PK_LANG ?? "zh")}); location.reload(); return 1`);
await sleep(2500);
await ev(`document.querySelector('.cursor-pointer')?.click(); await new Promise(r=>setTimeout(r,600)); [...document.querySelectorAll('button')].find(b=>/训练模式|Training/.test(b.textContent))?.click(); return 1;`);
await sleep(1200);
await shot("select");
await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyJ'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyJ'})); return 1`);
for (let i = 0; i < 50 && !(await ev(`return !!window.__pk`)); i++) await sleep(100);
await sleep(500);

// page-side driver: hold keys for a frame, tick the paused runner, draw
await ev(`
  const pk = window.__pk; pk.paused = true; pk.showBoxes = false;
  const held = new Set();
  const set = (codes) => {
    for (const c of [...held]) if (!codes.includes(c)) { window.dispatchEvent(new KeyboardEvent('keyup', { code: c })); held.delete(c); }
    for (const c of codes) if (!held.has(c)) { window.dispatchEvent(new KeyboardEvent('keydown', { code: c })); held.add(c); }
  };
  window.__f = (seq) => { for (const codes of seq) { set(codes); pk.tick(); } set([]); pk.draw(); };
  window.__n = (k, codes = []) => window.__f(Array.from({ length: k }, () => codes));
  window.__until = (cond, max = 600, codes = []) => { for (let i = 0; i < max; i++) { if (cond(pk.state)) break; set(codes); pk.tick(); } set([]); pk.draw(); };
  const HP = { 0: 1000, 1: 960, 2: 1080, 3: 980 };
  window.__setup = (a, b, xa = 300, xb = 380, opts = {}) => {
    const s = pk.state;
    s.projectiles = []; s.fx = []; s.cineT = 0; s.superFreeze = 0; s.freeze = 0;
    [a, b].forEach((c, i) => {
      const f = s.fighters[i];
      Object.assign(f, { char: c, hp: HP[c], meter: 2000, state: 'idle', sf: 0, move: null, y: 0, vx: 0, vy: 0, pushVx: 0, combo: 0, stun: 0,
        ban: 0, banCd: 0, unban: 0, ultra: 0, muscle: 0, busy: 0, gpl: 0, noted: 0, invuln: 0, facing: i === 0 ? 1 : -1, acquired: false });
      f.x = i === 0 ? xa : xb;
    });
    Object.assign(s, opts);
    window.__n(2);
  };
  window.__n(140);
  return 1;
`);
const f = (js) => ev(`${js}; return 1`);
// P1 faces right: ↓↘→ = S, S+D, D · ↓↙← = S, S+A, A
const QCF = (b) => `[['KeyS'],['KeyS','KeyD'],['KeyD'],['KeyD','${b}']]`;
const QCB = (b) => `[['KeyS'],['KeyS','KeyA'],['KeyA'],['KeyA','${b}']]`;
const LP = "KeyJ", LK = "KeyK", HP = "KeyU", HK = "KeyI";
const GPT = 0, CLAUDE = 1, DS = 2, GROK = 3;

await f(`__setup(${GPT}, ${CLAUDE})`); await shot("idle_hud");
for (const [k, name] of ["launch", "datacenter", "colosseum"].entries()) {
  await f(`__setup(${[GPT, DS, GROK][k]}, ${[CLAUDE, GROK, GPT][k]}, 300, 380, { stage: ${k} })`); await shot(`stage_${name}`);
}

// ── ChatGPT ──
await f(`__setup(${GPT}, ${CLAUDE}, 220, 420); __f(${QCF(HP)}); __n(16)`); await shot("gpt_card");
await f(`__until(s => s.fx.some(x => x.kind === 'say'), 80); __n(6)`); await shot("gpt_card_hit");
await f(`__setup(${GPT}, ${GROK}, 300, 352); __f(${QCB(LP)}); __n(6)`); await shot("gpt_catch_stance");
await ev(`window.__pk.state.fighters[1].buf = [0, 7, 0, 0]; window.__pk.state.fighters[1].prevBits = 0; window.__n(1); window.__until(s => s.fighters[0].state === 'throwing' && s.fighters[0].sf > 14, 40); return 1`); await shot("gpt_catch_throw");
await f(`__setup(${GPT}, ${GROK}, 300, 360); __f(${QCB(HK)}); __n(30)`); await shot("gpt_agent");
await f(`__until(s => s.fighters[1].state === 'kd', 80); __n(2)`); await shot("gpt_agent_confirm");
await f(`__setup(${GPT}, ${DS}, 220, 400); __f([['KeyU','KeyI']]); __n(40)`); await shot("gpt_ultra_cine_a");
await f(`__n(60)`); await shot("gpt_ultra_cine_b");
await f(`__until(s => s.cineT === 0, 200); __n(30); __f(${QCF(LP)}); __n(18)`); await shot("gpt_ultra_cards");

// ── Claude ──
await f(`__setup(${CLAUDE}, ${GROK}, 200, 330); __f(${QCF(HP)}); __n(20)`); await shot("claude_notice");
await f(`__until(s => s.fighters[1].ban > 0, 120); __until(s => s.fighters[1].state === 'idle', 60)`); await shot("claude_banned");
await f(`__until(s => s.fighters[1].unban > 0 && s.fighters[1].unban < 76, 160)`); await shot("claude_unban");
// the dummy can't take keys: put Claude straight into the 你说得完全对 stance as the card arrives
await f(`__setup(${GPT}, ${CLAUDE}, 200, 330); __f(${QCF(HP)}); __until(s => s.projectiles.some(p => p.kind==='card' && Math.abs(p.x - s.fighters[1].x) < 60), 60);
  Object.assign(window.__pk.state.fighters[1], { state: 'attack', move: 'agreeL', sf: 0, hitCount: 0 })`);
await f(`__until(s => s.projectiles.some(p => p.owner === 1), 40); __n(6)`); await shot("claude_reflect");
await f(`__setup(${CLAUDE}, ${GPT}, 220, 400); __f(${QCB(HK)}); __n(40)`); await shot("claude_artifact");
await f(`__setup(${CLAUDE}, ${DS}, 300, 350); __f([['KeyU','KeyI']]); __until(s => s.cineT > 0, 120); __n(30)`); await shot("claude_ban_cine_a");
await f(`__n(40)`); await shot("claude_ban_cine_b");
await f(`__until(s => s.cineT === 0 && s.fighters[1].state === 'down', 200)`); await shot("claude_ban_after");

// ── DeepSeek ──
await f(`__setup(${DS}, ${GROK}, 200, 420); __f(${QCF(LP)}); __n(20)`); await shot("ds_mit");
await f(`__setup(${DS}, ${GROK}, 200, 420); __f(${QCF(HP)}); __n(30)`); await shot("ds_gpl");
await f(`__until(s => s.fighters[1].gpl > 0, 120); __n(40)`); await shot("ds_gpl_infected");
await f(`__setup(${DS}, ${GROK}, 300, 345); __f(${QCB(HP)}); __n(8)`); await shot("ds_think");
await f(`__n(14)`); await shot("ds_uppercut");
await f(`__setup(${DS}, ${GPT}, 200, 380); __f(${QCB(HK)}); __n(40)`); await shot("ds_maid_run");
await f(`__until(s => s.projectiles.some(p => p.kind==='maid' && p.mode === 1 && p.mt > 12), 160)`); await shot("ds_maid_bonk");
await f(`__until(s => s.projectiles.some(p => p.kind==='maid' && p.mode === 2 && p.mt > 16), 160)`); await shot("ds_maid_spout");
await f(`__setup(${DS}, ${GROK}, 300, 400); __f([['KeyU','KeyI']]); __until(s => s.superFreeze === 0, 60); __n(24)`); await shot("ds_transform");
await f(`__until(s => s.fighters[0].muscle > 0 && s.fighters[0].state === 'idle', 80); __n(10)`); await shot("ds_liangsheng");
await f(`window.__pk.state.fighters[1].x = 360; __f([['KeyU']]); __n(14)`); await shot("ds_iron_fist");
await f(`__n(40); __f([['KeyI']]); __n(18)`); await shot("ds_stomp");
await f(`window.__pk.state.fighters[0].muscle = 2; __n(20)`); await shot("ds_revert");
await f(`__n(50)`); await shot("ds_busy");

// ── Grok ──
await f(`__setup(${GROK}, ${CLAUDE}, 160, 420); __f(${QCF(LP)}); __n(24)`); await shot("grok_rocket");
await f(`__until(s => s.projectiles.some(p => p.kind==='rocket' && Math.abs(p.x - s.fighters[1].x) < 50), 80); __f([['KeyJ']]); __n(4)`); await shot("grok_detonate");
await f(`__setup(${GROK}, ${CLAUDE}, 200, 400); __f(${QCF(HP)}); __n(38)`); await shot("grok_rocket_arc");
await f(`__setup(${GROK}, ${DS}, 300, 348); __f(${QCB(LP)}); __n(14)`); await shot("grok_note");
await f(`__n(30)`); await shot("grok_noted");
await f(`__setup(${GROK}, ${DS}, 220, 330); __f(${QCB(HK)}); __n(14)`); await shot("grok_roadster_a");
await f(`__n(14)`); await shot("grok_roadster_b");
await f(`__setup(${GROK}, ${DS}, 200, 380); __f([['KeyU','KeyI']]); __until(s => s.superFreeze === 0, 60); __n(50)`); await shot("grok_salvo");
await f(`__n(30)`); await shot("grok_salvo_b");

// ── dodge ──
await f(`__setup(${GPT}, ${GROK}, 300, 345); __f([['KeyJ','KeyK']]); __n(9)`); await shot("dodge");

// ── KO screens + 已被收购 ──
for (const [w, l] of [[GROK, GPT], [GPT, CLAUDE], [GROK, DS], [GPT, GROK]]) {
  await ev(`window.__pk.state.training = false; return 1`);
  await f(`__setup(${w}, ${l}, 300, 345); window.__pk.state.fighters[1].hp = 5; __f([['KeyU']]); __until(s => s.phase === 'ko' && s.phaseFrame > 60, 300)`);
  await shot(`ko_${["chatgpt", "claude", "deepseek", "grok"][l]}`);
  await f(`__until(s => s.phase === 'intro' || s.phase === 'matchEnd', 300); __n(20)`);
  await ev(`const s = window.__pk.state; s.phase = 'fight'; s.round = 1; s.fighters.forEach(f => f.wins = 0); s.training = true; return 1`);
}
await f(`__setup(${GROK}, ${GPT}); window.__pk.state.fighters[1].acquired = true; __n(2)`); await shot("acquired");

console.log("shots", n);
chrome.kill(); process.exit(0);
