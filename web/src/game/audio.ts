/**
 * WebAudio playback for BGM, sound effects, character voices and the announcer.
 * Every file is optional: a missing asset just plays nothing.
 */

const SFX = [
  "whiff", "hitL", "hitH", "kick", "block", "fireball", "fall", "jump", "land", "ko", "menu", "confirm", "gift", "cheer", "poof",
  "card", "click", "ultra", "stamp", "ban", "unban", "reflect", "artifact", "scroll", "tray", "splash", "transform", "busy",
  "glitch", "rocket", "explode", "car", "note",
];
const ANNOUNCER = ["choose", "round1", "round2", "final", "fight", "ko", "perfect", "timeover", "youwin", "youlose", "draw", "p1wins", "p2wins"];
const VOICES = ["atk1", "atk2", "atkH", "special", "special2", "special3", "super", "hurt", "hurtH", "ko", "win", "intro", "revert", "detonate"];
// lines of summoned helpers, played as "<helper>:<line>" voice events
const HELPER_VOICES: Record<string, string[]> = { whalemaid: ["arrive", "strike", "bye"] };
const BGM = { title: "bgm_title", launch: "bgm_launch", datacenter: "bgm_datacenter", colosseum: "bgm_colosseum" } as const;

const SFX_GAIN: Record<string, number> = {
  whiff: 0.45, jump: 0.35, land: 0.35, menu: 0.5, block: 0.8, cheer: 0.7, gift: 0.6, poof: 0.8,
  click: 0.7, unban: 0.8, tray: 0.7, splash: 0.7, busy: 0.7, glitch: 0.6, rocket: 0.6, explode: 0.8, car: 0.7, note: 0.8, card: 0.7,
};

class AudioManager {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicGain!: GainNode;
  sfxGain!: GainNode;
  buffers = new Map<string, AudioBuffer>();
  loading = new Map<string, Promise<void>>();
  bgmNode: AudioBufferSourceNode | null = null;
  bgmId = "";
  voiceNodes: (AudioBufferSourceNode | null)[] = [null, null, null, null]; // 0/1 players, 2/3 their helpers
  annNode: AudioBufferSourceNode | null = null;
  musicVolume = 0.55;
  sfxVolume = 0.9;
  muted = false;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem("pk-audio") ?? "{}");
      if (typeof saved.music === "number") this.musicVolume = saved.music;
      if (typeof saved.sfx === "number") this.sfxVolume = saved.sfx;
      if (typeof saved.muted === "boolean") this.muted = saved.muted;
    } catch {
      /* storage unavailable */
    }
  }

  /** Must be called from a user gesture the first time (autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
      this.preload();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : 1;
    this.musicGain.gain.value = this.musicVolume;
    this.sfxGain.gain.value = this.sfxVolume;
    try {
      localStorage.setItem("pk-audio", JSON.stringify({ music: this.musicVolume, sfx: this.sfxVolume, muted: this.muted }));
    } catch {
      /* ignore */
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolumes();
  }

  private load(key: string, url: string): Promise<void> {
    const existing = this.loading.get(key);
    if (existing) return existing;
    const p = (async () => {
      if (!this.ctx) return;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(data);
        this.buffers.set(key, buf);
      } catch {
        /* missing or undecodable asset: stay silent */
      }
    })();
    this.loading.set(key, p);
    return p;
  }

  preload(chars: string[] = ["chatgpt", "claude", "deepseek", "grok"]) {
    for (const id of SFX) void this.load(`sfx:${id}`, `/assets/audio/sfx/${id}.mp3`);
    for (const id of ANNOUNCER) void this.load(`ann:${id}`, `/assets/audio/ann/${id}.mp3`);
    for (const c of chars) for (const v of VOICES) void this.load(`voice:${c}:${v}`, `/assets/audio/voice/${c}_${v}.mp3`);
    for (const [h, lines] of Object.entries(HELPER_VOICES))
      for (const v of lines) void this.load(`voice:${h}:${v}`, `/assets/audio/voice/${h}_${v}.mp3`);
  }

  private play(key: string, gain: number, out: GainNode, rate = 1): AudioBufferSourceNode | null {
    if (!this.ctx) return null;
    const buf = this.buffers.get(key);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start();
    return src;
  }

  sfx(id: string) {
    if (id === "super") {
      this.play("sfx:ko", 0.55, this.sfxGain, 1.25);
      this.play("sfx:fireball", 0.7, this.sfxGain, 0.8);
      return;
    }
    this.play(`sfx:${id}`, SFX_GAIN[id] ?? 1, this.sfxGain);
  }

  voice(who: 0 | 1, char: string, id: string) {
    const helper = id.indexOf(":");
    if (helper > 0) {
      this.voiceNodes[who + 2]?.stop();
      this.voiceNodes[who + 2] = this.play(`voice:${id.slice(0, helper)}:${id.slice(helper + 1)}`, 1, this.sfxGain);
      return;
    }
    let v = id;
    if (id === "atk") v = Math.random() < 0.5 ? "atk1" : "atk2";
    // optional lines a character may not have recorded
    if (id !== "atk" && !this.buffers.has(`voice:${char}:${id}`)) v = "atkH";
    // one voice channel per player: a new line cuts the previous one
    this.voiceNodes[who]?.stop();
    this.voiceNodes[who] = this.play(`voice:${char}:${v}`, 1, this.sfxGain);
  }

  announce(id: string) {
    this.annNode?.stop();
    this.annNode = this.play(`ann:${id}`, 1.1, this.sfxGain);
  }

  async bgm(name: keyof typeof BGM | "") {
    if (this.bgmId === name) return;
    this.bgmId = name;
    const old = this.bgmNode;
    this.bgmNode = null;
    if (old && this.ctx) {
      const g = this.ctx.createGain();
      try {
        old.disconnect();
        old.connect(g).connect(this.musicGain);
        g.gain.setValueAtTime(1, this.ctx.currentTime);
        g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.6);
        old.stop(this.ctx.currentTime + 0.65);
      } catch {
        old.stop();
      }
    }
    if (!name || !this.ctx) return;
    const key = `bgm:${name}`;
    await this.load(key, `/assets/audio/bgm/${BGM[name]}.mp3`);
    if (this.bgmId !== name) return;
    const buf = this.buffers.get(key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.bgmNode = src;
  }
}

export const audio = new AudioManager();
