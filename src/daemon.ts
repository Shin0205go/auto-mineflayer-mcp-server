#!/usr/bin/env node
/**
 * Bot Daemon - MCP不要のCLIモード用エントリーポイント
 * ポート3099でHTTP APIを提供し、CLIスクリプトから制御できる
 */

import { startViewerServer } from "./viewer-server.js";

const port = parseInt(process.env.VIEWER_PORT || "3099");

await startViewerServer(port);

console.error(`[Daemon] Bot daemon running at http://localhost:${port}`);
console.error(`[Daemon] API endpoints:`);
console.error(`[Daemon]   POST /api/execute  - run bot code`);
console.error(`[Daemon]   POST /api/connect  - connect/disconnect bot`);
console.error(`[Daemon]   POST /api/chat     - send/receive chat`);
console.error(`[Daemon] CLI scripts:`);
console.error(`[Daemon]   node scripts/mc-connect.cjs localhost 25565 Claude1`);
console.error(`[Daemon]   node scripts/mc-execute.cjs "await bot.status()"`);

process.on("SIGTERM", () => { process.exit(0); });
process.on("SIGINT", () => { process.exit(0); });
