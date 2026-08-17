import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { estimateCost, type ProviderId, type UsageEvent } from "@ai-usage/core";
import type { CollectContext, ProviderConnector } from "../types.js";

/** 单目录最多扫描的文件数（防止机器上日志爆炸拖慢采集） */
const MAX_FILES = 200;

interface ClaudeMessage {
  message?: {
    model?: string;
    timestamp?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  timestamp?: string;
}

function locateDirs(): string[] {
  const base = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  return [path.join(base, "projects")];
}

function walkJsonl(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || out.length >= MAX_FILES) return out;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out, depth + 1);
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

function parseLine(line: string): UsageEvent | null {
  if (!line.trim()) return null;
  let obj: ClaudeMessage;
  try {
    obj = JSON.parse(line) as ClaudeMessage;
  } catch {
    return null;
  }
  const usage = obj.message?.usage;
  const model = obj.message?.model;
  if (!usage || typeof usage !== "object" || !model) return null;
  const ts = obj.message?.timestamp ?? obj.timestamp;
  if (!ts) return null;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    source: "claude-code-log",
    provider: "claude-code" as ProviderId,
    model,
    ts,
    date: String(ts).slice(0, 10),
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    requests: 1,
    costUsd: estimateCost(model, input, output, cacheRead, cacheWrite),
  };
}

async function parseFile(file: string, from?: string, to?: string): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }) });
  for await (const line of rl) {
    const ev = parseLine(line);
    if (!ev) continue;
    if (from && ev.date < from) continue;
    if (to && ev.date > to) continue;
    events.push(ev);
  }
  return events;
}

export const claudeCode: ProviderConnector = {
  id: "claude-code-log",
  name: "Claude Code (本地日志)",
  kind: "local-log",
  providers: ["claude-code"],
  describe: () =>
    "解析 ~/.claude/projects/**/*.jsonl（每消息 input/output/cache token）。零配置，最精确。",

  async fetchUsage(ctx): Promise<UsageEvent[]> {
    const files = locateDirs().flatMap((d) => walkJsonl(d));
    const all: UsageEvent[] = [];
    for (const f of files) all.push(...(await parseFile(f, ctx.from, ctx.to)));
    return all;
  },
};
