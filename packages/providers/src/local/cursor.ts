import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { estimateCost, type ProviderId, type UsageEvent } from "@ai-usage/core";
import type { CollectContext, ProviderConnector } from "../types.js";

/**
 * Cursor —— 本地 SQLite 状态库（严格只读，不修改 Cursor 任何本地文件）。
 * 仅执行 SELECT；数据库以 readOnly + mode=ro 打开，不写 WAL、不 checkpoint。
 * 主数据源：globalStorage/state.vscdb（新版 Cursor 的 composer/bubble 在此）
 * 辅数据源：workspaceStorage 下各 workspace 的 state.vscdb（旧版/残留）
 * 模型回填：~/.cursor/ai-tracking/ai-code-tracking.db（只读）
 * 参考：https://github.com/tokentopapp/agent-cursor
 */

const ASSISTANT_BUBBLE_TYPES = new Set([0, 2]);
const CHARS_PER_TOKEN = 4;
const MAX_WORKSPACES = 200;
const PRODUCT_NAMES = ["Cursor", "Cursor Nightly"] as const;

interface Bubble {
  bubbleId?: string;
  type?: number;
  text?: string;
  thinking?: { text?: string };
  createdAt?: string;
  tokenCount?: { inputTokens?: number; outputTokens?: number };
  modelInfo?: { modelName?: string };
}

interface Composer {
  modelConfig?: { modelName?: string; selectedModels?: { modelId?: string }[] };
  promptTokenBreakdown?: { totalUsedTokens?: number };
  contextTokensUsed?: number;
}

interface ComposerHeader {
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
  workspaceIdentifier?: {
    uri?: { fsPath?: string; path?: string };
  };
  trackedGitRepos?: { repoPath?: string }[];
}

interface ComposerMeta {
  project: string;
  linesAdded?: number;
  linesRemoved?: number;
}

interface StateDbRef {
  dbPath: string;
  kind: "global" | "workspace";
  workspaceProject?: string;
}

function realPathSafe(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** 将 user-data-dir 或 User 目录规范化为 .../User */
function normalizeUserDir(raw: string): string {
  const resolved = path.resolve(raw);
  if (path.basename(resolved) === "User") return resolved;
  const userChild = path.join(resolved, "User");
  if (fs.existsSync(userChild)) return userChild;
  return resolved;
}

/** 发现所有 Cursor User 根目录（标准 / Nightly / 便携 / env 覆盖） */
export function discoverUserRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  const add = (raw?: string) => {
    if (!raw) return;
    const userDir = normalizeUserDir(raw);
    if (!fs.existsSync(userDir)) return;
    const key = realPathSafe(userDir);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(userDir);
  };

  add(env.CURSOR_USER_DATA_DIR);

  for (const portable of [env.VSCODE_PORTABLE, env.CURSOR_PORTABLE]) {
    if (!portable) continue;
    add(path.join(portable, "user-data"));
    add(portable);
  }

  if (process.platform === "win32") {
    const base = env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    for (const name of PRODUCT_NAMES) add(path.join(base, name, "User"));
  } else if (process.platform === "darwin") {
    const base = path.join(os.homedir(), "Library", "Application Support");
    for (const name of PRODUCT_NAMES) add(path.join(base, name, "User"));
  } else {
    const base = path.join(os.homedir(), ".config");
    for (const name of PRODUCT_NAMES) add(path.join(base, name, "User"));
  }

  return roots;
}

/** Agent 家目录（ai-tracking 等），不当作 state.vscdb 根 */
export function discoverAgentHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CURSOR_AGENT_HOME) return env.CURSOR_AGENT_HOME;
  return path.join(os.homedir(), ".cursor");
}

