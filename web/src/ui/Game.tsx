import { useEffect, useRef, useState } from "react";
import { audio } from "@/game/audio";
import { CHARS, type CharDef } from "@/game/chars";
import { tx } from "@/lib/i18n";
import { startInput, stopInput } from "@/game/input";
import { GameRunner, type DummyMode, type Mode } from "@/game/runner";
import type { CtrlMsg, PeerLink } from "@/game/rtc";
import { ArcadeButton, isTouch } from "./common";
import type { StartInfo } from "./Select";
import { TouchPad } from "./TouchPad";

interface Props {
  mode: Mode;
  info: StartInfo;
  names: [string, string];
  link?: PeerLink;
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

export function Game({ mode, info, names, link, matchKey, peerGone, onRematch, onReselect, onExit }: Props) {
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
  const [touch] = useState(isTouch);
  const isHost = link?.role !== "guest";
  const localSide: 0 | 1 = mode === "online" && !isHost ? 1 : 0;

  useEffect(() => {
    if (!canvas.current) return;
    startInput();
    setEnded(null);
    setVictory(null);
    setWantRematch(false);
    setPeerWantsRematch(false);
    const r = new GameRunner({
      canvas: canvas.current,
      mode,
      config: { chars: info.chars, stage: info.stage, seed: info.seed, training: mode === "training" },
      names,
      cpuLevel: info.cpuLevel,
      link,
      localSide,
      inputDelay: info.delay,
      onMatchEnd: (w) => {
        if (w === 0 || w === 1) setVictory(CHARS[info.chars[w]]);
        setEnded(w);
      },
      onDisconnect: () => setDisconnected(true),
    });
    r.showBoxes = mode === "training";
    runner.current = r;
    r.start();
    return () => {
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

  return (
    <div className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-black">
      <canvas
        ref={canvas}
        className="block max-h-[100dvh] max-w-full [image-rendering:pixelated]"
        style={{ aspectRatio: "16 / 9", width: "min(100vw, calc(100dvh * 16 / 9))" }}
      />

      {touch && ended === null && !paused && <TouchPad />}

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
          title={ended === 2 ? "DRAW" : mode === "local" ? `${ended === 0 ? "1P" : "2P"} WIN` : won ? "YOU WIN" : "YOU LOSE"}
          gold={won || mode === "local"}
          sub={ended === 0 || ended === 1 ? tx("{0} 获胜", names[ended]) : tx("平局")}
        >
          <ArcadeButton tone="gold" disabled={wantRematch} onClick={rematch}>
            {mode === "online" ? (wantRematch ? tx("等待对手…") : peerWantsRematch ? tx("对手想再来一局！") : tx("再来一局")) : tx("再来一局")}
          </ArcadeButton>
          <ArcadeButton tone="blue" onClick={reselect}>
            {tx("重新选人")}
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
