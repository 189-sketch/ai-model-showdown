/**
 * 谁才是最强AI大模型 — matchmaking + WebRTC signaling server.
 *
 * Gameplay traffic is peer-to-peer (WebRTC DataChannel with rollback netcode).
 * This server only:
 *   - creates rooms (invite code or quick-match pool)
 *   - relays the SDP offer/answer between the two peers
 *   - hands out ICE servers (STUN)
 *
 * All routes are under /api/public/* so guests can play without logging in.
 * A peer proves membership of a room by its random peer id, which is only
 * ever returned to the two room members.
 */

import { Hono } from "hono";
import { db, ctx } from "edgespark";
import { rooms, signals } from "@defs";
import { and, asc, desc, eq, gt, lt, ne, or } from "drizzle-orm";

const ROOM_TTL_MS = 10 * 60 * 1000;
// A quick-match room whose host has not polled for this long is considered abandoned
const QUICK_STALE_MS = 15 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

function cleanName(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return (s || "无名拳手").slice(0, 16);
}

function isPeerId(v: unknown): v is string {
  return typeof v === "string" && /^[a-f0-9-]{32,40}$/i.test(v);
}

type Room = typeof rooms.$inferSelect;

function roomView(room: Room, peer: string) {
  const isHost = room.host_peer === peer;
  return {
    id: room.id,
    code: room.code,
    mode: room.mode,
    status: room.status,
    role: isHost ? "host" : "guest",
    // the other side's peer id is needed to address signals
    opponentPeer: isHost ? room.guest_peer : room.host_peer,
    opponentName: isHost ? room.guest_name : room.host_name,
  };
}

async function loadRoomFor(id: string, peer: string): Promise<Room | null> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  if (!room) return null;
  if (room.host_peer !== peer && room.guest_peer !== peer) return null;
  return room;
}

async function createRoom(mode: "private" | "public", peer: string, name: string): Promise<Room> {
  const now = Date.now();
  // retry on the (unlikely) invite-code collision
  for (let i = 0; i < 5; i++) {
    try {
      const [room] = await db
        .insert(rooms)
        .values({
          id: crypto.randomUUID(),
          code: makeCode(),
          mode,
          status: "waiting",
          host_peer: peer,
          host_name: name,
          created_at: now,
          updated_at: now,
        })
        .returning();
      return room;
    } catch (err) {
      if (i === 4) throw err;
    }
  }
  throw new Error("unreachable");
}

async function cleanupExpired() {
  const cutoff = Date.now() - ROOM_TTL_MS;
  await db.batch([
    db.delete(signals).where(lt(signals.created_at, cutoff)),
    db.delete(rooms).where(lt(rooms.updated_at, cutoff)),
  ]);
}

