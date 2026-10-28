/**
 * Client for the local Model Arena bridge (arena/bridge.ts, `npm run arena`).
 * The bridge holds the model profiles and API keys and makes the model calls;
 * the browser only sends prompts and reads masked profiles.
 */

export type ModelKind = "openai" | "anthropic" | "cli";

export interface ArenaModel {
  id: string;
  name: string;
  body: string; // CharDef id used as the fighter's appearance
  color?: string; // accent colour, #rrggbb
  kind: ModelKind;
  baseUrl?: string;
  model?: string;
  hasKey?: boolean;
  command?: string;
  cwd?: string;
  timeoutSec?: number;
  temperature?: number;
  maxTokens?: number;
  record?: { w: number; l: number; d: number };
  avatar?: boolean; // has an uploaded avatar
  skinAnims?: string[]; // animations with uploaded sprite strips
}

/** What the editor sends; apiKey is only ever written, never read back. */
export type ModelInput = Omit<ArenaModel, "id" | "hasKey" | "record" | "avatar" | "skinAnims"> & { apiKey?: string };

/** One animation override: a horizontal strip of `frames` equal-width frames, facing right. */
export interface AnimSkin {
  file: string;
  frames: number;
  fps?: number;
  height: number; // game units the frame height spans (fighters stand ~95 tall)
  anchorX: number; // 0..1 across a frame: where the feet are
}

export interface SkinData {
  avatar?: string;
  anims: Record<string, AnimSkin>;
}

export interface CallResult {
  ok: boolean;
  ms: number;
  text?: string;
  error?: string;
}

const URL_KEY = "pk-arena-url";
const TOKEN_KEY = "pk-arena-token";
export const DEFAULT_BRIDGE = "http://127.0.0.1:7790";

/** True when the bridge itself served this page (`npm run arena`): it is then this very origin. */
export const servedByBridge = typeof window !== "undefined" && (window as { __ARENA_BRIDGE__?: boolean }).__ARENA_BRIDGE__ === true;

const memory = new Map<string, string>(); // when localStorage is unavailable (private windows)

function read(key: string) {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? "";
  } catch {
    return memory.get(key) ?? "";
  }
}

function write(key: string, v: string) {
  memory.set(key, v);
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

/** `?bridge=<token>` (printed by the bridge at startup) is saved and stripped from the address bar. */
function takeTokenFromUrl(): boolean {
  if (typeof location === "undefined") return false;
  const q = new URLSearchParams(location.search);
  const t = q.get("bridge");
  if (!t) return false;
  write(TOKEN_KEY, t);
  q.delete("bridge");
  const rest = q.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
  return true;
}

/** The page was opened from the bridge's link: go straight to the Model Arena. */
export const openedFromBridgeLink = takeTokenFromUrl();

export const bridge = {
  get url() {
    return servedByBridge ? location.origin : read(URL_KEY) || DEFAULT_BRIDGE;
  },
  get token() {
    return read(TOKEN_KEY);
  },
  configure(url: string, token: string) {
    write(URL_KEY, url.trim().replace(/\/+$/, ""));
    write(TOKEN_KEY, token.trim());
  },

  async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.url + path, {
      ...init,
      headers: { "content-type": "application/json", "x-arena-token": this.token, ...init.headers },
    });
    const j = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    return j;
  },

  /** Resolves when the bridge is up and the token is accepted. */
  async check(): Promise<void> {
    await this.req("/models");
  },
  models() {
    return this.req<ArenaModel[]>("/models");
  },
  save(m: ModelInput, id?: string) {
    return this.req<ArenaModel>(id ? `/models/${id}` : "/models", { method: id ? "PUT" : "POST", body: JSON.stringify(m) });
  },
  remove(id: string) {
    return this.req<{ ok: boolean }>(`/models/${id}`, { method: "DELETE" });
  },
  test(id: string) {
    return this.req<CallResult>(`/models/${id}/test`, { method: "POST" });
  },
  skin(id: string) {
    return this.req<SkinData>(`/models/${id}/skin`);
  },
  /** A skin image as an object URL (the token can't ride on a plain <img src>). */
  async file(id: string, file: string): Promise<string> {
    const res = await fetch(`${this.url}/models/${id}/skin/file/${file}`, { headers: { "x-arena-token": this.token } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  putAvatar(id: string, data: string) {
    return this.req<SkinData>(`/models/${id}/avatar`, { method: "PUT", body: JSON.stringify({ data }) });
  },
  deleteAvatar(id: string) {
    return this.req<SkinData>(`/models/${id}/avatar`, { method: "DELETE" });
  },
  /** Upload (with `data`) or re-tune an animation override. */
  putAnim(id: string, anim: string, meta: Partial<Omit<AnimSkin, "file" | "fps">> & { fps?: number | null; data?: string }) {
    return this.req<SkinData>(`/models/${id}/skin/anims/${anim}`, { method: "PUT", body: JSON.stringify(meta) });
  },
  deleteAnim(id: string, anim: string) {
    return this.req<SkinData>(`/models/${id}/skin/anims/${anim}`, { method: "DELETE" });
  },
  decide(model: string, system: string, prompt: string) {
    return this.req<CallResult>("/decide", { method: "POST", body: JSON.stringify({ model, system, prompt }) });
  },
  result(r: { models: [string, string]; winner: number; [k: string]: unknown }) {
    return this.req<{ ok: boolean }>("/results", { method: "POST", body: JSON.stringify(r) });
  },
};
