/**
 * Cloudflare Workers entry point.
 *
 * The routes live in ./app.ts so the same code can also run on a plain local
 * Node process (see ../local/server.ts). This file only supplies the
 * platform's database client and background-task helper.
 */

import { db, ctx } from "edgespark";
import { createApp } from "./app";

const app = createApp({
  db,
  runInBackground: (promise) => ctx.runInBackground(promise),
});

export default app;