/** 发现 state.vscdb：globalStorage 优先，workspaceStorage 为辅 */
export function discoverStateDatabases(userRoots: string[]): StateDbRef[] {
  const seen = new Set<string>();
  const refs: StateDbRef[] = [];
  const add = (dbPath: string, kind: StateDbRef["kind"], workspaceProject?: string) => {
    if (!fs.existsSync(dbPath)) return;
    const key = realPathSafe(dbPath);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ dbPath, kind, workspaceProject });
  };

  for (const root of userRoots) {
    add(path.join(root, "globalStorage", "state.vscdb"), "global");
  }

  for (const root of userRoots) {
    const wsRoot = path.join(root, "workspaceStorage");
    let dirs: string[] = [];
    try {
      dirs = fs
        .readdirSync(wsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(wsRoot, e.name))
        .slice(0, MAX_WORKSPACES);
    } catch {
      continue;
    }
    for (const wsDir of dirs) {
      let project = "";
      try {
        const wj = parseJson<{ folder?: string; name?: string }>(
          fs.readFileSync(path.join(wsDir, "workspace.json"), "utf8"),
        );
        if (wj?.folder) {
          try {
            project = decodeURIComponent(new URL(wj.folder).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
          } catch {
            project = wj.folder;
          }
        }
        if (!project) project = wj?.name ?? "";
      } catch {
        /* workspace.json 不存在时忽略 */
      }
      add(path.join(wsDir, "state.vscdb"), "workspace", project);
    }
  }

  return refs;
}

function decodeValue(raw: string | Uint8Array | Buffer | null | undefined): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  return Buffer.from(raw).toString("utf8");
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseJsonValue<T>(raw: string | Uint8Array | Buffer | null | undefined): T | null {
  const text = decodeValue(raw);
  if (text == null || text.length === 0) return null;
  return parseJson<T>(text);
}

/** SQLite 只读 URI（Windows 路径转斜杠） */
function sqliteRoUri(dbPath: string, query: string): string {
  const normalized = dbPath.replace(/\\/g, "/");
  return normalized.includes("?") ? `${normalized}&${query}` : `${normalized}?${query}`;
}

/** 以多种只读方式尝试打开，避免对 Cursor 数据库产生任何写入 */
function openReadOnlyDb(dbPath: string): DatabaseSync {
  const attempts: (() => DatabaseSync)[] = [
    () => new DatabaseSync(sqliteRoUri(dbPath, "mode=ro"), { readOnly: true }),
    () => new DatabaseSync(dbPath, { readOnly: true }),
    () => new DatabaseSync(sqliteRoUri(dbPath, "immutable=1"), { readOnly: true }),
  ];
  for (const open of attempts) {
    try {
      return open();
    } catch {
      /* 尝试下一种只读打开方式 */
    }
  }
  throw new Error(`无法以只读方式打开: ${dbPath}`);
}

function estimateOutputTokens(text: string | undefined): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** 可见回复文本：正文 + thinking（工具气泡常无 text） */
function bubbleVisibleText(bubble: Bubble): string {
  const parts: string[] = [];
  if (bubble.text) parts.push(bubble.text);
  if (bubble.thinking?.text) parts.push(bubble.thinking.text);
  return parts.join("\n");
}

/** 会话上下文水位：官网账单的本地近似（最新快照，不是每轮累加） */
function contextMeter(composer: Composer | null): number {
  const fromBreakdown = composer?.promptTokenBreakdown?.totalUsedTokens ?? 0;
  if (fromBreakdown > 0) return fromBreakdown;
  return composer?.contextTokensUsed ?? 0;
}

function validModelName(name: string | undefined): string | null {
  if (!name) return null;
  if (name === "default" || name === "?") return null;
  return name;
}

function loadComposerHeaders(db: DatabaseSync): Map<string, ComposerMeta> {
  const map = new Map<string, ComposerMeta>();
  let hasTable = false;
  try {
    hasTable = !!db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'composerHeaders'")
      .get();
  } catch {
    return map;
  }
  if (!hasTable) return map;

  const rows = db.prepare("SELECT composerId, value FROM composerHeaders").all() as {
    composerId: string;
    value: string | Uint8Array;
  }[];
  for (const row of rows) {
    const header = parseJsonValue<ComposerHeader>(row.value);
    if (!header) continue;
    let project = header.workspaceIdentifier?.uri?.fsPath ?? header.workspaceIdentifier?.uri?.path ?? "";
    if (!project && header.trackedGitRepos?.[0]?.repoPath) {
      project = header.trackedGitRepos[0].repoPath;
    }
    map.set(row.composerId, {
      project,
      linesAdded: header.totalLinesAdded,
      linesRemoved: header.totalLinesRemoved,
    });
  }
  return map;
}

