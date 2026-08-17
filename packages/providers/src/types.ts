import type { BalanceSnapshot, ProviderId, UsageEvent } from "@ai-usage/core";

export type ConnectorKind = "official-api" | "local-log";

export interface CollectContext {
  /** YYYY-MM-DD；缺省表示不限 */
  from?: string;
  to?: string;
  env: NodeJS.ProcessEnv;
}

export interface ProviderConnector {
  id: string;
  name: string;
  kind: ConnectorKind;
  providers: ProviderId[];
  /** 抓取用量事件（本地日志解析或官方用量接口） */
  fetchUsage(ctx: CollectContext): Promise<UsageEvent[]>;
  /** 抓取余额/额度快照（可选） */
  fetchBalances?(ctx: CollectContext): Promise<BalanceSnapshot[]>;
  /** 给 CLI / UI 展示的说明 */
  describe(): string;
}

export interface CollectResult {
  events: UsageEvent[];
  balances: BalanceSnapshot[];
  errors: { connector: string; message: string }[];
}
