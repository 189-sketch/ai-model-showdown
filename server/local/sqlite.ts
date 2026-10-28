/**
 * Local database: a SQLite file on disk, driven through drizzle's
 * `sqlite-proxy` driver.
 *
 * Why sqlite-proxy: it is the same driver Cloudflare D1 and the EdgeSpark
 * SDK's own local D1 are built on (see @edgespark/devkit), so the query
 * builder behaviour — including `db.batch()` — matches the deployed server.
 *
 * The executor uses Node's built-in `node:sqlite` (Node 22.5+), so there is
 * no native module to compile.
 *
 * One subtlety: drizzle's `mapResultRow()` reads values positionally
 * (`row[columnIndex]`). The D1 session converts object rows into arrays
 * before that; the proxy driver does not, so we hand it arrays directly via
 * `StatementSync.setReturnArrays(true)`.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { drizzleSchema } from "@defs";

export type LocalDb = SqliteRemoteDatabase<typeof drizzleSchema>;

export interface LocalDatabase {
  db: LocalDb;
  sqlite: DatabaseSync;
  close(): void;
}

type SqlMethod = "run" | "all" | "values" | "get";

/**
 * node:sqlite hands back object rows by default; `setReturnArrays(true)`
 * switches it to positional arrays — which is what drizzle's row mapper
 * expects. @types/node 22 does not model that mode, hence the cast.
 */
function allRows(stmt: StatementSync, params: unknown[]): unknown[][] {
  return stmt.all(...(params as never[])) as unknown as unknown[][];
}

function getRow(stmt: StatementSync, params: unknown[]): unknown[] | undefined {
  return stmt.get(...(params as never[])) as unknown as unknown[] | undefined;
}

function execOne(sqlite: DatabaseSync, sql: string, params: unknown[], method: SqlMethod) {
  const stmt = sqlite.prepare(sql);
  // drizzle reads result rows by column index, not by column name
  stmt.setReturnArrays(true);

  switch (method) {
    case "run":
      stmt.run(...(params as never[]));
      return { rows: [] as unknown[][] };
    case "get": {
      const row = getRow(stmt, params);
      return { rows: row === undefined ? [] : [row] };
    }
    case "all":
    case "values":
      return { rows: allRows(stmt, params) };
  }
}

export function openLocalDb(file: string): LocalDatabase {
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");

  const exec = (sql: string, params: unknown[], method: SqlMethod) =>
    Promise.resolve(execOne(sqlite, sql, params, method));

  // D1's db.batch() is atomic — keep the same guarantee locally.
  const execBatch = async (batch: { sql: string; params: unknown[]; method: SqlMethod }[]) => {
    sqlite.exec("BEGIN");
    try {
      const results = batch.map((q) => execOne(sqlite, q.sql, q.params, q.method));
      sqlite.exec("COMMIT");
      return results;
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  };

  const db = buildDb(exec, execBatch);

  return {
    db,
    sqlite,
    close() {
      sqlite.close();
    },
  };
}

function buildDb(
  exec: (sql: string, params: unknown[], method: SqlMethod) => Promise<{ rows: unknown[][] }>,
  execBatch: (
    batch: { sql: string; params: unknown[]; method: SqlMethod }[]
  ) => Promise<{ rows: unknown[][] }[]>
): LocalDb {
  try {
    return drizzle<typeof drizzleSchema>(exec, execBatch, { schema: drizzleSchema });
  } catch (err) {
    // The relational config is only needed for `db.query.*`, which this app
    // never uses. If the generated system schema cannot be parsed, drop it.
    console.warn("[local] relational schema ignored:", (err as Error).message);
    return drizzle<typeof drizzleSchema>(exec, execBatch);
  }
}
