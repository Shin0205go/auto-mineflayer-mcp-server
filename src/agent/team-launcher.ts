#!/usr/bin/env node

/**
 * Agent Team Launcher
 *
 * 複数のClaude Agentをチームとして起動するオーケストレーター。
 * 1. MCP WebSocket Server を起動（または既存を利用）
 * 2. チームを作成
 * 3. リードエージェントを起動
 * 4. メンバーエージェントを順次起動
 * 5. プロセス監視・自動再起動
 *
 * 環境変数:
 *   TEAM_NAME      - チーム名（デフォルト: survival-team）
 *   AGENT_NAMES    - カンマ区切りのエージェント名（デフォルト: Claude,Claude2）
 *   AGENT_MODELS   - カンマ区切りのモデル指定（デフォルト: 全員sonnet）
 *                    例: "opus,sonnet,sonnet" → リードがOpus、メンバーがSonnet
 *   TEAM_MISSION   - チームのミッション（任意）
 *   MC_HOST        - Minecraftサーバーホスト
 *   MC_PORT        - Minecraftサーバーポート
 *   MCP_WS_URL     - MCP WebSocketサーバーURL
 *   STAGGER_DELAY  - エージェント起動間隔ミリ秒（デフォルト: 8000）
 */

import "dotenv/config";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import WebSocket from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, "..", "..");
const MCP_WS_SERVER = join(projectRoot, "dist", "mcp-ws-server.js");
const CLAUDE_AGENT = join(projectRoot, "dist", "agent", "claude-agent.js");

// Configuration
const TEAM_NAME = process.env.TEAM_NAME || "survival-team";
const AGENT_NAMES = (process.env.AGENT_NAMES || "Claude,Claude2").split(",").map(s => s.trim());
const AGENT_MODELS = (process.env.AGENT_MODELS || "").split(",").map(s => s.trim().toLowerCase());
const TEAM_MISSION = process.env.TEAM_MISSION || "サバイバルモードで協力して生き残り、装備を整える";
const MC_HOST = process.env.MC_HOST || "localhost";
const MC_PORT = process.env.MC_PORT || "25565";
const MCP_WS_URL = process.env.MCP_WS_URL || "ws://localhost:8765";
const STAGGER_DELAY = parseInt(process.env.STAGGER_DELAY || "8000");
const DEFAULT_MODEL = "sonnet"; // コスト効率のためSonnetをデフォルト

// Colors
const C = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

// Assign distinct colors to each agent
const AGENT_COLORS = [C.cyan, C.green, C.magenta, C.yellow];

function getPrefix(name: string, index: number): string {
  const color = AGENT_COLORS[index % AGENT_COLORS.length];
  return `${color}[${name}]${C.reset}`;
}

const LAUNCHER = `${C.bold}${C.cyan}[TeamLauncher]${C.reset}`;

// ===== Process management =====

let mcpServer: ChildProcess | null = null;
const agentProcesses = new Map<string, ChildProcess>();
let isShuttingDown = false;

// ===== MCP Server =====

async function checkMCPServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(MCP_WS_URL);
    ws.on("open", () => { ws.close(); resolve(true); });
    ws.on("error", () => { resolve(false); });
    setTimeout(() => resolve(false), 2000);
  });
}

async function startMCPServer(): Promise<void> {
  const alreadyRunning = await checkMCPServerRunning();
  if (alreadyRunning) {
    console.log(`${LAUNCHER} MCP server already running at ${MCP_WS_URL}`);
    return;
  }

  console.log(`${LAUNCHER} Starting MCP WebSocket server...`);

  return new Promise((resolve, reject) => {
    mcpServer = spawn("node", [MCP_WS_SERVER], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    mcpServer.stdout?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.log(`${C.dim}[MCP-WS] ${text}${C.reset}`);
      if (text.includes("running on ws://")) {
        resolve();
      }
    });

    mcpServer.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error(`${C.dim}[MCP-WS] ${text}${C.reset}`);
    });

    mcpServer.on("error", reject);
    mcpServer.on("exit", (code) => {
      console.log(`${LAUNCHER} ${C.red}MCP server exited with code ${code}${C.reset}`);
      mcpServer = null;
    });

    // Timeout fallback
    setTimeout(resolve, 5000);
  });
}

// ===== Team Setup via WebSocket =====

async function setupTeamViaWS(leadName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(MCP_WS_URL);
    let requestId = 0;

    const call = (name: string, args: Record<string, unknown>): Promise<unknown> => {
      return new Promise((res, rej) => {
        const id = ++requestId;
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args },
        }));

        const handler = (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.id === id) {
              ws.removeListener("message", handler);
              if (msg.error) {
                rej(new Error(msg.error.message));
              } else {
                res(msg.result);
              }
            }
          } catch { /* ignore parse errors */ }
        };

        ws.on("message", handler);
        setTimeout(() => { ws.removeListener("message", handler); rej(new Error("timeout")); }, 10000);
      });
    };

    ws.on("open", async () => {
      try {
        // Create team (ignore error if already exists)
        try {
          await call("team_create", {
            team_name: TEAM_NAME,
            agent_name: leadName,
            description: TEAM_MISSION,
          });
          console.log(`${LAUNCHER} ${C.green}Team '${TEAM_NAME}' created. Lead: ${leadName}${C.reset}`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("既に存在")) {
            console.log(`${LAUNCHER} Team '${TEAM_NAME}' already exists, reusing.`);
          } else {
            throw e;
          }
        }

        ws.close();
        resolve();
      } catch (error) {
        ws.close();
        reject(error);
      }
    });

    ws.on("error", reject);
  });
}

