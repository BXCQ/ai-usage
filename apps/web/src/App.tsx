import { useEffect, useState } from "react";
import {
  collect,
  fetchBalances,
  fetchModels,
  fetchProviders,
  fetchStats,
  type BalanceRow,
  type DailyRow,
  type ModelRow,
  type ProviderRow,
  type Range,
  type Totals,
} from "./api.js";
import { KpiCard } from "./components/KpiCard.js";
import { ModelTable } from "./components/ModelTable.js";
import { PROVIDER_COLORS, UsageChart } from "./components/UsageChart.js";

const PRESETS = [
  { key: "7d", label: "7 天", days: 7 },
  { key: "30d", label: "30 天", days: 30 },
  { key: "90d", label: "90 天", days: 90 },
  { key: "all", label: "全部", days: 0 },
] as const;

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  const [from, setFrom] = useState<string | undefined>(daysAgo(30));
  const [to, setTo] = useState<string | undefined>(undefined);
  const [preset, setPreset] = useState<string>("30d");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range: Range = { from, to };

  const loadData = async (r: Range = range) => {
    const [s, m, p, b] = await Promise.all([
      fetchStats(r),
      fetchModels(r),
      fetchProviders(r),
      fetchBalances(),
    ]);
    setTotals(s.totals);
    setDaily(s.daily);
    setModels(m.models);
    setProviders(p.providers);
    setBalances(b.balances);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadData(range)
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const applyPreset = (days: number, key: string) => {
    setPreset(key);
    setFrom(days === 0 ? undefined : daysAgo(days));
    setTo(undefined);
  };

  const onReload = async () => {
    setReloading(true);
    setError(null);
    try {
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReloading(false);
    }
  };

  const onCollect = async () => {
    setCollecting(true);
    setError(null);
    try {
      const summary = await collect();
      await loadData();
      alert(
        "采集完成\n新增事件 " +
          summary.eventsInserted +
          "，跳过 " +
          summary.eventsSkipped +
          (summary.errors.length
            ? "\n⚠️ " + summary.errors.map((e) => e.connector + ": " + e.message).join("\n")
            : ""),
      );
    } catch (e) {
      setError("采集失败: " + (e as Error).message);
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ai-usage</h1>
          <p className="mt-1 text-sm text-neutral-400">
            跨工具 AI 编程用量聚合 —— token / 请求 / 代码行 / 成本，按日与按模型
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReload}
            disabled={reloading || collecting}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
          >
            {reloading ? "刷新中…" : "刷新"}
          </button>
          <button
            onClick={onCollect}
            disabled={reloading || collecting}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {collecting ? "采集中…" : "重新采集"}
          </button>
        </div>
      </div>

      {/* Range filter */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.days, p.key)}
            className={
              "rounded-full px-3 py-1 text-sm " +
              (preset === p.key ? "bg-neutral-200 text-neutral-900" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700")
            }
          >
            {p.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-sm text-neutral-400">
          <input
            type="date"
            value={from ?? ""}
            onChange={(e) => {
              setPreset("");
              setFrom(e.target.value || undefined);
            }}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
          />
          <span>至</span>
          <input
            type="date"
            value={to ?? ""}
            onChange={(e) => {
              setPreset("");
              setTo(e.target.value || undefined);
            }}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
          />
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">{error}</div>
      ) : null}

      {/* KPIs */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="总 Token"
          value={totals ? fmt(totals.inputTokens + totals.outputTokens + totals.cacheTokens) : "—"}
          sub={
            totals
              ? "输入 " + fmt(totals.inputTokens) + " · 输出 " + fmt(totals.outputTokens) + " · 缓存 " + fmt(totals.cacheTokens)
              : undefined
          }
        />
        <KpiCard
          label="调用次数"
          value={totals ? fmt(totals.requests) : "—"}
          sub={totals ? "含会话级汇总" : undefined}
          accent="text-sky-400"
        />
        <KpiCard
          label="估算成本"
          value={totals ? "$" + totals.costUsd.toFixed(2) : "—"}
          sub="USD；Cursor 本地估算不计输入单价"
          accent="text-amber-400"
        />
        <KpiCard
          label="代码行"
          value={totals ? "+" + fmt(totals.linesAdded) + " / -" + fmt(totals.linesRemoved) : "—"}
          sub="仅官方/本地日志来源"
          accent="text-violet-400"
        />
      </div>

      {/* Chart */}
      <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">每日 Token 用量（按工具堆叠）</h2>
        {loading ? <div className="py-16 text-center text-sm text-neutral-500">加载中…</div> : <UsageChart daily={daily} />}
      </div>

      {/* Providers + Models */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-300">按工具</h2>
          {loading ? <div className="text-sm text-neutral-500">加载中…</div> : (
            <div className="space-y-3">
              {providers.map((p) => (
                <div key={p.provider}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: PROVIDER_COLORS[p.provider] ?? "#737373" }}
                      />
                      {p.provider}
                    </span>
                    <span className="tabular-nums text-neutral-300">{"$" + p.costUsd.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {fmt(p.inputTokens + p.outputTokens + p.cacheTokens)} token · {fmt(p.requests)} 请求 · {p.events} 条记录
                  </div>
                </div>
              ))}
              {!providers.length ? <div className="text-sm text-neutral-500">暂无数据</div> : null}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-neutral-300">按模型</h2>
          {loading ? <div className="text-sm text-neutral-500">加载中…</div> : <ModelTable models={models} />}
        </div>
      </div>

      {/* Balances */}
      <div className="mt-6 flex flex-wrap gap-3">
        {balances.map((b) => (
          <div key={b.provider} className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
            <div className="text-xs text-neutral-400">{b.provider} 余额</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {b.balanceUsd != null ? (b.currency === "CNY" ? "¥" : "$") + b.balanceUsd.toFixed(2) : "—"}
            </div>
          </div>
        ))}
        {!balances.length ? (
          <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-3 text-sm text-neutral-500">
            暂无余额数据（官方接口需环境变量 API Key）
          </div>
        ) : null}
      </div>

      <footer className="mt-10 text-center text-xs text-neutral-600">
        数据仅存本机 SQLite（~/.ai-usage/usage.db）· Cursor 本地 token 为估算（官网个人中心是服务端账单，数量会更高）· MIT License
      </footer>
    </div>
  );
}
