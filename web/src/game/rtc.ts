/**
 * Matchmaking + WebRTC peer connection.
 *
 * Rooms and the SDP offer/answer go through the EdgeSpark API (polling);
 * once the DataChannels open, all game traffic is peer-to-peer.
 *   "game" channel: unordered, no retransmits — rollback input packets
 *   "ctrl" channel: reliable, ordered — menus, character select, rematch
 */

import { client } from "@/lib/edgespark";
import { tx } from "@/lib/i18n";

export interface RoomInfo {
  id: string;
  code: string;
  mode: "private" | "public";
  status: "waiting" | "paired" | "closed";
  role: "host" | "guest";
  opponentPeer: string | null;
  opponentName: string | null;
}

export type CtrlMsg =
  | { t: "hello"; name: string }
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number }
  | { t: "sel"; char: number; ready: boolean; stage?: number }
  | { t: "start"; chars: [number, number]; stage: number; seed: number; delay: number }
  | { t: "rematch" }
  | { t: "toSelect" }
  | { t: "bye" };

export interface PeerLink {
  role: "host" | "guest";
  rtt: number;
  sendGame(buf: ArrayBuffer): void;
  sendCtrl(msg: CtrlMsg): void;
  onGame: ((buf: ArrayBuffer) => void) | null;
  onCtrl: ((msg: CtrlMsg) => void) | null;
  onClose: (() => void) | null;
  close(): void;
}

const PEER_KEY = "pk-peer-id";

export function myPeerId(): string {
  // one id per tab so two tabs of the same browser can play each other
  let id = sessionStorage.getItem(PEER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(PEER_KEY, id);
  }
  return id;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await client.api.fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || tx("请求失败 ({0})", res.status));
  return data;
}

export async function createRoom(name: string): Promise<RoomInfo> {
  const r = await api<{ room: RoomInfo }>("/api/public/rooms", { method: "POST", body: JSON.stringify({ peer: myPeerId(), name }) });
  return r.room;
}

export async function joinRoom(code: string, name: string): Promise<RoomInfo> {
  const r = await api<{ room: RoomInfo }>("/api/public/rooms/join", {
    method: "POST",
    body: JSON.stringify({ peer: myPeerId(), name, code }),
  });
  return r.room;
}

export async function quickMatch(name: string): Promise<RoomInfo> {
  const r = await api<{ room: RoomInfo }>("/api/public/match/quick", { method: "POST", body: JSON.stringify({ peer: myPeerId(), name }) });
  return r.room;
}

export async function getRoom(id: string): Promise<RoomInfo> {
  const r = await api<{ room: RoomInfo }>(`/api/public/rooms/${id}?peer=${myPeerId()}`);
  return r.room;
}

export async function leaveRoom(id: string) {
  try {
    await api(`/api/public/rooms/${id}/leave`, { method: "POST", body: JSON.stringify({ peer: myPeerId() }) });
  } catch {
    /* best effort */
  }
}

