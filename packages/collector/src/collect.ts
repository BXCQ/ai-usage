import { runAll, type CollectContext } from "@ai-usage/providers";
import type { Store } from "./store.js";

export interface CollectSummary {
  connectors: number;
  eventsInserted: number;
  eventsSkipped: number;
  balances: number;
  errors: { connector: string; message: string }[];
}

/** 跑全部连接器并落库；单个 provider 失败不影响其它。成功采到的 source 会先删旧行再写入，避免估算口径变化后重复。 */
export async function collectAll(store: Store, ctx: CollectContext): Promise<CollectSummary> {
  const result = await runAll(ctx);
  const sources = new Set(result.events.map((e) => e.source));
  for (const source of sources) store.deleteBySource(source);
  const ins = store.insertEvents(result.events);
  const balances = store.insertBalances(result.balances);
  return {
    connectors: 1,
    eventsInserted: ins.inserted,
    eventsSkipped: ins.skipped,
    balances,
    errors: result.errors,
  };
}
