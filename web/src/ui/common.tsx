import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { CharDef } from "@/game/chars";
import { audio } from "@/game/audio";
import { getLang, setLang, tx } from "@/lib/i18n";
import { CodeFlow } from "./CodeFlow";

/** PK sides: red on the left, blue on the right, like the live-room PK bar. */
export const SIDE_COLOR = ["var(--red)", "var(--blue)"] as const;

type Tone = "red" | "blue" | "cyan" | "gold" | "gray";

const TONES: Record<Tone, string> = {
  red: "bg-[var(--red)] text-white",
  blue: "bg-[var(--blue)] text-white",
  cyan: "bg-[var(--cyan)] text-[var(--ink)]",
  gold: "bg-[var(--gold)] text-[var(--ink)]",
  gray: "bg-white/10 text-white ring-1 ring-inset ring-white/25 backdrop-blur",
};

/** Slanted arcade button with a hard drop shadow. */
export function ArcadeButton({
  children,
  tone = "red",
  className = "",
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      {...rest}
      onClick={(e) => {
        audio.unlock();
        audio.sfx("confirm");
        onClick?.(e);
      }}
      onMouseEnter={() => audio.sfx("menu")}
      className={`font-ui relative -skew-x-12 select-none px-6 py-2.5 text-base font-black tracking-wider shadow-[4px_4px_0_#000]
        transition-[transform,box-shadow] duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#000]
        active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_#000]
        disabled:pointer-events-none disabled:opacity-40 ${TONES[tone]} ${className}`}
    >
      <span className="flex w-full skew-x-12 items-center justify-center gap-2">{children}</span>
    </button>
  );
}

/** Full-viewport page: ink base, optional blurred art, PK colour washes, scanlines and grain. */
export function Screen({ children, bg, fx, className = "" }: { children: ReactNode; bg?: string; fx?: "code"; className?: string }) {
  return (
    <div className={`grain relative flex h-[100dvh] w-full flex-col overflow-hidden ${fx === "code" ? "bg-[#e9e8ec] text-[#1d1a24]" : "bg-[var(--ink)] text-white"} ${className}`}>
      {bg && (
        <img
          src={bg}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover opacity-35 blur-[3px]"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        />
      )}
      {fx === "code" ? (
        <>
          <CodeFlow theme="light" />
          {/* the code fades under the left-hand menu column and toward the top and bottom edges; in portrait the menu
              spans the whole width, so it is faded all over */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(233,232,236,0.85)_0%,rgba(233,232,236,0.5)_34%,rgba(233,232,236,0.1)_58%,transparent_75%),linear-gradient(to_bottom,rgba(233,232,236,0.6),transparent_16%,transparent_84%,rgba(233,232,236,0.7))] portrait:bg-[linear-gradient(rgba(233,232,236,0.5),rgba(233,232,236,0.5)),linear-gradient(90deg,rgba(233,232,236,0.6),transparent_70%)]" />
        </>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_0%_0%,rgba(254,44,85,0.28),transparent_70%),radial-gradient(60%_80%_at_100%_100%,rgba(47,123,255,0.3),transparent_70%)]" />
          <div className="scan pointer-events-none absolute inset-0" />
        </>
      )}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** Keyboard key cap for control hints. */
export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="font-num inline-grid h-[1.7em] min-w-[1.7em] place-items-center rounded-[5px] border border-b-[3px] border-white/35 bg-white/10 px-1.5 text-[0.85em] not-italic leading-none text-white">
      {children}
    </kbd>
  );
}

export function LiveBadge({ viewers }: { viewers?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-num inline-flex -skew-x-12 items-center gap-1.5 bg-[var(--red)] px-2 py-0.5 text-sm tracking-[0.2em] text-white">
        <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        LIVE
      </span>
      {viewers && <span className="font-ui text-xs font-bold text-white/80">{tx("{0}人在看", viewers)}</span>}
    </span>
  );
}

