import { z } from "zod";
import type { ProviderId, UsageEvent } from "@ai-usage/core";
import type { CollectContext, ProviderConnector } from "../types.js";

/**
 * Claude Code Analytics API（官方，需要组织 Admin Key sk-ant-admin...）
 * GET /v1/organizations/usage_report/claude_code
 * 返回：按日 × 按用户：会话数、代码行增删、commit/PR、工具操作、按模型 token、预估成本。
 * OpenAPI: https://github.com/api-evangelist/anthropic (anthropic-claude-code-analytics-api-openapi.yml)
 */

const UsageReportSchema = z.object({
  data: z
    .array(
      z.object({
        date: z.string(),
        actor: z
          .object({ email_address: z.string().optional(), user_id: z.string().nullable().optional() })
          .optional(),
        core_metrics: z
          .object({
            num_sessions: z.number().optional(),
            lines_of_code: z
              .object({ added: z.number().optional(), removed: z.number().optional() })
              .optional(),
            commits_by_claude_code: z.number().optional(),
            pull_requests_by_claude_code: z.number().optional(),
          })
          .optional(),
        tool_actions: z.record(z.string(), z.unknown()).optional(),
        model_breakdown: z
          .array(
            z.object({
              model: z.string(),
              tokens: z
                .object({
                  input: z.number().optional(),
                  output: z.number().optional(),
                  cache_read: z.number().optional(),
                  cache_creation: z
                    .object({
                      ephemeral_5m_input_tokens: z.number().optional(),
                      ephemeral_1h_input_tokens: z.number().optional(),
                    })
                    .optional(),
                })
                .optional(),
              estimated_cost: z
                .object({ currency: z.string().optional(), amount: z.string().optional() })
                .optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  has_more: z.boolean().optional(),
  next_page: z.string().nullable().optional(),
});

type ReportRow = z.infer<typeof UsageReportSchema>["data"][number];

function rowToEvents(row: ReportRow): UsageEvent[] {
  const date = row.date.slice(0, 10);
  const events: UsageEvent[] = [];
  const actor = row.actor?.email_address ?? row.actor?.user_id ?? "unknown";
  const source = `anthropic-admin:${actor}`;

  for (const m of row.model_breakdown ?? []) {
    const t = m.tokens;
    const cacheRead = (t?.cache_read ?? 0) + (t?.cache_creation?.ephemeral_5m_input_tokens ?? 0) + (t?.cache_creation?.ephemeral_1h_input_tokens ?? 0);
    const cost = m.estimated_cost?.amount != null ? Number.parseFloat(m.estimated_cost.amount) : null;
    events.push({
      source,
      provider: "claude-code" as ProviderId,
      model: m.model,
      ts: `${date}T00:00:00.000Z`,
      date,
      inputTokens: t?.input ?? 0,
      outputTokens: t?.output ?? 0,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: 0,
      requests: 0,
      costUsd: Number.isFinite(cost ?? NaN) ? cost : null,
      extra: { currency: m.estimated_cost?.currency ?? "USD" },
    });
  }

  const core = row.core_metrics;
  if (core && (core.num_sessions || core.lines_of_code?.added || core.lines_of_code?.removed)) {
    events.push({
      source,
      provider: "claude-code" as ProviderId,
      model: "__session__",
      ts: `${date}T00:00:00.000Z`,
      date,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      requests: core.num_sessions ?? 0,
      costUsd: null,
      linesAdded: core.lines_of_code?.added ?? 0,
      linesRemoved: core.lines_of_code?.removed ?? 0,
      extra: {
        commits: core.commits_by_claude_code ?? 0,
        pullRequests: core.pull_requests_by_claude_code ?? 0,
        toolActions: row.tool_actions ?? {},
      },
    });
  }
  return events;
}

export const anthropic: ProviderConnector = {
  id: "anthropic-admin",
  name: "Claude Code (Anthropic Admin)",
  kind: "official-api",
  providers: ["claude-code"],
  describe: () =>
    "官方 Analytics API：按日/按用户返回会话数、代码行增删、commit/PR、按模型 token 与成本。需 ANTHROPIC_ADMIN_KEY（组织 Admin Key）。",

  async fetchUsage(ctx): Promise<UsageEvent[]> {
    const key = ctx.env.ANTHROPIC_ADMIN_KEY;
    if (!key) throw new Error("缺少环境变量 ANTHROPIC_ADMIN_KEY（sk-ant-admin...）");
    if (!ctx.from) throw new Error("Anthropic Admin 需要 --from 参数（起始日期）");

    const events: UsageEvent[] = [];
    let page = 1;
    let nextPage: string | null | undefined = undefined;
    const url = new URL("https://api.anthropic.com/v1/organizations/usage_report/claude_code");
    url.searchParams.set("starting_at", `${ctx.from}T00:00:00Z`);
    if (ctx.to) url.searchParams.set("ending_at", `${ctx.to}T00:00:00Z`);
    url.searchParams.set("limit", "200");

    do {
      if (page > 5) {
        console.warn("[anthropic-admin] 分页超过 5 页，截断。");
        break;
      }
      const u = new URL(url);
      if (nextPage) u.searchParams.set("page", nextPage);
      const res = await fetch(u, {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      });
      if (!res.ok) throw new Error(`usage_report/claude_code 返回 ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const parsed = UsageReportSchema.parse(await res.json());
      for (const row of parsed.data) events.push(...rowToEvents(row));
      nextPage = parsed.next_page;
      if (!parsed.has_more) break;
      page += 1;
    } while (nextPage);

    return events;
  },
};