export async function lobbyCount(): Promise<number> {
  try {
    const r = await api<{ active: number }>("/api/public/lobby");
    return r.active;
  } catch {
    return 0;
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

/** Host side of quick match / invite: wait until somebody joins. */
export async function waitForGuest(room: RoomInfo, signal: AbortSignal): Promise<RoomInfo> {
  for (;;) {
    const r = await getRoom(room.id);
    if (r.status === "paired") return r;
    if (r.status === "closed") throw new Error(tx("房间已关闭"));
    await sleep(1000, signal);
  }
}

/** Quick match keeps re-entering the pool so two waiting players find each other. */
export async function quickMatchLoop(name: string, signal: AbortSignal, onRoom: (r: RoomInfo) => void): Promise<RoomInfo> {
  let room = await quickMatch(name);
  onRoom(room);
  let tick = 0;
  for (;;) {
    if (room.status === "paired") return room;
    await sleep(1000, signal);
    tick++;
    // every few seconds try to join someone else's room; otherwise just heartbeat ours
    room = tick % 4 === 0 ? await quickMatch(name) : await getRoom(room.id);
    onRoom(room);
  }
}

async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const r = await api<{ iceServers: RTCIceServer[] }>("/api/public/ice");
    return r.iceServers;
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

function gatheringDone(pc: RTCPeerConnection, ms: number) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

async function postSignal(room: RoomInfo, kind: "offer" | "answer" | "bye", payload: unknown) {
  await api(`/api/public/rooms/${room.id}/signals`, {
    method: "POST",
    body: JSON.stringify({ peer: myPeerId(), kind, payload }),
  });
}

async function waitSignal(room: RoomInfo, kind: string, signal: AbortSignal): Promise<string> {
  let since = 0;
  for (;;) {
    const r = await api<{ status: string; signals: { id: number; kind: string; payload: string }[] }>(
      `/api/public/rooms/${room.id}/signals?peer=${myPeerId()}&since=${since}`
    );
    for (const s of r.signals) {
      since = Math.max(since, s.id);
      if (s.kind === kind) return s.payload;
      if (s.kind === "bye") throw new Error(tx("对手已离开"));
    }
    if (r.status === "closed") throw new Error(tx("房间已关闭"));
    await sleep(700, signal);
  }
}

export async function connectPeer(room: RoomInfo, signal: AbortSignal, onStatus: (s: string) => void): Promise<PeerLink> {
  const pc = new RTCPeerConnection({ iceServers: await iceServers() });
  let game: RTCDataChannel | null = null;
  let ctrl: RTCDataChannel | null = null;

  const opened = new Promise<void>((resolve, reject) => {
    let n = 0;
    const onOpen = () => {
      if (++n === 2) resolve();
    };
    const attach = (ch: RTCDataChannel) => {
      ch.binaryType = "arraybuffer";
      if (ch.label === "game") game = ch;
      else ctrl = ch;
      if (ch.readyState === "open") onOpen();
      else ch.addEventListener("open", onOpen);
    };
    if (room.role === "host") {
      attach(pc.createDataChannel("game", { ordered: false, maxRetransmits: 0 }));
      attach(pc.createDataChannel("ctrl", { ordered: true }));
    } else {
      pc.addEventListener("datachannel", (e) => attach(e.channel));
    }
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") reject(new Error(tx("P2P 连接失败（可能是网络 NAT 限制）")));
    });
    setTimeout(() => reject(new Error(tx("连接超时，请重试"))), 30000);
  });

  try {
    if (room.role === "host") {
      onStatus(tx("正在建立连接…"));
      await pc.setLocalDescription(await pc.createOffer());
      await gatheringDone(pc, 2500);
      await postSignal(room, "offer", JSON.stringify(pc.localDescription));
      onStatus(tx("等待对手响应…"));
      const answer = await waitSignal(room, "answer", signal);
      await pc.setRemoteDescription(JSON.parse(answer));
    } else {
      onStatus(tx("等待房主…"));
      const offer = await waitSignal(room, "offer", signal);
      await pc.setRemoteDescription(JSON.parse(offer));
      onStatus(tx("正在建立连接…"));
      await pc.setLocalDescription(await pc.createAnswer());
      await gatheringDone(pc, 2500);
      await postSignal(room, "answer", JSON.stringify(pc.localDescription));
    }
    onStatus(tx("打通 P2P 通道…"));
    await Promise.race([
      opened,
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    ]);
  } catch (err) {
    pc.close();
    throw err;
  }

  const g = game as RTCDataChannel | null;
  const c = ctrl as RTCDataChannel | null;
  if (!g || !c) {
    pc.close();
    throw new Error(tx("数据通道未建立"));
  }

  let closed = false;
  const link: PeerLink = {
    role: room.role,
    rtt: 80,
    sendGame(buf) {
      if (g.readyState === "open") g.send(buf);
    },
    sendCtrl(msg) {
      if (c.readyState === "open") c.send(JSON.stringify(msg));
    },
    onGame: null,
    onCtrl: null,
    onClose: null,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(pinger);
      try {
        link.sendCtrl({ t: "bye" });
      } catch {
        /* ignore */
      }
      pc.close();
      void leaveRoom(room.id);
    },
  };

  g.onmessage = (e) => link.onGame?.(e.data as ArrayBuffer);
  c.onmessage = (e) => {
    let msg: CtrlMsg;
    try {
      msg = JSON.parse(e.data as string);
    } catch {
      return;
    }
    if (msg.t === "ping") link.sendCtrl({ t: "pong", ts: msg.ts });
    else if (msg.t === "pong") link.rtt = link.rtt * 0.7 + (performance.now() - msg.ts) * 0.3;
    else if (msg.t === "bye") {
      closed = true;
      clearInterval(pinger);
      pc.close();
      link.onClose?.();
    } else link.onCtrl?.(msg);
  };
  const lost = () => {
    if (closed) return;
    closed = true;
    clearInterval(pinger);
    link.onClose?.();
  };
  c.onclose = lost;
  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") lost();
  });
  const pinger = setInterval(() => link.sendCtrl({ t: "ping", ts: performance.now() }), 1000);
  return link;
}
