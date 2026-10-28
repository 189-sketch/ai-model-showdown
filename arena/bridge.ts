/**
 * Model Arena bridge: a small local server the game talks to when models fight.
 *
 * The browser runs the fight; whenever a fighter needs a decision it sends the
 * prompt here and this process calls the model — an OpenAI-compatible API, the
 * Anthropic API, or any command line (`claude -p`, `codex exec -`, `ollama run …`).
 * API keys and commands never leave this machine: profiles live in
 * arena/data/models.json and the browser only ever sees them masked.
 *
 * Every request must carry the token printed at startup, so other web pages
 * open in the same browser cannot reach the bridge or run its commands.
 *
 * Each model can also have a skin in arena/data/skins/<id>/: an avatar and
 * sprite-strip overrides for any of its fighter's animations.
 *
 * It also serves the built game (web/dist) on the same port, so a single
 * link (and a single forwarded port on a remote machine) is all it takes.
 *
 *   npm run arena                 (from the repo root; Node 22.18+): build the game, then start
 *   npm run arena:bridge          bridge only, for use with the Vite dev server
 *   ARENA_PORT=7790 ARENA_HOST=127.0.0.1
 */

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.ARENA_PORT ?? 7790);
const HOST = process.env.ARENA_HOST ?? "127.0.0.1";
const DATA = join(dirname(fileURLToPath(import.meta.url)), "data");
const MODELS_FILE = join(DATA, "models.json");
const RESULTS_FILE = join(DATA, "results.jsonl");
const TOKEN_FILE = join(DATA, "token");
const WORK_DIR = join(DATA, "work"); // default cwd for command-line models
const SKINS_DIR = join(DATA, "skins");
const MAX_IMAGE = 12_000_000; // bytes of base64 per uploaded image
const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
const API_PATHS = /^\/(health|models|decide|results)(\/|$)/;

type Kind = "openai" | "anthropic" | "cli";

interface ModelProfile {
  id: string;
  name: string;
  body: string; // fighter appearance: chatgpt | claude | deepseek | grok
  color?: string; // accent colour, #rrggbb
  kind: Kind;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  command?: string;
  cwd?: string;
  timeoutSec?: number;
  temperature?: number;
  maxTokens?: number;
}

/** One animation override: a horizontal strip of equal-width frames, facing right. */
interface AnimSkin {
  file: string;
  frames: number;
  fps?: number;
  height: number; // game units the frame height spans (the fighters are ~95 tall)
  anchorX: number; // 0..1 across a frame: where the feet are
}

interface Skin {
  avatar?: string;
  anims: Record<string, AnimSkin>;
}

interface MatchResult {
  at: number;
  models: [string, string];
  winner: number; // 0 / 1, 2 = draw
  [k: string]: unknown;
}

// ───────────────────────── storage ─────────────────────────

mkdirSync(WORK_DIR, { recursive: true });

function loadModels(): ModelProfile[] {
  if (!existsSync(MODELS_FILE)) return [];
  return JSON.parse(readFileSync(MODELS_FILE, "utf8")) as ModelProfile[];
}

function saveModels(list: ModelProfile[]) {
  writeFileSync(MODELS_FILE, JSON.stringify(list, null, 2));
  chmodSync(MODELS_FILE, 0o600);
}

function loadResults(): MatchResult[] {
  if (!existsSync(RESULTS_FILE)) return [];
  return readFileSync(RESULTS_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as MatchResult);
}

function token(): string {
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, "utf8").trim();
  const t = randomBytes(18).toString("base64url");
  writeFileSync(TOKEN_FILE, t);
  chmodSync(TOKEN_FILE, 0o600);
  return t;
}
const TOKEN = token();

const skinDir = (id: string) => join(SKINS_DIR, id);

function loadSkin(id: string): Skin {
  const f = join(skinDir(id), "skin.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Skin) : { anims: {} };
}

function saveSkin(id: string, skin: Skin) {
  mkdirSync(skinDir(id), { recursive: true });
  writeFileSync(join(skinDir(id), "skin.json"), JSON.stringify(skin, null, 2));
}

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };
const EXT_TYPES: Record<string, string> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg" };

