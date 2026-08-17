/**
 * 本地日志只给 token 不给成本时，用这张静态定价表估算（USD / 百万 token）。
 * ⚠️ 价格会变：上线前请用 LiteLLM 的价格接口或官方定价页刷新。
 * 找不到模型时返回 null（不估算，避免假数据）。
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** key 支持前缀匹配（如 "claude-opus" 匹配 "claude-opus-4-20250514"） */
const PRICES: Record<string, ModelPrice> = {
  "claude-opus": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.25, cacheWrite: 1.25 },
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  "o3": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
  "deepseek-chat": { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
  "kimi-k2": { input: 0.6, output: 2.6, cacheRead: 0.15, cacheWrite: 0.6 },
};

export function findPrice(model: string): ModelPrice | null {
  const m = model.toLowerCase();
  for (const [prefix, price] of Object.entries(PRICES)) {
    if (m.startsWith(prefix)) return price;
  }
  return null;
}

/** 按模型估算一次调用的成本（USD）；未知模型返回 null */
export function estimateCost(
  model: string,
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
): number | null {
  const p = findPrice(model);
  if (!p) return null;
  return (
    (input / 1e6) * p.input +
    (output / 1e6) * p.output +
    (cacheRead / 1e6) * p.cacheRead +
    (cacheWrite / 1e6) * p.cacheWrite
  );
}
