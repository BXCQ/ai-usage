#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listConnectors } from "@ai-usage/providers";
import { collectAll } from "./collect.js";
import { seedDemo } from "./demo.js";
import { openStore } from "./store.js";

const DEFAULT_DB = path.join(os.homedir(), ".ai-usage", "usage.db");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(name);
}

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

async function cmdCollect(dbPath: string) {
  const store = openStore(dbPath);
  try {
    if (has("--demo")) {
      const r = seedDemo(store);
      console.log(`✅ 已写入演示数据：${r.inserted} 条事件（跳过 ${r.skipped}），${r.balances} 条余额。`);
    } else {
      console.log("🔍 正在采集（本地日志零配置；官方接口需环境变量）...");
      const summary = await collectAll(store, {
        from: arg("--from"),
        to: arg("--to"),
        env: process.env,
      });
      console.log(`✅ 新增事件 ${summary.eventsInserted}，跳过去重 ${summary.eventsSkipped}，余额 ${summary.balances}`);
      if (summary.errors.length) {
        console.log("⚠️ 部分连接器失败：");
        for (const e of summary.errors) console.log(`   - ${e.connector}: ${e.message}`);
      }
      const c = store.counts();
      console.log(`📊 库内累计：${fmt(c.events)} 条事件 / ${c.balances} 条余额快照`);
    }
  } finally {
    store.close();
  }
}

function cmdStatus(dbPath: string) {
  const store = openStore(dbPath);
  try {
    const c = store.counts();
    console.log(`📊 数据库：${dbPath}`);
    console.log(`   事件 ${fmt(c.events)} 条，余额快照 ${c.balances} 条`);
    console.log("");
    console.log("按 provider 汇总（全部时间）：");
    const providers = store.getProviders({});
    if (!providers.length) {
      console.log("   （空）先运行 pnpm seed 看演示数据，或 pnpm collect 采集真实数据");
    }
    for (const p of providers) {
      console.log(
        `   ${p.provider.padEnd(12)} 输入 ${fmt(p.inputTokens).padStart(6)} 输出 ${fmt(p.outputTokens).padStart(6)} 缓存 ${fmt(p.cacheTokens).padStart(6)} 请求 ${String(p.requests).padStart(5)} 成本 $${p.costUsd.toFixed(2).padStart(8)} 代码行 +${p.linesAdded}/-${p.linesRemoved}`,
      );
    }
  } finally {
    store.close();
  }
}

function cmdConnectors() {
  console.log("已注册的连接器：");
  for (const c of listConnectors()) {
    console.log(`   [${c.id}] ${c.name} (${c.kind})`);
    console.log(`       ${c.describe}`);
  }
}

function printHelp() {
  console.log(`
ai-usage —— 跨工具 AI 编程用量聚合

用法:
  ai-usage collect [--demo] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--db path]
      采集并入库（本地日志零配置；官方接口需环境变量）
  ai-usage seed [--db path]
      写入 30 天演示数据，快速看效果
  ai-usage status [--db path]
      查看库内按 provider 汇总
  ai-usage connectors
      列出已注册连接器
  ai-usage help

环境变量:
  ANTHROPIC_ADMIN_KEY   Claude Code Analytics（官方，按日/代码行/模型 token）
  OPENAI_ADMIN_KEY      OpenAI 组织用量（官方）
  DEEPSEEK_API_KEY      DeepSeek 余额
  MOONSHOT_API_KEY      Kimi/Moonshot 余额（MOONSHOT_REGION=china 走国内节点）

默认数据库: ${DEFAULT_DB}
`);
}

async function main() {
  const dbPath = arg("--db") ?? DEFAULT_DB;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const cmd = process.argv[2] ?? "help";
  switch (cmd) {
    case "collect":
      await cmdCollect(dbPath);
      break;
    case "seed": {
      const store = openStore(dbPath);
      try {
        const r = seedDemo(store);
        console.log(`✅ 已写入演示数据：${r.inserted} 条事件（跳过 ${r.skipped}），${r.balances} 条余额。`);
      } finally {
        store.close();
      }
      break;
    }
    case "status":
      cmdStatus(dbPath);
      break;
    case "connectors":
      cmdConnectors();
      break;
    default:
      printHelp();
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
