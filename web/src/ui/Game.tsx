import { useEffect, useRef, useState } from "react";
import { audio } from "@/game/audio";
import { CHARS, type CharDef } from "@/game/chars";
import { tx } from "@/lib/i18n";
import { startInput, stopInput } from "@/game/input";
import { bridge } from "@/game/pilot/bridge";
import { Pilot } from "@/game/pilot/pilot";
import { loadFighterSkin, type FighterSkin } from "@/game/pilot/skin";
import { GameRunner, type DummyMode, type Mode } from "@/game/runner";
import type { CtrlMsg, PeerLink } from "@/game/rtc";
import { ArcadeButton, SIDE_COLOR, isTouch } from "./common";
import type { ArenaStart } from "./Arena";
import type { StartInfo } from "./Select";
import { TouchPad } from "./TouchPad";

interface Props {
  mode: Mode;
  info: StartInfo;
  names: [string, string];
  link?: PeerLink;
  arena?: ArenaStart; // mode "arena": the models playing each side
  matchKey: number;
  peerGone?: boolean;
  onRematch: (info: StartInfo) => void;
  onReselect: () => void;
  onExit: () => void;
}

const DUMMY: { v: DummyMode; label: string }[] = [
  { v: "stand", label: "站立" },
  { v: "crouch", label: "下蹲" },
  { v: "block", label: "自动防御" },
  { v: "jump", label: "连续跳" },
];

