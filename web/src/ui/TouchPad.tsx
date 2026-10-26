import { useEffect, useRef } from "react";
import { IN_D, IN_HK, IN_HP, IN_L, IN_LK, IN_LP, IN_R, IN_U } from "@/game/constants";
import { setTouchBits } from "@/game/input";
import { tx } from "@/lib/i18n";

const BUTTONS = [
  { bit: IN_LP, label: "轻拳", cls: "right-[118px] bottom-[64px]", color: "#ff7a45" },
  { bit: IN_HP, label: "重拳", cls: "right-[62px] bottom-[112px]", color: "#ff3b3b" },
  { bit: IN_LK, label: "轻脚", cls: "right-[62px] bottom-[16px]", color: "#46b8ff" },
  { bit: IN_HK, label: "重脚", cls: "right-[6px] bottom-[64px]", color: "#2f6bff" },
];

/** On-screen stick + 4 buttons for phones. Multi-touch aware. */
export function TouchPad() {
  const stick = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const dirBits = useRef(0);
  const btnBits = useRef(0);
  const stickTouch = useRef<number | null>(null);
  const btnTouches = useRef(new Map<number, number>());

  useEffect(() => () => setTouchBits(0), []);

  const flush = () => setTouchBits(dirBits.current | btnBits.current);

  const updateStick = (x: number, y: number) => {
    const el = stick.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    const max = r.width / 2;
    const k = len > max ? max / len : 1;
    if (knob.current) knob.current.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    let b = 0;
    if (len > 16) {
      const a = Math.atan2(dy, dx);
      const deg = (a * 180) / Math.PI;
      if (deg > -157.5 && deg < -22.5) b |= IN_U;
      if (deg > 22.5 && deg < 157.5) b |= IN_D;
      if (deg > -67.5 && deg < 67.5) b |= IN_R;
      if (deg > 112.5 || deg < -112.5) b |= IN_L;
    }
    dirBits.current = b;
    flush();
  };

  const resetStick = () => {
    stickTouch.current = null;
    dirBits.current = 0;
    if (knob.current) knob.current.style.transform = "translate(0,0)";
    flush();
  };

  const onStickStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    stickTouch.current = t.identifier;
    updateStick(t.clientX, t.clientY);
  };
  const onStickMove = (e: React.TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) if (t.identifier === stickTouch.current) updateStick(t.clientX, t.clientY);
  };
  const onStickEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) if (t.identifier === stickTouch.current) resetStick();
  };

  const recomputeButtons = () => {
    let b = 0;
    for (const v of btnTouches.current.values()) b |= v;
    btnBits.current = b;
    flush();
  };

  const onBtn = (bit: number) => ({
    onTouchStart: (e: React.TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) btnTouches.current.set(t.identifier, bit);
      recomputeButtons();
      navigator.vibrate?.(8);
    },
    onTouchEnd: (e: React.TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) btnTouches.current.delete(t.identifier);
      recomputeButtons();
    },
    onTouchCancel: (e: React.TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) btnTouches.current.delete(t.identifier);
      recomputeButtons();
    },
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none [touch-action:none]">
      <div
        ref={stick}
        className="pointer-events-auto absolute bottom-6 left-6 h-36 w-36 rounded-full border-2 border-white/25 bg-white/10 backdrop-blur-sm"
        onTouchStart={onStickStart}
        onTouchMove={onStickMove}
        onTouchEnd={onStickEnd}
        onTouchCancel={onStickEnd}
      >
        <div ref={knob} className="absolute left-1/2 top-1/2 -ml-8 -mt-8 h-16 w-16 rounded-full border-2 border-white/50 bg-white/30" />
      </div>
      <div className="pointer-events-auto absolute bottom-4 right-4 h-[172px] w-[172px]">
        {BUTTONS.map((b) => (
          <button
            key={b.label}
            {...onBtn(b.bit)}
            className={`font-cn absolute h-14 w-14 rounded-full border-2 border-white/40 text-sm text-white shadow-lg active:scale-95 ${b.cls}`}
            style={{ background: `${b.color}bb` }}
          >
            {tx(b.label)}
          </button>
        ))}
      </div>
      <div
        className="font-cn pointer-events-auto absolute bottom-[196px] right-6 rounded-full border border-white/30 bg-[#ff3b3b88] px-3 py-1.5 text-xs text-white"
        {...onBtn(IN_HP | IN_HK)}
      >
        {tx("超必杀")}
      </div>
      <div
        className="font-cn pointer-events-auto absolute bottom-[196px] right-[92px] rounded-full border border-white/30 bg-white/15 px-3 py-1.5 text-xs text-white"
        {...onBtn(IN_LP | IN_LK)}
      >
        {tx("闪避")}
      </div>
    </div>
  );
}
