#!/usr/bin/env node

/**
 * Autonomous Agent — 3-Layer Architecture
 *
 * L3 Planner  → Goal generation     (Sonnet, no tools, infrequent)
 * L2 Tactician → Skill selection     (Sonnet, no tools, on goal/abort)
 * L1 Executor  → Action execution    (Haiku, active skill tools, every tick)
 * Interrupts   → Rule-based          (no LLM, every tick)
 *
 * Single bot, single process. The 3 layers are abstraction levels of thought.
 */

import "dotenv/config";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import WebSocket from "ws";

import { MCPWebSocketClientTransport } from "../mcp-ws-transport.js";
import { SkillRegistry } from "./skill-registry.js";
import { observeWorld, quickObserve } from "./world-observer.js";
import { checkInterrupts } from "./interrupts.js";
import { runPlanner } from "./planner.js";
import { runTactician, applySkillChanges } from "./tactician.js";
import { runExecutor, buildToolSet } from "./executor.js";
import type {
  AutonomousAgentConfig,
  Goal,
  TacticalPlan,
  WorldState,
  MCPToolDefinition,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..", "..");
const MCP_WS_SERVER = join(projectRoot, "dist", "mcp-ws-server.js");

// Terminal colors
const C = {
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};
const PREFIX = `${C.cyan}[Auto]${C.reset}`;

// --- Configuration ---

function loadConfig(): AutonomousAgentConfig {
  return {
    mcHost: process.env.MC_HOST || "localhost",
    mcPort: parseInt(process.env.MC_PORT || "25565"),
    botUsername: process.env.BOT_USERNAME || "Claude",
    mcpWsUrl: process.env.MCP_WS_URL || "ws://localhost:8765",
    startMcpServer: process.env.START_MCP_SERVER !== "false",
    plannerModel: process.env.PLANNER_MODEL || "claude-sonnet-4-20250514",
    tacticianModel: process.env.TACTICIAN_MODEL || "claude-sonnet-4-20250514",
    executorModel: process.env.EXECUTOR_MODEL || "claude-haiku-3-5-20241022",
    plannerIntervalTicks: parseInt(process.env.PLANNER_INTERVAL || "600"), // ~5min at 500ms/tick
    observeIntervalTicks: parseInt(process.env.OBSERVE_INTERVAL || "10"),
    tickDelayMs: parseInt(process.env.TICK_DELAY || "500"),
  };
}

// --- MCP Server Management ---

let mcpServerProcess: ChildProcess | null = null;

async function checkMCPServerRunning(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on("open", () => { ws.close(); resolve(true); });
    ws.on("error", () => resolve(false));
    setTimeout(() => resolve(false), 1000);
  });
}

async function startMCPServer(config: AutonomousAgentConfig): Promise<void> {
  if (!config.startMcpServer) {
    console.log(`${PREFIX} Skipping MCP server start (START_MCP_SERVER=false)`);
    return;
  }

  const running = await checkMCPServerRunning(config.mcpWsUrl);
  if (running) {
    console.log(`${PREFIX} MCP server already running at ${config.mcpWsUrl}`);
    return;
  }

  console.log(`${PREFIX} Starting MCP WebSocket server...`);

  return new Promise((resolve, reject) => {
    mcpServerProcess = spawn("node", [MCP_WS_SERVER], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BOT_USERNAME: config.botUsername },
    });

    mcpServerProcess.stdout?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text.includes("[MCP-WS-Server]")) console.log(text);
      if (text.includes("running on ws://")) resolve();
    });

    mcpServerProcess.stderr?.on("data", (data: Buffer) => {
      console.error(`[MCP-WS] ${data.toString().trim()}`);
    });

    mcpServerProcess.on("error", reject);
    mcpServerProcess.on("exit", (code) => {
      console.log(`[MCP-WS] Server exited with code ${code}`);
      mcpServerProcess = null;
    });

    setTimeout(resolve, 3000);
  });
}

// --- Tool Registry ---

interface ToolRegistry {
  allTools: MCPToolDefinition[];
}

async function loadToolRegistry(mcp: MCPWebSocketClientTransport): Promise<ToolRegistry> {
  const result = await mcp.listTools() as { tools: MCPToolDefinition[] };
  console.log(`${PREFIX} Loaded ${result.tools.length} MCP tools`);
  return { allTools: result.tools };
}

