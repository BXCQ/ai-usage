import { z } from "zod";
import type { ProviderId, UsageEvent } from "@ai-usage/core";
import type { CollectContext, ProviderConnector } from "../types.js";

/**
 * OpenAI 组织 Admin API（官方）—— 按日 × 按模型的 token/请求/成本。
 * GET /v1/organization/usage/completions
 * 注意：只统计组织内 API 调用，不含 ChatGPT 桌面/Codex CLI 用量（后者走本地日志）。
 */
const UsagePageSchema = z.object({
  data: z
    .array(
      z.object({
        start_time: z.number(),
        end_time: z.number(),
        results: z
          .array(
            z.object({
              result: z
                .object({
                  input_tokens: z.number().optional().default(0),
                  output_tokens: z.number().optional().default(0),
                  input_cached_tokens: z.number().optional().default(0),
                  num_model_requests: z.number().optional().default(0),
                  usd_cost: z.union([z.number(), z.object({ amount: z.number().optional() })]).optional(),
                })
                .passthrough(),
              dimensions: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  has_more: z.boolean().optional(),
  next_page: z.string().nullable().optional(),
});

export const openai: ProviderConnector = {
  id: "openai-admin",
  name: "OpenAI (Admin)",
  kind: "official-api",
  providers: ["openai"],
  describe: () =>
    "官方 Admin API：组织内 API 调用按日×按模型。需 OPENAI_ADMIN_KEY（组织 Admin Key，sk- 开头且有 usage.read 权限）。",

  async fetchUsage(ctx): Promise<UsageEvent[]> {
    const key = ctx.env.OPENAI_ADMIN_KEY;
    if (!key) throw new Error("缺少环境变量 OPENAI_ADMIN_KEY");
    if (!ctx.from) throw new Error("OpenAI Admin 需要 --from 参数（起始日期）");

    const start = Date.parse(`${ctx.from}T00:00:00Z`) / 1000;
    const end = ctx.to ? Date.parse(`${ctx.to}T00:00:00Z`) / 1000 : Math.floor(Date.now() / 1000);

    const events: UsageEvent[] = [];
    let page: string | null | undefined = undefined;
    let pages = 0;
    do {
      if (++pages > 5) {
        console.warn("[openai-admin] 分页超过 5 页，截断。");
        break;
      }
      const u = new URL("https://api.openai.com/v1/organization/usage/completions");
      u.searchParams.set("start_time", String(Math.floor(start)));
      u.searchParams.set("end_time", String(Math.floor(end)));
      u.searchParams.set("bucket_width", "1d");
      u.searchParams.append("group_by[]", "model");
      if (page) u.searchParams.set("page", page);
      const res = await fetch(u, {
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      });
      if (!res.ok) throw new Error(`usage/completions 返回 ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const parsed = UsagePageSchema.parse(await res.json());

      for (const bucket of parsed.data) {
        const date = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
        for (const r of bucket.results) {
          const model = r.dimensions.find((d) => d.key === "model")?.value ?? "unknown";
          const cost =
            typeof r.result.usd_cost === "number"
              ? r.result.usd_cost
              : r.result.usd_cost?.amount ?? null;
          events.push({
            source: "openai-admin",
            provider: "openai" as ProviderId,
            model,
            ts: `${date}T00:00:00.000Z`,
            date,
            inputTokens: r.result.input_tokens,
            outputTokens: r.result.output_tokens,
            cacheReadTokens: r.result.input_cached_tokens,
            cacheWriteTokens: 0,
            requests: r.result.num_model_requests,
            costUsd: cost,
          });
        }
      }
      page = parsed.next_page;
    } while (page);
    return events;
  },
};