export function Game({ mode, info, names, link, arena, matchKey, peerGone, onRematch, onReselect, onExit }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runner = useRef<GameRunner | null>(null);
  const [ended, setEnded] = useState<number | null>(null);
  const [victory, setVictory] = useState<CharDef | null>(null); // the winner's victory video plays before the result
  const [paused, setPaused] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [wantRematch, setWantRematch] = useState(false);
  const [peerWantsRematch, setPeerWantsRematch] = useState(false);
  const [boxes, setBoxes] = useState(mode === "training");
  const [dummy, setDummy] = useState<DummyMode>("stand");
  const [touch] = useState(() => isTouch() && mode !== "arena");
  const [pilots, setPilots] = useState<[Pilot, Pilot] | null>(null);
  const [skins, setSkins] = useState<[FighterSkin, FighterSkin] | null>(null);
  const isHost = link?.role !== "guest";
  const localSide: 0 | 1 = mode === "online" && !isHost ? 1 : 0;

  useEffect(() => {
    if (!canvas.current) return;
    startInput();
    setEnded(null);
    setVictory(null);
    setWantRematch(false);
    setPeerWantsRematch(false);
    const ps = mode === "arena" && arena ? ([new Pilot(arena.models[0], 0), new Pilot(arena.models[1], 1)] as [Pilot, Pilot]) : undefined;
    setPilots(ps ?? null);
    const r = new GameRunner({
      canvas: canvas.current,
      mode,
      config: { chars: info.chars, stage: info.stage, seed: info.seed, training: mode === "training", equal: mode === "arena" && !!arena?.equal },
      names,
      cpuLevel: info.cpuLevel,
      link,
      pilots: ps,
      localSide,
      inputDelay: info.delay,
      onMatchEnd: (w) => {
        if (w === 0 || w === 1) setVictory(CHARS[info.chars[w]]);
        setEnded(w);
        if (ps) {
          void bridge
            .result({
              models: [ps[0].model.id, ps[1].model.id],
              names: [ps[0].model.name, ps[1].model.name],
              bodies: [CHARS[info.chars[0]].id, CHARS[info.chars[1]].id],
              winner: w,
              equal: !!arena?.equal,
              stage: info.stage,
              seed: info.seed,
              stats: [ps[0].stats, ps[1].stats],
            })
            .catch(() => {});
        }
      },
      onDisconnect: () => setDisconnected(true),
    });
    r.showBoxes = mode === "training";
    runner.current = r;
    r.start();
    // model looks load while the round intro plays
    let live = true;
    if (ps) {
      void Promise.all(ps.map((p) => loadFighterSkin(p.model))).then(([a, b]) => {
        if (!live) return;
        r.skins = [a, b];
        setSkins([a, b]);
      });
    }
    return () => {
      live = false;
      r.stop();
      runner.current = null;
      stopInput();
    };
    // matchKey restarts the match with fresh state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey]);

  // online control messages during / after the match
  useEffect(() => {
    if (!link) return;
    link.onCtrl = (msg: CtrlMsg) => {
      if (msg.t === "rematch") setPeerWantsRematch(true);
      else if (msg.t === "toSelect") onReselect();
      else if (msg.t === "start" && !isHost) onRematch({ ...info, chars: msg.chars, stage: msg.stage, seed: msg.seed, delay: msg.delay });
    };
    return () => {
      link.onCtrl = null;
    };
  }, [link, isHost, info, onRematch, onReselect]);

  // both sides asked for a rematch → host starts it
  useEffect(() => {
    if (!link || !isHost || !wantRematch || !peerWantsRematch) return;
    const seed = Math.floor(Math.random() * 2 ** 31);
    link.sendCtrl({ t: "start", chars: info.chars, stage: info.stage, seed, delay: info.delay });
    onRematch({ ...info, seed });
  }, [link, isHost, wantRematch, peerWantsRematch, info, onRematch]);

  // pause (offline modes only)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        if (mode === "online" || ended !== null) return;
        setPaused((p) => {
          if (runner.current) runner.current.paused = !p;
          return !p;
        });
      } else if (e.code === "KeyH" && mode === "training") {
        setBoxes((b) => {
          if (runner.current) runner.current.showBoxes = !b;
          return !b;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, ended]);

  const rematch = () => {
    if (mode === "online") {
      setWantRematch(true);
      link?.sendCtrl({ t: "rematch" });
    } else onRematch({ ...info, seed: Math.floor(Math.random() * 2 ** 31) });
  };

  const reselect = () => {
    link?.sendCtrl({ t: "toSelect" });
    onReselect();
  };

  const gone = disconnected || !!peerGone;
  const won = ended !== null && (mode === "online" ? ended === localSide : ended === 0);
  const title =
    ended === 2 ? "DRAW" : mode === "arena" ? "WINNER" : mode === "local" ? `${ended === 0 ? "1P" : "2P"} WIN` : won ? "YOU WIN" : "YOU LOSE";

  return (
    <div className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-black">
      <canvas
        ref={canvas}
        className="block max-h-[100dvh] max-w-full [image-rendering:pixelated]"
        style={{ aspectRatio: "16 / 9", width: "min(100vw, calc(100dvh * 16 / 9))" }}
      />

      {touch && ended === null && !paused && <TouchPad />}

      {pilots && ended === null && <PilotHud pilots={pilots} skins={skins} runner={runner} />}

      {mode !== "online" && ended === null && (
        <button
          className="font-ui absolute bottom-2 left-1/2 z-30 -translate-x-1/2 -skew-x-12 bg-black/55 px-3 py-1 text-xs font-bold text-white/75 ring-1 ring-white/25 backdrop-blur hover:text-white"
          onClick={() =>
            setPaused((p) => {
              if (runner.current) runner.current.paused = !p;
              return !p;
            })
          }
        >
          {paused ? tx("继续") : tx("暂停 Esc")}
        </button>
      )}

      {mode === "training" && (
        <div className="font-ui absolute left-1/2 top-[11%] z-30 flex -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 bg-black/60 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15 backdrop-blur">
          <span className="font-num mr-1 italic tracking-[0.25em] text-white/50">DUMMY</span>
          {DUMMY.map((d) => (
            <button
              key={d.v}
              className={`-skew-x-12 px-2 py-1 transition ${dummy === d.v ? "bg-[var(--gold)] text-[var(--ink)]" : "bg-white/10 text-white hover:bg-white/20"}`}
              onClick={() => {
                setDummy(d.v);
                if (runner.current) runner.current.dummy = d.v;
              }}
            >
              {tx(d.label)}
            </button>
          ))}
          <button
            className={`ml-2 -skew-x-12 px-2 py-1 transition ${boxes ? "bg-[var(--cyan)] text-[var(--ink)]" : "bg-white/10 text-white hover:bg-white/20"}`}
            onClick={() =>
              setBoxes((b) => {
                if (runner.current) runner.current.showBoxes = !b;
                return !b;
              })
            }
          >
            {tx("判定框 (H)")}
          </button>
        </div>
      )}

      {paused && (
        <Overlay title="PAUSE" aside={<MoveList chars={info.chars} />}>
          <ArcadeButton tone="red" onClick={() => {
            setPaused(false);
            if (runner.current) runner.current.paused = false;
          }}>
            {tx("继续")}
          </ArcadeButton>
          <ArcadeButton tone="blue" onClick={() => onRematch({ ...info, seed: Math.floor(Math.random() * 2 ** 31) })}>
            {tx("重新开始")}
          </ArcadeButton>
          <ArcadeButton tone="gray" onClick={onReselect}>
            {tx("重新选人")}
          </ArcadeButton>
          <ArcadeButton tone="gray" onClick={onExit}>
            {tx("返回菜单")}
          </ArcadeButton>
        </Overlay>
      )}

      {victory && !gone && <VictoryVideo c={victory} winner={ended === 0 || ended === 1 ? names[ended] : ""} onDone={() => setVictory(null)} />}

      {ended !== null && !victory && !gone && (
        <Overlay
          title={title}
          gold={won || mode === "local" || mode === "arena"}
          sub={ended === 0 || ended === 1 ? tx("{0} 获胜", names[ended]) : tx("平局")}
        >
          <ArcadeButton tone="gold" disabled={wantRematch} onClick={rematch}>
            {mode === "online" ? (wantRematch ? tx("等待对手…") : peerWantsRematch ? tx("对手想再来一局！") : tx("再来一局")) : tx("再来一局")}
          </ArcadeButton>
          <ArcadeButton tone="blue" onClick={reselect}>
            {mode === "arena" ? tx("返回竞技场") : tx("重新选人")}
          </ArcadeButton>
          <ArcadeButton tone="gray" onClick={onExit}>
            {mode === "online" ? tx("离开房间") : tx("返回菜单")}
          </ArcadeButton>
        </Overlay>
      )}

      {gone && (
        <Overlay title="DISCONNECTED">
          <div className="font-ui text-sm font-bold text-white/70">{tx("对手已断开连接")}</div>
          <ArcadeButton tone="gray" onClick={onExit}>
            {tx("返回菜单")}
          </ArcadeButton>
        </Overlay>
      )}
    </div>
  );
}

/** Arena: what each model is doing — thinking (the world is paused), its plan, its taunt. */
function PilotHud({ pilots, skins, runner }: { pilots: [Pilot, Pilot]; skins: [FighterSkin, FighterSkin] | null; runner: React.RefObject<GameRunner | null> }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 150);
    return () => clearInterval(t);
  }, []);
  const thinking = pilots.filter((p) => p.pending);
  return (
    <>
      {thinking.length > 0 && !runner.current?.paused && (
        <div className="font-ui pointer-events-none absolute left-1/2 top-[22%] z-30 flex -translate-x-1/2 -skew-x-12 items-center gap-2 bg-black/65 px-3 py-1 text-xs font-bold text-white ring-1 ring-white/20">
          <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--gold)]" />
          {tx("{0} 思考中 {1}s · 时间暂停", thinking.map((p) => p.model.name).join(" / "), ((performance.now() - Math.min(...thinking.map((p) => p.thinkingSince))) / 1000).toFixed(1))}
        </div>
      )}
      {pilots.map((p) => {
        const last = p.log[p.log.length - 1];
        const st = p.stats;
        return (
          <div
            key={p.side}
            className={`font-ui pointer-events-none absolute bottom-10 z-30 flex w-[min(42vw,320px)] flex-col gap-1 bg-black/60 px-2.5 py-1.5 text-[11px] text-white ring-1 ring-white/15 backdrop-blur-sm ${p.side ? "right-2 items-end text-right" : "left-2"}`}
          >
            <div className="flex items-center gap-1.5 font-black" style={{ color: skins?.[p.side].color ?? SIDE_COLOR[p.side] }}>
              {p.pending && <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--gold)]" />}
              {skins?.[p.side].avatar && <img src={skins[p.side].avatar!.src} alt="" className="h-4 w-4 rounded-full object-cover" />}
              {p.model.name}
              <span className="font-normal text-white/50">{tx("决策 {0} · 平均 {1}s · 失误 {2}", st.decisions, (st.avgMs / 1000).toFixed(1), st.errors)}</span>
            </div>
            {last?.say && <div className="font-bold text-[var(--gold)]">「{last.say}」</div>}
            {last && (last.error ? <div className="truncate text-[var(--red)]">✗ {last.error}</div> : <div className="truncate text-white/75">{last.plan}</div>)}
          </div>
        );
      })}
    </>
  );
}

