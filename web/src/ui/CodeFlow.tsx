import { useEffect, useRef } from "react";

/**
 * Main-menu background: rows of syntax-coloured code streaming sideways at three depths, tilted like the rest of the
 * slanted UI. Now and then an "execution" cursor runs along a row in one of the fighters' colours and lights it up.
 * Each depth keeps a few pre-rendered strips that the rows share, so a frame is just a couple of image draws per row.
 * `light` draws dark code for a grey-white page; `dark` draws light code for the ink background.
 */

type Theme = "dark" | "light";
const PALETTE = {
  // [keyword, string, number, cursor accents...], identifier, punctuation, comment
  dark: { accents: ["#8f7dff", "#ff8a3d", "#3f86ff", "#ff5b3a"], ident: "#e9e6f2", punct: "#a7a1b9", comment: "#8d87a3", alphas: [0.17, 0.28, 0.4] },
  light: { accents: ["#6a55f0", "#e0661c", "#2b6fe6", "#e0442b"], ident: "#2b2735", punct: "#6e6880", comment: "#8f89a0", alphas: [0.16, 0.26, 0.38] },
};
const ANGLE = (-8 * Math.PI) / 180;
const PITCH = 22; // px between rows
const LAYERS = [
  { size: 11, speed: 14, weight: 0.5 },
  { size: 13, speed: 28, weight: 0.35 },
  { size: 15, speed: 46, weight: 0.15 },
];
const STRIPS_PER_LAYER = 8;
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const SNIPPETS = [
  'const fighters = ["chatgpt", "claude", "deepseek", "grok"];',
  "for (const round of match.rounds) { await round.fight(); }",
  "const reply = await model.generate({ prompt, temperature: 0.7 });",
  "if (opponent.hp <= 0) return announce(\"K.O.\");",
  "attn = softmax(q @ k.T / sqrt(d_k)) @ v",
  "loss.backward(); optimizer.step(); optimizer.zero_grad();",
  'ban(player, { reason: "policy" }); // 封号警告',
  'rocket.launch({ target: "mars", retries: 3 });',
  "tokens.push(sample(logits, { top_p: 0.95 }));",
  "while (true) { think(); answer(); }",
  "const gpus = cluster.allocate(8 * 1024);",
  "def winner(a, b): return max(a, b, key=lambda m: m.elo)",
  'stamp(answer, "APPROVED"); // 稳稳接住你',
  'deepseek.transform("liangsheng"); // 梁圣降临',
  "reward = rlhf(feedback, beta=0.1)",
  "context_window = 1_000_000",
  "combo = [LP, LP, HP, special(QCF, HK)];",
  'acquire(company, { price: 44_000_000_000 }); // 已被收购',
  "if (server.busy) retryLater(); // 服务器繁忙",
  "ultra = effort.max(); // Effort 拉满",
  "for epoch in range(3): train(model, data)",
  "const ko = fighters.filter((f) => f.hp > 0).length === 1;",
  "embedding = encoder(tokens).mean(dim=1)",
  "return compare(benchmarks, { leaderboard: true });",
];

const KEYWORDS = new Set([
  "const", "let", "for", "of", "await", "async", "if", "else", "return", "def", "while", "true", "false", "lambda",
  "in", "new", "function", "import", "from",
]);
const TOKEN = /\/\/.*$|"[^"]*"|\b\d[\d_.]*\b|[A-Za-z_]\w*(?=\()|[A-Za-z_]\w*|\s+|./g;

function colourOf(tok: string, p: (typeof PALETTE)[Theme]): string {
  if (tok.startsWith("//")) return p.comment;
  if (tok.startsWith('"')) return p.accents[1];
  if (/^\d/.test(tok)) return p.accents[3];
  if (KEYWORDS.has(tok)) return p.accents[0];
  if (/^[A-Za-z_]/.test(tok)) return p.ident;
  return p.punct;
}

type Strip = { canvas: HTMLCanvasElement; w: number };
type Row = { y: number; layer: number; strip: number; x: number; speed: number };
type Run = { row: number; head: number; speed: number; colour: string };

