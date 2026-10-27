import { useEffect, useRef, useState } from "react";
import { audio } from "@/game/audio";
import { lobbyCount } from "@/game/rtc";
import { getLang, tx } from "@/lib/i18n";
import { renoiseUrl } from "@/lib/renoise";
import renoiseMark from "@/assets/renoise-mark.svg";
import { Key, LangToggle, Logo, Screen } from "./common";
import { Roster } from "./Roster";

export type MenuChoice = "cpu" | "local" | "online" | "training" | "arena" | "help";

const ITEMS: { id: MenuChoice; label: string; en: string; sub: string; color: string }[] = [
  { id: "cpu", label: "单人闯关", en: "ARCADE", sub: "和电脑主播打擂台", color: "var(--red)" },
  { id: "online", label: "联机对战", en: "ONLINE PK", sub: "房间码邀请好友 · 快速匹配", color: "var(--gold)" },
  { id: "local", label: "本地双人", en: "VERSUS", sub: "同一个键盘面对面对打", color: "var(--blue)" },
  { id: "arena", label: "模型竞技场", en: "MODEL ARENA", sub: "接入任意大模型 · 让模型自己打", color: "#9b5cff" },
  { id: "training", label: "训练模式", en: "TRAINING", sub: "练连招 · 看判定框", color: "var(--cyan)" },
  { id: "help", label: "操作说明", en: "HOW TO PLAY", sub: "按键与全角色出招表", color: "#2b2735" },
];


