export interface Totals {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface DailyRow {
  date: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface ModelRow {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface ProviderRow {
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
  events: number;
}

export interface BalanceRow {
  provider: string;
  capturedAt: string;
  balanceUsd: number | null;
  currency: string;
  meta: string | null;
}

export interface Range {
  from?: string;
  to?: string;
  provider?: string;
  model?: string;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status + " " + (await r.text()));
  return r.json() as Promise<T>;
}

function toQuery(range: Range): string {
  const p = new URLSearchParams();
  if (range.from) p.set("from", range.from);
  if (range.to) p.set("to", range.to);
  if (range.provider) p.set("provider", range.provider);
  if (range.model) p.set("model", range.model);
  const s = p.toString();
  return s ? "?" + s : "";
}

export const fetchStats = (r: Range) => get<{ totals: Totals; daily: DailyRow[] }>("/api/stats" + toQuery(r));
export const fetchModels = (r: Range) => get<{ models: ModelRow[] }>("/api/models" + toQuery(r));
export const fetchProviders = (r: Range) => get<{ providers: ProviderRow[] }>("/api/providers" + toQuery(r));
export const fetchBalances = () => get<{ balances: BalanceRow[] }>("/api/balances");
export const refresh = () =>
  get<{ eventsInserted: number; eventsSkipped: number; errors: { connector: string; message: string }[] }>("/api/refresh");
