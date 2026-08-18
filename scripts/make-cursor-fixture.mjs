import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "tests", "fixtures", "cursor");
const userRoot = path.join(root, "User");
const globalDir = path.join(userRoot, "globalStorage");
const ws = path.join(userRoot, "workspaceStorage", "ws-abc123");
const trackingDir = path.join(root, ".cursor", "ai-tracking");

for (const dir of [globalDir, ws, trackingDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

function createStateDb(dbPath, { composerId, bubbles, composerHeaders, composerData }) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS composerHeaders (
      composerId TEXT PRIMARY KEY,
      workspaceId TEXT,
      createdAt INTEGER,
      lastUpdatedAt INTEGER,
      isArchived INTEGER,
      isSubagent INTEGER,
      recency REAL,
      checkpointAt INTEGER,
      value TEXT
    );
  `);
  const ins = db.prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)");
  const insHeader = db.prepare(`
    INSERT OR REPLACE INTO composerHeaders
      (composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, recency, checkpointAt, value)
    VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)
  `);

  ins.run(
    `composerData:${composerId}`,
    JSON.stringify(
      composerData ?? {
        modelConfig: { modelName: "default" },
        promptTokenBreakdown: { totalUsedTokens: 50000 },
      },
    ),
  );

  for (const bubble of bubbles) {
    ins.run(`bubbleId:${composerId}:${bubble.bubbleId}`, JSON.stringify(bubble));
  }

  if (composerHeaders) {
    insHeader.run(
      composerId,
      "ws-abc123",
      Date.parse("2026-08-15T09:00:00.000Z"),
      Date.parse("2026-08-15T10:05:00.000Z"),
      JSON.stringify(composerHeaders),
    );
  }

  db.close();
}

// globalStorage（主数据源）
createStateDb(path.join(globalDir, "state.vscdb"), {
  composerId: "composer-1",
  composerHeaders: {
    type: "head",
    composerId: "composer-1",
    name: "demo-project",
    totalLinesAdded: 42,
    totalLinesRemoved: 7,
    workspaceIdentifier: {
      uri: { fsPath: "E:\\demo-project", path: "/E:/demo-project" },
    },
    trackedGitRepos: [{ repoPath: "E:\\demo-project" }],
  },
  bubbles: [
    {
      bubbleId: "b1",
      type: 2,
      text: "Refactored the auth module to use session tokens.",
      createdAt: "2026-08-15T10:00:00.000Z",
      tokenCount: { inputTokens: 1200, outputTokens: 300 },
      modelInfo: { modelName: "claude-sonnet-4-5" },
    },
    {
      bubbleId: "b2",
      type: 2,
      text: "Here is a fairly long response explaining the fix in detail across multiple sentences for estimation purposes.",
      thinking: { text: "Need to explain the fix clearly." },
      createdAt: "2026-08-15T10:05:00.000Z",
      tokenCount: { inputTokens: 0, outputTokens: 0 },
    },
    {
      bubbleId: "b3",
      type: 1,
      text: "please fix the bug",
      createdAt: "2026-08-15T10:00:30.000Z",
    },
  ],
});

// workspaceStorage（旧版/残留，含重复 bubble 用于去重验证）
createStateDb(path.join(ws, "state.vscdb"), {
  composerId: "composer-1",
  bubbles: [
    {
      bubbleId: "b1",
      type: 2,
      text: "shorter duplicate",
      createdAt: "2026-08-15T10:00:00.000Z",
      tokenCount: { inputTokens: 0, outputTokens: 0 },
    },
  ],
});

fs.writeFileSync(
  path.join(ws, "workspace.json"),
  JSON.stringify({ folder: "file:///E%3A/demo-project", name: "demo-project" }),
);

// ai-tracking：模型回填（composer-1 的 b2 无 modelInfo）
const trackingDb = new DatabaseSync(path.join(trackingDir, "ai-code-tracking.db"));
trackingDb.exec(`
  CREATE TABLE IF NOT EXISTS ai_code_hashes (
    hash TEXT PRIMARY KEY,
    source TEXT,
    fileExtension TEXT,
    fileName TEXT,
    requestId TEXT,
    conversationId TEXT,
    timestamp INTEGER,
    model TEXT,
    createdAt INTEGER
  );
`);
const insTrack = trackingDb.prepare(`
  INSERT OR REPLACE INTO ai_code_hashes
    (hash, source, fileExtension, fileName, requestId, conversationId, timestamp, model, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insTrack.run(
  "hash-1",
  "composer",
  ".ts",
  "src/index.ts",
  "req-1",
  "composer-1",
  Date.parse("2026-08-15T10:05:00.000Z"),
  "gpt-5.2-codex",
  Date.parse("2026-08-15T10:05:00.000Z"),
);
insTrack.run(
  "hash-2",
  "composer",
  ".ts",
  "src/app.ts",
  "req-2",
  "composer-1",
  Date.parse("2026-08-15T10:05:00.000Z"),
  "gpt-5.2-codex",
  Date.parse("2026-08-15T10:05:00.000Z"),
);
trackingDb.close();

console.log("cursor fixture created at", userRoot);
console.log("  CURSOR_USER_DATA_DIR=", userRoot);
console.log("  CURSOR_AGENT_HOME=", path.join(root, ".cursor"));
