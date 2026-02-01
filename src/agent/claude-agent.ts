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
      console.log("[Agent] Skipping MCP server start (START_MCP_SERVER=false)");
      resolve();
      return;
    }

    // Check if already running
    const alreadyRunning = await checkMCPServerRunning();
    if (alreadyRunning) {
      console.log(`[Agent] MCP server already running at ${MCP_WS_URL}`);
      resolve();
      return;
    }

    console.log("[Agent] Starting MCP WebSocket server...");

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
      maxTurns: 30,
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
      console.error("[Agent] Error:", error.message);
    });
  }

  async start(): Promise<void> {
    console.log("[Agent] Starting Claude Agent...");
    console.log(`[Agent] Target Minecraft server: ${MC_HOST}:${MC_PORT}`);
    console.log(`[Agent] MCP Bridge will connect to: ${MCP_WS_URL}`);

    this.isRunning = true;

    // Load Minecraft skill knowledge
    let minecraftKnowledge = "";
    try {
      const skillPath = join(projectRoot, ".claude", "skills", "minecraft-survival", "SKILL.md");
      minecraftKnowledge = readFileSync(skillPath, "utf-8");
    } catch {
      console.log("[Agent] Warning: Could not load minecraft-survival.md skill");
    }

    // Initial prompt with Minecraft knowledge
    const initialPrompt = `あなたはMinecraftサバイバルモードで自律的にプレイするAIエージェントです。

## Minecraft基本知識
${minecraftKnowledge}

## 接続情報
- host: ${MC_HOST}
- port: ${MC_PORT}
- username: ${BOT_USERNAME}

## サバイバルの基本
1. 道具を作る（木→石→鉄→ダイヤ）
2. 食料を確保する
3. 夜に備える（ベッドまたは拠点）
4. 装備を強化する

## 最終目標
エンダードラゴンを倒す

## 指示
1. minecraft_connect で接続（username: "${BOT_USERNAME}"）
2. agent_board_read で掲示板を確認
3. 状況を判断して行動`;

    console.log("[Agent] Starting autonomous loop...");
    await this.runLoop(initialPrompt);
  }

  private async runLoop(initialPrompt: string): Promise<void> {
    let currentPrompt = initialPrompt;
    let loopCount = 0;

    while (this.isRunning) {
      try {
        loopCount++;
        console.log(`\n[Agent] === Loop ${loopCount} ===`);

        const result = await this.claude.runQuery(currentPrompt);

        let loopSummary = "";
        if (result.success) {
          console.log("[Agent] Turn completed successfully");
          if (result.usage) {
            console.log(
              `[Agent] Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out, Cost: $${result.usage.costUSD.toFixed(4)}`
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
          console.error("[Agent] Turn failed:", result.error);
          loopSummary = `エラー: ${result.error?.slice(0, 50) || "unknown"}`;
        }

        // Force board write at end of each loop with actual summary
        await this.claude.forceBoardWrite(
          loopSummary || `ループ${loopCount}完了`
        );

        // Get buffered events from last loop
        const eventSection = this.claude.formatEventsForPrompt();

        // Next turn prompt - include events and encourage coordination
        currentPrompt = `続けてください。

${eventSection}

状況を確認して、次に何をすべきか判断してください。
掲示板に計画を書いてから行動。`;

        // Delay between turns
        await this.delay(5000);
      } catch (error) {
        console.error("[Agent] Error in loop:", error);
        await this.delay(10000);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    console.log("[Agent] Stopping...");
    this.isRunning = false;
    this.claude.disconnect();
  }
}

// Main entry point
async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Claude Autonomous Agent                         ║
║      (OAuth + MCP Bridge - Persistent Connection)            ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Start MCP WebSocket server
  await startMCPServer();
  await new Promise((r) => setTimeout(r, 1000));

  const agent = new ClaudeAgent();

  // Graceful shutdown
  const cleanup = () => {
    console.log("\n[Agent] Shutting down...");
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
    console.error("[Agent] Fatal error:", error);
    cleanup();
  }
}

main();
