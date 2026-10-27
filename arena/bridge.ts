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
 *   npm run arena                 (from the repo root; Node 22.18+)
 *   ARENA_PORT=7790 ARENA_HOST=127.0.0.1
 */

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.ARENA_PORT ?? 7790);
const HOST = process.env.ARENA_HOST ?? "127.0.0.1";
const DATA = join(dirname(fileURLToPath(import.meta.url)), "data");
const MODELS_FILE = join(DATA, "models.json");
const RESULTS_FILE = join(DATA, "results.jsonl");
const TOKEN_FILE = join(DATA, "token");
const WORK_DIR = join(DATA, "work"); // default cwd for command-line models

type Kind = "openai" | "anthropic" | "cli";

interface ModelProfile {
  id: string;
  name: string;
  body: string; // fighter appearance: chatgpt | claude | deepseek | grok
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

/** What the browser sees: no key, plus the win/loss record. */
function publicView(m: ModelProfile, results: MatchResult[]) {
  const { apiKey, ...rest } = m;
  const rec = { w: 0, l: 0, d: 0 };
  for (const r of results) {
    const side = r.models.indexOf(m.id);
    if (side < 0 || r.models[0] === r.models[1]) continue;
    if (r.winner === 2) rec.d++;
    else if (r.winner === side) rec.w++;
    else rec.l++;
  }
  return { ...rest, hasKey: !!apiKey, record: rec };
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

async function callModel(m: ModelProfile, system: string, prompt: string): Promise<string> {
  const timeout = (m.timeoutSec ?? (m.kind === "cli" ? 120 : 60)) * 1000;
  if (m.kind === "cli") return runCommand(m, `${system}\n\n${prompt}`, timeout);
  const signal = AbortSignal.timeout(timeout);
  if (m.kind === "anthropic") {
    const res = await fetch(`${m.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-api-key": m.apiKey ?? "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: m.model,
        max_tokens: m.maxTokens ?? 1024,
        system,
        messages: [{ role: "user", content: prompt }],
        ...(m.temperature !== undefined && { temperature: m.temperature }),
      }),
    });
    const j = (await res.json()) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${j.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
    return (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  const res = await fetch(`${m.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", ...(m.apiKey && { authorization: `Bearer ${m.apiKey}` }) },
    body: JSON.stringify({
      model: m.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      ...(m.maxTokens !== undefined && { max_tokens: m.maxTokens }),
      ...(m.temperature !== undefined && { temperature: m.temperature }),
    }),
  });
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${j.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
  return j.choices?.[0]?.message?.content ?? "";
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
      reject(new Error(`timed out after ${timeout / 1000}s`));
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

async function body<T>(req: IncomingMessage): Promise<T> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new HttpError(413, "body too large");
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

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

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
    return send(res, 200, { ok: true });
  }
  if (one && one[2] && method === "POST") {
    const m = find(one[1]);
    const t0 = Date.now();
    try {
      const text = await callModel(m, "You are a connection test.", 'Reply with exactly: {"ok":true}');
      return send(res, 200, { ok: true, ms: Date.now() - t0, text: text.slice(0, 400) });
    } catch (e) {
      return send(res, 200, { ok: false, ms: Date.now() - t0, error: (e as Error).message });
    }
  }

  if (path === "/decide" && method === "POST") {
    const b = await body<{ model: string; system: string; prompt: string }>(req);
    const m = find(b.model);
    const t0 = Date.now();
    try {
      const text = await callModel(m, String(b.system ?? ""), String(b.prompt ?? ""));
      return send(res, 200, { ok: true, ms: Date.now() - t0, text });
    } catch (e) {
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
    if (req.url !== "/health" && req.headers["x-arena-token"] !== TOKEN) throw new HttpError(401, "bad token");
    await route(req, res);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 400;
    send(res, status, { ok: false, error: (e as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  const web = process.env.ARENA_WEB ?? "http://localhost:5173";
  console.log(`\n  AI Model Arena bridge  →  http://${HOST}:${PORT}`);
  console.log(`  token                  →  ${TOKEN}`);
  console.log(`  open the game with     →  ${web}/?bridge=${TOKEN}\n`);
  console.log(`  profiles: ${MODELS_FILE}`);
});