/** Full-screen victory cut-scene of the match winner; any key, click or tap skips it. */
function VictoryVideo({ c, winner, onDone }: { c: CharDef; winner: string; onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const done = useRef(false);
  const finish = useRef(onDone);
  finish.current = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    const v = video.current;
    void audio.bgm("");
    if (v) {
      v.muted = audio.muted;
      v.volume = Math.min(1, audio.musicVolume + 0.3);
      v.play().catch(() => {
        // autoplay with sound refused: play muted rather than not at all
        v.muted = true;
        v.play().catch(() => finish.current());
      });
    }
    const since = performance.now();
    const skip = (e: KeyboardEvent) => {
      if (!e.repeat && performance.now() - since > 600) finish.current();
    };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, []);

  const show = Math.min(1, Math.max(0, (t - 1.2) / 0.8));
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black" onClick={() => finish.current()}>
      <video
        ref={video}
        src={`/assets/video/victory_${c.id}.mp4`}
        poster={`/assets/video/victory_${c.id}.jpg`}
        playsInline
        className="h-full w-full object-contain"
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onEnded={() => finish.current()}
        onError={() => finish.current()}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-6 pb-[6vh] pt-16 text-center"
        style={{ opacity: show, transform: `translateY(${(1 - show) * 12}px)` }}
      >
        <div className="font-num text-sm italic tracking-[0.3em]" style={{ color: c.color }}>
          {winner ? `${winner} WINS` : "WINNER"}
        </div>
        <div className="font-brush text-[clamp(22px,4.4vw,44px)] leading-tight text-white [text-shadow:0_3px_0_#000]">「{tx(c.victory)}」</div>
      </div>
      <div className="font-ui absolute right-4 top-4 -skew-x-12 bg-black/55 px-3 py-1 text-xs font-bold text-white/80 ring-1 ring-white/25">{tx("跳过 ›")}</div>
    </div>
  );
}

