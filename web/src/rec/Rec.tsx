import { useEffect, useRef } from "react";
import { loadArt } from "@/game/assets";
import { CHARS, STAGES } from "@/game/chars";
import { EN } from "@/lib/en";
import { Director, OUT_H, OUT_W } from "./engine";
import { FILMS, FILM_TEXT } from "./films";

const FAMILIES = ['900 40px "Big Shoulders Display"', '700 40px "Big Shoulders Display"', '500 40px "Noto Sans SC"', '400 40px "Ma Shan Zheng"', '900 40px "Noto Sans SC"', '700 40px "Noto Sans SC"', '400 40px "ZCOOL QingKe HuangYou"', '400 40px "Bungee"'];

/**
 * Dev-only film recorder page (`/?rec=<film>`): exposes `window.__rec.next()`, which renders the next frame of the
 * film and returns it as a JPEG data URL (null when the film is over), and `__rec.cues()`, the sound log.
 */
export default function Rec() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get("rec") ?? "";
    const el = canvas.current;
    const film = FILMS[id];
    if (!el || !film) return;
    let started = false;
    (async () => {
      await loadArt(CHARS.map((c) => c.id), STAGES.map((s) => s.bg));
      // Google Fonts serves Chinese in slices: load every glyph the film draws before the first frame
      const text = [...FILM_TEXT, ...Object.keys(EN), ...Object.values(EN), ...CHARS.flatMap((c) => [c.name, c.title, c.quote, c.victory])].join("");
      await Promise.all(FAMILIES.map((f) => document.fonts.load(f, text).catch(() => undefined)));
      await document.fonts.ready;
      const d = new Director(el);
      const gen = film(d);
      (window as unknown as { __rec: unknown }).__rec = {
        ready: true,
        async next(quality = 0.92) {
          if (!started) started = true;
          const r = await gen.next();
          if (r.done) return null;
          return quality ? el.toDataURL("image/jpeg", quality) : ""; // 0 = dry run
        },
        cues: () => d.cues,
        log: () => d.log,
        frame: () => d.f,
      };
    })();
  }, []);

  return <canvas ref={canvas} width={OUT_W} height={OUT_H} style={{ position: "fixed", left: 0, top: 0, width: OUT_W, height: OUT_H }} />;
}
