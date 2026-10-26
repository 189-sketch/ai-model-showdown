import { useEffect, useMemo, useState } from "react";
import { art } from "@/game/assets";
import { audio } from "@/game/audio";
import { CHARS } from "@/game/chars";
import { getLang, tx } from "@/lib/i18n";
import { Face, Key, LangToggle, LiveBadge, Logo } from "./common";

const DANMAKU = [
  "前方高能！", "我会稳稳接住你", "你说得完全对！", "服务器繁忙，请稍后再试", "火箭炸了🚀", "666666", "今晚谁是最强AI？",
  "梁圣降临！！", "已被收购", "这波 PK 稳了", "Effort 拉满", "又被封号了⚠", "Grok，这是真的吗？", "开源万岁",
];

export function Title({ onStart }: { onStart: () => void }) {
  const [progress, setProgress] = useState(art.progress);
  const viewers = useMemo(() => {
    const n = 1.2 + Math.random() * 4;
    return getLang() === "zh" ? `${n.toFixed(1)}万` : `${Math.round(n * 10)}K`;
  }, []);

  useEffect(() => {
    const t = setInterval(() => setProgress(art.progress), 200);
    const key = (e: KeyboardEvent) => {
      if (!e.repeat) go();
    };
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go() {
    audio.unlock();
    audio.sfx("confirm");
    void audio.bgm("title");
    audio.announce("choose");
    onStart();
  }

  const ready = progress >= 1;
  const pct = Math.round(progress * 100);

  return (
    <div className="grain relative h-[100dvh] w-full cursor-pointer overflow-hidden bg-[var(--ink)] text-white" onClick={go}>
      <img
        src="/assets/ui/keyart.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover [animation:kenburns_18s_ease-in-out_infinite_alternate]"
        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(10,6,16,0.97)_8%,rgba(10,6,16,0.35)_45%,rgba(10,6,16,0.55))]" />
      <div className="scan pointer-events-none absolute inset-0" />

      {/* live-room chrome */}
      <div className="rise absolute inset-x-0 top-0 flex items-center justify-between p-3 sm:p-5">
        <LiveBadge viewers={viewers} />
        <div className="flex items-center gap-2">
          <LangToggle className="mr-2" />
          <span className="font-ui hidden text-xs font-bold text-white/70 sm:inline">{tx("今晚登场")}</span>
          <div className="flex -space-x-2">
            {CHARS.map((c) => (
              <Face key={c.id} c={c} className="h-8 w-8 rounded-full ring-2 ring-[var(--ink)] sm:h-9 sm:w-9" />
            ))}
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-[14%] flex flex-col items-center px-4">
        <div className="rise [animation-delay:120ms]">
          <Logo />
        </div>
        <div className="rise mt-[3vh] flex items-center gap-3 [animation-delay:300ms]">
          <span className="blink font-ui text-base font-black tracking-[0.35em] sm:text-xl">{tx("按任意键开始")}</span>
          <span className="hidden sm:inline">
            <Key>Enter</Key>
          </span>
        </div>
        <div className="rise mt-4 flex w-60 items-center gap-3 [animation-delay:400ms]">
          <div className="h-1 flex-1 overflow-hidden bg-white/15">
            <div className="h-full bg-gradient-to-r from-[var(--red)] to-[var(--cyan)] transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-num w-12 text-right text-sm italic text-white/60">{ready ? "READY" : `${pct}%`}</span>
        </div>
      </div>

      {/* danmaku ticker */}
      <div className="absolute inset-x-0 bottom-0 overflow-hidden border-t border-white/10 bg-black/50 py-2 backdrop-blur">
        <div className="flex w-max [animation:marquee_38s_linear_infinite]">
          {[0, 1].map((k) => (
            <div key={k} className="flex shrink-0 gap-10 pr-10">
              {DANMAKU.map((d, i) => (
                <span key={i} className={`font-ui whitespace-nowrap text-sm font-bold ${i % 3 === 0 ? "text-[var(--gold)]" : i % 3 === 1 ? "text-white/85" : "text-[var(--cyan)]"}`}>
                  {tx(d)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
