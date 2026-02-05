#!/usr/bin/env node

/**
 * Claude Autonomous Agent
 *
 * Uses WebSocket MCP for persistent bot connection.
 * Autonomous agent using WebSocket MCP.
 */

import "dotenv/config";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";
import WebSocket from "ws";
import { ClaudeClient } from "./claude-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, "..", "..");
const MCP_WS_SERVER = join(projectRoot, "dist", "mcp-ws-server.js");

const MC_HOST = process.env.MC_HOST || "localhost";
const MC_PORT = parseInt(process.env.MC_PORT || "25565");
const MCP_WS_URL = process.env.MCP_WS_URL || "ws://localhost:8765";
const START_MCP_SERVER = process.env.START_MCP_SERVER !== "false";
const BOT_USERNAME = process.env.BOT_USERNAME || "Claude";  // Can override with env var

// Colors for terminal output
const C = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};
const PREFIX = `${C.cyan}[Agent]${C.reset}`;

let mcpServer: ChildProcess | null = null;

async function checkMCPServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(MCP_WS_URL);
    ws.on("open", () => {
      ws.close();
      resolve(true);
    });
    ws.on("error", () => {
      resolve(false);
    });
    setTimeout(() => resolve(false), 1000);
  });
}

function startMCPServer(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    if (!START_MCP_SERVER) {
      console.log(`${PREFIX} Skipping MCP server start (START_MCP_SERVER=false)`);
      resolve();
      return;
    }

    // Check if already running
    const alreadyRunning = await checkMCPServerRunning();
    if (alreadyRunning) {
      console.log(`${PREFIX} MCP server already running at ${MCP_WS_URL}`);
      resolve();
      return;
    }

    console.log(`${PREFIX} Starting MCP WebSocket server...`);

    mcpServer = spawn("node", [MCP_WS_SERVER], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BOT_USERNAME },
    });

    mcpServer.stdout?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text.includes("[MCP-WS-Server]")) {
        console.log(text);
      }
      if (text.includes("running on ws://")) {
        resolve();
      }
    });

    mcpServer.stderr?.on("data", (data: Buffer) => {
      console.error(`[MCP-WS] ${data.toString().trim()}`);
    });

    mcpServer.on("error", reject);

    mcpServer.on("exit", (code) => {
      console.log(`[MCP-WS] Server exited with code ${code}`);
      mcpServer = null;
    });

    // Timeout fallback
    setTimeout(resolve, 3000);
  });
}

class ClaudeAgent {
  private claude: ClaudeClient;
  private isRunning = false;

  constructor() {
    this.claude = new ClaudeClient({
      maxTurns: 50,
      mcpServerUrl: MCP_WS_URL,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.claude.on("text", (_text: string) => {
      // Already logged in runQuery
    });

    this.claude.on("tool_use", (_name: string, _input: unknown) => {
      // Already logged in runQuery
    });

    this.claude.on("error", (error: Error) => {
      console.error(`${PREFIX} ${C.red}Error:${C.reset}`, error.message);
    });
  }

  async start(): Promise<void> {
    console.log(`${PREFIX} Starting Claude Agent...`);
    console.log(`${PREFIX} Target Minecraft server: ${MC_HOST}:${MC_PORT}`);
    console.log(`${PREFIX} MCP Bridge will connect to: ${MCP_WS_URL}`);

    this.isRunning = true;

    // Load learned optimization rules (high priority only, max 30)
    let learnedRules = "";
    try {
      const rulesPath = join(projectRoot, "learning", "rules.json");
      const rulesData = JSON.parse(readFileSync(rulesPath, "utf-8"));
      if (rulesData.rules && rulesData.rules.length > 0) {
        const MAX_RULES = 30;
        const filteredRules = rulesData.rules
          .filter((r: any) => r.priority === "high")
          .slice(0, MAX_RULES);

        if (filteredRules.length > 0) {
          learnedRules = filteredRules
            .map((r: any) => `- ${r.rule}`)
            .join("\n");
          console.log(`${PREFIX} Loaded ${filteredRules.length} high-priority rules`);
        }
      }
    } catch {
      // Rules file doesn't exist yet - that's fine
    }

    // Initial prompt - simple autonomous mode
    const initialPrompt = `接続: host=${MC_HOST}, port=${MC_PORT}, username=${BOT_USERNAME}（変更禁止）

起動手順:
1. minecraft_connect → 接続エラー時は minecraft_get_surroundings で確認
2. minecraft_get_inventory, minecraft_get_surroundings, minecraft_get_status で状況把握
3. recall_locations で記憶済みの場所確認

${learnedRules ? `## 学習ルール:\n${learnedRules}\n` : ""}
状況を把握して、足りないものを優先して行動。`;

    console.log(`${PREFIX} Starting autonomous loop...`);
    await this.runLoop(initialPrompt);
  }

  private async runLoop(initialPrompt: string): Promise<void> {
    let currentPrompt = initialPrompt;
    let loopCount = 0;

    while (this.isRunning) {
      try {
        loopCount++;
        console.log(`\n${PREFIX} ${C.cyan}=== Loop ${loopCount} ===${C.reset}`);

        // Events are now injected per tool call via MCP Bridge
        const result = await this.claude.runQuery(currentPrompt);

        let loopSummary = "";
        if (result.success) {
          console.log(`${PREFIX} ${C.green}Turn completed successfully${C.reset}`);
          if (result.usage) {
            console.log(
              `${PREFIX} ${C.dim}Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out, Cost: $${result.usage.costUSD.toFixed(4)}${C.reset}`
            );
          }
          // Extract summary from result (last 100 chars or full if shorter)
          if (result.result) {
            const summary = result.result.length > 100
              ? result.result.slice(-100).replace(/\n/g, " ")
              : result.result.replace(/\n/g, " ");
            loopSummary = summary;
          }
        } else {
          console.error(`${PREFIX} ${C.red}Turn failed:${C.reset}`, result.error);
          loopSummary = `エラー: ${result.error?.slice(0, 50) || "unknown"}`;
        }

        // Force board write at end of each loop with actual summary
        await this.claude.forceBoardWrite(
          loopSummary || `ループ${loopCount}完了`
        );

        // Next turn prompt - simple continuation
        // Events are injected per tool call via MCP Bridge
        currentPrompt = `続行。状況確認→行動。`;

        // Delay between turns
        await this.delay(5000);
      } catch (error) {
        console.error(`${PREFIX} ${C.red}Error in loop:${C.reset}`, error);
        await this.delay(10000);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    console.log(`${PREFIX} Stopping...`);
    this.isRunning = false;
    this.claude.disconnect();
  }
}

// Main entry point
async function main(): Promise<void> {
  console.log(`
${C.cyan}╔══════════════════════════════════════════════════════════════╗
║              Claude Autonomous Agent                         ║
║      (OAuth + MCP Bridge - Persistent Connection)            ║
╚══════════════════════════════════════════════════════════════╝${C.reset}
`);

  // Start MCP WebSocket server
  await startMCPServer();
  await new Promise((r) => setTimeout(r, 1000));

  const agent = new ClaudeAgent();

  // Graceful shutdown
  const cleanup = () => {
    console.log(`\n${PREFIX} Shutting down...`);
    agent.stop();
    if (mcpServer) {
      mcpServer.kill();
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    await agent.start();
  } catch (error) {
    console.error(`${PREFIX} ${C.red}Fatal error:${C.reset}`, error);
    cleanup();
  }
}

main();
