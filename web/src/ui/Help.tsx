import { useEffect } from "react";
import { CHARS } from "@/game/chars";
import { tx } from "@/lib/i18n";
import { Face, Key, Screen, TopBar } from "./common";

const ROWS: [string, string[], string[]][] = [
  ["移动 / 跳 / 蹲", ["W", "A", "S", "D"], ["↑", "←", "↓", "→"]],
  ["轻拳", ["J"], ["小键盘1", ","]],
  ["轻脚", ["K"], ["小键盘2", "."]],
  ["重拳", ["U"], ["小键盘4", "L"]],
  ["重脚", ["I"], ["小键盘5", ";"]],
  ["闪避", ["J", "K"], ["小键盘1", "小键盘2"]],
  ["超必杀", ["U", "I"], ["小键盘4", "小键盘5"]],
];

// rows whose keys are pressed together
const COMBO_ROWS = ["闪避", "超必杀"];

const TIPS = [
  "每个角色按法都一样：↓↘→ + 拳、↓↙← + 拳、↓↙← + 脚 三个必杀，轻键出轻版、重键出重版",
  "重拳 + 重脚 同时按：超必杀（要 1 格能量）；必杀技命中后也能直接接超必杀",
  "轻拳 + 轻脚 同时按：闪避翻滚，穿过对手、开头无敌；按住后退再按就往后滚；防御中也能闪，但要半格能量",
  "按住「后」防御：蹲防挡下段，站防挡跳攻；Claude 的大章不能防，只能闪",
  "轻攻击命中后可以接重攻击；贴身「前或后 + 重拳」投技，被投时立刻按重拳可拆投",
  "血条下方是状态：封禁（不能出招）、Ultra、梁圣、服务器繁忙、GPL 感染、社群注记",
  "支持手柄：X 轻拳 · A 轻脚 · Y 重拳 · B 重脚 · LB 闪避 · RB 超必杀",
];

/** "↓↘→ + 拳" → direction chips + button chip */
function Input({ text }: { text: string }) {
  const [dirs, btn] = tx(text).split(" + ");
  return (
    <span className="flex shrink-0 items-center gap-1">
      {btn !== undefined ? (
        <>
          <span className="font-ui -skew-x-12 bg-white/10 px-1.5 py-0.5 text-sm tracking-tight text-[var(--cyan)]">{dirs}</span>
          <span className="text-white/40">+</span>
          <span className="font-ui -skew-x-12 bg-[var(--gold)] px-1.5 py-0.5 text-xs font-black text-[var(--ink)]">{btn}</span>
        </>
      ) : (
        <span className="font-ui -skew-x-12 bg-[var(--gold)] px-1.5 py-0.5 text-xs font-black text-[var(--ink)]">{dirs}</span>
      )}
    </span>
  );
}

export function Help({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyK") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <Screen>
      <TopBar title={tx("操作说明")} en="HOW TO PLAY" onBack={onBack} right={<span className="font-ui text-xs text-white/50">{tx("方向以面朝右为准：→ 为「前」")}</span>} />
      <main className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-[4vw]">
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[1fr_1.35fr]">
          <section className="rise flex flex-col gap-4">
            <div className="bg-black/55 p-4 ring-1 ring-white/12 backdrop-blur">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="font-ui text-lg font-black">{tx("按键")}</span>
                <span className="font-num text-xs italic tracking-[0.3em] text-white/40">CONTROLS</span>
              </div>
              <div className="font-ui grid grid-cols-[auto_1fr_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
                <span />
                <span className="font-num text-xs italic tracking-widest text-[var(--red)]">1P</span>
                <span className="font-num text-xs italic tracking-widest text-[var(--blue)]">{tx("2P · 本地双人")}</span>
                {ROWS.map(([label, p1, p2]) => (
                  <div key={label} className="contents">
                    <span className="font-bold text-white/70">{tx(label)}</span>
                    <span className="flex flex-wrap items-center gap-1">
                      {p1.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && COMBO_ROWS.includes(label) && <span className="text-xs text-white/40">+</span>}
                          <Key>{k}</Key>
                        </span>
                      ))}
                    </span>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-white/40">
                      {p2.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && label !== "移动 / 跳 / 蹲" && (COMBO_ROWS.includes(label) ? "+" : tx("或"))}
                          <Key>{tx(k)}</Key>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <ul className="font-ui flex flex-col gap-2 text-sm text-white/80">
              {TIPS.map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <i className="mt-1.5 h-2 w-3 shrink-0 -skew-x-12 bg-[var(--red)]" />
                  {tx(t)}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            {CHARS.map((c, k) => (
              <div key={c.id} className="rise flex gap-4 bg-black/55 p-3 ring-1 ring-white/12 backdrop-blur" style={{ animationDelay: `${100 + k * 80}ms` }}>
                <div className="relative h-24 w-20 shrink-0 -skew-x-6 overflow-hidden ring-2" style={{ boxShadow: `inset 0 -3px 0 ${c.color}` }}>
                  <Face c={c} className="absolute inset-0 skew-x-6 scale-110" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3">
                    <span className="font-brush text-3xl leading-none text-white">{c.name}</span>
                    <span className="font-ui text-xs font-bold" style={{ color: c.color }}>
                      {tx(c.title)}
                    </span>
                  </div>
                  <ul className="font-ui flex flex-col gap-1 text-sm">
                    {c.moveList.map((m) => (
                      <li key={m.name} className="flex items-center gap-3 border-t border-white/10 pt-1">
                        <Input text={m.input} />
                        <span className="min-w-0 text-white/80">{tx(m.name)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </Screen>
  );
}
