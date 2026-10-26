/**
 * Database Schema
 *
 * Online versus uses peer-to-peer WebRTC for gameplay. The database only
 * stores matchmaking rooms and the signaling messages (SDP offer/answer)
 * that the two browsers exchange to open the peer connection.
 *
 * After making changes, run:
 *   edgespark db generate   (create migration files)
 *   edgespark db migrate    (apply to the project database)
 *   edgespark deploy        (deploy with latest schema)
 */

import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    // 6-char invite code shown to players; unique while the room is open
    code: text("code").notNull(),
    // "private" = joined by code, "public" = quick match pool
    mode: text("mode").notNull(),
    // "waiting" → "paired" → "closed"
    status: text("status").notNull(),
    host_peer: text("host_peer").notNull(),
    host_name: text("host_name").notNull(),
    guest_peer: text("guest_peer"),
    guest_name: text("guest_name"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("rooms_code_idx").on(t.code),
    index("rooms_mode_status_idx").on(t.mode, t.status, t.updated_at),
  ]
);

export const signals = sqliteTable(
  "signals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    room_id: text("room_id").notNull(),
    to_peer: text("to_peer").notNull(),
    from_peer: text("from_peer").notNull(),
    // "offer" | "answer" | "bye"
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => [
    index("signals_room_to_idx").on(t.room_id, t.to_peer, t.id),
    index("signals_created_idx").on(t.created_at),
  ]
);