// --- Utility ---

function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  const r = result as { content?: Array<{ type: string; text: string }> };
  if (r?.content && Array.isArray(r.content)) {
    return r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  }
  return JSON.stringify(result);
}

// --- Main Autonomous Loop ---

async function autonomousLoop(
  anthropic: Anthropic,
  mcp: MCPWebSocketClientTransport,
  config: AutonomousAgentConfig,
): Promise<void> {
  const skillRegistry = new SkillRegistry();
  const toolRegistry = await loadToolRegistry(mcp);

  // State
  let goals: Goal[] = [];
  let currentGoal: Goal | null = null;
  let tacticalPlan: TacticalPlan | null = null;
  const activeSkills = new Set<string>();
  let tickCount = 0;
  let ticksSincePlan = 0;
  let lastAction: string | undefined;
  let lastResult: string | undefined;
  let worldState: WorldState | null = null;
  let isRunning = true;

  // Connect bot to Minecraft
  console.log(`${PREFIX} Connecting bot to Minecraft ${config.mcHost}:${config.mcPort}...`);
  try {
    const connectResult = await mcp.callTool("minecraft_connect", {
      host: config.mcHost,
      port: config.mcPort,
      username: config.botUsername,
    });
    console.log(`${PREFIX} ${extractText(connectResult)}`);
  } catch (error) {
    console.error(`${PREFIX} Failed to connect to Minecraft:`, error);
    throw error;
  }

  // Wait for bot to spawn
  await new Promise((r) => setTimeout(r, 3000));

  // Subscribe to events
  try {
    await mcp.callTool("subscribe_events", { username: config.botUsername });
    console.log(`${PREFIX} Subscribed to game events`);
  } catch {
    console.log(`${PREFIX} Event subscription not available (continuing without)`);
  }

  console.log(`\n${PREFIX} ${C.bold}=== Autonomous loop started ===${C.reset}`);
  console.log(`${PREFIX} Planner: ${config.plannerModel}`);
  console.log(`${PREFIX} Tactician: ${config.tacticianModel}`);
  console.log(`${PREFIX} Executor: ${config.executorModel}`);
  console.log(`${PREFIX} Tick delay: ${config.tickDelayMs}ms\n`);

  while (isRunning) {
    try {
      tickCount++;

      // --- 1. Observe World ---
      const doFullObserve = !worldState || tickCount % config.observeIntervalTicks === 0;
      if (doFullObserve) {
        worldState = await observeWorld(mcp);
      } else {
        worldState = await quickObserve(mcp, worldState!);
      }

      // --- 2. Check Interrupts (Rule-based, no LLM) ---
      const interrupt = checkInterrupts(worldState);
      if (interrupt) {
        console.log(`\n${PREFIX} ${C.red}⚡ INTERRUPT: ${interrupt.type}${C.reset}`);
        activeSkills.clear();
        activeSkills.add(interrupt.requiredSkill);
        tacticalPlan = interrupt.emergencyPlan;
        currentGoal = interrupt.emergencyGoal;
        ticksSincePlan = 0;
        lastAction = undefined;
        lastResult = undefined;
      }

      // --- 3. L3 Planner (infrequent) ---
      const needsReplan =
        !currentGoal ||
        ticksSincePlan > config.plannerIntervalTicks;

      if (needsReplan && !interrupt) {
        console.log(`\n${PREFIX} ${C.magenta}🧠 L3 Planner running...${C.reset}`);

        goals = await runPlanner(anthropic, config.plannerModel, worldState);
        currentGoal = goals[0] || null;

        if (currentGoal) {
          console.log(`${PREFIX} ${C.magenta}Goal: ${currentGoal.description}${C.reset}`);

          // Run tactician for new goal
          console.log(`${PREFIX} ${C.yellow}🎯 L2 Tactician running...${C.reset}`);
          tacticalPlan = await runTactician(
            anthropic,
            config.tacticianModel,
            currentGoal,
            worldState,
            activeSkills,
            skillRegistry,
          );
          applySkillChanges(tacticalPlan, activeSkills);
          ticksSincePlan = 0;
          lastAction = undefined;
          lastResult = undefined;
        }
      }

      // --- 4. L1 Executor (every tick) ---
      if (tacticalPlan && currentGoal) {
        // Build dynamic tool set from active skills
        const skillToolNames = skillRegistry.getToolNames(activeSkills);
        const tools = buildToolSet(toolRegistry.allTools, skillToolNames);
        const skillContexts = skillRegistry.getContexts(activeSkills);

        // Status line
        const skillStr = Array.from(activeSkills).join(",");
        console.log(
          `${C.dim}[tick ${tickCount}] HP:${worldState.health} Food:${worldState.hunger} ` +
          `Skills:[${skillStr}] Tools:${tools.length} Goal:${currentGoal.description.slice(0, 30)}${C.reset}`,
        );

        const result = await runExecutor(
          anthropic,
          config.executorModel,
          mcp,
          tacticalPlan,
          worldState,
          tools,
          skillContexts,
          lastAction,
          lastResult,
        );

        lastAction = result.action;
        lastResult = result.toolResult;

        // Handle abort — re-run tactician
        if (result.aborted) {
          console.log(`${PREFIX} ${C.yellow}Abort: ${result.abortReason}${C.reset}`);
          tacticalPlan = await runTactician(
            anthropic,
            config.tacticianModel,
            currentGoal,
            worldState,
            activeSkills,
            skillRegistry,
          );
          applySkillChanges(tacticalPlan, activeSkills);
        }

        // Handle completion — advance to next goal
        if (result.completed) {
          console.log(`${PREFIX} ${C.green}✓ Goal completed: ${currentGoal.description}${C.reset}`);
          goals.shift();
          currentGoal = goals[0] || null;

          if (currentGoal) {
            tacticalPlan = await runTactician(
              anthropic,
              config.tacticianModel,
              currentGoal,
              worldState,
              activeSkills,
              skillRegistry,
            );
            applySkillChanges(tacticalPlan, activeSkills);
          } else {
            // No more goals — planner will generate new ones on next interval
            tacticalPlan = null;
            ticksSincePlan = config.plannerIntervalTicks + 1; // force replan
          }
        }
      } else {
        // No plan yet — force planner on next tick
        ticksSincePlan = config.plannerIntervalTicks + 1;
      }

      ticksSincePlan++;

      // --- 5. Delay ---
      await new Promise((r) => setTimeout(r, config.tickDelayMs));

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`${PREFIX} ${C.red}Tick ${tickCount} error: ${errMsg}${C.reset}`);

      // On error, wait longer before retrying
      await new Promise((r) => setTimeout(r, 5000));

      // If MCP disconnected, try to reconnect
      if (!mcp.isConnected()) {
        console.log(`${PREFIX} MCP disconnected, waiting for reconnect...`);
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
  }
}

// --- Entry Point ---

async function main(): Promise<void> {
  console.log(`
${C.cyan}╔══════════════════════════════════════════════════════════════╗
║          Autonomous Agent — 3-Layer Architecture             ║
║   L3 Planner │ L2 Tactician │ L1 Executor │ Interrupts       ║
╚══════════════════════════════════════════════════════════════╝${C.reset}
`);

  const config = loadConfig();

  // Validate API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${PREFIX} ${C.red}ANTHROPIC_API_KEY is required.${C.reset}`);
    console.error(`${PREFIX} Set it in .env file or environment variable.`);
    process.exit(1);
  }

  const anthropic = new Anthropic();

  // Start MCP server if needed
  await startMCPServer(config);
  await new Promise((r) => setTimeout(r, 1000));

  // Connect to MCP WebSocket
  console.log(`${PREFIX} Connecting to MCP server at ${config.mcpWsUrl}...`);
  const mcp = new MCPWebSocketClientTransport(config.mcpWsUrl);
  await mcp.connect();
  console.log(`${PREFIX} MCP connection established`);

  // Graceful shutdown
  const cleanup = () => {
    console.log(`\n${PREFIX} Shutting down...`);
    mcp.close();
    if (mcpServerProcess) mcpServerProcess.kill();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    await autonomousLoop(anthropic, mcp, config);
  } catch (error) {
    console.error(`${PREFIX} ${C.red}Fatal error:${C.reset}`, error);
    cleanup();
  }
}

main();
