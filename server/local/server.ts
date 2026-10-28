/**
 * Local development server — the same API as the deployed Workers, running
 * on a plain Node process. No EdgeSpark account, CLI or project required.
 *
 *   npm run dev:local        # from server/
 *
 * It serves the routes in ../src/app.ts against a local SQLite file and
 * listens on 127.0.0.1:8787, which is where the Vite dev server proxies
 * `/api` (see web/vite.config.ts).
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "../src/app";
import { migrateLocal } from "./migrate";
import { openLocalDb } from "./sqlite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.LOCAL_PORT ?? 8787);
const HOST = process.env.LOCAL_HOST ?? "127.0.0.1";
const DB_FILE = process.env.LOCAL_DB_FILE ?? join(HERE, "data", "pk.db");

// node:sqlite is still flagged experimental — hide only that warning so real
// problems stay visible.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const first = rest[0];
  const type = typeof first === "string" ? first : (first as { type?: string } | undefined)?.type;
  const text = typeof warning === "string" ? warning : warning.message;
  if (type === "ExperimentalWarning" && text.includes("SQLite")) return;
  (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const { db, sqlite, close } = openLocalDb(DB_FILE);
await migrateLocal(db, sqlite);

const app = createApp({
  db,
  runInBackground: (promise) => {
    void promise.catch((err) => console.error("[local] background task failed:", err));
  },
});

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`  local API   →  http://${HOST}:${info.port}`);
  console.log(`  database    →  ${DB_FILE}`);
  console.log(`  web dev     →  http://localhost:5173  (vite proxies /api here)\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    close();
    process.exit(0);
  });
}
