/**
 * The four skill-showcase films (and, later, the trailer). Each shot sets up a fresh match state, scripts
 * both pads, and waits on game conditions so every move really connects; jokes get slow motion, a camera
 * push-in and a 「名场面」 sticker.
 */

import { IN_HK, IN_HP, IN_LK, IN_LP } from "@/game/constants";
import { ACCENT, Director } from "./engine";
import { gagSticker, introCard, moveCaption, outroCard, sectionChip } from "./kit";
import { TRAILER_TEXT, trailer } from "./trailer";

const LP = IN_LP, HP = IN_HP, LK = IN_LK, HK = IN_HK;
const GPT = 0, CLAUDE = 1, DS = 2, GROK = 3;
const LAUNCH = 0, DATACENTER = 1, COLOSSEUM = 2;

type Film = (d: Director) => AsyncGenerator<void>;

const dist = (d: Director) => Math.abs(d.s!.fighters[1].x - d.s!.fighters[0].x);

/** A short beat of play with a caption on screen for the whole shot. */
async function* shot(d: Director, frames: number) {
  d.flash(5);
  yield* d.run(frames);
}

// every caption string, so the recorder can load its glyphs up front
export const FILM_TEXT: string[] = [];
const T = (s: string) => (FILM_TEXT.push(s), s);

// ───────────────────────── ChatGPT ─────────────────────────

