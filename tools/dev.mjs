// One command for local development: the API (server/local, :8787), the web dev server (Vite, :5173) and the
// Model Arena bridge (:7790), with labelled output, one summary of links, and Ctrl+C stopping all three.
// Missing dependencies are installed first. Works on macOS, Linux and Windows; needs Node 22.18+.
//   npm run dev                      (from the repo root)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const WEB_PORT = 5173;
const API_PORT = 8787;
const ARENA_PORT = 7790;

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`\n  Node ${process.versions.node} is too old: the local API and the arena bridge need Node 22.18 or newer.\n`);
  process.exit(1);
}

const color = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);

// ───────────────────────── dependencies ─────────────────────────

for (const dir of ["server", "web"]) {
  if (existsSync(join(ROOT, dir, "node_modules"))) continue;
  console.log(color(33, `\n  Installing ${dir}/ dependencies (first run)…\n`));
  const r = spawnSync("npm install --no-audit --no-fund", { cwd: join(ROOT, dir), stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`\n  npm install failed in ${dir}/.\n`);
    process.exit(r.status ?? 1);
  }
}

/** A package's CLI script, run with this same Node (no npm or shell wrappers to leave behind). */
function bin(dir, pkg, name = pkg) {
  const req = createRequire(join(ROOT, dir, "package.json"));
  const pkgJson = req.resolve(`${pkg}/package.json`);
  const b = JSON.parse(readFileSync(pkgJson, "utf8")).bin;
  return join(dirname(pkgJson), typeof b === "string" ? b : b[name]);
}

// ───────────────────────── processes ─────────────────────────

// colours only when they reach a terminal (FORCE_COLOR=0 still turns them on in some libraries)
const { FORCE_COLOR: _force, NO_COLOR: _none, ...baseEnv } = process.env;
const colorEnv = process.stdout.isTTY ? { FORCE_COLOR: "1" } : { NO_COLOR: "1" };

const procs = [
  { name: "api", tint: 36, cwd: "server", args: [bin("server", "tsx"), "local/server.ts"], env: { LOCAL_PORT: String(API_PORT) } },
  { name: "web", tint: 35, cwd: "web", args: [bin("web", "vite"), "--port", String(WEB_PORT), "--strictPort", "--clearScreen", "false"], env: {} },
  { name: "arena", tint: 33, cwd: ".", args: ["arena/bridge.ts"], env: { ARENA_PORT: String(ARENA_PORT), ARENA_WEB: `http://localhost:${WEB_PORT}` } },
];

let stopping = false;
const width = Math.max(...procs.map((p) => p.name.length));

for (const p of procs) {
  p.child = spawn(process.execPath, p.args, {
    cwd: join(ROOT, p.cwd),
    env: { ...baseEnv, ...colorEnv, ...p.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const label = color(p.tint, `[${p.name.padEnd(width)}]`);
  for (const stream of [p.child.stdout, p.child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => console.log(`${label} ${line}`));
  }
  p.child.on("exit", (code, signal) => {
    p.exited = true;
    if (stopping) return;
    console.error(color(31, `\n  ${p.name} stopped (${signal ?? `exit code ${code}`}), so everything is shutting down. See its output above.\n`));
    stopAll(code || 1);
  });
}

function kill(p) {
  if (!p.child || p.exited) return;
  try {
    // Windows: take the whole tree down; elsewhere the children share our process group, so a
    // Ctrl+C or a closed terminal reaches them too, and SIGTERM covers the rest
    if (WIN) spawnSync("taskkill", ["/pid", String(p.child.pid), "/T", "/F"], { stdio: "ignore" });
    else p.child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  procs.forEach(kill);
  setTimeout(() => process.exit(code), 300);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stopAll(0));
process.on("exit", () => procs.forEach(kill));

// ───────────────────────── ready ─────────────────────────

async function up(url) {
  for (let i = 0; i < 120 && !stopping; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status < 500) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const ok = await Promise.all([
  up(`http://127.0.0.1:${API_PORT}/api/public/lobby`),
  up(`http://localhost:${WEB_PORT}/`),
  up(`http://127.0.0.1:${ARENA_PORT}/health`),
]);
if (!stopping) {
  if (ok.every(Boolean)) {
    const tokenFile = join(ROOT, "arena", "data", "token");
    const token = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "";
    const line = color(90, "  " + "─".repeat(66));
    console.log(`\n${line}`);
    console.log(color(32, "   Everything is running.") + color(90, "   Ctrl+C stops all three."));
    console.log(`\n   Game          ${color(1, `http://localhost:${WEB_PORT}`)}`);
    console.log(`   Model Arena   ${color(1, `http://localhost:${WEB_PORT}/?bridge=${token}`)}`);
    console.log(color(90, `   API :${API_PORT} and arena bridge :${ARENA_PORT} are proxied through the web server.`));
    console.log(color(90, `   On a remote machine, forward one port: ssh -L ${WEB_PORT}:localhost:${WEB_PORT} <host>`));
    console.log(`${line}\n`);
  } else {
    const names = procs.filter((_, i) => !ok[i]).map((p) => p.name).join(", ");
    console.error(color(31, `\n  ${names} did not come up within a minute. Check the output above.\n`));
  }
}
