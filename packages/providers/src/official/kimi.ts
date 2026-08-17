import { z } from "zod";
import type { BalanceSnapshot } from "@ai-usage/core";
import type { CollectContext, ProviderConnector } from "../types.js";

/**
 * Kimi / Moonshot —— 官方公开的只有余额接口。
 * 按日/按模型的明细只在网页控制台（platform.kimi.ai 的 fee-detail），无公开 API，MVP 未接入。
 */
const BalanceSchema = z.object({
  available_balance: z.union([z.number(), z.string()]),
  voucher_balance: z.union([z.number(), z.string()]).optional(),
  cash_balance: z.union([z.number(), z.string()]).optional(),
});

export const kimi: ProviderConnector = {
  id: "kimi",
  name: "Kimi / Moonshot",
  kind: "official-api",
  providers: ["kimi"],
  describe: () =>
    "余额：GET /v1/users/me/balance（官方，国际 api.moonshot.ai / 国内 api.moonshot.cn）。明细仅网页控制台，MVP 未接入。",

  async fetchBalances(ctx): Promise<BalanceSnapshot[]> {
    const key = ctx.env.MOONSHOT_API_KEY ?? ctx.env.KIMI_API_KEY;
    if (!key) {
      throw new Error("缺少环境变量 MOONSHOT_API_KEY（或 KIMI_API_KEY）");
    }
    const region = ctx.env.MOONSHOT_REGION === "china" ? "api.moonshot.cn" : "api.moonshot.ai";
    const res = await fetch(`https://${region}/v1/users/me/balance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`余额接口返回 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const parsed = BalanceSchema.parse(await res.json());
    return [
      {
        provider: "kimi",
        capturedAt: new Date().toISOString(),
        balanceUsd: Number(parsed.available_balance),
        currency: "CNY",
        meta: {
          voucherBalance: Number(parsed.voucher_balance ?? 0),
          cashBalance: Number(parsed.cash_balance ?? 0),
        },
      },
    ];
  },

  async fetchUsage(): Promise<never[]> {
    return [];
  },
};
