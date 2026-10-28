/**
 * Model Arena: connect to the local bridge, manage model profiles (API or
 * command line, fighter look, accent colour, avatar, custom sprites), pick
 * any two and let them fight.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { audio } from "@/game/audio";
import { CHARS, STAGES, charIndex } from "@/game/chars";
import { bridge, DEFAULT_BRIDGE, servedByBridge, type ArenaModel, type CallResult, type ModelInput, type ModelKind } from "@/game/pilot/bridge";
import { forgetAvatar, useAvatar } from "@/hooks/useAvatar";
import { tx } from "@/lib/i18n";
import { fileToAvatar } from "@/lib/images";
import { ArcadeButton, Face, SIDE_COLOR, Screen, TopBar } from "./common";
import { SkinEditor } from "./SkinEditor";

export interface ArenaStart {
  models: [ArenaModel, ArenaModel];
  stage: number;
  equal: boolean; // same max HP and normal-attack damage for both fighters
}

/** A model's uploaded avatar, or its fighter's face, ringed in its accent colour. */
function ModelAvatar({ m, className = "" }: { m: ArenaModel; className?: string }) {
  const url = useAvatar(m);
  const c = CHARS[Math.max(0, charIndex(m.body))];
  const ring = { boxShadow: `0 0 0 2px ${m.color ?? "rgba(255,255,255,0.2)"}` };
  return url ? (
    <img src={url} alt="" className={`rounded-full object-cover ${className}`} style={ring} />
  ) : (
    <Face c={c} className={`rounded-full ${className}`} />
  );
}

const KINDS: { v: ModelKind; label: string }[] = [
  { v: "openai", label: "OpenAI 兼容 API" },
  { v: "anthropic", label: "Anthropic API" },
  { v: "cli", label: "命令行" },
];