// ===== Agent Process Management =====

function spawnAgent(name: string, index: number): ChildProcess {
  const isLead = index === 0;
  const prefix = getPrefix(name, index);
  // Get model for this agent (fallback to DEFAULT_MODEL)
  const model = AGENT_MODELS[index] || DEFAULT_MODEL;

  console.log(`${LAUNCHER} Spawning ${isLead ? "lead" : "member"}: ${name} (model: ${model})`);

  const child = spawn("node", [CLAUDE_AGENT], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BOT_USERNAME: name,
      MC_HOST,
      MC_PORT,
      MCP_WS_URL,
      START_MCP_SERVER: "false", // We already started it
      // Model selection
      CLAUDE_MODEL: model,
      // Team env vars
      TEAM_NAME,
      TEAM_ROLE: isLead ? "lead" : "member",
      TEAM_MISSION,
    },
  });

  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line.trim()) console.log(`${prefix} ${line}`);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line.trim()) console.error(`${prefix} ${C.dim}${line}${C.reset}`);
    }
  });

  child.on("exit", (code) => {
    console.log(`${prefix} ${C.red}Process exited with code ${code}${C.reset}`);
    agentProcesses.delete(name);

    // Auto-restart unless shutting down
    if (!isShuttingDown && code !== 0) {
      console.log(`${LAUNCHER} ${C.yellow}Restarting ${name} in 10 seconds...${C.reset}`);
      setTimeout(() => {
        if (!isShuttingDown) {
          const newChild = spawnAgent(name, index);
          agentProcesses.set(name, newChild);
        }
      }, 10000);
    }
  });

  agentProcesses.set(name, child);
  return child;
}

// ===== Shutdown =====

function cleanup(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n${LAUNCHER} ${C.yellow}Shutting down team...${C.reset}`);

  // Kill all agent processes
  for (const [name, proc] of agentProcesses) {
    console.log(`${LAUNCHER} Stopping ${name}...`);
    proc.kill("SIGTERM");
  }

  // Kill MCP server
  if (mcpServer) {
    console.log(`${LAUNCHER} Stopping MCP server...`);
    mcpServer.kill("SIGTERM");
  }

  // Force exit after 5 seconds
  setTimeout(() => {
    console.log(`${LAUNCHER} Force exiting.`);
    process.exit(0);
  }, 5000);
}

// ===== Main =====

async function main(): Promise<void> {
  console.log(`
${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗
║              Agent Team Launcher                             ║
║         Multi-Agent Coordination System                      ║
╚══════════════════════════════════════════════════════════════╝${C.reset}

  Team:    ${TEAM_NAME}
  Agents:  ${AGENT_NAMES.join(", ")} (${AGENT_NAMES.length}体)
  Models:  ${AGENT_NAMES.map((_, i) => AGENT_MODELS[i] || DEFAULT_MODEL).join(", ")}
  Mission: ${TEAM_MISSION}
  Server:  ${MC_HOST}:${MC_PORT}
  MCP:     ${MCP_WS_URL}
`);

  // 1. Start MCP WebSocket Server
  console.log(`${LAUNCHER} ${C.cyan}Step 1: Starting MCP server...${C.reset}`);
  await startMCPServer();
  await delay(2000);

  // 2. Create team
  console.log(`${LAUNCHER} ${C.cyan}Step 2: Setting up team '${TEAM_NAME}'...${C.reset}`);
  await setupTeamViaWS(AGENT_NAMES[0]);
  await delay(1000);

  // 3. Spawn agents with stagger
  console.log(`${LAUNCHER} ${C.cyan}Step 3: Spawning agents...${C.reset}`);

  for (let i = 0; i < AGENT_NAMES.length; i++) {
    spawnAgent(AGENT_NAMES[i], i);

    // Stagger between agents to avoid race conditions
    if (i < AGENT_NAMES.length - 1) {
      console.log(`${LAUNCHER} ${C.dim}Waiting ${STAGGER_DELAY / 1000}s before next agent...${C.reset}`);
      await delay(STAGGER_DELAY);
    }
  }

  console.log(`\n${LAUNCHER} ${C.green}${C.bold}All ${AGENT_NAMES.length} agents launched!${C.reset}`);
  console.log(`${LAUNCHER} ${C.dim}Press Ctrl+C to stop all agents.${C.reset}\n`);

  // Graceful shutdown
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`${LAUNCHER} ${C.red}Fatal error:${C.reset}`, error);
  cleanup();
});
