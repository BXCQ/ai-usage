/**
 * 统一的用量事件模型 —— 所有 connector 的输出都归一到这个形状。
 * 字段含义：provider 是工具/厂商；source 是具体数据来源（如 "claude-code-log"、"anthropic-admin"）。
 */
export type ProviderId =
  | "claude-code"
  | "codex"
  | "deepseek"
  | "kimi"
  | "openai"
  | "cursor"
  | "copilot"
  | "gemini"
  | "grok"
  | "windsurf"
  | "other";

export interface UsageEvent {
  /** 数据来源标识，如 "claude-code-log" / "codex-log" / "anthropic-admin" / "openai-admin" */
  source: string;
  provider: ProviderId;
  model: string;
  /** ISO 时间戳（本地日志行的时间） */
  ts: string;
  /** YYYY-MM-DD，用于按日聚合 */
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** 本次事件代表的请求数（没有则 0） */
  requests: number;
  /** 估算成本 USD；无法估算时为 null */
  costUsd: number | null;
  /** 以下字段只有部分来源提供（如 Anthropic Admin） */
  linesAdded?: number;
  linesRemoved?: number;
  tool?: string;
  extra?: Record<string, unknown>;
}

export interface BalanceSnapshot {
  provider: ProviderId;
  capturedAt: string;
  balanceUsd: number | null;
  currency: string;
  meta: Record<string, unknown>;
}

/** 按 (date, provider, model) 聚合后的一行 */
export interface DailyRow {
  date: string;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface Totals {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
}
