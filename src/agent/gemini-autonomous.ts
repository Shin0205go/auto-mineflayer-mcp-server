#!/usr/bin/env node

/**
 * Gemini Autonomous Agent
 *
 * Uses the same pattern as Claude Agent:
 * - Outer loop for continuous operation
 * - Inner loop for multi-turn tool execution
 * - Coordination via agent board
 */

import "dotenv/config";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";
import WebSocket from "ws";
import { GeminiClient } from "./gemini-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, "..", "..");
const MCP_WS_SERVER = join(projectRoot, "dist", "mcp-ws-server.js");

const MC_HOST = process.env.MC_HOST || "localhost";
const MC_PORT = parseInt(process.env.MC_PORT || "25565");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MCP_WS_URL = process.env.MCP_WS_URL || "ws://localhost:8765";
const START_MCP_SERVER = process.env.START_MCP_SERVER !== "false";
const BOT_USERNAME = "Gemini";  // Fixed username for Gemini agent

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

class GeminiAgent {
  private gemini: GeminiClient;
  private isRunning = false;

  constructor() {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }

    this.gemini = new GeminiClient({
      apiKey: GEMINI_API_KEY,
      maxTurns: 30,
      mcpServerUrl: MCP_WS_URL,
      agentName: BOT_USERNAME,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.gemini.on("text", (_text: string) => {
      // Already logged in runQuery
    });

    this.gemini.on("tool_use", (_name: string, _input: unknown) => {
      // Already logged in runQuery
    });

    this.gemini.on("error", (error: Error) => {
      console.error("[Agent] Error:", error.message);
    });
  }

  async start(): Promise<void> {
    console.log("[Agent] Starting Gemini Agent...");
    console.log(`[Agent] Target Minecraft server: ${MC_HOST}:${MC_PORT}`);

    // Connect to MCP
    await this.gemini.connect();

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

**重要**: minecraft_connectを呼ぶ時は必ず username: "${BOT_USERNAME}" を使ってください。

## 指示
1. まずサーバーに接続してください（username: "${BOT_USERNAME}"）
2. agent_board_read で掲示板を確認（前回の「次のアクション」があれば続行）
3. 周囲を確認し、素材を集めてください
4. 他のエージェント（Claude等）と協力してください
5. **重要**: ターン終了前に「次のアクション: ○○」を掲示板に書く`;

    console.log("[Agent] Starting autonomous loop...");
    await this.runLoop(initialPrompt);
  }

  private async runLoop(initialPrompt: string): Promise<void> {
    let currentPrompt = initialPrompt;

    while (this.isRunning) {
      try {
        console.log("\n[Agent] === New Turn ===");

        const result = await this.gemini.runQuery(currentPrompt);

        if (result.success) {
          console.log("[Agent] Turn completed successfully");
        } else {
          console.error("[Agent] Turn failed:", result.error);
        }

        // Force board write at end of each loop (hook)
        await this.gemini.forceBoardWrite(
          `ターン完了。次は掲示板を読んで継続予定。`
        );

        // Next turn prompt - encourage coordination
        currentPrompt = `続けてください。

まず掲示板を確認:
1. agent_board_read で自分の前回の「次のアクション」や他エージェントのメッセージを読む
2. 前回の計画があればそれを続行、なければ新しい目標を設定

行動後、ループ終了前に必ず:
- agent_board_write で「次のアクション: ○○をする予定」を書く（agent_name: "Gemini"）
- これで次のループで何をすべきか忘れない

探索、採掘、建築など、自由に行動してください。`;

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
    this.gemini.disconnect();
  }
}

// Main entry point
async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Gemini Autonomous Agent                         ║
║        (Same pattern as Claude Agent)                        ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Start MCP WebSocket server
  await startMCPServer();
  await new Promise((r) => setTimeout(r, 1000));

  const agent = new GeminiAgent();

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