/** One long line of random snippets, rendered once with syntax colours at full opacity. */
function makeStrip(size: number, minWidth: number, dpr: number, p: (typeof PALETTE)[Theme]): Strip {
  const font = `${size}px ${FONT}`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const parts: string[] = [];
  let w = 0;
  while (w < minWidth) {
    parts.push(SNIPPETS[Math.floor(Math.random() * SNIPPETS.length)]);
    w = measure.measureText(parts.join("      ")).width;
  }
  const text = parts.join("      ");
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(PITCH * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textBaseline = "middle";
  let x = 0;
  for (const tok of text.match(TOKEN) ?? []) {
    ctx.fillStyle = colourOf(tok, p);
    ctx.fillText(tok, x, PITCH / 2);
    x += ctx.measureText(tok).width;
  }
  return { canvas, w };
}

function pickLayer(): number {
  const r = Math.random();
  return r < LAYERS[0].weight ? 0 : r < LAYERS[0].weight + LAYERS[1].weight ? 1 : 2;
}

export function CodeFlow({ theme = "dark", className = "" }: { theme?: Theme; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const p = PALETTE[theme];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, diag = 0;
    let strips: Strip[][] = [];
    let rows: Row[] = [];
    let runs: Run[] = [];
    let nextRun = 0.6;
    let raf = 0;
    let last = performance.now();

    const build = () => {
      const box = canvas.getBoundingClientRect();
      w = Math.max(1, box.width);
      h = Math.max(1, box.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      diag = Math.ceil(Math.hypot(w, h));
      strips = LAYERS.map((l) => Array.from({ length: STRIPS_PER_LAYER }, () => makeStrip(l.size, diag + 240, dpr, p)));
      rows = [];
      for (let y = -diag / 2; y < diag / 2; y += PITCH) {
        const layer = pickLayer();
        const strip = Math.floor(Math.random() * STRIPS_PER_LAYER);
        rows.push({ y, layer, strip, x: -Math.random() * strips[layer][strip].w, speed: LAYERS[layer].speed * (0.8 + Math.random() * 0.4) });
      }
      runs = [];
    };

    const drawRow = (r: Row, alpha: number) => {
      const s = strips[r.layer][r.strip];
      ctx.globalAlpha = alpha;
      ctx.drawImage(s.canvas, -diag / 2 + r.x, r.y, s.w, PITCH);
      ctx.drawImage(s.canvas, -diag / 2 + r.x + s.w, r.y, s.w, PITCH);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2, h / 2);
      ctx.rotate(ANGLE);

      for (const r of rows) {
        const sw = strips[r.layer][r.strip].w;
        r.x -= r.speed * dt;
        if (r.x <= -sw) r.x += sw;
        drawRow(r, p.alphas[r.layer]);
      }

      // execution cursors: light up the code they pass over, trailing a glow in a fighter's colour
      nextRun -= dt;
      if (nextRun <= 0 && rows.length) {
        nextRun = 0.7 + Math.random() * 1.1;
        const candidates = rows.map((r, i) => (r.layer > 0 ? i : -1)).filter((i) => i >= 0);
        const row = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
        runs.push({ row, head: -diag / 2, speed: 380 + Math.random() * 280, colour: p.accents[Math.floor(Math.random() * p.accents.length)] });
      }
      const trail = 260;
      runs = runs.filter((run) => run.head - trail < diag / 2);
      for (const run of runs) {
        run.head += run.speed * dt;
        const r = rows[run.row];
        ctx.save();
        ctx.beginPath();
        ctx.rect(run.head - trail, r.y, trail, PITCH);
        ctx.clip();
        drawRow(r, 0.95);
        const g = ctx.createLinearGradient(run.head - trail, 0, run.head, 0);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, run.colour);
        // on the dark page the glow adds light; on the light page it tints like a highlighter
        ctx.globalCompositeOperation = theme === "dark" ? "lighter" : "source-over";
        ctx.globalAlpha = theme === "dark" ? 0.28 : 0.2;
        ctx.fillStyle = g;
        ctx.fillRect(run.head - trail, r.y + 2, trail, PITCH - 4);
        ctx.restore();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = run.colour;
        ctx.fillRect(run.head, r.y + 4, LAYERS[r.layer].size * 0.6, PITCH - 8);
      }
      ctx.globalAlpha = 1;
      if (!still) raf = requestAnimationFrame(frame);
    };

    build();
    raf = requestAnimationFrame(frame);
    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        build();
        if (still) requestAnimationFrame(frame);
      }, 150);
    });
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [theme]);

  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}