const chatgpt: Film = async function* (d) {
  const A = ACCENT.chatgpt;
  yield* introCard(d, "chatgpt", LAUNCH);

  // basics: lights chain into heavies
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [300, 352] });
  sectionChip(d, "BASICS", T("普通技"), A, 290);
  moveCaption(d, { input: T("轻拳 → 重拳"), name: T("基础连段"), accent: A }, 280);
  d.pads[0].wait(24).tap(LP).wait(5).tap(HP).wait(60).push(2, 0, 4).push(2, LK).push(2, 0, 6).push(2, LP).push(2, 0, 8).push(2, HK).push(2, 0, 30);
  yield* shot(d, 290);

  // reset card (light): the opponent's meter is wiped by 300
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [250, 450], training: false, meter: [0, 1000] });
  sectionChip(d, "SPECIAL 1", T("必杀技"), A, 420);
  moveCaption(d, { input: "↓↘→ + 拳", name: "重置卡", note: T("命中：对手能量 −300"), accent: A }, 420);
  d.pads[0].wait(20).motion("236", LP);
  yield* d.until((s) => s.fighters[1].state === "hitstun", 160);
  d.check(d.s!.fighters[1].meter <= 760, `card drained meter → ${d.s!.fighters[1].meter}`);
  d.slow = 3;
  d.focus(1, 1.55, -70);
  gagSticker(d, T("额度已重置"), 170, 6);
  yield* d.run(90);
  d.slow = 1;
  d.zoom(400, 240, 1.7, 0.08); // over to the opponent's power gauge
  yield* d.run(80);
  d.unzoom();
  yield* d.run(40);

  // reset card (heavy): fast
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [250, 450] });
  moveCaption(d, { input: "↓↘→ + 重拳", name: T("重置卡 · 重版"), note: T("飞得更快"), accent: A }, 150);
  d.pads[0].wait(10).motion("236", HP);
  yield* shot(d, 150);

  // I've got you: catches a jump-in and throws
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [300, 430] });
  sectionChip(d, "SPECIAL 2", T("必杀技"), A, 420);
  moveCaption(d, { input: "↓↙← + 拳", name: "稳稳接住你", note: T("接住拳脚、跳攻，甩出去"), accent: A }, 420);
  d.pads[1].wait(16).push(9, 0, 2).wait(26).tap(HK); // the kick comes out on the way down
  yield* d.until((s) => s.fighters[1].y > 10 && s.fighters[1].vy < 0 && dist(d) < 90, 120);
  d.pads[0].motion("214", LP);
  yield* d.until((s) => s.fighters[0].state === "throwing", 80);
  d.check(d.s!.fighters[0].state === "throwing", "catch grabbed the jump-in");
  d.slow = 2;
  d.focus(0, 1.45, -70);
  gagSticker(d, T("我会稳稳接住你"), 230, 4);
  yield* d.run(170);
  d.slow = 1;
  d.unzoom();
  yield* d.run(60);

  // Agent mode: four clicks and 「确认」
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [300, 360] });
  sectionChip(d, "SPECIAL 3", T("必杀技"), A, 300);
  moveCaption(d, { input: "↓↙← + 脚", name: "Agent 代操作", note: T("连点 4 下，「确认 ✓」击倒"), accent: A }, 300);
  d.pads[0].wait(16).motion("214", HK);
  yield* d.until((s) => s.fighters[1].combo >= 4, 120);
  d.slow = 2;
  d.focus(1, 1.35, -60);
  yield* d.until((s) => s.fighters[1].state === "kd", 80);
  d.check(d.s!.fighters[1].state === "kd", "agent knocked down");
  gagSticker(d, T("确认 ✓：替你点了"), 170);
  yield* d.run(110);
  d.slow = 1;
  d.unzoom();
  yield* d.run(50);

  // Ultra: the slider cut-in, then three cards at once and catching a projectile
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [250, 420] });
  sectionChip(d, "SUPER", T("超必杀"), A, 520);
  moveCaption(d, { input: "重拳 + 重脚", name: "Ultra · Effort 拉满", note: T("8 秒内更快、更痛"), accent: A }, 300);
  d.pads[0].wait(16).both(HP | HK);
  yield* d.until((s) => s.fighters[0].ultra > 0, 200);
  d.check(d.s!.fighters[0].ultra > 0, "ultra active");
  yield* d.run(30);
  moveCaption(d, { input: "↓↘→ + 拳", name: T("Ultra：一次 3 张卡"), accent: A }, 150);
  d.pads[0].motion("236", LP);
  yield* d.run(120);
  moveCaption(d, { input: "↓↙← + 拳", name: T("Ultra：飞行道具也能接"), accent: A }, 230);
  d.pads[1].motion("236", HP);
  yield* d.until((s) => s.projectiles.some((p) => p.kind === "notice" && Math.abs(p.x - s.fighters[0].x) < 100), 120);
  d.pads[0].motion("214", LP);
  yield* d.until((s) => s.fx.some((f) => f.kind === "say" && f.text === "稳稳接住了"), 90);
  d.check(d.s!.fx.some((f) => f.text === "稳稳接住了"), "ultra caught the notice");
  d.slow = 2;
  d.focus(0, 1.4, -70);
  gagSticker(d, T("稳稳接住了"), 160, 4);
  yield* d.run(130);
  d.slow = 1;
  d.unzoom();
  yield* d.run(40);

  // combo
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [300, 350] });
  sectionChip(d, "COMBO", T("连段"), A, 220);
  moveCaption(d, { input: T("↓轻脚 → ↓轻拳 → ↓↘→ + 拳"), name: T("下段连段"), accent: A }, 220);
  d.pads[0].wait(14).push(2, 0, 2).push(2, LK).push(2, 0, 7).push(2, LP).push(3).push(3).push(6).push(6, LP).push(5, 0, 40);
  yield* shot(d, 220);

  // KO: Claude's 「对话已达长度上限」
  d.setup({ chars: [GPT, CLAUDE], stage: LAUNCH, x: [300, 352], training: false, hp: [1000, 40] });
  moveCaption(d, { name: T("KO 彩蛋"), accent: A }, 260);
  d.pads[0].wait(10).tap(HP);
  yield* d.until((s) => s.phase === "ko" && s.phaseFrame > 40, 200);
  d.zoom(240, 175, 1.3, 0.06);
  yield* d.run(220);
  d.unzoom();
  yield* d.run(20);

  yield* outroCard(d, "chatgpt", 3);
};

// ───────────────────────── Claude ─────────────────────────

