#!/usr/bin/env node
/**
 * Bot Daemon - MCP不要のCLIモード用エントリーポイント
 * ポート3099でHTTP APIを提供し、CLIスクリプトから制御できる
 */

import { startViewerServer } from "./viewer-server.js";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const port = parseInt(process.env.VIEWER_PORT || "3099");
const PID_FILE = join(tmpdir(), `mc-daemon-${port}.pid`);

// PIDファイルで既存デーモンを強制終了（確実に1プロセスのみ）
if (existsSync(PID_FILE)) {
  const oldPid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
  if (oldPid && oldPid !== process.pid) {
    try {
      process.kill(oldPid, 0); // プロセスが存在するか確認
      console.error(`[Daemon] Killing existing daemon PID ${oldPid}`);
      process.kill(oldPid, "SIGTERM");
      await new Promise(r => setTimeout(r, 3000)); // Minecraft接続が切れるまで待つ
    } catch { /* already gone */ }
  }
}

// ポートを使っているプロセスも念のためkill（PIDファイル漏れ対策）
try {
  const result = execSync(`lsof -ti :${port} 2>/dev/null || true`).toString().trim();
  if (result) {
    const pids = result.split("\n").map(Number).filter(p => p && p !== process.pid);
    if (pids.length > 0) {
      console.error(`[Daemon] Killing stale port-holders: ${pids.join(", ")}`);
      // SIGTERM first so mineflayer can send disconnect packets to Minecraft server
      pids.forEach(pid => { try { process.kill(pid, "SIGTERM"); } catch {} });
      await new Promise(r => setTimeout(r, 3000));
      // SIGKILL any survivors
      pids.forEach(pid => { try { process.kill(pid, "SIGKILL"); } catch {} });
      await new Promise(r => setTimeout(r, 500));
    }
  }
} catch { /* lsof not available */ }

// PIDファイルを書き込む
writeFileSync(PID_FILE, String(process.pid));

const cleanup = () => {
  try { unlinkSync(PID_FILE); } catch {}
  process.exit(0);
};
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
process.on("exit", () => { try { unlinkSync(PID_FILE); } catch {} });

// Prevent pathfinder/mineflayer bugs from crashing the whole daemon
process.on("uncaughtException", (err) => {
  console.error(`[Daemon] uncaughtException (continuing): ${err.message}`);
  console.error(err.stack ?? "(no stack)");
});
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error) {
    console.error(`[Daemon] unhandledRejection (continuing): ${reason.message}`);
    console.error(reason.stack ?? "(no stack)");
  } else {
    console.error(`[Daemon] unhandledRejection (continuing): ${reason}`);
  }
});

await startViewerServer(port);

console.error(`[Daemon] Bot daemon running at http://localhost:${port} (PID ${process.pid})`);
console.error(`[Daemon] API endpoints:`);
console.error(`[Daemon]   POST /api/execute  - run bot code`);
console.error(`[Daemon]   POST /api/connect  - connect/disconnect bot`);
console.error(`[Daemon]   POST /api/chat     - send/receive chat`);
console.error(`[Daemon] CLI scripts:`);
console.error(`[Daemon]   node scripts/mc-connect.cjs localhost 25565 Claude1`);
console.error(`[Daemon]   node scripts/mc-execute.cjs "await bot.status()"`);