/** Page header: back button, Chinese title with English kicker, right-hand slot. */
export function TopBar({ title, en, onBack, right }: { title: string; en: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-black/45 px-3 backdrop-blur-md sm:h-14 sm:px-6">
      {onBack && (
        <button
          className="group flex items-center gap-2"
          onMouseEnter={() => audio.sfx("menu")}
          onClick={() => {
            audio.sfx("menu");
            onBack();
          }}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full border border-white/30 text-lg transition group-hover:border-white group-hover:bg-white group-hover:text-black">
            ‹
          </span>
          <span className="hidden sm:inline">
            <Key>Esc</Key>
          </span>
        </button>
      )}
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="font-ui truncate text-lg font-black sm:text-2xl">{title}</span>
        <span className="font-num hidden text-sm italic tracking-[0.3em] text-white/40 sm:inline">{en}</span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">{right}</div>
    </header>
  );
}

export function Logo({ small = false, light = false }: { small?: boolean; light?: boolean }) {
  const zh = getLang() === "zh";
  return (
    <div className="select-none text-center leading-none">
      {/* the flame title artwork, one transparent image per language (both about 5:3) */}
      <img
        src={zh ? "/assets/ui/title-logo.webp" : "/assets/ui/title-logo-en.webp"}
        alt={zh ? "谁才是最强AI大模型" : "Who Is the Strongest AI Model"}
        draggable={false}
        className={`mx-auto w-auto ${light ? "drop-shadow-[0_6px_14px_rgba(40,20,60,0.22)]" : "drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]"} ${small ? "h-[clamp(56px,min(30vw,17vh),150px)] [@media(max-height:500px)]:h-[13vh]" : "h-[clamp(110px,min(52vw,30vh),300px)]"}`}
      />
      <div className={`font-ui mt-2 flex items-center justify-center gap-3 font-bold tracking-[0.45em] ${light ? "text-[#2b2735]/70" : "text-white/75"} ${small ? "text-[10px] [@media(max-height:500px)]:hidden" : "text-xs"}`}>
        <span className="h-px w-8 bg-gradient-to-r from-transparent to-[var(--cyan)]" />
        {tx("模型大乱斗 · 直播间格斗 PK")}
        <span className="h-px w-8 bg-gradient-to-l from-transparent to-[var(--red)]" />
      </div>
    </div>
  );
}

/** 中文 / EN switch. */
export function LangToggle({ className = "" }: { className?: string }) {
  const lang = getLang();
  return (
    <span className={`font-ui inline-flex -skew-x-12 overflow-hidden text-xs font-black ring-1 ring-white/30 ${className}`}>
      {(["zh", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={(e) => {
            e.stopPropagation();
            audio.sfx("menu");
            setLang(l);
          }}
          className={`px-2.5 py-1 transition ${lang === l ? "bg-white text-[var(--ink)]" : "bg-black/40 text-white/70 hover:text-white"}`}
        >
          <span className="inline-block skew-x-12">{l === "zh" ? "中文" : "EN"}</span>
        </button>
      ))}
    </span>
  );
}

// ───── character presentation helpers ─────

/** Background crop that centres each portrait's face (portraits are 3:4, faces sit high). */
const FACE: Record<string, string> = {
  chatgpt: "50% 18%",
  claude: "50% 18%",
  deepseek: "50% 18%",
  grok: "50% 18%",
};

export function Face({ c, className = "" }: { c: CharDef; className?: string }) {
  return (
    <div
      className={`bg-no-repeat ${className}`}
      style={{ backgroundImage: `url(/assets/ui/portrait_${c.id}.jpg)`, backgroundSize: "220%", backgroundPosition: FACE[c.id] ?? "50% 15%" }}
    />
  );
}

/** 0..1 ratings for the select screen, read from the fighter's numbers. */
export function charStats(c: CharDef) {
  return [
    { label: tx("体力"), v: (c.hp - 800) / 350 },
    { label: tx("速度"), v: (c.walkF - 1.4) / 1.6 },
    { label: tx("弹跳"), v: (c.jumpVy - 8.6) / 2.2 },
  ].map((s) => ({ ...s, v: Math.max(0.15, Math.min(1, s.v)) }));
}

/** The super move's display name. */
export function superName(c: CharDef) {
  return tx(c.superMove.name ?? "");
}

const NAME_KEY = "pk-name";

export function loadName(): string {
  try {
    const n = localStorage.getItem(NAME_KEY);
    if (n) return n;
  } catch {
    /* ignore */
  }
  return `${tx("拳手")}${Math.floor(1000 + Math.random() * 9000)}`;
}

export function saveName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}

export const isTouch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
