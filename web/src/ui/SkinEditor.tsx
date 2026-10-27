/**
 * Sprite & animation editor for one arena model: upload a frame strip (or a
 * set of frame images) for any animation of its base fighter, tune frame
 * count / speed / size / foot position with a live preview, or fall back to
 * the original art. Skins change looks only: hitboxes and timing stay the base fighter's.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { art, type SpriteFrame } from "@/game/assets";
import { CHARS, charIndex, type CharDef } from "@/game/chars";
import { bridge, type AnimSkin, type ArenaModel, type SkinData } from "@/game/pilot/bridge";
import { SKIN_HEIGHT, skinImage, stripFrames } from "@/game/pilot/skin";
import { tx } from "@/lib/i18n";
import { filesToStrip } from "@/lib/images";
import { ArcadeButton } from "./common";

const MOVEMENT = ["idle", "walkF", "walkB", "run", "crouch", "jump", "block", "crouchBlock", "dodgeF", "dodgeB"];
const NORMALS = ["stLP", "stHP", "stLK", "stHK", "crLP", "crHP", "crLK", "crHK", "jLP", "jHP", "jLK", "jHK"];
const REACT = ["hit", "hitLow", "kd", "getup", "throw", "win"];

const LABELS: Record<string, string> = {
  idle: "站立", walkF: "前进", walkB: "后退", run: "奔跑", crouch: "下蹲", jump: "跳跃", block: "站防", crouchBlock: "蹲防",
  dodgeF: "前滚", dodgeB: "后滚", hit: "受击", hitLow: "蹲姿受击", kd: "倒地", getup: "起身", throw: "投技", win: "胜利",
  stLP: "站轻拳", stHP: "站重拳", stLK: "站轻脚", stHK: "站重脚", crLP: "蹲轻拳", crHP: "蹲重拳", crLK: "蹲轻脚", crHK: "蹲重脚",
  jLP: "跳轻拳", jHP: "跳重拳", jLK: "跳轻脚", jHK: "跳重脚",
};

/** Special-move animations are named after the move that plays them. */
function specialLabel(c: CharDef, anim: string) {
  const moves = [...c.specials.flatMap((s) => [s.light, s.heavy]), c.superMove, c.throwMove];
  const mv = moves.find((m) => m.anim === anim || m.preAnim === anim);
  return mv?.name ? tx(mv.name) + (mv.preAnim === anim ? tx("（前摇）") : "") : anim;
}

interface Frames {
  img: CanvasImageSource[];
  frames: SpriteFrame[];
  scale: number;
  fps: number;
}

/** Plays an animation standing on a ground line, next to a marker of the fighter's real height. */
function AnimPreview({ anim, height, label }: { anim: Frames | null; height: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 150, H = 170, ground = H - 18, k = 1.25; // css px per game unit
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    const t0 = performance.now();
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // fighter height marker and ground
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(W / 2 - 16, ground - height * k, 32, height * k);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(8, ground + 0.5);
      ctx.lineTo(W - 8, ground + 0.5);
      ctx.stroke();
      if (!anim || !anim.frames.length) return;
      const i = Math.floor(((performance.now() - t0) / 1000) * anim.fps) % anim.frames.length;
      const f = anim.frames[i];
      const s = (f.s ?? anim.scale) / k;
      ctx.drawImage(anim.img[f.p ?? 0], f.x, f.y, f.w, f.h, W / 2 - f.ax / s, ground - f.ay / s, f.w / s, f.h / s);
      // foot anchor
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(W / 2 - 2, ground - 1, 4, 3);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [anim, height]);
  return (
    <div className="flex flex-col items-center gap-1">
      <canvas ref={ref} className="h-[170px] w-[150px] bg-black/40 ring-1 ring-white/10" />
      <span className="text-[11px] font-bold text-white/50">{label}</span>
    </div>
  );
}

type Meta = Omit<AnimSkin, "file">;