const claude: Film = async function* (d) {
  const A = ACCENT.claude;
  yield* introCard(d, "claude", COLOSSEUM);

  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [300, 352] });
  sectionChip(d, "BASICS", "普通技", A, 260);
  moveCaption(d, { input: "轻拳 → 重拳", name: T("基础连段"), accent: A }, 250);
  d.pads[0].wait(24).tap(LP).wait(5).tap(HP).wait(60).push(2, 0, 4).push(2, LK).push(2, 0, 6).push(2, LP).push(2, 0, 30);
  yield* shot(d, 260);

  // policy notice: banned for a second, then the unban bubble
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [230, 400], training: false });
  sectionChip(d, "SPECIAL 1", "必杀技", A, 760);
  moveCaption(d, { input: "↓↘→ + 拳", name: "使用政策审查", note: T("命中封禁 1 秒"), accent: A }, 300);
  d.pads[0].wait(16).motion("236", HP);
  yield* d.until((s) => s.fighters[1].ban > 0, 200);
  d.check(d.s!.fighters[1].ban > 0, "notice banned ChatGPT");
  d.slow = 3;
  d.focus(1, 1.5, -80);
  gagSticker(d, T("封禁中：出不了招"), 260, 10);
  // the banned fighter mashes buttons: nothing comes out
  d.pads[1].wait(24);
  for (let k = 0; k < 8; k++) d.pads[1].tap([LP, HP, LK, HK][k % 4]).wait(2);
  yield* d.until((s) => s.fighters[1].unban > 0, 400);
  d.slow = 2;
  gagSticker(d, T("叮！已解封"), 150, 0, [1560, 330]);
  yield* d.run(120);
  d.slow = 1;
  d.unzoom();
  moveCaption(d, { name: T("解封后 4 秒免封"), accent: A }, 200);
  d.zoom(380, 50, 1.6, 0.08);
  yield* d.run(160);
  d.unzoom();
  yield* d.run(30);

  // you're absolutely right: reflects ChatGPT's own reset card back at him
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [230, 420], training: false, meter: [0, 1000] });
  sectionChip(d, "SPECIAL 2", "必杀技", A, 520);
  moveCaption(d, { input: "↓↙← + 拳", name: "你说得完全对！", note: T("飞行道具原样打回"), accent: A }, 260);
  d.pads[1].wait(20).motion("236", LP);
  yield* d.until((s) => s.projectiles.some((p) => p.kind === "card" && p.owner === 1 && Math.abs(p.x - s.fighters[0].x) < 105), 160);
  d.pads[0].motion("214", LP);
  yield* d.until((s) => s.projectiles.some((p) => p.kind === "card" && p.owner === 0), 40);
  d.check(d.s!.projectiles.some((p) => p.kind === "card" && p.owner === 0), "card reflected");
  d.slow = 2;
  d.focus(0, 1.35, -70);
  yield* d.run(60);
  d.focus(1, 1.45, -70, 0.14);
  yield* d.until((s) => s.fighters[1].state === "hitstun" || s.fighters[1].state === "kd", 80);
  gagSticker(d, T("打中自己：额度已重置"), 240, 4);
  yield* d.run(160);
  d.slow = 1;
  d.unzoom();
  yield* d.run(40);

  // parry: punches and kicks get turned into a palm strike
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [300, 380] });
  moveCaption(d, { input: "↓↙← + 拳", name: T("接到拳脚就招架"), note: T("反手一记掌击"), accent: A }, 200);
  d.pads[1].wait(18).push(6, 0, 10).tap(HP);
  d.pads[0].wait(20).motion("214", LP);
  yield* shot(d, 200);

  // artifact: a code window that eats one projectile
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [230, 450] });
  sectionChip(d, "SPECIAL 3", "必杀技", A, 240);
  moveCaption(d, { input: "↓↙← + 脚", name: "Artifact 生成", note: T("挡下飞行道具"), accent: A }, 240);
  d.pads[0].wait(10).motion("214", HK);
  d.pads[1].wait(46).motion("236", HP);
  yield* shot(d, 240);

  // super: unblockable stamp → the account suspension page
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [300, 355] });
  d.pads[1].rest = { d: 1, b: 0 }; // ChatGPT crouch-blocks: it doesn't help
  sectionChip(d, "SUPER", "超必杀", A, 420);
  moveCaption(d, { input: "重拳 + 重脚", name: "你的账号已被封禁", note: T("红章不可防御"), accent: A }, 160);
  d.pads[0].wait(12).both(HP | HK);
  yield* d.until((s) => s.cineT > 0, 150);
  d.check(d.s!.cineT > 0, "stamp cut-in");
  gagSticker(d, T("申诉：不可用"), 150, 60, [1560, 330]);
  yield* d.until((s) => s.cineT === 0, 200);
  moveCaption(d, { name: T("附送封禁 1 秒"), accent: A }, 140);
  yield* d.run(130);
  // …but it can be dodged
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [300, 355] });
  moveCaption(d, { input: T("轻拳 + 轻脚"), name: T("闪避躲开"), note: T("翻滚开头无敌"), accent: A }, 200);
  d.pads[0].wait(12).both(HP | HK);
  yield* d.until((s) => s.superFreeze === 0 && s.fighters[0].state === "attack" && s.fighters[0].sf > 6, 120);
  d.pads[1].both(LP | LK);
  d.slow = 2;
  yield* d.run(70);
  d.slow = 1;
  yield* d.run(80);

  // KO: ChatGPT's 「Something went wrong」 and the regenerate button that presses itself
  d.setup({ chars: [CLAUDE, GPT], stage: COLOSSEUM, x: [300, 352], training: false, hp: [960, 40] });
  moveCaption(d, { name: T("KO 彩蛋"), accent: A }, 260);
  d.pads[0].wait(10).tap(HP);
  yield* d.until((s) => s.phase === "ko" && s.phaseFrame > 40, 200);
  d.zoom(240, 175, 1.3, 0.06);
  yield* d.run(220);
  d.unzoom();
  yield* d.run(20);

  yield* outroCard(d, "claude", 4);
};

