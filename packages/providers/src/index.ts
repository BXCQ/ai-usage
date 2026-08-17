import type { BalanceSnapshot, UsageEvent } from "@ai-usage/core";
import { anthropic } from "./official/anthropic.js";
import { deepseek } from "./official/deepseek.js";
import { kimi } from "./official/kimi.js";
import { openai } from "./official/openai.js";
import { claudeCode } from "./local/claude-code.js";
import { codex } from "./local/codex.js";
import { cursorLocal } from "./local/cursor.js";
import type { CollectContext, CollectResult, ProviderConnector } from "./types.js";

export * from "./types.js";

/** 连接器注册表：新增 provider 在这里登记即可 */
export const connectors: ProviderConnector[] = [
  // 官方 API（稳定优先）
  anthropic,
  openai,
  deepseek,
  kimi,
  // 本地日志（零配置）
  claudeCode,
  codex,
  cursorLocal,
];

export function getConnector(id: string): ProviderConnector | undefined {
  return connectors.find((c) => c.id === id);
}

export function listConnectors() {
  return connectors.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    providers: c.providers,
    describe: c.describe(),
  }));
}

/** 跑所有连接器，逐个容错：某个 provider 挂了不影响其它 */
export async function runAll(ctx: CollectContext): Promise<CollectResult> {
  const events: UsageEvent[] = [];
  const balances: BalanceSnapshot[] = [];
  const errors: CollectResult["errors"] = [];

  for (const c of connectors) {
    try {
      events.push(...(await c.fetchUsage(ctx)));
    } catch (e) {
      errors.push({ connector: c.id, message: (e as Error).message });
    }
    if (c.fetchBalances) {
      try {
        balances.push(...(await c.fetchBalances(ctx)));
      } catch (e) {
        errors.push({ connector: `${c.id}.balance`, message: (e as Error).message });
      }
    }
  }
  return { events, balances, errors };
}
