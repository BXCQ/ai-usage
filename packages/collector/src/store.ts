import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { BalanceSnapshot, DailyRow, ProviderId, Totals, UsageEvent } from "@ai-usage/core";

export interface RangeOpts {
  from?: string;
  to?: string;
  provider?: string;
  model?: string;
}

export interface ModelAgg {
  model: string;
  provider: ProviderId;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface ProviderAgg {
  provider: ProviderId;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
  events: number;
}

export interface BalanceRow {
  provider: ProviderId;
  capturedAt: string;
  balanceUsd: number | null;
  currency: string;
  meta: string | null;
}

export interface Store {
  db: DatabaseSync;
  insertEvents(events: UsageEvent[]): { inserted: number; skipped: number };
  insertBalances(balances: BalanceSnapshot[]): number;
  deleteBySource(source: string): number;
  getDaily(opts: RangeOpts): DailyRow[];
  getTotals(opts: RangeOpts): Totals;
  getModels(opts: RangeOpts): ModelAgg[];
  getProviders(opts: RangeOpts): ProviderAgg[];
  getBalances(): BalanceRow[];
  counts(): { events: number; balances: number };
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  ts TEXT NOT NULL,
  date TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  tool TEXT,
  extra TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_date ON usage_events(date);
CREATE INDEX IF NOT EXISTS idx_events_provider_model ON usage_events(provider, model);

CREATE TABLE IF NOT EXISTS balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  balance_usd REAL,
  currency TEXT,
  meta TEXT
);
`;

function keyOf(e: UsageEvent): string {
  const extra = e.extra as Record<string, unknown> | undefined;
  if (typeof extra?.composerId === "string" && typeof extra?.bubbleId === "string") {
    return createHash("sha1").update(`${e.source}|${extra.composerId}|${extra.bubbleId}`).digest("hex");
  }
  return createHash("sha1")
    .update(`${e.source}|${e.provider}|${e.ts}|${e.model}|${e.inputTokens}|${e.outputTokens}|${e.requests}`)
    .digest("hex");
}

function whereClause(opts: RangeOpts): { sql: string; params: (string | number)[] } {
  const conds: string[] = ["source != 'demo'"];
  const params: (string | number)[] = [];
  if (opts.from) {
    conds.push("date >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    conds.push("date <= ?");
    params.push(opts.to);
  }
  if (opts.provider) {
    conds.push("provider = ?");
    params.push(opts.provider);
  }
  if (opts.model) {
    conds.push("model = ?");
    params.push(opts.model);
  }
  return { sql: "WHERE " + conds.join(" AND "), params };
}

export function openStore(dbPath: string): Store {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const insertEventStmt = db.prepare(`
    INSERT OR IGNORE INTO usage_events
      (event_key, source, provider, model, ts, date, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, requests, cost_usd, lines_added, lines_removed, tool, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBalanceStmt = db.prepare(`
    INSERT INTO balances (provider, captured_at, balance_usd, currency, meta)
    VALUES (?, ?, ?, ?, ?)
  `);

  return {
    db,

    insertEvents(events) {
      let inserted = 0;
      db.exec("BEGIN");
      try {
        for (const e of events) {
          const r = insertEventStmt.run(
            keyOf(e),
            e.source,
            e.provider,
            e.model,
            e.ts,
            e.date,
            e.inputTokens,
            e.outputTokens,
            e.cacheReadTokens,
            e.cacheWriteTokens,
            e.requests,
            e.costUsd,
            e.linesAdded ?? 0,
            e.linesRemoved ?? 0,
            e.tool ?? null,
            e.extra ? JSON.stringify(e.extra) : null,
          );
          if (r.changes > 0) inserted += 1;
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { inserted, skipped: events.length - inserted };
    },

    insertBalances(balances) {
      for (const b of balances) {
        insertBalanceStmt.run(b.provider, b.capturedAt, b.balanceUsd, b.currency, JSON.stringify(b.meta));
      }
      return balances.length;
    },

    deleteBySource(source) {
      const r = db.prepare("DELETE FROM usage_events WHERE source = ?").run(source);
      return Number(r.changes);
    },

    getDaily(opts) {
      const w = whereClause(opts);
      const rows = db
        .prepare(`
          SELECT date, provider, model,
                 SUM(input_tokens) AS inputTokens,
                 SUM(output_tokens) AS outputTokens,
                 SUM(cache_read_tokens + cache_write_tokens) AS cacheTokens,
                 SUM(requests) AS requests,
                 COALESCE(SUM(cost_usd), 0) AS costUsd,
                 SUM(lines_added) AS linesAdded,
                 SUM(lines_removed) AS linesRemoved
          FROM usage_events
          ${w.sql}
          GROUP BY date, provider, model
          ORDER BY date
        `)
        .all(...w.params) as unknown as DailyRow[];
      return rows.map((r) => ({ ...r, provider: r.provider as ProviderId }));
    },

    getTotals(opts) {
      const w = whereClause(opts);
      const row = db
        .prepare(`
          SELECT
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(cache_read_tokens + cache_write_tokens), 0) AS cacheTokens,
            COALESCE(SUM(requests), 0) AS requests,
            COALESCE(SUM(cost_usd), 0) AS costUsd,
            COALESCE(SUM(lines_added), 0) AS linesAdded,
            COALESCE(SUM(lines_removed), 0) AS linesRemoved
          FROM usage_events
          ${w.sql}
        `)
        .get(...w.params) as unknown as Totals;
      return row;
    },

    getModels(opts) {
      const w = whereClause(opts);
      const rows = db
        .prepare(`
          SELECT model, provider,
                 SUM(input_tokens) AS inputTokens,
                 SUM(output_tokens) AS outputTokens,
                 SUM(cache_read_tokens + cache_write_tokens) AS cacheTokens,
                 SUM(requests) AS requests,
                 COALESCE(SUM(cost_usd), 0) AS costUsd,
                 SUM(lines_added) AS linesAdded,
                 SUM(lines_removed) AS linesRemoved
          FROM usage_events
          ${w.sql}
          GROUP BY model, provider
          ORDER BY COALESCE(SUM(cost_usd), 0) DESC
        `)
        .all(...w.params) as unknown as ModelAgg[];
      return rows.map((r) => ({ ...r, provider: r.provider as ProviderId }));
    },

    getProviders(opts) {
      const w = whereClause(opts);
      const rows = db
        .prepare(`
          SELECT provider,
                 SUM(input_tokens) AS inputTokens,
                 SUM(output_tokens) AS outputTokens,
                 SUM(cache_read_tokens + cache_write_tokens) AS cacheTokens,
                 SUM(requests) AS requests,
                 COALESCE(SUM(cost_usd), 0) AS costUsd,
                 SUM(lines_added) AS linesAdded,
                 SUM(lines_removed) AS linesRemoved,
                 COUNT(*) AS events
          FROM usage_events
          ${w.sql}
          GROUP BY provider
          ORDER BY COALESCE(SUM(cost_usd), 0) DESC
        `)
        .all(...w.params) as unknown as ProviderAgg[];
      return rows.map((r) => ({ ...r, provider: r.provider as ProviderId }));
    },

    getBalances() {
      const rows = db
        .prepare(`
          SELECT b.provider, b.captured_at AS capturedAt, b.balance_usd AS balanceUsd,
                 b.currency, b.meta
          FROM balances b
          JOIN (SELECT provider, MAX(id) AS max_id FROM balances GROUP BY provider) m
            ON b.id = m.max_id
          WHERE b.meta IS NULL OR b.meta NOT LIKE '%"demo":true%'
          ORDER BY b.provider
        `)
        .all() as unknown as BalanceRow[];
      return rows;
    },

    counts() {
      const e = db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE source != 'demo'").get() as { n: number };
      const b = db
        .prepare(`SELECT COUNT(*) AS n FROM balances WHERE meta IS NULL OR meta NOT LIKE '%"demo":true%'`)
        .get() as { n: number };
      return { events: e.n, balances: b.n };
    },

    close() {
      db.close();
    },
  };
}
