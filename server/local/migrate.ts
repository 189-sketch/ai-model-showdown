/**
 * Applies the project's Drizzle migrations to the local SQLite file.
 *
 * The same `drizzle/*.sql` files that `edgespark db migrate` applies to D1
 * are used here — they are plain SQLite, so no separate migration set is
 * needed. Drizzle's own migrator keeps the `__drizzle_migrations` table in
 * sync, so restarting the server does not re-run anything.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import type { DatabaseSync } from "node:sqlite";
import type { LocalDb } from "./sqlite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const MIGRATIONS_FOLDER = join(HERE, "..", "drizzle");

export async function migrateLocal(db: LocalDb, sqlite: DatabaseSync): Promise<void> {
  await migrate(
    db,
    async (queries) => {
      for (const query of queries) {
        // migration statements are DDL / literal INSERTs — no placeholders
        sqlite.exec(query);
      }
    },
    { migrationsFolder: MIGRATIONS_FOLDER }
  );
}
