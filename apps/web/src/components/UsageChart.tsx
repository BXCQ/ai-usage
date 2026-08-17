import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyRow } from "../api.js";

export const PROVIDER_COLORS: Record<string, string> = {
  "claude-code": "#d97757",
  "codex": "#10a37f",
  "openai": "#10a37f",
  "deepseek": "#4d6bfe",
  "kimi": "#a78bfa",
  "cursor": "#f59e0b",
  "copilot": "#22d3ee",
  "gemini": "#60a5fa",
  "grok": "#f472b6",
  "windsurf": "#34d399",
  "other": "#737373",
};

/** 把 (date, provider, model) 明细归并为 按日 × 按 provider 的 token 序列，供堆叠面积图使用 */
export function buildDailySeries(daily: DailyRow[]) {
  const byDate = new Map<string, Record<string, number>>();
  const providers = new Set<string>();
  for (const row of daily) {
    providers.add(row.provider);
    const cur = byDate.get(row.date) ?? { date: row.date };
    const tokens = row.inputTokens + row.outputTokens + row.cacheTokens;
    cur[row.provider] = (cur[row.provider] ?? 0) + tokens;
    byDate.set(row.date, cur);
  }
  return { data: [...byDate.values()], providers: [...providers] };
}

export function UsageChart({ daily }: { daily: DailyRow[] }) {
  const { data, providers } = buildDailySeries(daily);
  if (!data.length) {
    return (
      <div className="py-16 text-center text-sm text-neutral-500">
        暂无数据 —— 先运行 <code>pnpm seed</code> 或 <code>pnpm collect</code>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {providers.map((p) => (
            <linearGradient key={p} id={"grad-" + p} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PROVIDER_COLORS[p] ?? "#737373"} stopOpacity={0.5} />
              <stop offset="100%" stopColor={PROVIDER_COLORS[p] ?? "#737373"} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis dataKey="date" tick={{ fill: "#a3a3a3", fontSize: 11 }} stroke="#404040" />
        <YAxis
          tick={{ fill: "#a3a3a3", fontSize: 11 }}
          stroke="#404040"
          tickFormatter={(v: number) => (v >= 1e6 ? v / 1e6 + "M" : v >= 1e3 ? v / 1e3 + "K" : String(v))}
        />
        <Tooltip
          contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#e5e5e5" }}
        />
        {providers.map((p) => (
          <Area
            key={p}
            type="monotone"
            dataKey={p}
            stackId="1"
            stroke={PROVIDER_COLORS[p] ?? "#737373"}
            fill={"url(#grad-" + p + ")"}
            strokeWidth={1.5}
            name={p}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