// ───────────────────────── DeepSeek ─────────────────────────

const deepseek: Film = async function* (d) {
  const A = ACCENT.deepseek;
  yield* introCard(d, "deepseek", DATACENTER);

  d.setup({ chars: [DS, GROK], stage: DATACENTER, x: [300, 352] });
  sectionChip(d, "BASICS", "普通技", A, 260);
  moveCaption(d, { input: "轻拳 → 重拳", name: T("基础连段"), note: T("重脚高踢可对空"), accent: A }, 250);
  d.pads[0].wait(24).tap(LP).wait(5).tap(HP).wait(60).tap(HK).wait(30);
  yield* shot(d, 260);

  // MIT scroll: refunds meter
  d.setup({ chars: [DS, GROK], stage: DATACENTER, x: [230, 420], training: false, meter: [200, 0] });
  sectionChip(d, "SPECIAL 1", "必杀技", A, 520);
  moveCaption(d, { input: "↓↘→ + 拳", name: "MIT 卷轴", note: T("命中回 150 能量"), accent: A }, 260);
  d.pads[0].wait(14).motion("236", LP);
  yield* d.until((s) => s.fighters[1].state === "hitstun", 120);
  d.check(d.s!.fighters[0].meter >= 340, `MIT meter → ${d.s!.fighters[0].meter}`);
  d.slow = 2;
  d.zoom(80, 240, 1.7, 0.1); // own power gauge
  gagSticker(d, T("MIT：随便用"), 190, 4);
  yield* d.run(160);
  d.slow = 1;
  d.unzoom();
  // GPL scroll: infects and bleeds
  moveCaption(d, { input: "↓↘→ + 重拳", name: "GPL 卷轴", note: T("感染 4 秒，持续扣血"), accent: A }, 280);
  d.pads[0].wait(30).motion("236", HP);
  yield* d.until((s) => s.fighters[1].gpl > 0, 160);
  d.check(d.s!.fighters[1].gpl > 0, "GPL infected");
  d.zoom(380, 30, 1.7, 0.1); // the opponent's health bar turning green
  gagSticker(d, T("GPL：传染给你！"), 240, 10, [1400, 470]);
  yield* d.run(260);
  d.unzoom();
  yield* d.run(30);

  // deep thinking: thinks, then the uppercut
  d.setup({ chars: [DS, GROK], stage: DATACENTER, x: [300, 420] });
  sectionChip(d, "SPECIAL 2", "必杀技", A, 330);
  moveCaption(d, { input: "↓↙← + 拳", name: "已深度思考", note: T("先思考，再升龙对空"), accent: A }, 330);
  d.pads[1].wait(16).push(9, 0, 2).wait(24).tap(HK);
  yield* d.until((s) => s.fighters[1].y > 10 && s.fighters[1].vy < 0 && dist(d) < 110, 120);
  d.pads[0].motion("214", HP);
  d.slow = 2;
  d.focus(0, 1.35, -90);
  gagSticker(d, T("想了 0.8 秒才出拳"), 170, 8);
  yield* d.until((s) => s.fighters[1].state === "kd", 140);
  d.check(d.s!.fighters[1].state === "kd", "uppercut anti-air");
  yield* d.run(60);
  d.slow = 1;
  d.unzoom();
  yield* d.run(40);

  // whale maid
  d.setup({ chars: [DS, GROK], stage: DATACENTER, x: [230, 420] });
  sectionChip(d, "SPECIAL 3", "必杀技", A, 330);
  moveCaption(d, { input: "↓↙← + 脚", name: "召唤鲸鱼女仆", note: T("托盘拍两下，再喷水柱"), accent: A }, 330);
  d.pads[0].wait(12).motion("214", HK);
  yield* d.until((s) => s.projectiles.some((p) => p.kind === "maid" && p.mode === 1), 160);
  d.focus(1, 1.3, -40);
  yield* d.until((s) => s.fighters[1].state === "kd", 160);
  d.check(d.s!.fighters[1].state === "kd", "maid spout knocked down");
  yield* d.run(90);
  d.unzoom();
  yield* d.run(30);

  // 梁圣降临: armour, iron fist, stomp — and 服务器繁忙 when it ends
  d.setup({ chars: [DS, GROK], stage: DATACENTER, x: [300, 380] });
  sectionChip(d, "SUPER", "超必杀", A, 900);
  moveCaption(d, { input: "重拳 + 重脚", name: "梁圣降临", note: T("变身 10 秒：攻击 +30%、霸体"), accent: A }, 300);
  d.pads[0].wait(12).both(HP | HK);
  yield* d.until((s) => s.fighters[0].muscle > 0, 160);
  d.check(d.s!.fighters[0].muscle > 0, "transformed");
  d.focus(0, 1.35, -110);
  yield* d.run(160);
  d.unzoom();
  moveCaption(d, { name: T("霸体：挨打照样出招"), accent: A }, 240);
  d.s!.fighters[1].x = d.s!.fighters[0].x + 70;
  d.pads[0].wait(10).tap(HP);
  d.pads[1].wait(14).tap(LP);
  d.slow = 2;
  yield* d.run(90);
  d.slow = 1;
  yield* d.run(40);
  moveCaption(d, { input: "重脚", name: "踏地震波", note: T("下段击倒"), accent: A }, 150);
  d.s!.fighters[1].x = d.s!.fighters[0].x + 80;
  d.pads[0].wait(8).tap(HK);
  yield* d.run(150);
  // skip ahead to the end of the form
  d.s!.fighters[0].muscle = 20;
  d.s!.fighters[1].x = d.s!.fighters[0].x + 110;
  moveCaption(d, { name: T("变身结束"), note: T("喘气 1.5 秒，放不了必杀"), accent: A }, 280);
  yield* d.until((s) => s.fighters[0].busy > 0, 60);
  d.focus(0, 1.45, -90);
  gagSticker(d, T("服务器繁忙，请稍后再试"), 280, 20);
  d.pads[0].wait(70).motion("236", LP); // tries a scroll: nothing
  yield* d.run(260);
  d.unzoom();
  yield* d.run(30);

  // KO: Grok's rapid unscheduled disassembly
  d.setup({ chars: [DS, GROK], stage: DATACENTER, x: [300, 352], training: false, hp: [1080, 40] });
  moveCaption(d, { name: T("KO 彩蛋"), accent: A }, 260);
  d.pads[0].wait(10).tap(HP);
  yield* d.until((s) => s.phase === "ko" && s.phaseFrame > 40, 200);
  d.zoom(240, 175, 1.3, 0.06);
  yield* d.run(220);
  d.unzoom();
  yield* d.run(20);

  yield* outroCard(d, "deepseek", 2.5);
};