const PRESETS: { label: string; baseUrl: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { label: "xAI", baseUrl: "https://api.x.ai/v1" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
];

const COMMANDS = ["claude -p", "codex exec --skip-git-repo-check -", "gemini -p {prompt}", "ollama run qwen3"];

const input =
  "font-ui w-full border-b-2 border-white/25 bg-white/5 px-2 py-1.5 text-sm font-bold text-white outline-none placeholder:text-white/30 focus:border-[var(--gold)]";

export function Arena({ initial, onStart, onBack }: { initial?: ArenaStart; onStart: (a: ArenaStart) => void; onBack: () => void }) {
  const [status, setStatus] = useState<"checking" | "ok" | "down">("checking");
  const [error, setError] = useState("");
  const [models, setModels] = useState<ArenaModel[]>([]);
  const [slots, setSlots] = useState<[string | null, string | null]>([initial?.models[0].id ?? null, initial?.models[1].id ?? null]);
  const [stage, setStage] = useState(initial?.stage ?? 2);
  const [equal, setEqual] = useState(initial?.equal ?? true);
  const [editing, setEditing] = useState<ArenaModel | "new" | null>(null);
  const [tests, setTests] = useState<Record<string, CallResult | "running">>({});

  const refresh = useCallback(async () => {
    setStatus("checking");
    try {
      const list = await bridge.models();
      setModels(list);
      setStatus("ok");
      setError("");
      // drop slots whose model is gone
      setSlots(([a, b]) => [list.some((m) => m.id === a) ? a : null, list.some((m) => m.id === b) ? b : null]);
    } catch (e) {
      setStatus("down");
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void audio.bgm("title");
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" && !editing) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onBack]);

  const assign = (side: 0 | 1, id: string) => setSlots((s) => (side === 0 ? [id, s[1]] : [s[0], id]));
  const picked = slots.map((id) => models.find((m) => m.id === id) ?? null) as [ArenaModel | null, ArenaModel | null];

  const test = async (m: ArenaModel) => {
    setTests((t) => ({ ...t, [m.id]: "running" }));
    try {
      const r = await bridge.test(m.id);
      setTests((t) => ({ ...t, [m.id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [m.id]: { ok: false, ms: 0, error: (e as Error).message } }));
    }
  };

  return (
    <Screen>
      <TopBar
        title={tx("模型竞技场")}
        en="MODEL ARENA"
        onBack={onBack}
        right={
          <span className="font-ui flex items-center gap-1.5 text-xs font-bold text-white/60">
            <i className={`h-2 w-2 rounded-full ${status === "ok" ? "bg-[#3ddc84] shadow-[0_0_8px_#3ddc84]" : status === "down" ? "bg-[var(--red)]" : "bg-white/40"}`} />
            {status === "ok" ? tx("桥接已连接") : status === "down" ? tx("桥接未连接") : tx("连接中…")}
          </span>
        }
      />

      {status !== "ok" ? (
        <Connect error={status === "down" ? error : ""} onConnect={refresh} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:px-[4vw] lg:flex-row">
          {/* model roster */}
          <section className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-ui text-lg font-black">{tx("参赛模型")}</h2>
              <span className="font-ui text-xs text-white/50">{tx("点 1P / 2P 安排上场")}</span>
              <ArcadeButton tone="gold" className="ml-auto !px-4 !py-1.5 !text-sm" onClick={() => setEditing("new")}>
                + {tx("添加模型")}
              </ArcadeButton>
            </div>
            {!models.length && (
              <div className="font-ui border border-dashed border-white/20 p-6 text-center text-sm text-white/60">
                {tx("还没有模型。添加一个 API 模型，或者一条命令行（比如 claude -p）。")}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {models.map((m) => (
                <ModelCard
                  key={m.id}
                  m={m}
                  slot={slots[0] === m.id ? 0 : slots[1] === m.id ? 1 : -1}
                  test={tests[m.id]}
                  onAssign={(side) => assign(side, m.id)}
                  onEdit={() => setEditing(m)}
                  onTest={() => test(m)}
                />
              ))}
            </div>
          </section>

          {/* matchup */}
          <section className="flex shrink-0 flex-col gap-4 bg-black/35 p-4 ring-1 ring-white/10 lg:w-[340px]">
            <h2 className="font-ui text-lg font-black">{tx("对阵")}</h2>
            <div className="flex items-center gap-2">
              {picked.map((m, i) => (
                <div key={i} className="contents">
                  {i === 1 && <span className="font-num text-2xl italic text-[var(--gold)]">VS</span>}
                  <div className="flex flex-1 flex-col items-center gap-1 p-2 ring-2" style={{ ["--tw-ring-color" as string]: SIDE_COLOR[i] }}>
                    <span className="font-num text-xs italic tracking-[0.2em]" style={{ color: SIDE_COLOR[i] }}>
                      {i ? "2P" : "1P"}
                    </span>
                    {m ? (
                      <>
                        <ModelAvatar m={m} className="h-16 w-16" />
                        <span className="font-ui max-w-full truncate text-sm font-black" style={{ color: m.color }}>
                          {m.name}
                        </span>
                      </>
                    ) : (
                      <span className="font-ui grid h-[88px] place-items-center text-xs text-white/40">{tx("未选择")}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-ui text-xs font-bold text-white/50">{tx("场地")}</span>
              <select value={stage} onChange={(e) => setStage(Number(e.target.value))} className={input}>
                {STAGES.map((st, i) => (
                  <option key={st.id} value={i} className="bg-[#16121c]">
                    {tx(st.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="font-ui flex cursor-pointer items-start gap-2 text-sm font-bold">
              <input type="checkbox" className="mt-1 accent-[var(--gold)]" checked={equal} onChange={(e) => setEqual(e.target.checked)} />
              <span className="flex flex-col">
                {tx("统一属性")}
                <span className="text-xs font-normal leading-relaxed text-white/55">{tx("双方血量和普通技伤害相同，只有必杀技不同，更公平")}</span>
              </span>
            </label>
            <p className="font-ui text-xs leading-relaxed text-white/55">
              {tx("模型思考时游戏会暂停，所以比的是决策，不是网速。每个决策覆盖约 0.3–2 秒的行动；被打中会立刻重新决策。")}
            </p>
            <ArcadeButton tone="red" disabled={!picked[0] || !picked[1]} onClick={() => picked[0] && picked[1] && onStart({ models: [picked[0], picked[1]], stage, equal })}>
              {tx("开打！")}
            </ArcadeButton>
          </section>
        </div>
      )}

      {editing && (
        <ModelEditor
          model={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            // a new model stays open so its look can be set up right away
            setEditing(editing === "new" && m ? m : null);
            void refresh();
          }}
          onChanged={(m) => {
            setEditing(m);
            void refresh();
          }}
        />
      )}
    </Screen>
  );
}

function Connect({ error, onConnect }: { error: string; onConnect: () => void }) {
  const [url, setUrl] = useState(bridge.url);
  const [token, setToken] = useState(bridge.token);
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="font-ui flex w-full max-w-lg flex-col gap-4 bg-black/45 p-5 ring-1 ring-white/10">
        <h2 className="text-lg font-black">{tx("连接本地桥接")}</h2>
        <p className="text-sm leading-relaxed text-white/70">
          {tx("模型由你电脑上的桥接程序调用：API Key 和命令只保存在本机。在项目根目录运行：")}
        </p>
        <code className="bg-black/60 px-3 py-2 text-sm text-[var(--gold)]">npm run arena</code>
        <p className="text-sm leading-relaxed text-white/70">{tx("然后打开它打印出的链接，或把令牌粘贴到下面。")}</p>
        {/* served by the bridge itself: the address is this page's */}
        {!servedByBridge && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-white/50">{tx("桥接地址")}</span>
            <input className={input} value={url} placeholder={DEFAULT_BRIDGE} onChange={(e) => setUrl(e.target.value)} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-white/50">{tx("令牌")}</span>
          <input className={input} value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        {error && <div className="text-xs font-bold text-[var(--red)]">{error === "Failed to fetch" ? tx("连不上桥接，确认它正在运行") : error}</div>}
        <ArcadeButton
          tone="gold"
          onClick={() => {
            bridge.configure(url || DEFAULT_BRIDGE, token);
            onConnect();
          }}
        >
          {tx("连接")}
        </ArcadeButton>
      </div>
    </div>
  );
}

function ModelCard({
  m,
  slot,
  test,
  onAssign,
  onEdit,
  onTest,
}: {
  m: ArenaModel;
  slot: number;
  test?: CallResult | "running";
  onAssign: (side: 0 | 1) => void;
  onEdit: () => void;
  onTest: () => void;
}) {
  const how = m.kind === "cli" ? m.command : `${m.model} · ${m.baseUrl ?? "api.anthropic.com"}`;
  const rec = m.record ?? { w: 0, l: 0, d: 0 };
  return (
    <div
      className="font-ui flex flex-col gap-2 bg-white/[0.06] p-3 ring-2 transition"
      style={{ ["--tw-ring-color" as string]: slot >= 0 ? SIDE_COLOR[slot] : "rgba(255,255,255,0.1)" }}
    >
      <div className="flex items-center gap-3">
        <ModelAvatar m={m} className="h-12 w-12 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-black" style={{ color: m.color }}>
            {m.name}
            {!!m.skinAnims?.length && <span className="ml-1.5 align-middle text-[10px] font-bold text-white/50">{tx("自定义动画 {0}", m.skinAnims.length)}</span>}
          </span>
          <span className="truncate text-xs text-white/50" title={how}>
            {m.kind === "cli" ? "$ " : ""}
            {how}
          </span>
        </div>
        <span className="font-num shrink-0 text-sm italic text-white/70" title={tx("胜 / 负 / 平")}>
          {rec.w}-{rec.l}
          {rec.d ? `-${rec.d}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
        {([0, 1] as const).map((side) => (
          <button
            key={side}
            className="-skew-x-12 px-2.5 py-1 text-white transition hover:brightness-125"
            style={{ background: slot === side ? SIDE_COLOR[side] : "rgba(255,255,255,0.1)" }}
            onClick={() => {
              audio.sfx("confirm");
              onAssign(side);
            }}
          >
            {side ? "2P" : "1P"}
          </button>
        ))}
        <button className="-skew-x-12 bg-white/10 px-2.5 py-1 hover:bg-white/20" onClick={onTest} disabled={test === "running"}>
          {test === "running" ? tx("测试中…") : tx("测试")}
        </button>
        <button className="-skew-x-12 bg-white/10 px-2.5 py-1 hover:bg-white/20" onClick={onEdit}>
          {tx("编辑")}
        </button>
      </div>
      {test && test !== "running" && (
        <div className={`break-all text-xs ${test.ok ? "text-[#3ddc84]" : "text-[var(--red)]"}`}>
          {test.ok ? `✓ ${(test.ms / 1000).toFixed(1)}s · ${(test.text ?? "").trim().slice(0, 80)}` : `✗ ${test.error}`}
        </div>
      )}
    </div>
  );
}

function ModelEditor({
  model,
  onClose,
  onSaved,
  onChanged,
}: {
  model: ArenaModel | null;
  onClose: () => void;
  onSaved: (m?: ArenaModel) => void;
  onChanged: (m: ArenaModel) => void; // the avatar or sprites changed; the editor stays open
}) {
  const [f, setF] = useState<ModelInput>(() => ({
    name: model?.name ?? "",
    body: model?.body ?? CHARS[0].id,
    color: model?.color,
    kind: model?.kind ?? "openai",
    baseUrl: model ? model.baseUrl ?? "" : PRESETS[0].baseUrl,
    model: model?.model ?? "",
    apiKey: "",
    command: model?.command ?? "",
    cwd: model?.cwd ?? "",
    timeoutSec: model?.timeoutSec,
    temperature: model?.temperature,
    maxTokens: model?.maxTokens,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [skinOpen, setSkinOpen] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const avatarUrl = useAvatar(model);
  const set = (patch: Partial<ModelInput>) => setF((x) => ({ ...x, ...patch }));
  const bodyChar = CHARS[Math.max(0, charIndex(f.body))];

  /** Avatar and sprites change the stored model right away. */
  const change = async (job: () => Promise<unknown>) => {
    if (!model) return;
    setError("");
    try {
      await job();
      forgetAvatar(model.id);
      const fresh = (await bridge.models()).find((x) => x.id === model.id);
      if (fresh) onChanged(fresh);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      onSaved(await bridge.save(f, model?.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!model || !confirm(tx("删除 {0}？", model.name))) return;
    await bridge.remove(model.id);
    onSaved();
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="font-ui flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto bg-[#16121c] p-5 ring-1 ring-white/15" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-black">{model ? tx("编辑模型") : tx("添加模型")}</h2>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-white/50">{tx("显示名称")}</span>
          <input className={input} value={f.name} maxLength={24} placeholder="GPT-5 / Opus / Qwen…" onChange={(e) => set({ name: e.target.value })} />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-white/50">{tx("角色外观（决定招式）")}</span>
          <div className="flex gap-2">
            {CHARS.map((c) => (
              <button
                key={c.id}
                title={c.name}
                onClick={() => set({ body: c.id })}
                className={`flex flex-1 flex-col items-center gap-1 p-1.5 transition ${f.body === c.id ? "bg-white/15 ring-2 ring-[var(--gold)]" : "bg-white/5 hover:bg-white/10"}`}
              >
                <Face c={c} className="h-12 w-12 rounded-full" />
                <span className="text-[11px] font-bold">{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-white/50">{tx("强调色")}</span>
            <span className="flex items-center gap-2">
              <input type="color" className="h-8 w-12 cursor-pointer bg-transparent" value={f.color ?? bodyChar.color} onChange={(e) => set({ color: e.target.value })} />
              {f.color && (
                <button className="text-xs text-white/50 hover:text-white" onClick={() => set({ color: undefined })}>
                  {tx("重置")}
                </button>
              )}
            </span>
          </label>
          {model ? (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold text-white/50">{tx("头像")}</span>
                <span className="flex items-center gap-2">
                  {avatarUrl ? <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <Face c={bodyChar} className="h-8 w-8 rounded-full" />}
                  <button className="bg-white/10 px-2 py-1 text-xs font-bold hover:bg-white/20" onClick={() => avatarInput.current?.click()}>
                    {tx("上传")}
                  </button>
                  {model.avatar && (
                    <button className="text-xs text-white/50 hover:text-white" onClick={() => change(() => bridge.deleteAvatar(model.id))}>
                      {tx("移除")}
                    </button>
                  )}
                </span>
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void change(async () => bridge.putAvatar(model.id, await fileToAvatar(file)));
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold text-white/50">{tx("精灵与动画")}</span>
                <button className="bg-white/10 px-2 py-1 text-xs font-bold hover:bg-white/20" onClick={() => setSkinOpen(true)}>
                  {model.skinAnims?.length ? tx("编辑（已自定义 {0} 个）", model.skinAnims.length) : tx("自定义…")}
                </button>
              </div>
            </>
          ) : (
            <span className="pb-1 text-xs text-white/45">{tx("保存后可以上传头像和自定义精灵动画")}</span>
          )}
        </div>
        {model && model.body !== f.body && !!model.skinAnims?.length && (
          <div className="text-xs text-[var(--gold)]">{tx("换了角色外观：已上传的动画会套在新角色上，同名动画才会生效")}</div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-white/50">{tx("接入方式")}</span>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.v}
                onClick={() => set({ kind: k.v, baseUrl: k.v === "anthropic" ? "" : k.v === "openai" ? f.baseUrl || PRESETS[0].baseUrl : f.baseUrl })}
                className={`-skew-x-12 px-3 py-1.5 text-sm font-bold transition ${f.kind === k.v ? "bg-[var(--gold)] text-[var(--ink)]" : "bg-white/10 hover:bg-white/20"}`}
              >
                {tx(k.label)}
              </button>
            ))}
          </div>
        </div>

        {f.kind === "cli" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-white/50">{tx("命令")}</span>
              <input className={input} value={f.command} placeholder="claude -p" onChange={(e) => set({ command: e.target.value })} />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {COMMANDS.map((c) => (
                  <button key={c} className="bg-white/10 px-2 py-0.5 text-xs text-white/80 hover:bg-white/20" onClick={() => set({ command: c })}>
                    {c}
                  </button>
                ))}
              </div>
              <span className="text-xs leading-relaxed text-white/45">
                {tx("提示词默认通过 stdin 传入；参数里写 {prompt} 则替换到该位置。命令的标准输出就是模型的回复。不经过 shell。")}
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-white/50">{tx("工作目录（可选）")}</span>
              <input className={input} value={f.cwd} placeholder="arena/data/work" onChange={(e) => set({ cwd: e.target.value })} />
            </label>
          </>
        ) : (
          <>
            {f.kind === "openai" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-white/50">Base URL</span>
                <input className={input} value={f.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {PRESETS.map((p) => (
                    <button key={p.label} className="bg-white/10 px-2 py-0.5 text-xs text-white/80 hover:bg-white/20" onClick={() => set({ baseUrl: p.baseUrl })}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </label>
            )}
            {f.kind === "anthropic" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-white/50">{tx("Base URL（可选）")}</span>
                <input className={input} value={f.baseUrl} placeholder="https://api.anthropic.com" onChange={(e) => set({ baseUrl: e.target.value })} />
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-white/50">{tx("模型 ID")}</span>
              <input className={input} value={f.model} placeholder={f.kind === "anthropic" ? "claude-sonnet-5-5" : "deepseek-chat"} onChange={(e) => set({ model: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-white/50">API Key</span>
              <input
                className={input}
                type="password"
                autoComplete="off"
                value={f.apiKey}
                placeholder={model?.hasKey && model.kind === f.kind ? tx("已保存，留空则不修改") : f.kind === "openai" ? tx("本地模型可留空") : ""}
                onChange={(e) => set({ apiKey: e.target.value })}
              />
            </label>
          </>
        )}

        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-white/50">{tx("超时（秒）")}</span>
            <input className={input} inputMode="numeric" value={f.timeoutSec ?? ""} placeholder={f.kind === "cli" ? "120" : "60"} onChange={(e) => set({ timeoutSec: num(e.target.value) })} />
          </label>
          {f.kind !== "cli" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-white/50">Temperature</span>
                <input className={input} inputMode="decimal" value={f.temperature ?? ""} placeholder={tx("默认")} onChange={(e) => set({ temperature: num(e.target.value) })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-white/50">Max tokens</span>
                <input className={input} inputMode="numeric" value={f.maxTokens ?? ""} placeholder={f.kind === "anthropic" ? "1024" : tx("默认")} onChange={(e) => set({ maxTokens: num(e.target.value) })} />
              </label>
            </>
          )}
        </div>

        {error && <div className="text-xs font-bold text-[var(--red)]">{error}</div>}
        <div className="flex flex-wrap gap-3 pt-1">
          <ArcadeButton tone="gold" disabled={busy || !f.name.trim()} onClick={save}>
            {tx("保存")}
          </ArcadeButton>
          <ArcadeButton tone="gray" onClick={onClose}>
            {tx("取消")}
          </ArcadeButton>
          {model && (
            <ArcadeButton tone="gray" className="ml-auto !text-[var(--red)]" onClick={remove}>
              {tx("删除")}
            </ArcadeButton>
          )}
        </div>
      </div>
      {skinOpen && model && (
        <SkinEditor
          model={{ ...model, body: f.body }}
          onClose={() => setSkinOpen(false)}
          onChanged={() => void change(async () => {})}
        />
      )}
    </div>
  );
}
