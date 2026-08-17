import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { estimateCost, type ProviderId, type UsageEvent } from "@ai-usage/core";
import type { CollectContext, ProviderConnector } from "../types.js";

const MAX_FILES = 200;

interface CodexEvent {
  timestamp?: string;
  payload?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

function locateDirs(): string[] {
  const base = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  return [path.join(base, "sessions")];
}

function walkJsonl(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 4 || out.length >= MAX_FILES) return out;
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
  let obj: CodexEvent;
  try {
    obj = JSON.parse(line) as CodexEvent;
  } catch {
    return null;
  }
  const usage = obj.payload?.usage;
  const model = obj.payload?.model;
  if (!usage || typeof usage !== "object" || !model) return null;
  const ts = obj.timestamp;
  if (!ts) return null;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    source: "codex-log",
    provider: "codex" as ProviderId,
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

export const codex: ProviderConnector = {
  id: "codex-log",
  name: "Codex CLI (本地日志)",
  kind: "local-log",
  providers: ["codex"],
  describe: () =>
    "解析 ~/.codex/sessions/*.jsonl（每次响应事件的 model 与 usage）。零配置，最精确。",

  async fetchUsage(ctx): Promise<UsageEvent[]> {
    const files = locateDirs().flatMap((d) => walkJsonl(d));
    const all: UsageEvent[] = [];
    for (const f of files) all.push(...(await parseFile(f, ctx.from, ctx.to)));
    return all;
  },
};