function Overlay({ title, gold, sub, aside, children }: { title: string; gold?: boolean; sub?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grain absolute inset-0 z-40 flex items-center justify-center overflow-hidden bg-[rgba(10,6,16,0.8)] py-4 backdrop-blur-[3px]">
      <div className="stripes pointer-events-none absolute inset-0 opacity-40" />
      <div className="rise relative flex max-h-full flex-col items-center gap-2">
        <div
          className={`font-num dy-strong -skew-x-6 whitespace-nowrap text-center text-[clamp(40px,min(11vw,13vh),112px)] italic leading-none ${gold ? "text-[var(--gold)]" : "text-white"}`}
        >
          {title}
        </div>
        {sub && <div className="font-brush text-[clamp(22px,5vh,40px)] leading-none text-white/90 [text-shadow:0_3px_0_#000]">{sub}</div>}
        <div className="mt-[2.5vh] flex min-h-0 flex-col items-center gap-4 landscape:flex-row landscape:items-start landscape:gap-8">
          <div className="flex w-64 flex-col gap-3">{children}</div>
          {aside}
        </div>
      </div>
    </div>
  );
}

function MoveList({ chars }: { chars: [number, number] }) {
  const ids = Array.from(new Set(chars));
  return (
    <div className="font-ui max-h-[42vh] w-[min(86vw,360px)] overflow-auto bg-black/50 p-3 text-xs ring-1 ring-white/10">
      {ids.map((i) => (
        <div key={i} className="mb-1.5">
          <div className="font-brush text-base" style={{ color: CHARS[i].color }}>
            {CHARS[i].name}
          </div>
          {CHARS[i].moveList.map((m) => (
            <div key={m.name} className="flex justify-between gap-2 text-white/70">
              <span className="shrink-0 whitespace-nowrap text-[var(--gold)]">{tx(m.input)}</span>
              <span>{tx(m.name)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