export function SkinEditor({ model, onClose, onChanged }: { model: ArenaModel; onClose: () => void; onChanged: () => void }) {
  const c = CHARS[Math.max(0, charIndex(model.body))];
  const base = art.sprites[c.id] ?? null;
  const [skin, setSkin] = useState<SkinData>({ anims: {} });
  const [imgs, setImgs] = useState<Record<string, HTMLImageElement>>({});
  const [sel, setSel] = useState("idle");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const names = Object.keys(base?.anims ?? {});
    const known = new Set([...MOVEMENT, ...NORMALS, ...REACT]);
    return [
      { title: "移动与防御", list: MOVEMENT },
      { title: "普通技", list: NORMALS },
      { title: "必杀技与超必杀", list: names.filter((n) => !known.has(n)).sort() },
      { title: "受击与其他", list: REACT },
    ];
  }, [base]);

  const load = async (s: SkinData) => {
    setSkin(s);
    const entries = await Promise.all(Object.entries(s.anims).map(async ([a, m]) => [a, await skinImage(model.id, m.file)] as const));
    setImgs(Object.fromEntries(entries.filter((e): e is [string, HTMLImageElement] => !!e[1])));
  };

  useEffect(() => {
    bridge.skin(model.id).then(load, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id]);

  const custom = skin.anims[sel];
  useEffect(() => setMeta(custom ? { frames: custom.frames, fps: custom.fps, height: custom.height, anchorX: custom.anchorX } : null), [custom, sel]);

  const label = (a: string) => (LABELS[a] ? tx(LABELS[a]) : specialLabel(c, a));

  const basePreview: Frames | null = useMemo(() => {
    const a = base?.anims[sel];
    return base && a ? { img: base.pages, frames: a.frames, scale: base.scale, fps: a.fps ?? 10 } : null;
  }, [base, sel]);
  const img = imgs[sel];
  const customPreview: Frames | null = img && meta ? { img: [img], frames: stripFrames(img, meta, 0), scale: 1, fps: meta.fps ?? 10 } : null;

  const run = async (job: () => Promise<SkinData>) => {
    setBusy(true);
    setError("");
    try {
      await load(await job());
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const upload = (files: File[]) =>
    run(async () => {
      const strip = await filesToStrip(files);
      if (strip.data.length > 12_000_000) throw new Error(tx("图片太大了（上限约 9 MB）"));
      return bridge.putAnim(model.id, sel, {
        data: strip.data,
        frames: strip.frames ?? meta?.frames ?? 1,
        fps: meta?.fps ?? null,
        height: meta?.height ?? SKIN_HEIGHT,
        anchorX: meta?.anchorX ?? 0.5,
      });
    });

  const num = "font-ui w-full border-b-2 border-white/25 bg-white/5 px-2 py-1 text-sm font-bold text-white outline-none focus:border-[var(--gold)]";

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="font-ui flex max-h-full w-full max-w-4xl flex-col gap-3 overflow-hidden bg-[#16121c] p-4 ring-1 ring-white/15" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-black">{tx("{0} 的精灵与动画", model.name)}</h2>
          <span className="text-xs text-white/50">{tx("基于 {0}", c.name)}</span>
          <button className="ml-auto text-2xl leading-none text-white/60 hover:text-white" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto sm:flex-row">
          {/* animation list */}
          <nav className="flex shrink-0 flex-col gap-3 sm:w-56">
            {groups.map((g) => (
              <div key={g.title} className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-white/40">{tx(g.title)}</span>
                <div className="flex flex-wrap gap-1">
                  {g.list.map((a) => (
                    <button
                      key={a}
                      onClick={() => setSel(a)}
                      className={`px-2 py-0.5 text-xs font-bold transition ${sel === a ? "bg-[var(--gold)] text-[var(--ink)]" : "bg-white/10 hover:bg-white/20"}`}
                    >
                      {skin.anims[a] && <span className={sel === a ? "text-[var(--ink)]" : "text-[var(--gold)]"}>● </span>}
                      {label(a)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* selected animation */}
          <section className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-black">{label(sel)}</span>
              <code className="text-xs text-white/40">{sel}</code>
              <span className={`ml-auto text-xs font-bold ${custom ? "text-[var(--gold)]" : "text-white/40"}`}>{custom ? tx("已自定义") : tx("使用原版")}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <AnimPreview anim={basePreview} height={c.height} label={tx("原版")} />
              <AnimPreview anim={customPreview} height={c.height} label={custom ? tx("自定义") : tx("还没有上传")} />
            </div>

            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/webp,image/jpeg,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) void upload(files);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <ArcadeButton tone="gold" className="!px-4 !py-1.5 !text-sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                {custom ? tx("替换图片") : tx("上传图片")}
              </ArcadeButton>
              {custom && (
                <ArcadeButton tone="gray" className="!px-4 !py-1.5 !text-sm" disabled={busy} onClick={() => run(() => bridge.deleteAnim(model.id, sel))}>
                  {tx("恢复原版")}
                </ArcadeButton>
              )}
            </div>
            <p className="text-xs leading-relaxed text-white/50">
              {tx("上传一张横向排列、帧宽相同的序列图，或一次选多张单帧图（按文件名排序拼起来）。角色要面朝右，脚踩在图片底边。只改外观，判定框和出招帧数不变。")}
            </p>

            {custom && meta && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-white/50">{tx("帧数")}</span>
                  <input className={num} type="number" min={1} max={64} value={meta.frames} onChange={(e) => setMeta({ ...meta, frames: Math.max(1, Number(e.target.value) || 1) })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-white/50" title={tx("只影响循环动画：站立、行走、奔跑")}>
                    {tx("速度 (帧/秒)")}
                  </span>
                  <input className={num} type="number" min={1} max={60} value={meta.fps ?? ""} placeholder={tx("默认")} onChange={(e) => setMeta({ ...meta, fps: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-white/50">{tx("高度 {0}", Math.round(meta.height))}</span>
                  <input type="range" min={40} max={220} value={meta.height} onChange={(e) => setMeta({ ...meta, height: Number(e.target.value) })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-white/50">{tx("脚的位置 {0}%", Math.round(meta.anchorX * 100))}</span>
                  <input type="range" min={0} max={100} value={Math.round(meta.anchorX * 100)} onChange={(e) => setMeta({ ...meta, anchorX: Number(e.target.value) / 100 })} />
                </label>
                <div className="col-span-2 sm:col-span-4">
                  <ArcadeButton tone="blue" className="!px-4 !py-1.5 !text-sm" disabled={busy} onClick={() => run(() => bridge.putAnim(model.id, sel, { ...meta, fps: meta.fps ?? null }))}>
                    {tx("应用")}
                  </ArcadeButton>
                </div>
              </div>
            )}
            {error && <div className="text-xs font-bold text-[var(--red)]">{error}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
