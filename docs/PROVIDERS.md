# 如何新增一个 Provider（15 分钟）

连接器（connector）是 ai-usage 的扩展单元。所有连接器实现同一个接口，注册后即可被采集引擎、CLI 和看板自动使用。

## 接口定义

    interface ProviderConnector {
      id: string;                  // 唯一 ID，如 "cursor-usage"
      name: string;
      kind: "official-api" | "local-log";
      providers: ProviderId[];
      fetchUsage(ctx): Promise<UsageEvent[]>;      // 用量事件
      fetchBalances?(ctx): Promise<BalanceSnapshot[]>; // 余额（可选）
      describe(): string;
    }

## 四步接入

1. 在 packages/providers/src/ 下新建文件（official/ 或 local/ 目录）。
2. 实现 ProviderConnector：
   - 本地日志：找到日志路径，逐行解析 JSONL，输出 UsageEvent（token 字段齐全，成本可交给 estimateCost）。
   - 官方 API：fetch 接口，用 zod 定义响应 schema，输出 UsageEvent / BalanceSnapshot。
3. 在 packages/providers/src/index.ts 的 connectors 数组里注册。
4. 在 tests/fixtures/ 放一段真实（脱敏）响应样例，并补一个解析单测。

## 稳定性约定（重要）

- 官方公开 API：可直接接入，标记 kind: "official-api"。
- 本地日志：最可靠，kind: "local-log"。
- 逆向接口（未公开、靠 cookie/会话）：MVP 阶段默认不接。确需接入时：
  - describe() 里注明 experimental（未公开接口，可能随时失效）；
  - zod schema 必须宽松（缺失字段走默认值，不崩溃）；
  - 必须实现降级链：明细失败 -> 余额 -> 上次快照。

## PR 清单

- [ ] zod schema 对未知字段宽容（.passthrough() / default）
- [ ] 无环境变量时抛出带说明的错误（缺少环境变量 XXX）
- [ ] 失败不影响其它连接器（由 runAll 容错）
- [ ] 附测试 fixture 与单测
- [ ] describe() 更新
- [ ] README 的数据源表更新

## 参考实现

- 官方 API：packages/providers/src/official/anthropic.ts（最全，含分页）
- 本地日志：packages/providers/src/local/claude-code.ts（JSONL 流式解析）
- 本地 SQLite：packages/providers/src/local/cursor.ts（globalStorage 主读 + workspaceStorage 兼容 + ai-tracking 模型回填）