// ───────────────────────── Grok ─────────────────────────

const grok: Film = async function* (d) {
  const A = ACCENT.grok;
  yield* introCard(d, "grok", LAUNCH);

  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [300, 352] });
  sectionChip(d, "BASICS", "普通技", A, 260);
  moveCaption(d, { input: "轻拳 → 重拳", name: T("基础连段"), note: T("移动最快"), accent: A }, 250);
  d.pads[0].wait(24).tap(LP).wait(5).tap(HP).wait(50).push(6, 0, 30).tap(HK).wait(20);
  yield* shot(d, 260);

  // rockets: straight, arcing, and blown up mid-flight
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [200, 450] });
  sectionChip(d, "SPECIAL 1", "必杀技", A, 640);
  moveCaption(d, { input: "↓↘→ + 拳", name: "火箭发射", note: T("水平飞行"), accent: A }, 150);
  d.pads[0].wait(12).motion("236", LP);
  yield* shot(d, 130);
  moveCaption(d, { input: "↓↘→ + 重拳", name: T("火箭发射 · 重版"), note: T("先升空再砸下"), accent: A }, 160);
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [200, 420] });
  d.pads[0].wait(8).motion("236", HP);
  yield* shot(d, 150);
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [160, 460] });
  moveCaption(d, { input: T("飞行中按拳"), name: T("当场引爆"), accent: A }, 240);
  d.pads[0].wait(8).motion("236", LP);
  yield* d.until((s) => s.projectiles.some((p) => p.kind === "rocket" && Math.abs(p.x - s.fighters[1].x) < 46), 150);
  d.pads[0].clear().tap(LP);
  d.slow = 3;
  d.focus(1, 1.4, -60);
  gagSticker(d, T("快速计划外解体！"), 230, 4);
  yield* d.run(170);
  d.check(d.cues.some((c) => c.id === "detonate"), "detonated");
  d.slow = 1;
  d.unzoom();
  yield* d.run(40);

  // community note: +15% damage taken
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [300, 350] });
  sectionChip(d, "SPECIAL 2", "必杀技", A, 330);
  moveCaption(d, { input: "↓↙← + 拳", name: "社群注记", note: T("5 秒内受伤 +15%"), accent: A }, 330);
  d.pads[0].wait(12).motion("214", LP);
  yield* d.until((s) => s.fighters[1].noted > 0, 80);
  d.check(d.s!.fighters[1].noted > 0, "note stuck");
  d.slow = 2;
  d.focus(1, 1.5, -70);
  gagSticker(d, T("Grok，这是真的吗？"), 240, 6);
  yield* d.run(170);
  d.slow = 1;
  d.unzoom();
  d.pads[0].wait(20).tap(HP);
  yield* d.run(100);

  // Roadster 2: invincible hop, crushes on landing
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [240, 360] });
  d.pads[1].rest = { d: 1, b: 0 }; // DeepSeek crouch-blocks: the landing is an overhead
  sectionChip(d, "SPECIAL 3", "必杀技", A, 300);
  moveCaption(d, { input: "↓↙← + 脚", name: "Roadster 2 翻转飞跃", note: T("落地砸人，要站着防"), accent: A }, 300);
  d.pads[0].wait(12).motion("214", HK);
  yield* d.until((s) => s.fighters[0].move?.startsWith("roadster") === true && s.fighters[0].sf > 12, 80);
  d.slow = 2;
  d.focus(0, 1.25, -90, 0.08);
  yield* d.until((s) => s.fighters[1].state === "kd", 140);
  d.check(d.s!.fighters[1].state === "kd", "roadster crushed a croucher");
  yield* d.run(40);
  d.slow = 1;
  d.unzoom();
  yield* d.run(60);

  // super: starship salvo
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [240, 380] });
  sectionChip(d, "SUPER", "超必杀", A, 330);
  moveCaption(d, { input: "重拳 + 重脚", name: "星舰齐射", note: T("6 枚火箭轮番轰炸"), accent: A }, 330);
  d.pads[0].wait(10).both(HP | HK);
  yield* shot(d, 330);

  // a round lost to Grok: 「（已被收购）」 on the nameplate for the rest of the match
  d.setup({ chars: [GROK, DS], stage: LAUNCH, x: [300, 352], training: false, hp: [980, 40] });
  sectionChip(d, "ACQUIRED", T("收购"), A, 560);
  moveCaption(d, { name: T("赢一回合就收购"), note: T("对手名牌变「已被收购」"), accent: A }, 330);
  d.pads[0].wait(10).tap(HP);
  yield* d.until((s) => s.phase === "ko" && s.phaseFrame > 40, 200);
  d.zoom(240, 175, 1.3, 0.06);
  yield* d.run(120);
  d.unzoom();
  yield* d.until((s) => s.phase === "intro" && s.phaseFrame > 10, 260);
  d.check(d.s!.fighters[1].acquired, "acquired nameplate");
  d.zoom(400, 40, 1.8, 0.1);
  gagSticker(d, T("恭喜，你被收购了"), 260, 10);
  yield* d.run(260);
  d.unzoom();
  yield* d.run(20);

  yield* outroCard(d, "grok", 3);
};

export const FILMS: Record<string, Film> = { chatgpt, claude, deepseek, grok, trailer };
export const FILM_BGM: Record<string, string> = { chatgpt: "bgm_launch", claude: "bgm_colosseum", deepseek: "bgm_datacenter", grok: "bgm_launch" };

// strings used directly in kit.ts
FILM_TEXT.push(...TRAILER_TEXT);
FILM_TEXT.push("名场面", "技能演示", "SKILL SHOWCASE", "浏览器打开就能玩 · 单人闯关 · 本地双人 · 联机对战", "谁才是最强AI大模型");
