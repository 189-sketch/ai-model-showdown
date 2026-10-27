/**
 * 谁才是最强AI大模型 — screen flow:
 * title → menu → (online lobby) → character select → match → result
 */

import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { loadArt } from "@/game/assets";
import { audio } from "@/game/audio";
import { CHARS, STAGES, charIndex } from "@/game/chars";
import type { PeerLink } from "@/game/rtc";
import type { Mode } from "@/game/runner";
import { getLang, onLangChange, tx } from "@/lib/i18n";
import { Arena, type ArenaStart } from "@/ui/Arena";
import { loadName, saveName } from "@/ui/common";
import { Game } from "@/ui/Game";
import { Help } from "@/ui/Help";
import { Menu, type MenuChoice } from "@/ui/Menu";
import { Online } from "@/ui/Online";
import { Select, type StartInfo } from "@/ui/Select";
import { Title } from "@/ui/Title";

type ScreenId = "title" | "menu" | "online" | "select" | "game" | "help" | "arena";

const hasInvite = () => new URLSearchParams(location.search).has("room");

function App() {
  const [screen, setScreen] = useState<ScreenId>("title");
  const [mode, setMode] = useState<Mode>("cpu");
  const [name, setName] = useState(loadName);
  const [link, setLink] = useState<PeerLink | null>(null);
  const [opponent, setOpponent] = useState("");
  const [peerGone, setPeerGone] = useState(false);
  const [info, setInfo] = useState<StartInfo | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const [arena, setArena] = useState<ArenaStart | null>(null);
  // switching 中文 / EN re-mounts the current screen so every label is drawn again
  const [lang, setLangState] = useState(getLang);
  useEffect(() => onLangChange(() => setLangState(getLang())), []);

  useEffect(() => {
    void loadArt(CHARS.map((c) => c.id), STAGES.map((s) => s.bg));
  }, []);

  useEffect(() => {
    if (!link) return;
    link.onClose = () => setPeerGone(true);
  }, [link]);

  // opponent left while picking characters
  useEffect(() => {
    if (peerGone && screen === "select") {
      alert(tx("对手已离开"));
      leaveOnline();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerGone, screen]);

  const leaveOnline = useCallback(() => {
    link?.close();
    setLink(null);
    setPeerGone(false);
    setScreen("menu");
  }, [link]);

  const pick = (m: MenuChoice) => {
    if (m === "help") return setScreen("help");
    if (m === "online") return setScreen("online");
    if (m === "arena") return setScreen("arena");
    setMode(m);
    setInfo(null);
    setScreen("select");
  };

  const onName = (n: string) => {
    setName(n);
    saveName(n.trim() || tx("无名拳手"));
  };

  const isGuest = link?.role === "guest";
  const playerNames: [string, string] =
    mode === "online" ? (isGuest ? [opponent, name] : [name, opponent]) : mode === "local" ? ["1P", "2P"] : [name, mode === "cpu" ? "CPU" : tx("木桩")];
  // the in-game HUD shows fighter names offline, player names online
  const hudNames: [string, string] =
    mode === "arena" && arena ? [arena.models[0].name, arena.models[1].name] : mode === "online" ? playerNames : info ? [CHARS[info.chars[0]].name, CHARS[info.chars[1]].name] : ["", ""];

  const start = useCallback((s: StartInfo) => {
    setInfo(s);
    setMatchKey((k) => k + 1);
    setScreen("game");
  }, []);

  const toSelect = useCallback(() => {
    void audio.bgm("title");
    setScreen(mode === "arena" ? "arena" : "select");
  }, [mode]);

  const startArena = useCallback(
    (a: ArenaStart) => {
      setArena(a);
      setMode("arena");
      start({
        chars: [Math.max(0, charIndex(a.models[0].body)), Math.max(0, charIndex(a.models[1].body))],
        stage: a.stage,
        seed: Math.floor(Math.random() * 2 ** 31),
        cpuLevel: 2,
        delay: 0,
      });
    },
    [start]
  );

  switch (screen) {
    case "title":
      return <Title key={lang} onStart={() => setScreen(hasInvite() ? "online" : "menu")} />;
    case "menu":
      return <Menu key={lang} name={name} onName={onName} onPick={pick} />;
    case "help":
      return <Help key={lang} onBack={() => setScreen("menu")} />;
    case "arena":
      return <Arena key={lang} initial={arena ?? undefined} onStart={startArena} onBack={() => setScreen("menu")} />;
    case "online":
      return (
        <Online
          name={name.trim() || tx("无名拳手")}
          onBack={() => setScreen("menu")}
          onConnected={(l, opp) => {
            setLink(l);
            setOpponent(opp);
            setPeerGone(false);
            setMode("online");
            setInfo(null);
            setScreen("select");
          }}
        />
      );
    case "select":
      return (
        <Select
          key={`${mode}-${link ? "net" : "local"}`}
          mode={mode}
          names={playerNames}
          link={link ?? undefined}
          initial={info ?? undefined}
          onStart={start}
          onBack={() => (mode === "online" ? leaveOnline() : setScreen("menu"))}
        />
      );
    case "game":
      if (!info) return null;
      return (
        <Game
          mode={mode}
          info={info}
          names={hudNames}
          link={link ?? undefined}
          arena={mode === "arena" && arena ? arena.models : undefined}
          matchKey={matchKey}
          peerGone={peerGone}
          onRematch={start}
          onReselect={toSelect}
          onExit={() => {
            void audio.bgm("title");
            if (mode === "online") leaveOnline();
            else setScreen("menu");
          }}
        />
      );
  }
}

// dev only: `/?rec=<film>` opens the promo film recorder instead of the game
const Rec = import.meta.env.DEV ? lazy(() => import("@/rec/Rec")) : null;

export default function Root() {
  if (Rec && new URLSearchParams(location.search).has("rec")) {
    return (
      <Suspense fallback={null}>
        <Rec />
      </Suspense>
    );
  }
  return <App />;
}
