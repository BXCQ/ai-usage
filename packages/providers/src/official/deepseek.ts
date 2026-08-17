import { z } from "zod";
import type { BalanceSnapshot } from "@ai-usage/core";
import type { CollectContext, ProviderConnector } from "../types.js";

/**
 * DeepSeek —— 官方公开的只有余额接口。
 * 明细（token/成本/请求数）在 platform.deepseek.com 的私有接口里，
 * MVP 阶段刻意不接（脆弱、随时变更），详见 docs/PROVIDERS.md。
 */
const BalanceSchema = z.object({
  is_available: z.boolean(),
  balance_infos: z.array(
    z.object({
      currency: z.string(),
      total_balance: z.string(),
      granted_balance: z.string(),
      topped_up_balance: z.string(),
    }),
  ),
});

export const deepseek: ProviderConnector = {
  id: "deepseek",
  name: "DeepSeek",
  kind: "official-api",
  providers: ["deepseek"],
  describe: () =>
    "余额：GET https://api.deepseek.com/user/balance（官方）。明细为平台私有接口，MVP 未接入。",

  async fetchBalances(ctx): Promise<BalanceSnapshot[]> {
    const key = ctx.env.DEEPSEEK_API_KEY ?? ctx.env.DEEPSEEK_KEY;
    if (!key) {
      throw new Error("缺少环境变量 DEEPSEEK_API_KEY（或 DEEPSEEK_KEY）");
    }
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`余额接口返回 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const parsed = BalanceSchema.parse(await res.json());
    const usd = parsed.balance_infos.find((b) => b.currency === "USD");
    const target = usd ?? parsed.balance_infos[0];
    if (!target) return [];
    return [
      {
        provider: "deepseek",
        capturedAt: new Date().toISOString(),
        balanceUsd: Number.parseFloat(target.total_balance),
        currency: target.currency,
        meta: { isAvailable: parsed.is_available },
      },
    ];
  },

  async fetchUsage(): Promise<never[]> {
    return [];
  },
};
