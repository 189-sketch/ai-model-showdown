import { useCallback, useEffect, useRef, useState } from "react";
import { CHARS, STAGES } from "@/game/chars";
import { audio } from "@/game/audio";
import type { CtrlMsg, PeerLink } from "@/game/rtc";
import type { Mode } from "@/game/runner";
import { tx } from "@/lib/i18n";
import { ArcadeButton, Face, Key, Screen, SIDE_COLOR, TopBar, charStats, superName } from "./common";

export interface StartInfo {
  chars: [number, number];
  stage: number;
  seed: number;
  cpuLevel: 1 | 2 | 3;
  delay: number;
}

interface Props {
  mode: Mode;
  names: [string, string];
  link?: PeerLink;
  initial?: Partial<StartInfo>;
  onStart: (s: StartInfo) => void;
  onBack: () => void;
}

const LEVELS: { v: 1 | 2 | 3; label: string }[] = [
  { v: 1, label: "简单" },
  { v: 2, label: "普通" },
  { v: 3, label: "困难" },
];

const MODE_LABEL: Record<Mode, string> = { cpu: "单人闯关", local: "本地双人", training: "训练模式", online: "联机对战" };

function FighterPanel({
  idx, side, ready, tag, canCycle, onCycle, readyButton,
}: {
  idx: number;
  side: 0 | 1;
  ready: boolean;
  tag: string;
  canCycle: boolean;
  onCycle: (d: number) => void;
  readyButton?: React.ReactNode;
}) {
  const c = CHARS[idx];
  const left = side === 0;
  const color = SIDE_COLOR[side];
  const nameSize = `min(${26 / Math.max(2, c.name.length)}vw, 10vh)`;
  return (
    <section className="relative min-h-0 min-w-0 landscape:w-[34%]">
      {/* portrait in a slanted frame; re-keyed so a new pick slides in */}
      <div
        key={c.id}
        className={`${left ? "slide-l" : "slide-r"} absolute inset-0 overflow-hidden`}
        style={{ clipPath: left ? "polygon(0 0, 100% 0, 84% 100%, 0 100%)" : "polygon(0 0, 100% 0, 100% 100%, 16% 100%)" }}
      >
        <img
          src={`/assets/ui/portrait_${c.id}.jpg`}
          alt={c.name}
          className={`h-full w-full object-cover object-top ${left ? "" : "-scale-x-100"}`}
          onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0")}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top, rgba(10,6,16,0.97) 4%, rgba(10,6,16,0.88) 26%, rgba(10,6,16,0.35) 52%, transparent 68%), linear-gradient(${left ? "90deg" : "270deg"}, ${color}55, transparent 60%)`,
          }}
        />
        <div className="stripes absolute inset-0 opacity-30" />
      </div>
      {/* coloured edge along the slanted side */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          clipPath: left ? "polygon(99% 0, 100% 0, 85% 100%, 84% 100%)" : "polygon(0 0, 1% 0, 16% 100%, 15% 100%)",
          background: color,
        }}
      />

      <div className={`absolute top-3 flex items-center gap-2 ${left ? "left-3" : "right-3 flex-row-reverse"}`}>
        <span className="font-num -skew-x-12 px-2 py-0.5 text-lg italic leading-none text-white shadow-[3px_3px_0_#000]" style={{ background: color }}>
          {tag.split(" · ")[0]}
        </span>
        {tag.split(" · ")[1] !== tag.split(" · ")[0] && (
          <span className="font-ui max-w-[9rem] truncate text-xs font-bold text-white/85 [text-shadow:0_1px_2px_#000]">{tag.split(" · ")[1]}</span>
        )}
      </div>

      {canCycle && !ready && (
        <div className={`absolute top-1/2 flex -translate-y-1/2 gap-1 ${left ? "left-2" : "right-2"}`}>
          {[-1, 1].map((d) => (
            <button
              key={d}
              onClick={() => onCycle(d)}
              className="font-ui grid h-9 w-9 place-items-center rounded-full border border-white/40 bg-black/50 text-xl text-white backdrop-blur transition hover:bg-white hover:text-black"
              aria-label={d < 0 ? tx("上一个角色") : tx("下一个角色")}
            >
              {d < 0 ? "‹" : "›"}
            </button>
          ))}
        </div>
      )}

      {ready && (
        <div className="pointer-events-none absolute inset-x-0 top-[36%] flex justify-center">
          <div className="stamp font-num border-4 border-[var(--gold)] px-4 py-1 text-[clamp(28px,7vh,64px)] italic leading-none tracking-wider text-[var(--gold)] shadow-[0_0_30px_rgba(255,210,63,0.4)] [text-shadow:0_3px_0_#000]">
            READY
          </div>
        </div>
      )}

      <div className={`absolute bottom-[2.5vh] flex flex-col gap-[0.8vh] ${left ? "left-[4%] right-[18%] items-start text-left" : "left-[18%] right-[4%] items-end text-right"}`}>
        <div className="font-ui text-[11px] font-bold tracking-wider [text-shadow:0_1px_3px_#000,0_0_8px_#000] sm:text-xs" style={{ color: c.color }}>
          {tx(c.title)}
        </div>
        <div className="font-ui text-xs font-bold text-white/80 [text-shadow:0_1px_3px_#000] [@media(max-height:420px)]:hidden">「{tx(c.quote)}」</div>
        <div key={c.id} className="rise font-brush whitespace-nowrap leading-[0.95] text-white [text-shadow:0_4px_0_#000]" style={{ fontSize: nameSize }}>
          {c.name}
        </div>
        <div className="flex flex-col gap-1 [@media(max-height:460px)]:hidden">
          {charStats(c).map((st) => (
            <div key={st.label} className={`flex items-center gap-2 ${left ? "" : "flex-row-reverse"}`}>
              <span className="font-ui w-7 text-[11px] font-bold text-white/60">{st.label}</span>
              <div className={`flex gap-[3px] ${left ? "" : "flex-row-reverse"}`}>
                {[0, 1, 2, 3, 4].map((k) => (
                  <i key={k} className="h-2 w-4 -skew-x-12" style={{ background: k < Math.round(st.v * 5) ? color : "rgba(255,255,255,0.15)" }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="font-ui text-[11px] font-bold text-white/85 [text-shadow:0_1px_3px_#000] sm:text-xs">
          <span className="text-white/50">{tx("超必杀")} </span>
          {superName(c)}
        </div>
        {readyButton}
      </div>
    </section>
  );
}

export function Select({ mode, names, link, initial, onStart, onBack }: Props) {
  const online = mode === "online";
  const isHost = link?.role !== "guest";
  const mySide: 0 | 1 = online && !isHost ? 1 : 0;
  const [sel, setSel] = useState<[number, number]>(initial?.chars ?? [0, 1]);
  const [ready, setReady] = useState<[boolean, boolean]>([false, false]);
  const [stage, setStage] = useState(initial?.stage ?? Math.floor(Math.random() * STAGES.length));
  const [level, setLevel] = useState<1 | 2 | 3>(initial?.cpuLevel ?? 2);
  const started = useRef(false);
  const state = useRef({ sel, ready, stage });
  state.current = { sel, ready, stage };

  const twoHumans = mode === "local" || online;

  const send = useCallback(
    (char: number, r: boolean, st: number) => {
      link?.sendCtrl({ t: "sel", char, ready: r, stage: isHost ? st : undefined });
    },
    [link, isHost]
  );

  const move = useCallback(
    (side: 0 | 1, delta: number) => {
      if (state.current.ready[side]) return;
      audio.sfx("menu");
      setSel((prev) => {
        const next: [number, number] = [...prev];
        next[side] = (prev[side] + delta + CHARS.length) % CHARS.length;
        if (online && side === mySide) send(next[side], false, state.current.stage);
        return next;
      });
    },
    [online, mySide, send]
  );

  const confirm = useCallback(
    (side: 0 | 1, value: boolean) => {
      audio.sfx(value ? "confirm" : "menu");
      setReady((prev) => {
        const next: [boolean, boolean] = [...prev];
        next[side] = value;
        // against the CPU / in training only the human readies up
        if (!twoHumans && side === 0) next[1] = value;
        return next;
      });
      if (online && side === mySide) send(state.current.sel[side], value, state.current.stage);
    },
    [twoHumans, online, mySide, send]
  );

  const changeStage = useCallback(
    (d: number) => {
      if (online && !isHost) return;
      audio.sfx("menu");
      setStage((s) => {
        const n = (s + d + STAGES.length) % STAGES.length;
        if (online) send(state.current.sel[mySide], state.current.ready[mySide], n);
        return n;
      });
    },
    [online, isHost, send, mySide]
  );

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      const solo = !twoHumans || online;
      const p1 = online ? mySide : 0;
      const k = e.code;
      if (k === "KeyA" || (solo && k === "ArrowLeft")) move(p1, -1);
      else if (k === "KeyD" || (solo && k === "ArrowRight")) move(p1, 1);
      else if (k === "KeyW" || (solo && k === "ArrowUp")) changeStage(-1);
      else if (k === "KeyS" || (solo && k === "ArrowDown")) changeStage(1);
      else if (k === "KeyJ" || k === "Enter" || k === "KeyU") confirm(p1, true);
      else if (k === "KeyK" || k === "Escape" || k === "Backspace") {
        if (state.current.ready[p1]) confirm(p1, false);
        else onBack();
      } else if (!solo) {
        if (k === "ArrowLeft") move(1, -1);
        else if (k === "ArrowRight") move(1, 1);
        else if (k === "Numpad1" || k === "Comma" || k === "NumpadEnter") confirm(1, true);
        else if (k === "Numpad2" || k === "Period") confirm(1, false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, confirm, changeStage, onBack, twoHumans, online, mySide]);

  // online sync
  useEffect(() => {
    if (!link) return;
    const other = (1 - mySide) as 0 | 1;
    link.onCtrl = (msg: CtrlMsg) => {
      if (msg.t === "sel") {
        setSel((p) => {
          const n: [number, number] = [...p];
          n[other] = msg.char;
          return n;
        });
        setReady((p) => {
          const n: [boolean, boolean] = [...p];
          n[other] = msg.ready;
          return n;
        });
        if (msg.stage !== undefined && !isHost) setStage(msg.stage);
      } else if (msg.t === "start" && !isHost && !started.current) {
        started.current = true;
        onStart({ chars: msg.chars, stage: msg.stage, seed: msg.seed, cpuLevel: 2, delay: msg.delay });
      }
    };
    // keep re-announcing our pick: the peer may mount this screen after us
    const announce = () => send(state.current.sel[mySide], state.current.ready[mySide], state.current.stage);
    announce();
    const iv = setInterval(announce, 1000);
    return () => {
      clearInterval(iv);
      link.onCtrl = null;
    };
  }, [link, mySide, isHost, onStart, send]);

  // everyone ready → start
  useEffect(() => {
    if (!ready[0] || !ready[1] || started.current) return;
    if (online && !isHost) return;
    const t = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      const seed = Math.floor(Math.random() * 2 ** 31);
      const rtt = link?.rtt ?? 0;
      const delay = rtt < 50 ? 1 : rtt < 130 ? 2 : 3;
      const info: StartInfo = { chars: sel, stage, seed, cpuLevel: level, delay };
      if (online) link?.sendCtrl({ t: "start", chars: sel, stage, seed, delay });
      onStart(info);
    }, 700);
    return () => clearTimeout(t);
  }, [ready, sel, stage, level, online, isHost, link, onStart]);

  const sideLabel = (i: 0 | 1) => {
    if (mode === "cpu") return i === 0 ? "1P" : "CPU";
    if (mode === "training") return i === 0 ? "1P" : "DUMMY";
    if (online) return i === mySide ? "YOU" : "RIVAL";
    return i === 0 ? "1P" : "2P";
  };

  // mouse / touch: who a roster click or arrow changes
  const canPick = (i: 0 | 1) => (online ? i === mySide : mode === "local" || i === 0 || !ready[0]);
  const rosterSide: 0 | 1 = online ? mySide : !ready[0] ? 0 : 1;
  const opponentName = online ? names[1 - mySide] : "";

  // only human-controlled sides get a ready button (the CPU / dummy readies with 1P)
  const human = (i: 0 | 1) => (online ? i === mySide : mode === "local" || i === 0);
  const readyButton = (side: 0 | 1) =>
    human(side) ? (
      <ArcadeButton
        tone={ready[side] ? "gray" : side === 0 ? "red" : "blue"}
        onClick={() => confirm(side, !ready[side])}
        className="mt-1 px-5 py-1.5 text-sm sm:px-7 sm:py-2 sm:text-base"
      >
        {ready[side] ? tx("取消准备") : tx("确定出战")}
      </ArcadeButton>
    ) : null;

  return (
    <Screen bg={STAGES[stage].bg}>
      <TopBar
        title={tx("选择角色")}
        en="SELECT YOUR FIGHTER"
        onBack={onBack}
        right={
          <span className="font-ui -skew-x-12 border border-white/25 bg-black/40 px-3 py-1 text-xs font-bold text-white/85">
            {online ? tx("联机 · 对手 {0}", opponentName) : tx(MODE_LABEL[mode])}
          </span>
        }
      />

      <main className="relative flex min-h-0 flex-1 gap-[1.2vw] px-[1.5vw] pt-[1.2vh] portrait:grid portrait:grid-cols-2 portrait:grid-rows-[1fr_auto] portrait:gap-2 portrait:px-2">
        <FighterPanel
          idx={sel[0]}
          side={0}
          ready={ready[0]}
          tag={`${sideLabel(0)} · ${names[0]}`}
          canCycle={canPick(0)}
          onCycle={(d) => move(0, d)}
          readyButton={readyButton(0)}
        />

        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-[2.2vh] py-2 portrait:col-span-2 portrait:row-start-2">
          <div className="font-num dy-strong -skew-x-6 text-[clamp(44px,11vh,110px)] italic leading-none">VS</div>

          <div className="flex max-w-full flex-wrap items-start justify-center gap-[0.8vw]">
            {CHARS.map((c, i) => {
              const p1 = sel[0] === i;
              const p2 = sel[1] === i;
              const ring = [p1 && "0 0 0 3px var(--red)", p2 && `0 0 0 ${p1 ? 7 : 3}px var(--blue)`].filter(Boolean).join(", ");
              return (
                <button
                  key={c.id}
                  disabled={!canPick(rosterSide) || ready[rosterSide]}
                  onMouseEnter={() => audio.sfx("menu")}
                  onClick={() => {
                    audio.unlock();
                    if (sel[rosterSide] !== i) move(rosterSide, i - sel[rosterSide]);
                  }}
                  className="group flex flex-col items-center gap-1.5 disabled:cursor-default"
                >
                  <div
                    className="relative h-[clamp(42px,min(9.5vh,5.6vw),96px)] w-[clamp(42px,min(9.5vh,5.6vw),96px)] -skew-x-6 overflow-hidden bg-black transition-transform group-enabled:group-hover:-translate-y-1"
                    style={{ boxShadow: ring || "0 0 0 2px rgba(255,255,255,0.18)" }}
                  >
                    <Face c={c} className={`absolute inset-0 skew-x-6 scale-110 transition ${p1 || p2 ? "" : "opacity-55 grayscale-[60%] group-hover:opacity-100 group-hover:grayscale-0"}`} />
                    {p1 && <span className="font-num absolute left-0 top-0 bg-[var(--red)] px-1.5 text-xs italic leading-tight">1P</span>}
                    {p2 && <span className="font-num absolute right-0 top-0 bg-[var(--blue)] px-1.5 text-xs italic leading-tight">{mode === "cpu" ? "CPU" : "2P"}</span>}
                  </div>
                  <span className={`font-ui max-w-[5.5rem] truncate text-[11px] font-bold sm:text-xs ${p1 || p2 ? "text-white" : "text-white/45"}`}>{c.name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <span className="font-num text-[11px] italic tracking-[0.4em] text-white/45">STAGE</span>
            <div className="flex gap-2">
              {STAGES.map((st, i) => (
                <button
                  key={st.id}
                  disabled={online && !isHost}
                  onClick={() => changeStage(i - stage)}
                  className={`relative h-[clamp(34px,7.5vh,64px)] w-[clamp(84px,15vh,150px)] -skew-x-12 overflow-hidden transition ${
                    stage === i ? "ring-2 ring-[var(--cyan)]" : "opacity-50 ring-1 ring-white/20 hover:opacity-90"
                  }`}
                >
                  <img src={st.bg} alt="" className="absolute inset-0 h-full w-full skew-x-12 scale-125 object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                  <span className="font-ui absolute inset-x-0 bottom-0 skew-x-12 bg-black/65 py-0.5 text-[10px] font-bold sm:text-xs">{tx(st.name)}</span>
                </button>
              ))}
            </div>
          </div>

          {mode === "cpu" && (
            <div className="flex items-center gap-2">
              <span className="font-num text-[11px] italic tracking-[0.3em] text-white/45">CPU</span>
              {LEVELS.map((l) => (
                <button
                  key={l.v}
                  onClick={() => {
                    audio.sfx("menu");
                    setLevel(l.v);
                  }}
                  className={`font-ui -skew-x-12 px-3 py-1 text-xs font-black transition ${
                    level === l.v ? "bg-[var(--gold)] text-[var(--ink)]" : "bg-white/10 text-white/60 hover:text-white"
                  }`}
                >
                  {tx(l.label)}
                </button>
              ))}
            </div>
          )}

          {online && (
            <div className="font-ui flex items-center gap-2 text-xs font-bold text-white/70">
              <i className={`h-2 w-2 rounded-full ${ready[1 - mySide] ? "bg-[#3ddc84]" : "blink bg-[var(--gold)]"}`} />
              {ready[1 - mySide] ? tx("对手已准备") : tx("等待对手选择…")}
            </div>
          )}
        </div>

        <FighterPanel
          idx={sel[1]}
          side={1}
          ready={ready[1]}
          tag={`${sideLabel(1)} · ${names[1]}`}
          canCycle={canPick(1)}
          onCycle={(d) => move(1, d)}
          readyButton={readyButton(1)}
        />
      </main>

      <footer className="font-ui relative z-20 flex shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-2 text-[11px] text-white/55 sm:text-xs">
        <span className="flex items-center gap-1.5">
          <Key>A</Key>
          <Key>D</Key> {tx("选角色")}
        </span>
        <span className="flex items-center gap-1.5">
          <Key>W</Key>
          <Key>S</Key> {tx("换场景")}
        </span>
        <span className="flex items-center gap-1.5">
          <Key>J</Key> {tx("确定")}
        </span>
        <span className="flex items-center gap-1.5">
          <Key>K</Key> {tx("返回")}
        </span>
        {mode === "local" && (
          <span className="flex items-center gap-1.5 text-[var(--cyan)]">
            2P <Key>←</Key>
            <Key>→</Key> {tx("选择 · 小键盘")} <Key>1</Key> {tx("确定")}
          </span>
        )}
      </footer>
    </Screen>
  );
}
