import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { estimateCost, type ProviderId, type UsageEvent } from "@ai-usage/core";
import type { CollectContext, ProviderConnector } from "../types.js";

/**
 * Cursor —— 本地 SQLite 状态库（方式 A 的变体）。
 * 数据源：<UserData>/workspaceStorage/<workspaceId>/state.vscdb
 *   - 表 cursorDiskKV：key = composerData:<id> / bubbleId:<composerId>:<bubbleId>
 *   - assistant bubble: { type:2, tokenCount:{inputTokens,outputTokens}, modelInfo:{modelName}, text, createdAt }
 * 限制（tokentop agent-cursor 实测）：tokenCount 由服务端异步填充，新版 agent 对话常为 0，
 * 此时输出 token 按 4 字符/token 从文本估算，输入 token 记 0（extra.isEstimated=true）。
 * 参考：https://github.com/tokentopapp/agent-cursor
 */

const ASSISTANT_BUBBLE_TYPE = 2;
const CHARS_PER_TOKEN = 4;
const MAX_WORKSPACES = 200;

interface Bubble {
  bubbleId?: string;
  type?: number;
  text?: string;
  createdAt?: string;
  tokenCount?: { inputTokens?: number; outputTokens?: number };
  modelInfo?: { modelName?: string };
}

interface Composer {
  modelConfig?: { modelName?: string };
}

function userDataDir(): string | null {
  if (process.env.CURSOR_USER_DATA_DIR) return process.env.CURSOR_USER_DATA_DIR;
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "Cursor", "User");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor", "User");
  }
  return path.join(os.homedir(), ".config", "Cursor", "User");
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function estimateOutputTokens(text: string | undefined): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function validModelName(name: string | undefined): string | null {
  if (!name) return null;
  if (name === "default" || name === "?") return null;
  return name;
}

function toEvent(bubble: Bubble, composer: Composer | null, project: string): UsageEvent | null {
  const model =
    validModelName(bubble.modelInfo?.modelName) ??
    validModelName(composer?.modelConfig?.modelName) ??
    "cursor-default";
  const realInput = bubble.tokenCount?.inputTokens ?? 0;
  const realOutput = bubble.tokenCount?.outputTokens ?? 0;
  const hasReal = realInput > 0 || realOutput > 0;
  const output = hasReal ? realOutput : estimateOutputTokens(bubble.text);
  const input = hasReal ? realInput : 0;
  if (input === 0 && output === 0) return null;
  const ts = bubble.createdAt ?? "";
  return {
    source: "cursor-local",
    provider: "cursor" as ProviderId,
    model,
    ts,
    date: ts.slice(0, 10),
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requests: 1,
    costUsd: estimateCost(model, input, output),
    extra: { estimated: !hasReal, project, bubbleId: bubble.bubbleId },
  };
}

export const cursorLocal: ProviderConnector = {
  id: "cursor-local",
  name: "Cursor (本地 SQLite)",
  kind: "local-log",
  providers: ["cursor"],
  describe: () =>
    "解析 %APPDATA%/Cursor/User/workspaceStorage/**/state.vscdb：模型/时间/请求数精确；token 缺失时按 4 字符/token 估算。零配置。",

  async fetchUsage(ctx): Promise<UsageEvent[]> {
    const root = userDataDir();
    if (!root) return [];
    const wsRoot = path.join(root, "workspaceStorage");
    let dirs: string[] = [];
    try {
      dirs = fs
        .readdirSync(wsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(wsRoot, e.name))
        .slice(0, MAX_WORKSPACES);
    } catch {
      return [];
    }

    const events: UsageEvent[] = [];
    for (const wsDir of dirs) {
      const dbPath = path.join(wsDir, "state.vscdb");
      if (!fs.existsSync(dbPath)) continue;
      let project = "";
      try {
        const wj = parseJson<{ name?: string }>(fs.readFileSync(path.join(wsDir, "workspace.json"), "utf8"));
        project = wj?.name ?? "";
      } catch {
        /* workspace.json 不存在时忽略 */
      }
      let db: DatabaseSync;
      try {
        db = new DatabaseSync(dbPath);
      } catch {
        continue;
      }
      try {
        const rows = db.prepare("SELECT key FROM cursorDiskKV WHERE key LIKE ?").all("composerData:%") as { key: string }[];
        const prefix = "composerData:";
        for (const row of rows) {
          const composerId = row.key.slice(prefix.length);
          const cRow = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get("composerData:" + composerId) as
            | { value: string }
            | undefined;
          const composer: Composer | null = cRow ? parseJson(cRow.value) : null;
          const bPrefix = "bubbleId:" + composerId + ":";
          const bRows = db.prepare("SELECT key FROM cursorDiskKV WHERE key LIKE ?").all(bPrefix + "%") as { key: string }[];
          for (const bRow of bRows) {
            const vRow = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(bRow.key) as { value: string } | undefined;
            if (!vRow) continue;
            const bubble: Bubble | null = parseJson(vRow.value);
            if (!bubble || bubble.type !== ASSISTANT_BUBBLE_TYPE || !bubble.createdAt) continue;
            const ev = toEvent(bubble, composer, project);
            if (!ev) continue;
            if (ctx.from && ev.date < ctx.from) continue;
            if (ctx.to && ev.date > ctx.to) continue;
            events.push(ev);
          }
        }
      } finally {
        db.close();
      }
    }
    return events;
  },
};