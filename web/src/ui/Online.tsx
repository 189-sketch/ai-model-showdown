import { useEffect, useRef, useState } from "react";
import { tx } from "@/lib/i18n";
import { audio } from "@/game/audio";
import {
  connectPeer, createRoom, joinRoom, leaveRoom, quickMatchLoop, waitForGuest,
  type PeerLink, type RoomInfo,
} from "@/game/rtc";
import { ArcadeButton, Key, Screen, TopBar } from "./common";

type Phase = "idle" | "quick" | "hosting" | "joining" | "connecting" | "error";

export function Online({ name, onConnected, onBack }: { name: string; onConnected: (link: PeerLink, opponent: string) => void; onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const roomRef = useRef<RoomInfo | null>(null);
  roomRef.current = room;

  useEffect(() => {
    // invite link: ?room=CODE
    const q = new URLSearchParams(location.search).get("room");
    if (q && /^[A-Za-z0-9]{6}$/.test(q)) {
      setCode(q.toUpperCase());
      history.replaceState(null, "", location.pathname);
    }
    return () => {
      abort.current?.abort();
    };
  }, []);

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    if (roomRef.current) void leaveRoom(roomRef.current.id);
    setRoom(null);
    setPhase("idle");
    setStatus("");
  };

  const run = async (kind: "quick" | "host" | "join") => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setError("");
    try {
      let r: RoomInfo;
      if (kind === "quick") {
        setPhase("quick");
        setStatus(tx("正在寻找对手…"));
        r = await quickMatchLoop(name, ac.signal, setRoom);
      } else if (kind === "host") {
        setPhase("hosting");
        setStatus(tx("创建房间中…"));
        r = await createRoom(name);
        setRoom(r);
        setStatus(tx("把房间码发给好友，等待加入…"));
        r = await waitForGuest(r, ac.signal);
      } else {
        setPhase("joining");
        setStatus(tx("加入房间中…"));
        r = await joinRoom(code, name);
      }
      setRoom(r);
      setPhase("connecting");
      setStatus(tx("匹配到 {0}，正在连接…", r.opponentName ?? tx("对手")));
      const link = await connectPeer(r, ac.signal, setStatus);
      onConnected(link, r.opponentName ?? tx("对手"));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (roomRef.current) void leaveRoom(roomRef.current.id);
      setRoom(null);
      setPhase("error");
      setError(tx((err as Error).message || "连接失败"));
    }
  };

  const inviteUrl = room ? `${location.origin}/?room=${room.code}` : "";
  const busy = phase !== "idle" && phase !== "error";
  const back = () => (busy ? cancel() : onBack());
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") backRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Screen bg="/assets/stages/launch.jpg">
      <TopBar
        title={tx("联机对战")}
        en="ONLINE PK"
        onBack={back}
        right={<span className="font-ui hidden text-xs font-bold text-white/55 sm:inline">{tx("点对点直连 · 回滚同步")}</span>}
      />

      <main className="flex min-h-0 flex-1 items-center justify-center gap-[3vw] overflow-auto px-4 py-3">
        {!busy && (
          <>
            <button
              onClick={() => run("quick")}
              onMouseEnter={() => audio.sfx("menu")}
              className="rise group relative h-[min(60vh,380px)] w-[min(40vw,380px)] shrink-0 -skew-x-6 overflow-hidden bg-[var(--red)] text-left shadow-[6px_6px_0_#000] transition hover:-translate-y-1 hover:shadow-[10px_10px_0_#000]"
            >
              <div className="stripes absolute inset-0 opacity-50" />
              {[0, 1, 2].map((k) => (
                <span
                  key={k}
                  className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full border-2 border-white/60"
                  style={{ animation: `radar 2.4s ${k * 0.8}s ease-out infinite` }}
                />
              ))}
              <div className="relative flex h-full skew-x-6 flex-col justify-between p-[clamp(16px,3.5vh,32px)]">
                <span className="font-num text-sm italic tracking-[0.35em] text-white/80">QUICK MATCH</span>
                <div>
                  <div className="font-ui text-[clamp(30px,min(5vw,9vh),58px)] font-black leading-none [text-shadow:3px_3px_0_rgba(0,0,0,0.35)]">{tx("快速匹配")}</div>
                  <div className="font-ui mt-2 text-sm font-bold text-white/85">{tx("随机连线一位正在找对手的玩家")}</div>
                </div>
                <span className="font-ui inline-flex items-center gap-2 self-start bg-black/25 px-3 py-1.5 text-sm font-black">
                  {tx("开始匹配")} <span className="transition-transform group-hover:translate-x-1">›</span>
                </span>
              </div>
            </button>

            <div className="rise flex w-[min(40vw,380px)] shrink-0 flex-col gap-[2vh] [animation-delay:120ms]">
              <div className="-skew-x-6 bg-black/60 shadow-[6px_6px_0_#000] ring-1 ring-white/15 backdrop-blur">
                <div className="flex skew-x-6 flex-col gap-[1.8vh] p-[clamp(14px,3vh,26px)]">
                  <div className="flex items-baseline justify-between">
                    <span className="font-ui text-xl font-black sm:text-2xl">{tx("好友房间")}</span>
                    <span className="font-num text-xs italic tracking-[0.3em] text-white/40">PRIVATE ROOM</span>
                  </div>
                  <ArcadeButton tone="blue" onClick={() => run("host")}>
                    {tx("创建房间 · 邀请好友")}
                  </ArcadeButton>
                  <div className="font-ui flex items-center gap-3 text-xs font-bold text-white/40">
                    <span className="h-px flex-1 bg-white/15" />
                    {tx("或输入好友的房间码")}
                    <span className="h-px flex-1 bg-white/15" />
                  </div>
                  <label className="relative flex cursor-text justify-between gap-1.5">
                    {Array.from({ length: 6 }, (_, i) => (
                      <span
                        key={i}
                        className={`font-num grid h-[clamp(38px,8vh,54px)] flex-1 -skew-x-6 place-items-center text-[clamp(22px,4.5vh,32px)] italic transition ${
                          code[i] ? "bg-white/15 text-white" : "bg-white/5 text-white/20"
                        } ${i === Math.min(code.length, 5) ? "ring-2 ring-[var(--cyan)]" : "ring-1 ring-white/15"}`}
                      >
                        {code[i] ?? "·"}
                      </span>
                    ))}
                    <input
                      value={code}
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={tx("房间码")}
                      onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                      onKeyDown={(e) => e.key === "Enter" && code.length === 6 && run("join")}
                      className="absolute inset-0 opacity-0"
                    />
                  </label>
                  <ArcadeButton tone="cyan" disabled={code.length !== 6} onClick={() => run("join")}>
                    {tx("加入房间")}
                  </ArcadeButton>
                  {error && <div className="font-ui bg-[var(--red)]/15 px-3 py-2 text-center text-sm font-bold text-[#ff8fa5]">{error}</div>}
                </div>
              </div>
            </div>
          </>
        )}

        {busy && (
          <div className="rise flex w-[min(92vw,460px)] flex-col items-center gap-[2.2vh] text-center">
            <div className="relative grid h-[min(26vh,150px)] w-[min(26vh,150px)] place-items-center">
              {[0, 1, 2].map((k) => (
                <span key={k} className="absolute inset-0 rounded-full border-2 border-[var(--cyan)]" style={{ animation: `radar 2.2s ${k * 0.7}s ease-out infinite` }} />
              ))}
              <span className="font-num dy-strong text-[clamp(34px,7vh,52px)] italic">PK</span>
            </div>
            {phase === "hosting" && room && (
              <div className="flex flex-col items-center gap-2">
                <span className="font-ui text-xs font-bold tracking-[0.3em] text-white/50">{tx("房间码")}</span>
                <span className="font-num text-[clamp(40px,9vh,64px)] italic leading-none tracking-[0.25em] text-[var(--gold)] [text-shadow:4px_4px_0_#000]">{room.code}</span>
                <ArcadeButton
                  tone="gold"
                  className="mt-1 py-1.5 text-sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(tx("来「谁才是最强AI大模型」和我单挑！房间码 {0}  {1}", room.code, inviteUrl)).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? tx("已复制 ✓") : tx("复制邀请链接")}
                </ArcadeButton>
              </div>
            )}
            <div className="font-ui text-base font-bold sm:text-lg">{status}</div>
            {phase === "quick" && <div className="font-ui text-xs text-white/50">{tx("也可以开两个浏览器标签页自己测试")}</div>}
            <ArcadeButton tone="gray" onClick={cancel}>
              {tx("取消")}
            </ArcadeButton>
          </div>
        )}
      </main>

      <footer className="font-ui relative z-20 flex shrink-0 items-center justify-center gap-2 px-4 py-2 text-center text-[11px] text-white/45">
        {tx("对战数据点对点直连（WebRTC），回滚网络同步，延迟低于 150ms 时手感接近本地 ·")} <Key>Esc</Key> {tx("返回")}
      </footer>
    </Screen>
  );
}
