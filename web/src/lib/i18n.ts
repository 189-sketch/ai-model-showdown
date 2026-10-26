/**
 * Chinese / English. The Chinese text in the code is the key; EN maps it to English.
 * `tx("{0}连击", n)` fills {0}, {1}… placeholders. Untranslated keys fall back to Chinese.
 */

import { EN } from "./en";

export type Lang = "zh" | "en";

export const SITE_NAME = "谁才是最强AI大模型";

const KEY = "pk-lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== "undefined" && !/^zh/i.test(navigator.language) ? "en" : "zh";
}

let current: Lang = typeof window !== "undefined" ? detect() : "zh";
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function tx(zh: string, ...args: (string | number)[]): string {
  let s = current === "en" ? EN[zh] ?? zh : zh;
  args.forEach((a, i) => (s = s.split(`{${i}}`).join(String(a))));
  return s;
}

function applyDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
  document.title = tx(SITE_NAME);
}

export function setLang(l: Lang) {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  applyDocument();
  listeners.forEach((f) => f());
}

export function onLangChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

applyDocument();
