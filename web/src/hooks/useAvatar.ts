import { useEffect, useState } from "react";
import { bridge, type ArenaModel } from "@/game/pilot/bridge";

// object URLs of uploaded avatars, per model; dropped when the avatar changes
const cache = new Map<string, Promise<string | null>>();
const rev = new Map<string, number>();

async function fetchAvatar(id: string): Promise<string | null> {
  try {
    const skin = await bridge.skin(id);
    return skin.avatar ? await bridge.file(id, skin.avatar) : null;
  } catch {
    return null;
  }
}

/** Call after uploading or removing a model's avatar. */
export function forgetAvatar(id: string) {
  const old = cache.get(id);
  cache.delete(id);
  rev.set(id, (rev.get(id) ?? 0) + 1);
  void old?.then((url) => url && URL.revokeObjectURL(url));
}

/** The model's uploaded avatar as an object URL, or null (then show the fighter's face). */
export function useAvatar(m: ArenaModel | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const id = m?.avatar ? m.id : null;
  const key = id ? `${id}:${rev.get(id) ?? 0}` : "";
  useEffect(() => {
    if (!id) return setUrl(null);
    let live = true;
    let p = cache.get(id);
    if (!p) cache.set(id, (p = fetchAvatar(id)));
    void p.then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
    // `key` changes when the avatar is replaced
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}
