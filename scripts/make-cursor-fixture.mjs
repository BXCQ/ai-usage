import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "tests", "fixtures", "cursor");
const ws = path.join(root, "workspaceStorage", "ws-abc123");
fs.mkdirSync(ws, { recursive: true });

const db = new DatabaseSync(path.join(ws, "state.vscdb"));
db.exec("CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
const ins = db.prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)");

// composer 元数据（会话级模型配置）
ins.run("composerData:composer-1", JSON.stringify({ modelConfig: { modelName: "claude-sonnet-4-5" } }));

// bubble 1：真实 token（服务端已填充）
ins.run(
  "bubbleId:composer-1:b1",
  JSON.stringify({
    bubbleId: "b1",
    type: 2,
    text: "Refactored the auth module to use session tokens.",
    createdAt: "2026-08-15T10:00:00.000Z",
    tokenCount: { inputTokens: 1200, outputTokens: 300 },
    modelInfo: { modelName: "claude-sonnet-4-5" },
  }),
);

// bubble 2：无 tokenCount（新版 agent 对话常见）→ 走估算路径
ins.run(
  "bubbleId:composer-1:b2",
  JSON.stringify({
    bubbleId: "b2",
    type: 2,
    text: "Here is a fairly long response explaining the fix in detail across multiple sentences for estimation purposes.",
    createdAt: "2026-08-15T10:05:00.000Z",
    modelInfo: { modelName: "gpt-5.2-codex" },
  }),
);

// bubble 3：用户消息（type=1），应被跳过
ins.run("bubbleId:composer-1:b3", JSON.stringify({ bubbleId: "b3", type: 1, text: "please fix the bug", createdAt: "2026-08-15T10:00:30.000Z" }));

db.close();

fs.writeFileSync(path.join(ws, "workspace.json"), JSON.stringify({ name: "demo-project" }));
console.log("cursor fixture created at", ws);