/** 从 ai-tracking 按 conversationId 聚合最常见模型 */
export function loadModelHintsFromTracking(agentHome: string): Map<string, string> {
  const dbPath = path.join(agentHome, "ai-tracking", "ai-code-tracking.db");
  const map = new Map<string, string>();
  if (!fs.existsSync(dbPath)) return map;

  let db: DatabaseSync;
  try {
    db = openReadOnlyDb(dbPath);
  } catch {
    return map;
  }

  try {
    const hasTable = !!db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_code_hashes'")
      .get();
    if (!hasTable) return map;

    const rows = db
      .prepare(`
        SELECT conversationId, model, COUNT(*) AS c
        FROM ai_code_hashes
        WHERE conversationId IS NOT NULL
          AND model IS NOT NULL
          AND model != ''
          AND model != 'default'
        GROUP BY conversationId, model
        ORDER BY conversationId, c DESC
      `)
      .all() as { conversationId: string; model: string; c: number }[];

    for (const row of rows) {
      if (!map.has(row.conversationId)) map.set(row.conversationId, row.model);
    }
  } catch {
    /* 表结构变化时静默降级 */
  } finally {
    db.close();
  }

  return map;
}

function resolveModel(
  bubble: Bubble,
  composer: Composer | null,
  composerId: string,
  modelHints: Map<string, string>,
): string {
  return (
    validModelName(bubble.modelInfo?.modelName) ??
    validModelName(composer?.modelConfig?.selectedModels?.[0]?.modelId) ??
    validModelName(composer?.modelConfig?.modelName) ??
    validModelName(modelHints.get(composerId)) ??
    "cursor-default"
  );
}

function toEvent(
  bubble: Bubble,
  composer: Composer | null,
  composerId: string,
  meta: ComposerMeta | undefined,
  fallbackProject: string,
  modelHints: Map<string, string>,
): UsageEvent | null {
  const project = meta?.project || fallbackProject;
  const model = resolveModel(bubble, composer, composerId, modelHints);
  const visible = bubbleVisibleText(bubble);
  const realInput = bubble.tokenCount?.inputTokens ?? 0;
  const realOutput = bubble.tokenCount?.outputTokens ?? 0;
  const hasReal = realInput > 0 || realOutput > 0;
  const output = hasReal ? realOutput : estimateOutputTokens(visible);
  const meter = contextMeter(composer);
  // 只给有正文的 assistant 回复挂上下文水位；thinking/工具气泡只计输出，避免同一水位乘很多轮
  const input = hasReal ? realInput : bubble.text && bubble.text.length > 0 ? meter : 0;
  if (input === 0 && output === 0) return null;
  const ts = bubble.createdAt ?? "";
  const estimated = !hasReal;
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
    // 上下文水位不是官方计费明细，不按 API 单价去乘输入
    costUsd: hasReal ? estimateCost(model, input, output) : estimateCost(model, 0, output),
    extra: {
      estimated,
      inputFromContextMeter: estimated && input > 0,
      project,
      bubbleId: bubble.bubbleId,
      composerId,
      linesAdded: meta?.linesAdded,
      linesRemoved: meta?.linesRemoved,
      textLen: visible.length,
    },
  };
}

function eventScore(ev: UsageEvent): number {
  const extra = ev.extra as Record<string, unknown> | undefined;
  let score = 0;
  if (extra?.estimated === false) score += 100;
  if (typeof extra?.textLen === "number") score += extra.textLen;
  if (extra?.project) score += 10;
  return score;
}