const app = new Hono()
  // ICE servers for RTCPeerConnection
  .get("/api/public/ice", (c) => {
    // STUN only for now; a TURN relay (see src/defs/runtime.ts) can be appended here
    const iceServers: RTCIceServerLike[] = [
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302", "stun:stun.miwifi.com:3478"] },
    ];
    return c.json({ iceServers });
  })

  // Create a private room joined by invite code
  .post("/api/public/rooms", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!isPeerId(body.peer)) return c.json({ error: "bad peer" }, 400);
    const room = await createRoom("private", body.peer, cleanName(body.name));
    ctx.runInBackground(cleanupExpired());
    return c.json({ room: roomView(room, body.peer) }, 201);
  })

  // Join a private room by its invite code
  .post("/api/public/rooms/join", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!isPeerId(body.peer)) return c.json({ error: "bad peer" }, 400);
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return c.json({ error: "房间码格式不对" }, 400);

    const [room] = await db
      .update(rooms)
      .set({ guest_peer: body.peer, guest_name: cleanName(body.name), status: "paired", updated_at: Date.now() })
      .where(and(eq(rooms.code, code), eq(rooms.status, "waiting"), ne(rooms.host_peer, body.peer)))
      .returning();
    if (!room) return c.json({ error: "房间不存在或已满" }, 404);
    return c.json({ room: roomView(room, body.peer) });
  })

  // Quick match: join the oldest live public room, or open one and wait
  .post("/api/public/match/quick", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!isPeerId(body.peer)) return c.json({ error: "bad peer" }, 400);
    const name = cleanName(body.name);
    const now = Date.now();

    const candidates = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(
        and(
          eq(rooms.mode, "public"),
          eq(rooms.status, "waiting"),
          gt(rooms.updated_at, now - QUICK_STALE_MS),
          ne(rooms.host_peer, body.peer)
        )
      )
      .orderBy(asc(rooms.created_at))
      .limit(5);

    for (const cand of candidates) {
      // conditional update is atomic: only one guest can flip waiting → paired
      const [room] = await db
        .update(rooms)
        .set({ guest_peer: body.peer, guest_name: name, status: "paired", updated_at: now })
        .where(and(eq(rooms.id, cand.id), eq(rooms.status, "waiting")))
        .returning();
      if (room) {
        // close any public room this peer opened earlier
        await db
          .update(rooms)
          .set({ status: "closed", updated_at: now })
          .where(and(eq(rooms.host_peer, body.peer), eq(rooms.status, "waiting")));
        return c.json({ room: roomView(room, body.peer) });
      }
    }

    // reuse this peer's own waiting room if it already has one
    const [own] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.host_peer, body.peer), eq(rooms.mode, "public"), eq(rooms.status, "waiting")))
      .orderBy(desc(rooms.created_at))
      .limit(1);
    if (own) {
      await db.update(rooms).set({ updated_at: now }).where(eq(rooms.id, own.id));
      return c.json({ room: roomView(own, body.peer) });
    }

    const room = await createRoom("public", body.peer, name);
    ctx.runInBackground(cleanupExpired());
    return c.json({ room: roomView(room, body.peer) }, 201);
  })

  // Poll room status (the host waits here until a guest arrives)
  .get("/api/public/rooms/:id", async (c) => {
    const peer = c.req.query("peer") ?? "";
    const room = await loadRoomFor(c.req.param("id"), peer);
    if (!room) return c.json({ error: "房间不存在" }, 404);
    if (room.status === "waiting" && room.host_peer === peer) {
      // heartbeat so quick match does not hand out abandoned rooms
      await db.update(rooms).set({ updated_at: Date.now() }).where(eq(rooms.id, room.id));
    }
    return c.json({ room: roomView(room, peer) });
  })

  // Leave / cancel a room
  .post("/api/public/rooms/:id/leave", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const room = await loadRoomFor(c.req.param("id"), body.peer);
    if (!room) return c.json({ ok: true });
    await db.update(rooms).set({ status: "closed", updated_at: Date.now() }).where(eq(rooms.id, room.id));
    return c.json({ ok: true });
  })

  // Send a signaling message to the other room member
  .post("/api/public/rooms/:id/signals", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const room = await loadRoomFor(c.req.param("id"), body.peer);
    if (!room) return c.json({ error: "房间不存在" }, 404);
    const kind = String(body.kind ?? "");
    if (!["offer", "answer", "bye"].includes(kind)) return c.json({ error: "bad kind" }, 400);
    const payload = typeof body.payload === "string" ? body.payload : JSON.stringify(body.payload ?? null);
    if (payload.length > 9000) return c.json({ error: "payload too large" }, 413);
    const to = room.host_peer === body.peer ? room.guest_peer : room.host_peer;
    if (!to) return c.json({ error: "对手还没进入房间" }, 409);

    const now = Date.now();
    const [sig] = await db
      .insert(signals)
      .values({ room_id: room.id, to_peer: to, from_peer: body.peer, kind, payload, created_at: now })
      .returning({ id: signals.id });
    await db.update(rooms).set({ updated_at: now }).where(eq(rooms.id, room.id));
    return c.json({ id: sig.id }, 201);
  })

  // Fetch signaling messages addressed to me, after a cursor
  .get("/api/public/rooms/:id/signals", async (c) => {
    const peer = c.req.query("peer") ?? "";
    const since = Number(c.req.query("since") ?? 0) || 0;
    const room = await loadRoomFor(c.req.param("id"), peer);
    if (!room) return c.json({ error: "房间不存在" }, 404);
    const list = await db
      .select({ id: signals.id, kind: signals.kind, payload: signals.payload })
      .from(signals)
      .where(and(eq(signals.room_id, room.id), eq(signals.to_peer, peer), gt(signals.id, since)))
      .orderBy(asc(signals.id))
      .limit(20);
    return c.json({ status: room.status, signals: list });
  })

  // Lobby stats for the menu ("n players searching")
  .get("/api/public/lobby", async (c) => {
    const now = Date.now();
    const waiting = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(
        or(
          and(eq(rooms.mode, "public"), eq(rooms.status, "waiting"), gt(rooms.updated_at, now - QUICK_STALE_MS)),
          and(eq(rooms.status, "paired"), gt(rooms.updated_at, now - 60_000))
        )
      )
      .limit(200);
    return c.json({ active: waiting.length });
  });

interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export default app;
