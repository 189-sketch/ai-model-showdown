import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audio } from "@/game/audio";
import { CHARS, type CharDef } from "@/game/chars";
import { getLang, tx } from "@/lib/i18n";
import { LiveBadge, charStats, superName } from "./common";

// glow colour per fighter (Grok's silver doesn't glow, so his is rocket-flame orange)
export const ACCENT: Record<string, string> = { chatgpt: "#8f7dff", claude: "#ff8a3d", deepseek: "#3f86ff", grok: "#ff5b3a" };
// the spotlight moves on when the featured fighter's clip has played through; a fighter whose clip never
// starts (offline, blocked autoplay) still gets this long
const FALLBACK_MS = 7000;

// drifting sparks over the featured blade: [left %, size px, seconds, delay s]
const EMBERS: [number, number, number, number][] = [
  [8, 3, 4.2, 0], [22, 2, 3.4, 1.1], [35, 4, 5.0, 0.4], [48, 2, 3.8, 2.0], [61, 3, 4.6, 0.8],
  [74, 2, 3.2, 1.6], [86, 4, 5.4, 0.2], [15, 2, 4.0, 2.6], [55, 3, 3.6, 3.0], [92, 2, 4.4, 1.4],
];

/**
 * Main-menu roster: the four fighters as slanted blades. One blade is featured (full colour, name, stats,
 * quote, glow, fight clip) and the spotlight moves on when that clip has played through; hovering a blade
 * features it and holds it (the clip loops).
 */
export function Roster() {
  const [cur, setCur] = useState(0);
  const [hold, setHold] = useState(false);
  const [progress, setProgress] = useState(0); // of the featured clip, 0..1
  const started = useRef(false); // the featured clip actually started playing
  const viewers = useMemo(
    () => CHARS.map(() => {
      const n = 0.8 + Math.random() * 6;
      return getLang() === "zh" ? `${n.toFixed(1)}万` : `${Math.round(n * 10)}K`;
    }),
    []
  );

  const next = useCallback(() => {
    setCur((c) => (c + 1) % CHARS.length);
    setProgress(0);
  }, []);

  useEffect(() => {
    started.current = false;
  }, [cur]);

  useEffect(() => {
    if (hold) return;
    const t = setTimeout(() => {
      if (!started.current) next();
    }, FALLBACK_MS);
    return () => clearTimeout(t);
  }, [cur, hold, next]);

  const pick = (i: number) => {
    if (i === cur) return;
    audio.sfx("menu");
    setCur(i);
    setProgress(0);
  };

  const c = CHARS[cur];
  const accent = ACCENT[c.id];

  return (
    <div className="relative hidden flex-1 overflow-hidden landscape:block" onMouseLeave={() => setHold(false)}>
      {/* the featured fighter's colour floods the stage */}
      <div
        className="pointer-events-none absolute inset-0 transition-[background] duration-700"
        style={{ background: `radial-gradient(55% 65% at 58% 52%, ${accent}40, transparent 72%), linear-gradient(115deg, transparent 40%, ${accent}14)` }}
      />
      <div className="roster-speed pointer-events-none absolute inset-[-20%] opacity-40" />
      {/* giant outlined name behind the blades */}
      <div
        key={c.id}
        className="roster-ghost font-num pointer-events-none absolute right-[3%] top-[-1vh] select-none whitespace-nowrap text-[min(17vh,10vw)] italic leading-none"
        style={{ WebkitTextStroke: `2px ${accent}70`, color: "transparent" }}
      >
        {c.en}
      </div>

      <div className="absolute inset-y-[9vh] left-[7%] right-[6%] flex gap-[0.8vw]" onMouseEnter={() => setHold(true)}>
        {CHARS.map((ch, i) => (
          <Blade
            key={ch.id} c={ch} index={i} on={i === cur} accent={ACCENT[ch.id]} viewers={viewers[i]} onPick={() => pick(i)}
            loop={hold}
            onClipStart={() => (started.current = true)}
            onClipProgress={setProgress}
            onClipEnd={next}
          />
        ))}
      </div>

      {/* rotation indicator */}
      <div className="pointer-events-none absolute bottom-[3vh] left-[8%] right-[7%] flex items-center gap-2.5">
        <span className="font-num mr-1 text-xs italic tracking-[0.4em] text-[#2b2735]/50">ROSTER</span>
        {CHARS.map((ch, i) => (
          <div key={ch.id} className="relative h-[3px] flex-1 -skew-x-12 overflow-hidden bg-[#2b2735]/12">
            {i === cur ? (
              <i
                className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-linear"
                style={{ width: `${Math.round(progress * 100)}%`, background: ACCENT[ch.id], boxShadow: `0 0 8px ${ACCENT[ch.id]}` }}
              />
            ) : null}
          </div>
        ))}
        <span className="font-num ml-1 text-sm italic text-[#2b2735]/80">
          0{cur + 1}
          <span className="text-[#2b2735]/35">/0{CHARS.length}</span>
        </span>
      </div>
    </div>
  );
}

