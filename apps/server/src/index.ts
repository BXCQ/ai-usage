import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import os from "node:os";
import path from "node:path";
import { collectAll, openStore, type RangeOpts } from "@ai-usage/collector";

const DB_PATH = process.env.AI_USAGE_DB ?? path.join(os.homedir(), ".ai-usage", "usage.db");
const PORT = Number(process.env.PORT ?? 8787);

const app = new Hono();
app.use("*", cors());

function range(c: { req: { query: (k: string) => string | undefined } }): RangeOpts {
  return {
    from: c.req.query("from"),
    to: c.req.query("to"),
    provider: c.req.query("provider"),
    model: c.req.query("model"),
  };
}

app.get("/api/health", (c) => c.json({ ok: true, db: DB_PATH }));

app.get("/api/stats", (c) => {
  const store = openStore(DB_PATH);
  try {
    const opts = range(c);
    return c.json({ totals: store.getTotals(opts), daily: store.getDaily(opts) });
  } finally {
    store.close();
  }
});

app.get("/api/models", (c) => {
  const store = openStore(DB_PATH);
  try {
    return c.json({ models: store.getModels(range(c)) });
  } finally {
    store.close();
  }
});

app.get("/api/providers", (c) => {
  const store = openStore(DB_PATH);
  try {
    return c.json({ providers: store.getProviders(range(c)) });
  } finally {
    store.close();
  }
});

app.get("/api/balances", (c) => {
  const store = openStore(DB_PATH);
  try {
    return c.json({ balances: store.getBalances() });
  } finally {
    store.close();
  }
});

app.post("/api/refresh", async (c) => {
  const store = openStore(DB_PATH);
  try {
    const summary = await collectAll(store, { env: process.env });
    return c.json(summary);
  } finally {
    store.close();
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`⚡ ai-usage server: http://localhost:${info.port} （Web 看板 http://localhost:5173）`);
});
