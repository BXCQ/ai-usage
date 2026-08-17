import { runAll, type CollectContext } from "@ai-usage/providers";
import type { Store } from "./store.js";

export interface CollectSummary {
  connectors: number;
  eventsInserted: number;
  eventsSkipped: number;
  balances: number;
  errors: { connector: string; message: string }[];
}

/** 跑全部连接器并落库；单个 provider 失败不影响其它 */
export async function collectAll(store: Store, ctx: CollectContext): Promise<CollectSummary> {
  const result = await runAll(ctx);
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