interface ClipEvents {
  loop: boolean;
  onClipStart: () => void;
  onClipProgress: (p: number) => void;
  onClipEnd: () => void;
}

function Blade({ c, index, on, accent, viewers, onPick, ...clip }: { c: CharDef; index: number; on: boolean; accent: string; viewers: string; onPick: () => void } & ClipEvents) {
  const stats = charStats(c);
  const lift = on ? 0 : index % 2 ? 2.4 : -2.4;
  return (
    <button
      onMouseEnter={onPick}
      onFocus={onPick}
      onClick={onPick}
      aria-label={c.name}
      className="relative h-full min-w-0 overflow-hidden outline-none transition-[flex-grow,transform,box-shadow] duration-[650ms] ease-[cubic-bezier(.2,.9,.2,1)]"
      style={{
        flexGrow: on ? 5 : 1,
        flexBasis: 0,
        transform: `translateY(${lift}vh) skewX(-9deg)`,
        // soft shadows for the grey-white menu page
        boxShadow: on ? `0 0 0 2px ${accent}, 0 0 30px ${accent}77, 0 22px 44px rgba(20,16,28,0.32)` : "0 0 0 1px rgba(20,16,28,0.2), 0 12px 24px rgba(20,16,28,0.2)",
      }}
    >
      {/* everything inside is skewed back upright. It overhangs each side by 30% of the blade's width, but at least
          8vh: the skew shifts the corners sideways by about tan(9°) × half the height, which a narrow blade's 30%
          does not cover, and the page would show through the bottom-left and top-right corners */}
      <div className="absolute inset-y-0" style={{ left: "min(-30%, -8vh)", right: "min(-30%, -8vh)", transform: "skewX(9deg)" }}>
        <img
          src={`/assets/ui/portrait_${c.id}.jpg`}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-[filter] duration-700 ${on ? "[animation:kenburns_9s_ease-in-out_infinite_alternate]" : ""}`}
          style={{ objectPosition: "50% 16%", filter: on ? "saturate(1.1) contrast(1.05)" : "grayscale(0.9) brightness(0.42) contrast(1.15)" }}
          draggable={false}
        />
        <FightClip id={c.id} active={on} {...clip} />
        {/* colour grade + floor shade */}
        <div
          className="absolute inset-0 transition-opacity duration-700"
          style={{ background: `linear-gradient(to top, rgba(8,5,14,0.97) 6%, rgba(8,5,14,0.55) 34%, transparent 62%), linear-gradient(to top, ${accent}55, transparent 45%)`, opacity: on ? 1 : 0.9 }}
        />
        {!on && <div className="absolute inset-0" style={{ background: `linear-gradient(to top, ${accent}66, transparent 60%)`, mixBlendMode: "color" }} />}
        <div className="stripes absolute inset-0 opacity-25" />
        {on && <div key={`shine-${c.id}`} className="shine absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent" />}
        {on &&
          EMBERS.map(([x, size, t, d], k) => (
            <i
              key={k}
              className="ember absolute bottom-[8%] rounded-full"
              style={{ left: `${30 + x * 0.4}%`, width: size, height: size, background: accent, boxShadow: `0 0 6px ${accent}`, ["--t" as string]: `${t}s`, ["--dl" as string]: `${d}s` }}
            />
          ))}
      </div>

      {/* bright leading edge */}
      <i
        className="absolute inset-y-0 right-0 w-[3px] transition-opacity duration-500"
        style={{ background: accent, boxShadow: `0 0 12px ${accent}`, opacity: on ? 1 : 0.35 }}
      />

      {/* collapsed: index + vertical name */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-300"
        style={{ transform: "skewX(9deg)", opacity: on ? 0 : 1 }}
      >
        <span className="font-num absolute top-[2.4vh] text-[clamp(14px,2.4vh,22px)] italic text-white/45">0{index + 1}</span>
        <span
          className="font-num mt-[20vh] whitespace-nowrap text-[clamp(18px,3.4vh,32px)] italic leading-none tracking-[0.12em]"
          style={{ writingMode: "vertical-rl", color: accent, textShadow: `0 0 14px ${accent}88` }}
        >
          {c.en}
        </span>
      </div>

      {/* featured: the full card */}
      {on && (
        <div key={`info-${c.id}`} className="absolute inset-0 flex flex-col justify-between p-[2.4vh] pl-[3.4vw] text-left" style={{ transform: "skewX(9deg)" }}>
          <div className="roster-in flex items-center gap-2" style={{ animationDelay: "120ms" }}>
            <LiveBadge viewers={viewers} />
          </div>
          <div className="flex flex-col gap-[0.9vh]">
            <span className="roster-in font-num text-[clamp(14px,2.6vh,24px)] italic leading-none" style={{ color: accent, animationDelay: "160ms" }}>
              0{index + 1} / {c.en}
            </span>
            <span
              className="roster-in font-num -ml-[0.04em] whitespace-nowrap text-[clamp(44px,11vh,112px)] italic leading-[0.86] tracking-tight text-white"
              style={{ textShadow: `0.05em 0.05em 0 ${accent}, 0 0 28px ${accent}aa, 0 6px 18px rgba(0,0,0,0.7)`, animationDelay: "200ms" }}
            >
              {c.name}
            </span>
            <span className="roster-in font-ui text-[clamp(11px,1.7vh,15px)] font-black tracking-wider" style={{ color: accent, animationDelay: "260ms" }}>
              {tx(c.title)}
            </span>
            <span
              className="roster-in font-ui w-fit max-w-full -skew-x-6 px-2.5 py-1 text-[clamp(11px,1.7vh,15px)] font-bold text-white"
              style={{ background: `${accent}33`, boxShadow: `inset 3px 0 0 ${accent}`, animationDelay: "320ms" }}
            >
              「{tx(c.quote)}」
            </span>
            <div className="roster-in mt-[0.6vh] flex flex-col gap-[0.6vh]" style={{ animationDelay: "380ms" }}>
              {stats.map((st) => (
                <div key={st.label} className="flex items-center gap-2">
                  <span className="font-ui w-8 text-[11px] font-bold text-white/55">{st.label}</span>
                  <div className="h-[6px] w-[min(46%,220px)] -skew-x-12 bg-white/12">
                    <div className="roster-bar h-full" style={{ width: `${Math.round(st.v * 100)}%`, background: `linear-gradient(90deg, ${accent}, #fff)` }} />
                  </div>
                </div>
              ))}
            </div>
            <span className="roster-in font-ui text-[11px] font-bold text-white/60" style={{ animationDelay: "440ms" }}>
              <span style={{ color: accent }}>{tx("超必杀")}</span> · {superName(c)}
            </span>
          </div>
        </div>
      )}
    </button>
  );
}

