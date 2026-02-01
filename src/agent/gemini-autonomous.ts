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
      env: process.env,
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

    // Initial prompt
    const initialPrompt = `Minecraftサーバーに接続して、自律的に探索を開始してください。

サーバー情報:
- host: ${MC_HOST}
- port: ${MC_PORT}
- username: GeminiBot

まず接続し、周囲を確認してから行動を開始してください。
掲示板(agent_board_read)を確認して、他のエージェント（Claude等）がいれば協力してください。`;

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

        // Next turn prompt - encourage coordination
        currentPrompt = `続けてください。現在の状況を確認し、次の行動を決めてください。

掲示板を確認して:
1. agent_board_read で他のエージェントのメッセージを読む
2. 自分の状況や計画を agent_board_write で共有する（agent_name: "Gemini"）
3. Claudeと協力できることがあれば協力する

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
