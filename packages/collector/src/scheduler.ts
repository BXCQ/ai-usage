import chokidar from "chokidar";
import cron from "node-cron";
import path from "node:path";
import os from "node:os";
import { collectAll } from "./collect.js";
import { openStore, type Store } from "./store.js";

/**
 * 常驻调度：
 * 1) 每天 08:00 全量采集一次（官方接口 + 本地日志）；
 * 2) 监听本地日志目录，文件变更时增量重采（防抖 5s）。
 * MVP 阶段先提供骨架，正式版建议拆成独立 daemon + 事件总线。
 */
export function startScheduler(dbPath: string, opts: { env: NodeJS.ProcessEnv; log?: (s: string) => void } = { env: process.env }) {
  const log = opts.log ?? ((s: string) => console.log(s));
  const store: Store = openStore(dbPath);

  const run = async (label: string) => {
    try {
      const summary = await collectAll(store, { env: opts.env });
      log(`[scheduler] ${label}: 新增事件 ${summary.eventsInserted}，余额 ${summary.balances}`);
      if (summary.errors.length) {
        for (const e of summary.errors) log(`[scheduler]   ⚠️ ${e.connector}: ${e.message}`);
      }
    } catch (e) {
      log(`[scheduler] ${label} 失败: ${(e as Error).message}`);
    }
  };

  const daily = cron.schedule("0 8 * * *", () => void run("每日采集"), { timezone: "Asia/Shanghai" });

  const watched = [
    path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects"),
    path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "sessions"),
  ];
  let timer: NodeJS.Timeout | undefined;
  const watcher = chokidar.watch(watched, {
    ignoreInitial: true,
    depth: 6,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 250 },
  });
  watcher.on("all", (_ev, p) => {
    if (!p.endsWith(".jsonl")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run("日志变更"), 5000);
  });

  log(`[scheduler] 已启动：每日 08:00 采集 + 监听 ${watched.length} 个日志目录。Ctrl+C 退出。`);
  return {
    store,
    stop() {
      daily.stop();
      void watcher.close();
      store.close();
    },
  };
}
