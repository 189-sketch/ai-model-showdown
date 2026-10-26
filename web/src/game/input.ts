import { IN_D, IN_HK, IN_HP, IN_L, IN_LK, IN_LP, IN_R, IN_U } from "./constants";

// KOF-style layout: A=轻拳 B=轻脚 C=重拳 D=重脚
export const KEYMAPS: Record<"p1" | "p2", Record<string, number>> = {
  p1: {
    KeyW: IN_U, KeyS: IN_D, KeyA: IN_L, KeyD: IN_R,
    KeyJ: IN_LP, KeyK: IN_LK, KeyU: IN_HP, KeyI: IN_HK,
    Space: IN_U,
  },
  p2: {
    ArrowUp: IN_U, ArrowDown: IN_D, ArrowLeft: IN_L, ArrowRight: IN_R,
    Numpad1: IN_LP, Numpad2: IN_LK, Numpad4: IN_HP, Numpad5: IN_HK,
    Comma: IN_LP, Period: IN_LK, KeyL: IN_HP, Semicolon: IN_HK,
  },
};

const held = new Set<string>();
let touchBits = 0;
let listening = false;

function onDown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  held.add(e.code);
}
function onUp(e: KeyboardEvent) {
  held.delete(e.code);
}
function onBlur() {
  held.clear();
}

export function startInput() {
  if (listening) return;
  listening = true;
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  window.addEventListener("blur", onBlur);
}

export function stopInput() {
  listening = false;
  held.clear();
  window.removeEventListener("keydown", onDown);
  window.removeEventListener("keyup", onUp);
  window.removeEventListener("blur", onBlur);
}

export function setTouchBits(bits: number) {
  touchBits = bits;
}

function keyboardBits(map: Record<string, number>) {
  let b = 0;
  for (const code of held) b |= map[code] ?? 0;
  return b;
}

// Standard gamepad mapping: X=轻拳 A=轻脚 Y=重拳 B=重脚, d-pad or left stick to move
function gamepadBits(index: number) {
  const pads = navigator.getGamepads?.() ?? [];
  const connected = pads.filter((p): p is Gamepad => !!p);
  const pad = connected[index];
  if (!pad) return 0;
  let b = 0;
  const btn = (i: number) => !!pad.buttons[i]?.pressed;
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  if (btn(12) || ay < -0.5) b |= IN_U;
  if (btn(13) || ay > 0.5) b |= IN_D;
  if (btn(14) || ax < -0.5) b |= IN_L;
  if (btn(15) || ax > 0.5) b |= IN_R;
  if (btn(2)) b |= IN_LP;
  if (btn(0)) b |= IN_LK;
  if (btn(3)) b |= IN_HP;
  if (btn(1)) b |= IN_HK;
  if (btn(4)) b |= IN_LP | IN_LK;
  if (btn(5)) b |= IN_HP | IN_HK;
  return b;
}

function clean(b: number) {
  if (b & IN_L && b & IN_R) b &= ~(IN_L | IN_R);
  if (b & IN_U && b & IN_D) b &= ~(IN_U | IN_D);
  return b;
}

/**
 * Read one player's buttons.
 * `slot` p1 also merges touch controls and the first gamepad; when only one
 * human plays (vs CPU / online) both keyboard layouts drive that player.
 */
export function readPlayer(slot: "p1" | "p2", solo: boolean): number {
  let b = keyboardBits(KEYMAPS[slot]);
  if (slot === "p1") {
    b |= touchBits | gamepadBits(0);
    if (solo) b |= keyboardBits(KEYMAPS.p2);
  } else {
    b |= gamepadBits(1);
  }
  return clean(b);
}

export function anyKeyHeld(code: string) {
  return held.has(code);
}