/**
 * The fighter's AI fight clip, muted, over the portrait. All four are mounted (and preloading) as soon as the menu
 * opens, so featuring a fighter starts the clip at once. The clip starts on the portrait, so it fades in from it;
 * near the end it fades back to the portrait, then the roster moves on (or, while held, the clip restarts).
 */
function FightClip({ id, active, loop, onClipStart, onClipProgress, onClipEnd }: { id: string; active: boolean } & ClipEvents) {
  const video = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      void v.play().catch(() => undefined);
    } else {
      v.pause();
      setShown(false);
    }
  }, [active]);

  return (
    <video
      ref={video}
      src={`/assets/video/roster_${id}.mp4`}
      muted
      playsInline
      preload="auto"
      className="absolute inset-0 h-full w-full object-cover transition-opacity duration-200"
      style={{ objectPosition: "50% 16%", opacity: active && shown ? 1 : 0 }}
      onPlaying={() => {
        setShown(true);
        if (active) onClipStart();
      }}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (!active || !v.duration) return;
        onClipProgress(v.currentTime / v.duration);
        if (v.duration - v.currentTime < 0.35) setShown(false);
      }}
      onEnded={(e) => {
        if (!active) return;
        if (!loop) {
          onClipProgress(1);
          onClipEnd();
          return;
        }
        const v = e.currentTarget;
        v.currentTime = 0;
        void v.play().catch(() => undefined);
      }}
      onError={() => setShown(false)}
    />
  );
}