function dedupeKey(ev: UsageEvent): string | null {
  const extra = ev.extra as Record<string, unknown> | undefined;
  const composerId = extra?.composerId;
  const bubbleId = extra?.bubbleId;
  if (typeof composerId === "string" && typeof bubbleId === "string") {
    return `${composerId}:${bubbleId}`;
  }
  return null;
}

/** 跨 global/workspace 去重：优先真实 token / 更长文本 / 有项目路径 */
export function dedupeEvents(events: UsageEvent[]): UsageEvent[] {
  const byKey = new Map<string, UsageEvent>();
  const unkeyed: UsageEvent[] = [];

  for (const ev of events) {
    const key = dedupeKey(ev);
    if (!key) {
      unkeyed.push(ev);
      continue;
    }
    const prev = byKey.get(key);
    if (!prev || eventScore(ev) > eventScore(prev)) byKey.set(key, ev);
  }

  return [...byKey.values(), ...unkeyed];
}

function parseStateDatabase(
  ref: StateDbRef,
  ctx: CollectContext,
  modelHints: Map<string, string>,
): UsageEvent[] {
  let db: DatabaseSync;
  try {
    db = openReadOnlyDb(ref.dbPath);
  } catch {
    return [];
  }

  const events: UsageEvent[] = [];
  try {
    const hasKv = !!db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cursorDiskKV'")
      .get();
    if (!hasKv) return [];

    const headers = loadComposerHeaders(db);
    const composerRows = db
      .prepare("SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
      .all() as { key: string }[];

    for (const row of composerRows) {
      const composerId = row.key.slice("composerData:".length);
      const cRow = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(row.key) as
        | { value: string | Uint8Array }
        | undefined;
      const composer = cRow ? parseJsonValue<Composer>(cRow.value) : null;
      const meta = headers.get(composerId);
      const fallbackProject = ref.kind === "workspace" ? (ref.workspaceProject ?? "") : "";

      const bPrefix = `bubbleId:${composerId}:`;
      const bRows = db
        .prepare("SELECT key FROM cursorDiskKV WHERE key LIKE ?")
        .all(bPrefix + "%") as { key: string }[];

      for (const bRow of bRows) {
        const vRow = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(bRow.key) as
          | { value: string | Uint8Array }
          | undefined;
        if (!vRow) continue;
        const bubble = parseJsonValue<Bubble>(vRow.value);
        if (!bubble || bubble.type === undefined || !ASSISTANT_BUBBLE_TYPES.has(bubble.type) || !bubble.createdAt) {
          continue;
        }
        const ev = toEvent(bubble, composer, composerId, meta, fallbackProject, modelHints);
        if (!ev) continue;
        if (ctx.from && ev.date < ctx.from) continue;
        if (ctx.to && ev.date > ctx.to) continue;
        events.push(ev);
      }
    }
  } finally {
    db.close();
  }

  return events;
}

export const cursorLocal: ProviderConnector = {
  id: "cursor-local",
  name: "Cursor (本地 SQLite)",
  kind: "local-log",
  providers: ["cursor"],
  describe: () =>
    "只读解析 Cursor 本地 state.vscdb（不改任何 Cursor 文件）。新版 bubble.tokenCount 常为 0：输出按正文+thinking 的 4 字符/token 估算，输入用会话上下文水位（promptTokenBreakdown / contextTokensUsed）。这是本地近似，会低于官网个人中心的账单 token。",

  async fetchUsage(ctx): Promise<UsageEvent[]> {
    const userRoots = discoverUserRoots(ctx.env);
    if (userRoots.length === 0) return [];

    const agentHome = discoverAgentHome(ctx.env);
    const modelHints = loadModelHintsFromTracking(agentHome);
    const dbRefs = discoverStateDatabases(userRoots);
    if (dbRefs.length === 0) return [];

    const events: UsageEvent[] = [];
    for (const ref of dbRefs) {
      events.push(...parseStateDatabase(ref, ctx, modelHints));
    }

    return dedupeEvents(events);
  },
};
