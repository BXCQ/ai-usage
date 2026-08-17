# ai-usage 🎚️

> 跨工具 AI 编程用量聚合：token / 调用次数 / 代码行 / 成本，按日 × 按模型汇总。
> 一个命令，把 Claude Code、Codex CLI、DeepSeek、Kimi 的用量统一到一个 Web 看板。

![badge](https://img.shields.io/badge/license-MIT-green) ![badge](https://img.shields.io/badge/node-%3E%3D22.5-blue) ![badge](https://img.shields.io/badge/PRs-welcome-brightgreen)

![screenshot](docs/screenshot.png)  <!-- 上线前替换为真实看板截图 -->

## 为什么做这个

- 额度什么时候烧完？哪个模型在吃钱？Pro 套餐值不值？
- Cursor / Codex / Claude Code / DeepSeek / Kimi 各自的数据散落在日志、控制台、账单里，没有统一视图。
- 本工具把**官方 API（稳定）+ 本地日志（精确）**双通道归一为一张表，按日期筛选、按模型下钻。

## ✨ 特性

- 📅 按日期区间筛选（7 天 / 30 天 / 90 天 / 全部，或自定义）
- 📊 按日 × 按工具堆叠图、按模型明细表
- 🪙 token（输入/输出/缓存）、调用次数、估算成本、代码行增删
- 🏠 数据只存本机 SQLite（~/.ai-usage/usage.db），隐私优先
- 🧩 连接器注册表：新增 provider 只需实现一个接口（见 docs/PROVIDERS.md）
- ⚠️ 逆向接口（Cursor 明细、Kimi 明细）默认不接入 —— 稳定第一

## 🚀 快速开始

需要 Node.js ≥ 22.5（内置 SQLite，零原生依赖）。

    pnpm install
    pnpm build        # 编译全部包
    pnpm seed         # 写入 30 天演示数据，先看效果
    pnpm dev          # 打开 http://localhost:5173

采集真实数据：

    pnpm collect                  # 本地日志零配置（Claude Code / Codex CLI）
    ANTHROPIC_ADMIN_KEY=sk-ant-admin-xxx pnpm collect -- --from 2026-01-01
    DEEPSEEK_API_KEY=sk-xxx pnpm collect

## 🛠 已支持的数据源

| 来源 | 类型 | 数据 | 配置 |
|---|---|---|---|
| Claude Code 本地日志 | 本地日志 ✅ | 每消息 token（输入/输出/缓存）+ 估算成本 | 零配置（~/.claude/projects） |
| Codex CLI 本地日志 | 本地日志 ✅ | 每次响应 token + 估算成本 | 零配置（~/.codex/sessions） |
| Cursor 本地 SQLite | 本地日志 ✅ | Composer 会话请求数；token 在新版常为 0，输入用会话上下文水位估算、输出按正文+thinking 的 4 字符/token 估算（**低于官网账单**） | 零配置只读（`User/globalStorage/state.vscdb`；兼容 workspaceStorage / Nightly / `CURSOR_USER_DATA_DIR`） |
| Anthropic Admin | 官方 API ✅ | 按日：会话数、**代码行增删**、commit/PR、按模型 token/成本 | ANTHROPIC_ADMIN_KEY |
| OpenAI Admin | 官方 API ✅ | 按日 × 按模型 token/请求/成本 | OPENAI_ADMIN_KEY |
| DeepSeek | 官方 API ✅ | 余额 | DEEPSEEK_API_KEY |
| Kimi / Moonshot | 官方 API ✅ | 余额 | MOONSHOT_API_KEY |
| Cursor / Kimi 明细等逆向接口 | 未接入 ⏸️ | — | 待稳定后再纳入（见 Roadmap） |

## 🏗 架构

    apps/web           Vite + React + Recharts + Tailwind（看板）
    apps/server        Hono（/api/stats 等只读聚合接口）
    packages/providers 连接器注册表（官方 API + 本地日志解析）
    packages/collector 采集引擎 + SQLite 存储 + CLI + 定时任务
    packages/core      统一事件模型 + 模型定价表

所有 provider 输出统一的 UsageEvent，按 (date, provider, model) 聚合成事实表。

## 🔑 环境变量

| 变量 | 用途 |
|---|---|
| ANTHROPIC_ADMIN_KEY | Claude Code Analytics（官方，需组织 Admin Key） |
| OPENAI_ADMIN_KEY | OpenAI 组织用量（官方） |
| DEEPSEEK_API_KEY / DEEPSEEK_KEY | DeepSeek 余额 |
| MOONSHOT_API_KEY / KIMI_API_KEY | Kimi 余额（MOONSHOT_REGION=china 走国内节点） |
| CLAUDE_CONFIG_DIR / CODEX_HOME | 覆盖本地日志目录（可选） |
| CURSOR_USER_DATA_DIR | 覆盖 Cursor User 目录（便携 / `--user-data-dir` 安装） |
| CURSOR_AGENT_HOME | 覆盖 `~/.cursor`（ai-tracking 模型回填，可选） |
| AI_USAGE_DB / PORT | 数据库路径 / API 端口（可选） |

## 🗺 Roadmap

1. ✅ MVP：本地日志 + 官方 API 双通道，按日/按模型看板
2. ⏳ 成本告警、套餐建议（Pro vs API 哪个划算）
3. ⏳ 逆向连接器（Cursor / Kimi 明细）以 experimental 标记接入，schema 校验 + 自动降级
4. ⏳ 团队版（Anthropic/OpenAI Admin 天然多用户）、云端同步（脱敏）

## 🤝 贡献

加一个新 provider 只需 15 分钟：见 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 📄 License

MIT

---

*如果这个项目对你有用，点个 ⭐ 就是最大的支持。*
