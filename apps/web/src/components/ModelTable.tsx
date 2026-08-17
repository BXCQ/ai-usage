import type { ModelRow } from "../api.js";
import { PROVIDER_COLORS } from "./UsageChart.js";

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export function ModelTable({ models }: { models: ModelRow[] }) {
  if (!models.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-900 text-xs text-neutral-400">
          <tr>
            <th className="px-3 py-2">模型</th>
            <th className="px-3 py-2">来源</th>
            <th className="px-3 py-2 text-right">输入</th>
            <th className="px-3 py-2 text-right">输出</th>
            <th className="px-3 py-2 text-right">缓存</th>
            <th className="px-3 py-2 text-right">请求</th>
            <th className="px-3 py-2 text-right">成本</th>
            <th className="px-3 py-2 text-right">代码行</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {models.map((m) => (
            <tr key={m.model} className="hover:bg-neutral-900/50">
              <td className="px-3 py-2 font-medium text-neutral-100">{m.model}</td>
              <td className="px-3 py-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                  style={{
                    color: PROVIDER_COLORS[m.provider] ?? "#737373",
                    background: (PROVIDER_COLORS[m.provider] ?? "#737373") + "1a",
                  }}
                >
                  {m.provider}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(m.inputTokens)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(m.outputTokens)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(m.cacheTokens)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(m.requests)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{"$" + m.costUsd.toFixed(2)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-400">
                {m.linesAdded || m.linesRemoved ? "+" + m.linesAdded + "/-" + m.linesRemoved : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