export function Menu({ name, onName, onPick }: { name: string; onName: (n: string) => void; onPick: (m: MenuChoice) => void }) {
  const [online, setOnline] = useState<number | null>(null);
  const [muted, setMuted] = useState(audio.muted);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = active;

  useEffect(() => {
    void audio.bgm("title");
    let alive = true;
    const poll = () => lobbyCount().then((n) => alive && setOnline(n));
    poll();
    const t = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      if (e.code === "KeyW" || e.code === "ArrowUp") {
        audio.sfx("menu");
        setActive((a) => (a + ITEMS.length - 1) % ITEMS.length);
      } else if (e.code === "KeyS" || e.code === "ArrowDown") {
        audio.sfx("menu");
        setActive((a) => (a + 1) % ITEMS.length);
      } else if (e.code === "KeyJ" || e.code === "Enter" || e.code === "Space") {
        audio.unlock();
        audio.sfx("confirm");
        onPick(ITEMS[activeRef.current].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPick]);

  const sub = (it: (typeof ITEMS)[number]) => (it.id === "online" && online ? tx("{0} 人正在联机对战", online) : tx(it.sub));

  return (
    <Screen fx="code">
      <div className="flex min-h-0 flex-1">
        {/* left: logo + mode list; centred when it fits, otherwise (short landscape phones) it starts at the top and scrolls */}
        <div className="flex min-h-0 w-full flex-col gap-[2.5vh] px-5 py-3 [justify-content:safe_center] sm:px-[5vw] landscape:w-[50%] [@media(max-height:500px)]:overflow-x-hidden [@media(max-height:500px)]:overflow-y-auto [@media(max-height:500px)]:py-1">
          <div className="rise self-start">
            <Logo small light />
          </div>
          <nav className="flex flex-col">
            {ITEMS.map((it, i) => {
              const on = i === active;
              return (
                <button
                  key={it.id}
                  onMouseEnter={() => {
                    if (!on) audio.sfx("menu");
                    setActive(i);
                  }}
                  onClick={() => {
                    audio.unlock();
                    audio.sfx("confirm");
                    onPick(it.id);
                  }}
                  className="rise group relative flex items-center gap-4 py-[0.7vh] text-left"
                  style={{ animationDelay: `${120 + i * 60}ms` }}
                >
                  <span
                    className="absolute inset-y-0 -left-6 -skew-x-12 transition-all duration-200 ease-out"
                    style={{ width: on ? "calc(100% + 1.5rem)" : 0, background: `linear-gradient(90deg, ${it.color} 0%, ${it.color} 42%, transparent 100%)` }}
                  />
                  <span className={`font-num relative w-9 text-xl italic transition-colors sm:text-2xl ${on ? "text-white" : "text-[#2b2735]/30"}`}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="relative flex flex-col">
                    <span
                      className={`font-ui whitespace-nowrap text-[clamp(18px,min(3.3vw,6vh),38px)] font-black leading-tight transition-all ${on ? "translate-x-1 text-white" : "text-[#2b2735]/80"}`}
                      style={on ? { textShadow: "2px 2px 0 rgba(0,0,0,0.6)" } : undefined}
                    >
                      {tx(it.label)}
                    </span>
                    {getLang() === "zh" && <span className={`font-num text-[11px] italic tracking-[0.35em] transition-colors [@media(max-height:500px)]:hidden ${on ? "text-white/90" : "text-[#2b2735]/40"}`}>{it.en}</span>}
                  </span>
                  <span className={`font-ui relative ml-auto hidden whitespace-nowrap pl-4 text-sm font-bold transition-opacity lg:block ${on ? "text-[#2b2735] opacity-100" : "opacity-0"}`}>
                    {sub(it)} ›
                  </span>
                </button>
              );
            })}
          </nav>
          {/* credit: the whole game was made with Renoise.ai, an orange card in Renoise's accent colour.
              The rise wrapper is separate because its keyframes end on `transform: none`, which would undo the skew.
              On short screens (landscape phones) it drops the second line so the column still fits. */}
          <div className="rise max-w-full" style={{ animationDelay: "480ms" }}>
            <a
              href={renoiseUrl()}
              target="_blank"
              rel="noopener"
              onClick={() => audio.sfx("confirm")}
              onMouseEnter={() => audio.sfx("menu")}
              className="group flex w-fit max-w-full -skew-x-12 items-stretch bg-gradient-to-r from-[#ff6a35] to-[#e64b22] text-white shadow-[0_10px_30px_-8px_rgba(230,75,34,0.75)] ring-1 ring-white/30 transition hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_14px_40px_-6px_rgba(255,91,46,0.95)]"
            >
              <span className="flex min-w-0 skew-x-12 items-center gap-3 py-2.5 pl-4 pr-4 sm:gap-3.5 sm:py-3 sm:pl-5 sm:pr-6 [@media(max-height:500px)]:py-1.5">
                <img src={renoiseMark} alt="Renoise" className="h-10 w-auto shrink-0 sm:h-12 [@media(max-height:500px)]:h-7" />
                <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
                  <span className="font-ui text-sm font-black [text-shadow:0_1px_2px_rgba(90,20,0,0.45)] sm:text-lg [@media(max-height:500px)]:text-[11px]">{tx("游戏全程使用 Renoise.ai 制作")}</span>
                  <span className="font-ui text-[11px] font-bold text-white/85 sm:text-xs [@media(max-height:500px)]:hidden">{tx("角色、场景、视频、音乐全部由 AI 生成")}</span>
                </span>
              </span>
              <span className="font-ui flex items-center bg-[var(--ink)] px-3 text-3xl font-black text-[#ff5b2e] transition-[padding] group-hover:pl-4 group-hover:pr-2 sm:px-4 sm:text-4xl [@media(max-height:500px)]:px-2.5 [@media(max-height:500px)]:text-2xl">
                <span className="skew-x-12">›</span>
              </span>
            </a>
          </div>
        </div>

        {/* right: the four fighters as a rotating roster of slanted blades */}
        <Roster />
      </div>

      {/* bottom bar */}
      <footer className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 bg-[#16121c] px-4 py-2.5 sm:px-[5vw]">
        <label className="flex items-center gap-2">
          <span className="font-ui text-xs font-bold text-white/50">{tx("主播昵称")}</span>
          <input
            value={name}
            maxLength={12}
            onChange={(e) => onName(e.target.value)}
            className="font-ui w-32 -skew-x-12 border-b-2 border-white/30 bg-white/5 px-2 py-1 text-sm font-bold text-white outline-none focus:border-[var(--gold)]"
          />
        </label>
        <span className="font-ui flex items-center gap-1.5 text-xs font-bold text-white/60">
          <i className="h-2 w-2 rounded-full bg-[#3ddc84] shadow-[0_0_8px_#3ddc84]" />
          {online === null ? tx("连接中…") : tx("{0} 人在线", online)}
        </span>
        <button
          className="font-ui text-xs font-bold text-white/60 hover:text-white"
          onClick={() => {
            audio.unlock();
            audio.setMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? tx("🔇 已静音") : tx("🔊 声音开")}
        </button>
        <LangToggle />
        <span className="font-ui ml-auto hidden items-center gap-2 text-xs text-white/50 sm:flex">
          <Key>W</Key>
          <Key>S</Key> {tx("选择")}
          <Key>J</Key> {tx("确定")}
        </span>
      </footer>
    </Screen>
  );
}
