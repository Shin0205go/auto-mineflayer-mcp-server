#!/usr/bin/env node

/**
 * Gemini Autonomous Agent
 *
 * Starts both the MCP WebSocket server and the Gemini agent.
 * No need to run separate commands.
 */

import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, "..", "..");
const MCP_WS_SERVER = join(projectRoot, "dist", "mcp-ws-server.js");
const GEMINI_AGENT = join(projectRoot, "dist", "agent", "index.js");

let mcpServer: ChildProcess | null = null;
let geminiAgent: ChildProcess | null = null;

function startMCPServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("[Launcher] Starting MCP WebSocket server...");

    mcpServer = spawn("node", [MCP_WS_SERVER], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    mcpServer.stdout?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      console.log(`[MCP-WS] ${text}`);
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

    // Timeout in case server doesn't print expected message
    setTimeout(resolve, 2000);
  });
}

function startGeminiAgent(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("[Launcher] Starting Gemini agent...");

    geminiAgent = spawn("node", [GEMINI_AGENT], {
      stdio: "inherit",
      env: process.env,
    });

    geminiAgent.on("error", reject);

    geminiAgent.on("exit", (code) => {
      console.log(`[Gemini] Agent exited with code ${code}`);
      geminiAgent = null;
      cleanup();
    });

    resolve();
  });
}

function cleanup(): void {
  if (mcpServer) {
    console.log("[Launcher] Stopping MCP server...");
    mcpServer.kill();
    mcpServer = null;
  }
  if (geminiAgent) {
    console.log("[Launcher] Stopping Gemini agent...");
    geminiAgent.kill();
    geminiAgent = null;
  }
}

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Gemini Autonomous Agent Launcher                ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[Launcher] Shutting down...");
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n[Launcher] Shutting down...");
    cleanup();
    process.exit(0);
  });

  try {
    // Start MCP WebSocket server first
    await startMCPServer();

    // Wait a bit for server to be ready
    await new Promise((r) => setTimeout(r, 1000));

    // Start Gemini agent
    await startGeminiAgent();
  } catch (error) {
    console.error("[Launcher] Failed to start:", error);
    cleanup();
    process.exit(1);
  }
}

main();
