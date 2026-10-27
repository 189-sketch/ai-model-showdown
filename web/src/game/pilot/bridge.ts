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
}

/** What the editor sends; apiKey is only ever written, never read back. */
export type ModelInput = Omit<ArenaModel, "id" | "hasKey" | "record"> & { apiKey?: string };

export interface CallResult {
  ok: boolean;
  ms: number;
  text?: string;
  error?: string;
}

const URL_KEY = "pk-arena-url";
const TOKEN_KEY = "pk-arena-token";
export const DEFAULT_BRIDGE = "http://127.0.0.1:7790";

function read(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

/** `?bridge=<token>` (printed by the bridge at startup) is saved and stripped from the address bar. */
function takeTokenFromUrl() {
  if (typeof location === "undefined") return;
  const q = new URLSearchParams(location.search);
  const t = q.get("bridge");
  if (!t) return;
  write(TOKEN_KEY, t);
  q.delete("bridge");
  const rest = q.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
}
takeTokenFromUrl();

export const bridge = {
  get url() {
    return read(URL_KEY) || DEFAULT_BRIDGE;
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
  decide(model: string, system: string, prompt: string) {
    return this.req<CallResult>("/decide", { method: "POST", body: JSON.stringify({ model, system, prompt }) });
  },
  result(r: { models: [string, string]; winner: number; [k: string]: unknown }) {
    return this.req<{ ok: boolean }>("/results", { method: "POST", body: JSON.stringify(r) });
  },
};
