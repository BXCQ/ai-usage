import { estimateCost, type BalanceSnapshot, type ProviderId, type UsageEvent } from "@ai-usage/core";
import type { Store } from "./store.js";

/** 确定性伪随机（同一天多次 seed 结果一致，配合 event_key 去重可幂等） */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 24 * 60 * 60 * 1000;

export function generateDemoEvents(days = 30): { events: UsageEvent[]; balances: BalanceSnapshot[] } {
  const events: UsageEvent[] = [];
  const rand = mulberry32(20260101);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const profile: Record<string, { provider: ProviderId; models: string[]; base: number }[]> = {
    "claude-code": [
      { provider: "claude-code", models: ["claude-opus-4-1-20250805", "claude-sonnet-4-5-20250929"], base: 8000 },
    ],
    "codex": [{ provider: "codex", models: ["gpt-5.2-codex", "gpt-5.1-codex"], base: 5000 }],
    "deepseek": [
      { provider: "deepseek", models: ["deepseek-chat", "deepseek-reasoner"], base: 3000 },
    ],
    "kimi": [{ provider: "kimi", models: ["kimi-k2.5", "kimi-k2"], base: 2600 }],
  };

  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(today.getTime() - d * DAY);
    const date = day.toISOString().slice(0, 10);
    const weekday = day.getDay();
    // 周末用量低
    const scale = weekday === 0 || weekday === 6 ? 0.35 : 1;

    for (const groups of Object.values(profile)) {
      for (const g of groups) {
        for (const model of g.models) {
          const sessions = Math.max(1, Math.round(rand() * 6 * scale));
          const perCall = g.base * (0.5 + rand());
          const calls = Math.round(sessions * (1 + rand() * 2.5));
          const input = Math.round(perCall * calls * (0.7 + rand() * 0.6));
          const output = Math.round(input * (0.4 + rand() * 0.5));
          const cacheRead = Math.round(input * (1 + rand() * 2));
          const cacheWrite = Math.round(input * 0.15);
          const ts = new Date(day.getTime() + Math.floor(rand() * 12) * 3600_000 + Math.floor(rand() * 60) * 60_000).toISOString();
          events.push({
            source: "demo",
            provider: g.provider,
            model,
            ts,
            date,
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
            cacheWriteTokens: cacheWrite,
            requests: calls,
            costUsd: estimateCost(model, input, output, cacheRead, cacheWrite),
          });
        }
        // 每个 provider 每天一条会话汇总（承载 requests 与代码行）
        const sessions = Math.max(1, Math.round(rand() * 8 * scale));
        events.push({
          source: "demo",
          provider: g.provider,
          model: "__session__",
          ts: `${date}T12:00:00.000Z`,
          date,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          requests: sessions,
          costUsd: null,
          linesAdded: Math.round((200 + rand() * 1400) * scale),
          linesRemoved: Math.round((40 + rand() * 360) * scale),
        });
      }
    }
  }

  const now = new Date().toISOString();
  const balances: BalanceSnapshot[] = [
    { provider: "deepseek", capturedAt: now, balanceUsd: 18.5, currency: "CNY", meta: { demo: true } },
    { provider: "kimi", capturedAt: now, balanceUsd: 12.2, currency: "CNY", meta: { demo: true } },
  ];
  return { events, balances };
}

export function seedDemo(store: Store, days = 30) {
  const { events, balances } = generateDemoEvents(days);
  const ins = store.insertEvents(events);
  store.insertBalances(balances);
  return { ...ins, balances: balances.length };
}