/** Decodes a data: URL upload and writes it as <base>.<ext> in the model's skin folder, replacing older versions. */
function writeImage(id: string, base: string, dataUrl: unknown): string {
  const m = typeof dataUrl === "string" ? dataUrl.match(/^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m) throw new HttpError(400, "image must be a PNG, WebP or JPEG data URL");
  removeImage(id, base);
  const file = `${base}.${IMAGE_TYPES[m[1]]}`;
  mkdirSync(skinDir(id), { recursive: true });
  writeFileSync(join(skinDir(id), file), Buffer.from(m[2], "base64"));
  return file;
}

function removeImage(id: string, base: string) {
  for (const ext of Object.keys(EXT_TYPES)) {
    const f = join(skinDir(id), `${base}.${ext}`);
    if (existsSync(f)) unlinkSync(f);
  }
}

/** What the browser sees: no key, plus the win/loss record and which skin parts exist. */
function publicView(m: ModelProfile, results: MatchResult[]) {
  const { apiKey, ...rest } = m;
  const skin = loadSkin(m.id);
  const rec = { w: 0, l: 0, d: 0 };
  for (const r of results) {
    const side = r.models.indexOf(m.id);
    if (side < 0 || r.models[0] === r.models[1]) continue;
    if (r.winner === 2) rec.d++;
    else if (r.winner === side) rec.w++;
    else rec.l++;
  }
  return { ...rest, hasKey: !!apiKey, record: rec, avatar: !!skin.avatar, skinAnims: Object.keys(skin.anims) };
}

const KINDS: Kind[] = ["openai", "anthropic", "cli"];
const BODIES = ["chatgpt", "claude", "deepseek", "grok"];

function clean(input: Partial<ModelProfile>, prev?: ModelProfile): ModelProfile {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const kind = KINDS.includes(input.kind as Kind) ? (input.kind as Kind) : "openai";
  const m: ModelProfile = {
    id: prev?.id ?? randomUUID().slice(0, 8),
    name: str(input.name).slice(0, 24) || "Model",
    body: BODIES.includes(str(input.body)) ? str(input.body) : "chatgpt",
    color: /^#[0-9a-f]{6}$/i.test(str(input.color)) ? str(input.color).toLowerCase() : undefined,
    kind,
    timeoutSec: num(input.timeoutSec),
    temperature: num(input.temperature),
    maxTokens: num(input.maxTokens),
  };
  if (kind === "cli") {
    m.command = str(input.command);
    m.cwd = str(input.cwd) || undefined;
    if (!m.command) throw new Error("command is required");
  } else {
    m.baseUrl = str(input.baseUrl).replace(/\/+$/, "") || undefined;
    m.model = str(input.model);
    // an empty key on edit keeps the stored one
    m.apiKey = str(input.apiKey) || (prev?.kind === kind ? prev.apiKey : undefined);
    if (!m.model) throw new Error("model is required");
    if (kind === "openai" && !m.baseUrl) throw new Error("baseUrl is required");
  }
  return m;
}

// ───────────────────────── calling models ─────────────────────────

// Reasoning models (DeepSeek reasoner, MiniMax M2, …) can think for minutes on one decision. The game is
// paused meanwhile, so be patient: a call may take up to `timeoutSec` in total, and an API stream may
// go quiet for at most IDLE_SEC once it has started (a model still streaming reasoning tokens counts as alive).
const DEFAULT_TIMEOUT_SEC = 300;
const IDLE_SEC = Number(process.env.ARENA_IDLE_SEC ?? 90);

