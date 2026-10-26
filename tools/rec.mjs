// Records a promo film from the dev build: headless Chrome renders it frame by frame (`/?rec=<film>`), the
// frames are piped into ffmpeg at 60 fps, and the sound log is saved next to it for tools/mix.py.
//   node tools/rec.mjs <film> <out dir> [--dry | --shots=9,16.5,27]   (--shots: dry run that saves stills at those seconds)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [film, outDir = "promo/build", flag] = process.argv.slice(2);
const SHOTS = flag?.startsWith("--shots=") ? flag.slice(8).split(",").map((t) => Math.round(Number(t) * 60)) : null;
const DRY = flag === "--dry" || !!SHOTS;
const BASE = process.env.PK_BASE ?? "http://localhost:7776/";
const PORT = 9400 + Math.floor(Math.random() * 400);
mkdirSync(outDir, { recursive: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pkrec-"))}`,
  "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "about:blank",
], { stdio: "ignore" });
process.on("exit", () => chrome.kill()); // also when a step throws
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: BASE });
await sleep(1500);
await ev(`localStorage.setItem('pk-lang','zh'); localStorage.setItem('pk-audio', JSON.stringify({ muted: true })); return 1`);
const openFilm = async () => {
  await send("Page.navigate", { url: `${BASE}?rec=${film}` });
  for (let i = 0; i < 300; i++) {
    if (await ev(`return !!window.__rec?.ready`).catch(() => false)) return;
    await sleep(200);
  }
  throw new Error("recorder page never became ready");
};
await openFilm();
// Vite reloads the page when anything under web/ changes (other sessions edit there too). The films are
// deterministic, so reopen the page and replay the frames already filmed as a dry run, then carry on.
let reloads = 0;
const resume = async (n) => {
  for (;;) {
    if (++reloads > 6) throw new Error("recorder page keeps reloading");
    console.log(`${film}: page reloaded at frame ${n}, replaying`);
    try {
      await sleep(2000);
      await openFilm();
      for (let k = 0; k < n; k++) if ((await ev(`return await window.__rec.next(0)`)) !== "") throw new Error("replay");
      return;
    } catch {}
  }
};

const videoPath = join(outDir, `${film}_video.mp4`);
const ff = DRY ? null : spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", "60", "-i", "-",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "60", videoPath], { stdio: ["pipe", "inherit", "inherit"] });
const write = (buf) => new Promise((r) => (ff.stdin.write(buf) ? r() : ff.stdin.once("drain", r)));

const t0 = Date.now();
let n = 0;
for (;;) {
  const still = SHOTS?.includes(n);
  let data;
  try {
    data = await ev(`return await window.__rec.next(${DRY && !still ? 0 : 0.93})`);
    if (data === undefined) throw new Error("no frame");
  } catch {
    await resume(n);
    continue;
  }
  if (data === null) break;
  if (still) writeFileSync(join(outDir, `${film}_${(n / 60).toFixed(1)}s.jpg`), Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
  else if (!DRY) await write(Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
  n++;
  if (n % 600 === 0) console.log(`${film}: ${n} frames (${(n / 60).toFixed(0)}s) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const cues = await ev(`return window.__rec.cues()`);
const log = await ev(`return window.__rec.log()`);
writeFileSync(join(outDir, `${film}_cues.json`), JSON.stringify({ frames: n, fps: 60, cues }, null, 1));
console.log(log.join("\n"));
console.log(`${film}: ${n} frames = ${(n / 60).toFixed(1)}s, ${cues.length} sound cues, took ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (ff) {
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
}
chrome.kill();
process.exit(0);
