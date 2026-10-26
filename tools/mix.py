"""
Mix a recorded film's soundtrack from its sound log, the way the game's AudioManager would have played it,
then mux it with the video.

  python3 tools/mix.py <film> <build dir> <bgm name> <out.mp4> [bgm offset s] [music volume]

- sfx / announcer / voices come from web/public/assets/audio, with the game's gains; a new voice line from
  the same fighter cuts the previous one (one voice channel per player), the announcer has one channel too
- "clip" cues play the audio of a video file (the victory cut-scenes) and duck the BGM under them
- the BGM loops under everything, fades in and out
"""

from __future__ import annotations

import json
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "web" / "public" / "assets"
SR = 44100

SFX_GAIN = {
    "whiff": 0.45, "jump": 0.35, "land": 0.35, "menu": 0.5, "block": 0.8, "cheer": 0.7, "gift": 0.6, "poof": 0.8,
    "click": 0.7, "unban": 0.8, "tray": 0.7, "splash": 0.7, "busy": 0.7, "glitch": 0.6, "rocket": 0.6, "explode": 0.8,
    "car": 0.7, "note": 0.8, "card": 0.7,
}
SFX_VOL = 0.9
MUSIC_VOL = 0.5


@lru_cache(maxsize=None)
def load(path: str) -> np.ndarray:
    p = Path(path)
    if not p.exists():
        return np.zeros(0, np.float32)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def rate(x: np.ndarray, r: float) -> np.ndarray:
    """Play back r times faster (pitch shifts too, like AudioBufferSourceNode.playbackRate)."""
    if r == 1 or len(x) == 0:
        return x
    idx = np.arange(0, len(x) - 1, r)
    return np.interp(idx, np.arange(len(x)), x).astype(np.float32)


def main():
    film, build, bgm, out = sys.argv[1], Path(sys.argv[2]), sys.argv[3], sys.argv[4]
    offset = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
    music_vol = float(sys.argv[6]) if len(sys.argv) > 6 else MUSIC_VOL
    log = json.loads((build / f"{film}_cues.json").read_text())
    dur = log["frames"] / log["fps"]
    n = int(dur * SR) + SR
    mix = np.zeros(n, np.float32)
    voices: dict[str, list] = {}  # channel → [(start, end_index_written, buffer)] for cut-offs
    duck = np.ones(n, np.float32)
    atk_alt = {}

    def put(x: np.ndarray, t: float, gain: float, channel: str | None = None):
        s = int(t * SR)
        if s >= n or len(x) == 0:
            return
        e = min(n, s + len(x))
        seg = x[: e - s] * gain
        if channel:
            # one voice per channel: the previous line is cut (with a short fade) where this one starts
            prev = voices.get(channel)
            if prev and prev[1] > s:
                ps, pe, pbuf = prev
                cut = s - ps
                tail = pbuf[cut:pe - ps]
                fade = np.linspace(1, 0, min(len(tail), 441), dtype=np.float32)
                tail_cut = tail.copy()
                tail_cut[: len(fade)] *= 1 - fade  # remove what was added after the cut, keep a 10 ms fade-out
                mix[s:pe] -= tail_cut
            voices[channel] = (s, e, seg)
        mix[s:e] += seg

    for c in log["cues"]:
        t = c["t"]
        kind, cid = c["kind"], c["id"]
        if kind == "sfx":
            if cid == "super":
                put(rate(load(str(ASSETS / "audio/sfx/ko.mp3")), 1.25), t, 0.55 * SFX_VOL)
                put(rate(load(str(ASSETS / "audio/sfx/fireball.mp3")), 0.8), t, 0.7 * SFX_VOL)
            else:
                put(load(str(ASSETS / f"audio/sfx/{cid}.mp3")), t, SFX_GAIN.get(cid, 1.0) * SFX_VOL)
        elif kind == "announce":
            put(load(str(ASSETS / f"audio/ann/{cid}.mp3")), t, 1.1 * SFX_VOL, "ann")
        elif kind == "voice":
            who = c.get("who", 0)
            if ":" in cid:
                helper, line = cid.split(":", 1)
                put(load(str(ASSETS / f"audio/voice/{helper}_{line}.mp3")), t, SFX_VOL, f"helper{who}")
                continue
            char = c["char"]
            v = cid
            if cid == "atk":
                atk_alt[who] = 1 - atk_alt.get(who, 0)
                v = "atk1" if atk_alt[who] else "atk2"
            path = ASSETS / f"audio/voice/{char}_{v}.mp3"
            if not path.exists():
                path = ASSETS / f"audio/voice/{char}_atkH.mp3"
            put(load(str(path)), t, SFX_VOL, f"voice{who}")
        elif kind == "clip":
            x = load(str(ASSETS / c["file"]))
            a = int(c.get("from", 0) * SR)
            b = a + int(c.get("dur", 5) * SR)
            put(x[a:b], t, c.get("gain", 1.0))
            # duck the BGM under the clip with 0.6 s ramps
            s, e = int(t * SR), min(n, int(t * SR) + (b - a))
            ramp = int(0.6 * SR)
            duck[max(0, s - ramp):s] = np.minimum(duck[max(0, s - ramp):s], np.linspace(1, 0.15, len(duck[max(0, s - ramp):s])))
            duck[s:e] = np.minimum(duck[s:e], 0.15)

    music = load(str(ASSETS / f"audio/bgm/{bgm}.mp3"))[int(offset * SR):]
    if len(music):
        reps = int(np.ceil(n / len(music)))
        track = np.tile(music, reps)[:n] * music_vol
        fade_in = min(n, int(0.8 * SR))
        track[:fade_in] *= np.linspace(0, 1, fade_in)
        end = int(dur * SR)
        fo = int(1.5 * SR)
        track[max(0, end - fo):end] *= np.linspace(1, 0, end - max(0, end - fo))
        track[end:] = 0
        mix += track * duck

    mix = mix[: int(dur * SR)]
    peak = float(np.max(np.abs(mix))) if len(mix) else 0
    # raw float mix → ffmpeg: a limiter catches the stacked hit sounds, then loudness normalisation
    pcm = build / f"{film}_audio.f32"
    pcm.write_bytes(mix.astype(np.float32).tobytes())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(build / f"{film}_video.mp4"),
                    "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", str(pcm),
                    "-af", "alimiter=limit=0.7:attack=3:release=80:level=false,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-shortest", "-movflags", "+faststart", out], check=True)
    print(f"{film}: {dur:.1f}s, peak {peak:.2f} → {out}")


if __name__ == "__main__":
    main()