async function callModel(m: ModelProfile, system: string, prompt: string): Promise<string> {
  const timeout = (m.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  if (m.kind === "cli") return runCommand(m, `${system}\n\n${prompt}`, timeout);
  if (m.kind === "anthropic") {
    return streamText(m, `${m.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, timeout, {
      headers: { "content-type": "application/json", "x-api-key": m.apiKey ?? "", "anthropic-version": "2023-06-01" },
      body: {
        model: m.model,
        max_tokens: m.maxTokens ?? 1024,
        system,
        messages: [{ role: "user", content: prompt }],
        stream: true,
        ...(m.temperature !== undefined && { temperature: m.temperature }),
      },
    });
  }
  return streamText(m, `${m.baseUrl}/chat/completions`, timeout, {
    headers: { "content-type": "application/json", ...(m.apiKey && { authorization: `Bearer ${m.apiKey}` }) },
    body: {
      model: m.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      stream: true,
      ...(m.maxTokens !== undefined && { max_tokens: m.maxTokens }),
      ...(m.temperature !== undefined && { temperature: m.temperature }),
    },
  });
}

type ApiReply = {
  choices?: { message?: { content?: string }; delta?: { content?: string } }[];
  content?: { type: string; text?: string }[];
  type?: string;
  delta?: { type?: string; text?: string };
  error?: { message?: string } | string;
};

const errorText = (j: ApiReply) => (typeof j.error === "string" ? j.error : j.error?.message);

/** The reply text of a non-streamed answer (some servers ignore `stream: true`). */
function wholeText(m: ModelProfile, j: ApiReply) {
  if (m.kind === "anthropic") return (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return j.choices?.[0]?.message?.content ?? "";
}

/** One server-sent event's share of the reply text (OpenAI chunks or Anthropic content deltas). */
function deltaText(m: ModelProfile, j: ApiReply) {
  if (errorText(j)) throw new Error(`the API reported an error: ${errorText(j)}`);
  if (m.kind === "anthropic") return j.type === "content_block_delta" && j.delta?.type === "text_delta" ? j.delta.text ?? "" : "";
  return j.choices?.[0]?.delta?.content ?? "";
}

/** Readable reasons for network failures, with the usual fix. */
function networkError(e: unknown, url: string): Error {
  const err = e as { message?: string; cause?: { code?: string; message?: string; errors?: { code?: string }[] } };
  const code = err.cause?.code ?? err.cause?.errors?.[0]?.code ?? "";
  const host = new URL(url).host;
  const proxyHint = " If you need a proxy to reach it, start the bridge with HTTPS_PROXY=<proxy url> NODE_USE_ENV_PROXY=1.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new Error(`cannot find ${host} (DNS: ${code}). Check the Base URL.${proxyHint}`);
  if (/TIMEOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(code)) return new Error(`cannot connect to ${host} (${code}).${proxyHint}`);
  if (/CERT|SSL|TLS/.test(code)) return new Error(`TLS problem talking to ${host} (${code})`);
  return new Error(`request to ${host} failed: ${err.cause?.message ?? err.message ?? String(e)}`);
}

async function streamText(m: ModelProfile, url: string, timeout: number, init: { headers: Record<string, string>; body: object }): Promise<string> {
  const ctrl = new AbortController();
  let why = "";
  const stop = (reason: string) => {
    why = reason;
    ctrl.abort();
  };
  const total = setTimeout(() => stop(`no complete reply within ${timeout / 1000} s. Reasoning models can need longer: raise the timeout in this model's settings`), timeout);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const alive = () => {
    clearTimeout(idle);
    idle = setTimeout(() => stop(`the API stream went silent for ${IDLE_SEC} s`), IDLE_SEC * 1000);
  };
  try {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", signal: ctrl.signal, headers: init.headers, body: JSON.stringify(init.body) });
    } catch (e) {
      throw ctrl.signal.aborted ? new Error(why) : networkError(e, url);
    }
    if (!res.ok) {
      const raw = await res.text();
      let msg = raw.slice(0, 300);
      try {
        msg = errorText(JSON.parse(raw) as ApiReply) ?? msg;
      } catch {
        /* not JSON */
      }
      throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${msg}`);
    }
    if (!(res.headers.get("content-type") ?? "").includes("event-stream")) {
      const j = JSON.parse(await res.text()) as ApiReply;
      if (errorText(j)) throw new Error(`the API reported an error: ${errorText(j)}`);
      return wholeText(m, j);
    }
    alive();
    let out = "";
    let buf = "";
    const dec = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      alive();
      buf += dec.decode(chunk, { stream: true });
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let j: ApiReply;
        try {
          j = JSON.parse(data) as ApiReply;
        } catch {
          continue; // keep-alive comments and the like
        }
        out += deltaText(m, j);
      }
    }
    return out;
  } catch (e) {
    if (ctrl.signal.aborted && why) throw new Error(why);
    throw e;
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
  }
}

/** Split a command line into argv, honouring '…', "…" and backslash escapes. No shell is involved. */
export function splitArgs(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < cmd.length) {
      cur += cmd[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (quote) throw new Error("unterminated quote in command");
  if (has || cur) out.push(cur);
  return out;
}

/**
 * Runs a command-line model. The prompt goes to stdin, unless an argument
 * contains {prompt}, in which case it is substituted there instead.
 * The reply is whatever the command prints on stdout.
 */
function runCommand(m: ModelProfile, prompt: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const argv = splitArgs(m.command ?? "");
    if (!argv.length) return reject(new Error("empty command"));
    const inArgs = argv.some((a) => a.includes("{prompt}"));
    const args = argv.slice(1).map((a) => a.split("{prompt}").join(prompt));
    const win = process.platform === "win32";
    const child = spawn(argv[0], args, {
      cwd: m.cwd || WORK_DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: !win, // own process group, so a timeout kills the whole tree
      shell: win, // .cmd shims on Windows; use stdin there rather than {prompt}
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => {
      try {
        if (win) child.kill("SIGKILL");
        else process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* already gone */
      }
      reject(new Error(`no reply within ${timeout / 1000} s. Raise the timeout in this model's settings if it needs longer`));
    }, timeout);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`cannot run "${argv[0]}": ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`exit code ${code}: ${err.trim().split("\n").slice(-4).join(" ") || out.slice(-300)}`));
    });
    child.stdin.on("error", () => {}); // the command may exit without reading stdin
    child.stdin.end(inArgs ? "" : prompt);
  });
}

// ───────────────────────── http ─────────────────────────

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

async function body<T>(req: IncomingMessage, limit = 2_000_000): Promise<T> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new HttpError(413, "body too large");
  }
  try {
    return (raw ? JSON.parse(raw) : {}) as T;
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

/** One line per model call on the bridge's console, so slow or failing models are easy to spot. */
function log(m: ModelProfile, what: string, ms: number, outcome: string) {
  const time = new Date().toTimeString().slice(0, 8);
  console.log(`  ${time}  ${m.name} · ${what} · ${(ms / 1000).toFixed(1)} s · ${outcome}`);
}

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// ───────────────────────── the game itself ─────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain",
};

/** Serves web/dist: real files as-is (with byte ranges for media), anything else falls back to the SPA's index.html. */
function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  const index = join(WEB_DIST, "index.html");
  if (!existsSync(index)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    return void res.end("The game isn't built yet. Start the arena with `npm run arena` (it builds web/dist first).\n");
  }
  let file = resolve(WEB_DIST, "." + decodeURIComponent(path));
  if (file !== WEB_DIST && !file.startsWith(WEB_DIST + sep)) throw new HttpError(403, "forbidden");
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(path)) throw new HttpError(404, "not found"); // a missing asset, not an app route
    file = index;
  }
  if (file === index) {
    // tells the page its bridge is this same origin (the token still has to come from the printed link)
    const html = readFileSync(index, "utf8").replace("</head>", "<script>window.__ARENA_BRIDGE__=true</script></head>");
    res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
    return void res.end(req.method === "HEAD" ? undefined : html);
  }
  const size = statSync(file).size;
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return void res.end();
    }
    res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return void (req.method === "HEAD" ? res.end() : createReadStream(file, { start, end }).pipe(res));
  }
  res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).pipe(res);
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://bridge");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (path === "/health") return send(res, 200, { ok: true, app: "ai-model-arena" });

  const models = loadModels();
  const find = (id: string) => {
    const m = models.find((x) => x.id === id);
    if (!m) throw new HttpError(404, "model not found");
    return m;
  };

  if (path === "/models" && method === "GET") {
    const results = loadResults();
    return send(res, 200, models.map((m) => publicView(m, results)));
  }
  if (path === "/models" && method === "POST") {
    const m = clean(await body<Partial<ModelProfile>>(req));
    saveModels([...models, m]);
    return send(res, 200, publicView(m, []));
  }

  const one = path.match(/^\/models\/([\w-]+)(\/test)?$/);
  if (one && !one[2] && method === "PUT") {
    const prev = find(one[1]);
    const m = clean(await body<Partial<ModelProfile>>(req), prev);
    saveModels(models.map((x) => (x.id === m.id ? m : x)));
    return send(res, 200, publicView(m, loadResults()));
  }
  if (one && !one[2] && method === "DELETE") {
    find(one[1]);
    saveModels(models.filter((x) => x.id !== one[1]));
    rmSync(skinDir(one[1]), { recursive: true, force: true });
    return send(res, 200, { ok: true });
  }

  // ── skins: avatar + animation overrides ──
  const sk = path.match(/^\/models\/([\w-]+)\/(skin|avatar|skin\/file\/([\w-]+\.(?:png|webp|jpg))|skin\/anims\/(\w{1,32}))$/);
  if (sk) {
    const id = find(sk[1]).id;
    const skin = loadSkin(id);
    if (sk[2] === "skin" && method === "GET") return send(res, 200, skin);
    if (sk[3] && method === "GET") {
      const f = join(skinDir(id), sk[3]);
      if (!existsSync(f)) throw new HttpError(404, "no such file");
      res.writeHead(200, { "content-type": EXT_TYPES[sk[3].split(".").pop()!], "cache-control": "no-store" });
      return void res.end(readFileSync(f));
    }
    if (sk[2] === "avatar" && method === "PUT") {
      const b = await body<{ data?: string }>(req, MAX_IMAGE);
      skin.avatar = writeImage(id, "avatar", b.data);
      saveSkin(id, skin);
      return send(res, 200, skin);
    }
    if (sk[2] === "avatar" && method === "DELETE") {
      removeImage(id, "avatar");
      delete skin.avatar;
      saveSkin(id, skin);
      return send(res, 200, skin);
    }
    const anim = sk[4];
    if (anim && method === "PUT") {
      const b = await body<Partial<Omit<AnimSkin, "fps">> & { fps?: number | null; data?: string }>(req, MAX_IMAGE);
      const prev = skin.anims[anim];
      const file = b.data !== undefined ? writeImage(id, `anim_${anim}`, b.data) : prev?.file;
      if (!file) throw new HttpError(400, "image is required");
      const n = (v: unknown, lo: number, hi: number, def: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
      skin.anims[anim] = {
        file,
        frames: Math.round(n(b.frames, 1, 64, prev?.frames ?? 1)),
        fps: b.fps === null ? undefined : b.fps === undefined ? prev?.fps : n(b.fps, 1, 60, 10), // null = renderer default
        height: n(b.height, 20, 400, prev?.height ?? 100),
        anchorX: n(b.anchorX, 0, 1, prev?.anchorX ?? 0.5),
      };
      saveSkin(id, skin);
      return send(res, 200, skin);
    }
    if (anim && method === "DELETE") {
      removeImage(id, `anim_${anim}`);
      delete skin.anims[anim];
      saveSkin(id, skin);
      return send(res, 200, skin);
    }
  }
  if (one && one[2] && method === "POST") {
    // the page sends a real first-decision prompt, so the test also shows how long a decision takes
    const b = await body<{ system?: string; prompt?: string }>(req);
    const m = find(one[1]);
    const t0 = Date.now();
    try {
      const text = await callModel(m, b.system ?? "You are a connection test.", b.prompt ?? 'Reply with exactly: {"ok":true}');
      log(m, "test", Date.now() - t0, `${text.length} chars`);
      return send(res, 200, { ok: true, ms: Date.now() - t0, text: text.slice(-2000) });
    } catch (e) {
      log(m, "test", Date.now() - t0, `FAILED: ${(e as Error).message}`);
      return send(res, 200, { ok: false, ms: Date.now() - t0, error: (e as Error).message });
    }
  }

  if (path === "/decide" && method === "POST") {
    const b = await body<{ model: string; system: string; prompt: string }>(req);
    const m = find(b.model);
    const t0 = Date.now();
    try {
      const text = await callModel(m, String(b.system ?? ""), String(b.prompt ?? ""));
      log(m, "decide", Date.now() - t0, `${text.length} chars`);
      return send(res, 200, { ok: true, ms: Date.now() - t0, text });
    } catch (e) {
      log(m, "decide", Date.now() - t0, `FAILED: ${(e as Error).message}`);
      return send(res, 200, { ok: false, ms: Date.now() - t0, error: (e as Error).message });
    }
  }

  if (path === "/results" && method === "POST") {
    const r = await body<MatchResult>(req);
    if (!Array.isArray(r.models) || r.models.length !== 2) throw new HttpError(400, "models must be a pair");
    appendFileSync(RESULTS_FILE, JSON.stringify({ ...r, at: Date.now() }) + "\n");
    return send(res, 200, { ok: true });
  }
  if (path === "/results" && method === "GET") return send(res, 200, loadResults().slice(-200));

  throw new HttpError(404, "not found");
}

const server = createServer(async (req, res) => {
  // any origin may ask; only holders of the token get an answer
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  res.setHeader("access-control-allow-headers", "content-type, x-arena-token");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("access-control-allow-private-network", "true");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  try {
    // DNS rebinding guard: only answer to localhost names
    if (!LOCAL_HOSTS.test(req.headers.host ?? "")) throw new HttpError(403, "bad host");
    const path = new URL(req.url ?? "/", "http://bridge").pathname;
    if (!API_PATHS.test(path) && (req.method === "GET" || req.method === "HEAD")) return serveStatic(req, res, path);
    if (path !== "/health" && req.headers["x-arena-token"] !== TOKEN) throw new HttpError(401, "bad token");
    await route(req, res);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 400;
    send(res, status, { ok: false, error: (e as Error).message });
  }
});

server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `\n  Port ${PORT} is busy (another bridge running?). Stop it, or use ARENA_PORT=<port>.\n` : e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const host = HOST === "0.0.0.0" || HOST === "127.0.0.1" ? "localhost" : HOST;
  const built = existsSync(join(WEB_DIST, "index.html"));
  console.log("\n  AI Model Arena is running.\n");
  // ARENA_WEB set (npm run dev): the page comes from that dev server, which proxies this bridge
  if (process.env.ARENA_WEB) {
    console.log(`  Open  →  ${process.env.ARENA_WEB}/?bridge=${TOKEN}\n`);
    console.log(`  token: ${TOKEN}   ·   profiles: ${MODELS_FILE}\n`);
    return;
  }
  if (built) console.log(`  Open  →  http://${host}:${PORT}/?bridge=${TOKEN}\n`);
  else console.log("  The game isn't built (web/dist is missing): use `npm run arena`, or the Vite dev server link below.\n");
  const dev = process.env.ARENA_WEB ?? "http://localhost:5173";
  console.log(`  With the Vite dev server (cd web && npm run dev): ${dev}/?bridge=${TOKEN}`);
  console.log("  On a remote machine, forward this port to your computer first (e.g. ssh -L " + PORT + ":localhost:" + PORT + " <host>).");
  console.log(`  token: ${TOKEN}   ·   profiles: ${MODELS_FILE}\n`);
});
