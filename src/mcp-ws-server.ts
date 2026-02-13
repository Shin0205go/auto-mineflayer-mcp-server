#!/usr/bin/env node

/**
 * MCP WebSocket Server
 *
 * Exposes the MCP tools via WebSocket.
 * Each connection can have its own bot (identified by username).
 */

import { WebSocketServer, WebSocket } from 'ws';
import { botManager } from "./bot-manager/index.js";
import { readBoard, writeBoard, waitForNewMessage, clearBoard } from "./tools/coordination.js";
import { learningTools, handleLearningTool, getAgentSkill } from "./tools/learning.js";
import { taskCreate, taskList, taskGet, taskUpdate, TASK_MANAGEMENT_TOOLS } from "./tools/task-management.js";
import {
  minecraft_gather_resources,
  minecraft_build_structure,
  minecraft_craft_chain,
  minecraft_survival_routine,
  minecraft_explore_area,
  minecraft_validate_survival_environment
} from "./tools/high-level-actions.js";
import { stateTools, handleStateTool } from "./tools/state.js";
import { combatTools, handleCombatTool } from "./tools/combat.js";
import { appendFileSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ToolExecutionLog, ToolExecutionContext } from "./types/tool-log.js";
import type { LoopResult } from "./types/agent-config.js";
import { GAME_AGENT_TOOLS } from "./tool-filters.js";
import { searchTools, getToolCategories, TOOL_METADATA } from "./tool-metadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Tool execution log storage
const TOOL_LOG_FILE = join(__dirname, "..", "logs", "tool-execution.jsonl");
const toolExecutionLogs: ToolExecutionLog[] = [];
const MAX_LOGS_IN_MEMORY = 500;

// Dev Agent subscriptions (for receiving tool logs)
const devAgentConnections = new Set<WebSocket>();

// Loop result storage
const LOOP_RESULT_FILE = join(__dirname, "..", "logs", "loop-results.jsonl");
const loopResults: LoopResult[] = [];
const MAX_LOOP_RESULTS = 100;

// Agent config paths
const AGENT_CONFIG_FILE = join(__dirname, "..", "learning", "agent-config.json");
const EVOLUTION_HISTORY_FILE = join(__dirname, "..", "learning", "evolution-history.jsonl");

// Ensure logs directory exists
function ensureLogDir() {
  const logDir = join(__dirname, "..", "logs");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

// Generate unique ID
function generateLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get current bot context for logging
function getBotContext(username: string): ToolExecutionContext {
  try {
    const status = botManager.getStatus(username);
    const statusObj = JSON.parse(status);
    const pos = botManager.getPosition(username);
    const inventory = botManager.getInventory(username);

    return {
      hp: statusObj.health,
      food: statusObj.food,
      position: pos ? [pos.x, pos.y, pos.z] : undefined,
      inventory: inventory.slice(0, 10).map(i => ({ name: i.name, count: i.count })),
    };
  } catch {
    return {};
  }
}

// === Critical State Check (Skill Abort) ===
const CRITICAL_HP_THRESHOLD = 5;
const CRITICAL_FOOD_THRESHOLD = 0;  // 0のみブロック（3は厳しすぎ）

// Tools that are always allowed (safe/recovery actions)
const SAFE_TOOLS = new Set([
  "minecraft_connect",
  "minecraft_disconnect",
  "minecraft_get_state",
  "minecraft_get_chat_messages",
  "minecraft_chat",
  "subscribe_events",
  "agent_board_read",
  "agent_board_write",
  "agent_board_wait",
  "agent_board_clear",
  // Learning/memory tools
  "log_experience",
  "get_recent_experiences",
  "reflect_and_learn",
  "save_memory",
  "recall_memory",
  "forget_memory",
  "get_agent_skill",
  "list_agent_skills",
  // Dev tools
  "dev_subscribe",
  "dev_get_tool_logs",
  "dev_get_failure_summary",
  "dev_clear_logs",
  "dev_publish_loop_result",
  "dev_get_loop_results",
  "dev_get_config",
  "dev_save_config",
  "dev_get_evolution_history",
]);

/**
 * Check if bot is in critical state and tool should be blocked
 * Returns abort message if should block, null if OK to proceed
 */
function checkCriticalState(username: string | undefined, toolName: string): string | null {
  // Skip check for safe tools
  if (SAFE_TOOLS.has(toolName)) {
    return null;
  }

  // Skip if no username (not connected)
  if (!username) {
    return null;
  }

  try {
    const status = botManager.getStatus(username);
    const statusObj = JSON.parse(status);
    const hp = statusObj.health;
    const food = statusObj.food;

    if (hp <= CRITICAL_HP_THRESHOLD) {
      return `【緊急中断】HP=${hp}（危険水準）。このツールは実行できません。` +
        `\n\n即座にminecraft_survival_routine(priority="auto")を実行して生存を優先してください。` +
        `\n現在の状態: HP=${hp}/20, 食料=${food}/20`;
    }

    if (food <= CRITICAL_FOOD_THRESHOLD) {
      return `【緊急警告】空腹度=${food}（飢餓状態）。このツールは実行できません。` +
        `\n\n即座にminecraft_survival_routine(priority="food")を実行して食料を確保してください。` +
        `\n現在の状態: HP=${hp}/20, 食料=${food}/20`;
    }
  } catch {
    // If we can't get status, allow the tool to proceed
  }

  return null;
}

// Record tool execution
function recordToolExecution(
  tool: string,
  input: Record<string, unknown>,
  result: "success" | "failure" | "timeout",
  output: unknown,
  error: string | undefined,
  duration: number,
  agentName: string
): ToolExecutionLog {
  const log: ToolExecutionLog = {
    id: generateLogId(),
    timestamp: Date.now(),
    tool,
    input,
    result,
    output: result === "success" ? output : undefined,
    error,
    duration,
    context: getBotContext(agentName),
    agentName,
  };

  // Store in memory
  toolExecutionLogs.push(log);
  if (toolExecutionLogs.length > MAX_LOGS_IN_MEMORY) {
    toolExecutionLogs.shift();
  }

  // Persist to file
  try {
    ensureLogDir();
    appendFileSync(TOOL_LOG_FILE, JSON.stringify(log) + "\n");
  } catch (e) {
    console.error("[MCP-WS-Server] Failed to write log:", e);
  }

  // Notify Dev Agents
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/toolLog",
    params: log,
  };
  const json = JSON.stringify(notification);

  devAgentConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  });

  return log;
}

// Get recent tool logs
function getToolLogs(filter?: {
  tool?: string;
  result?: "success" | "failure" | "timeout";
  since?: number;
  limit?: number;
}): ToolExecutionLog[] {
  let logs = [...toolExecutionLogs];

  if (filter?.tool) {
    logs = logs.filter(l => l.tool === filter.tool);
  }
  if (filter?.result) {
    logs = logs.filter(l => l.result === filter.result);
  }
  if (filter?.since) {
    logs = logs.filter(l => l.timestamp > filter.since!);
  }

  if (filter?.limit) {
    logs = logs.slice(-filter.limit);
  }

  return logs;
}

// Failure patterns to detect in tool results
const FAILURE_PATTERNS = [
  /^No .+ found/i,
  /^No .+ nearby/i,
  /^No .+ in inventory/i,
  /^Cannot /i,
  /^Failed to /i,
  /^Unable to /i,
  /not found/i,
  /not enough/i,
  /missing/i,
  /unreachable/i,
  /too far/i,
  /no path/i,
  /blocked/i,
];

// Tools that should NOT throw on "failure" patterns (informational tools)
// Also includes search tools where "not found" is a valid, informational result
const INFORMATIONAL_TOOLS = [
  "minecraft_get_state",
  "minecraft_get_chat_messages",
  "agent_board_read",
  "get_recent_experiences",
  "recall_memory",
  "list_agent_skills",
  "get_agent_skill",
];

/**
 * Check if a tool result indicates failure and throw if so
 */
function throwOnFailureResult(toolName: string, result: string): string {
  // Skip informational tools
  if (INFORMATIONAL_TOOLS.includes(toolName)) {
    return result;
  }

  // Check for failure patterns
  for (const pattern of FAILURE_PATTERNS) {
    if (pattern.test(result)) {
      throw new Error(result);
    }
  }

  return result;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Track which bot each connection is using (for tool calls)
const connectionBots = new WeakMap<WebSocket, string>();

// Track which bots each connection is subscribed to (for event notifications)
const connectionSubscriptions = new WeakMap<WebSocket, Set<string>>();

// Track agent type for each connection (game or dev)
const connectionAgentTypes = new WeakMap<WebSocket, string>();

// Track all active WebSocket connections for event broadcasting
const activeConnections = new Set<WebSocket>();

// Listen for game events from BotManager and push to clients
botManager.on("gameEvent", (username: string, event: { type: string; message: string; timestamp: number; data?: Record<string, unknown> }) => {
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/gameEvent",
    params: {
      username,
      event: {
        type: event.type,
        message: event.message,
        timestamp: event.timestamp,
        data: event.data,
      },
    },
  };

  const json = JSON.stringify(notification);

  // Broadcast to all connections that own or are subscribed to this bot
  let sentCount = 0;
  activeConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      const botUsername = connectionBots.get(ws);
      const subscriptions = connectionSubscriptions.get(ws);
      const isSubscribed = subscriptions?.has(username) || false;
      if (botUsername === username || isSubscribed) {
        ws.send(json);
        sentCount++;
      }
    }
  });
  if (sentCount > 0) {
    console.log(`[MCP-WS-Server] Pushed ${event.type} event for ${username} to ${sentCount} clients`);
  }
});

// Tool definitions
const tools = {
  minecraft_connect: {
    description: "Connect to a Minecraft server",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", default: "localhost" },
        port: { type: "number", default: 25565 },
        username: { type: "string", description: "Bot username (required)" },
        version: { type: "string" },
        agentType: {
          type: "string",
          enum: ["game", "dev"],
          default: "game",
          description: "Agent type: 'game' for Game Agent (high-level tools only), 'dev' for Dev Agent (all tools)"
        },
      },
      required: ["username"],
    },
  },
  minecraft_disconnect: {
    description: "Disconnect from the Minecraft server",
    inputSchema: { type: "object", properties: {} },
  },
  ...stateTools,
  ...combatTools,
  minecraft_chat: {
    description: "Send a chat message",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
  minecraft_get_chat_messages: {
    description: "Get recent chat messages",
    inputSchema: {
      type: "object",
      properties: { clear: { type: "boolean", default: true } },
    },
  },
  subscribe_events: {
    description: "Subscribe to game events for a bot (for receiving push notifications)",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Bot username to subscribe to" },
      },
      required: ["username"],
    },
  },
  // Tool Search
  search_tools: {
    description: "Search for available tools by keyword or category. Use this to discover relevant tools without loading all tool definitions. Categories: connection, info, communication, actions, crafting, learning, coordination, tasks, dev",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (keyword, category, or tag). Examples: 'crafting', 'survival', 'mining', 'info'. Leave empty to get top priority tools.",
        },
        detail: {
          type: "string",
          enum: ["brief", "full"],
          default: "brief",
          description: "Level of detail in results. 'brief' shows only names and categories, 'full' includes descriptions and parameters.",
        },
      },
    },
  },
  // High-level action tools
  minecraft_gather_resources: {
    description: "High-level resource gathering - automatically finds, mines, and collects specified items",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Item name (e.g., 'oak_log', 'cobblestone')" },
              count: { type: "number", description: "Target quantity" }
            },
            required: ["name", "count"]
          },
          description: "List of items to gather"
        },
        maxDistance: { type: "number", description: "Maximum search distance (default: 32)" }
      },
      required: ["username", "items"]
    }
  },
  minecraft_build_structure: {
    description: "High-level building - constructs predefined structures (shelter, wall, platform, tower)",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        type: { type: "string", enum: ["shelter", "wall", "platform", "tower"], description: "Structure type" },
        size: { type: "string", enum: ["small", "medium", "large"], description: "Structure size" },
        materials: { type: "string", description: "Preferred building material (optional)" }
      },
      required: ["username", "type", "size"]
    }
  },
  minecraft_craft_chain: {
    description: "High-level crafting - crafts items with automatic dependency resolution and optional material gathering",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        target: { type: "string", description: "Target item to craft (e.g., 'iron_pickaxe', 'furnace')" },
        autoGather: { type: "boolean", description: "Automatically gather missing materials (default: false)" }
      },
      required: ["username", "target"]
    }
  },
  minecraft_survival_routine: {
    description: "High-level survival - executes survival priorities (food, shelter, tools) based on current needs",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        priority: { type: "string", enum: ["food", "shelter", "tools", "auto"], description: "Priority mode (auto = intelligent selection)" }
      },
      required: ["username", "priority"]
    }
  },
  minecraft_explore_area: {
    description: "High-level exploration - explores area in spiral pattern, searching for biomes, blocks, or entities",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        radius: { type: "number", description: "Exploration radius in blocks" },
        target: { type: "string", description: "Optional target to search for (biome, block, or entity name)" }
      },
      required: ["username", "radius"]
    }
  },
  minecraft_validate_survival_environment: {
    description: "Validate if environment has sufficient food sources for survival - checks for passive mobs, edible plants, and fishing viability. Run this at session start to detect unplayable environments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        searchRadius: { type: "number", description: "Search radius in blocks (default: 100)", default: 100 }
      },
      required: ["username"]
    }
  },
  // Coordination
  agent_board_read: {
    description: "Read the agent coordination board",
    inputSchema: {
      type: "object",
      properties: { last_n_lines: { type: "number" } },
    },
  },
  agent_board_write: {
    description: "Write to the agent coordination board",
    inputSchema: {
      type: "object",
      properties: {
        agent_name: { type: "string" },
        message: { type: "string" },
      },
      required: ["agent_name", "message"],
    },
  },
  agent_board_wait: {
    description: "Wait for new messages on the board",
    inputSchema: {
      type: "object",
      properties: {
        timeout_seconds: { type: "number", default: 30 },
        filter: { type: "string" },
      },
    },
  },
  agent_board_clear: {
    description: "Clear the agent board",
    inputSchema: { type: "object", properties: {} },
  },
  // Dev Agent tools
  dev_subscribe: {
    description: "Subscribe as a Dev Agent to receive tool execution logs",
    inputSchema: { type: "object", properties: {} },
  },
  dev_get_tool_logs: {
    description: "Get tool execution logs for analysis",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Filter by tool name" },
        result: { type: "string", enum: ["success", "failure", "timeout"] },
        since: { type: "number", description: "Timestamp to filter from" },
        limit: { type: "number", default: 50 },
      },
    },
  },
  dev_get_failure_summary: {
    description: "Get a summary of failed tool executions grouped by tool",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "number", description: "Timestamp to filter from" },
      },
    },
  },
  dev_clear_logs: {
    description: "Clear tool execution logs",
    inputSchema: { type: "object", properties: {} },
  },

  // === Dev Agent v2 ツール ===
  dev_publish_loop_result: {
    description: "Publish a loop result from Game Agent for Dev Agent analysis",
    inputSchema: {
      type: "object",
      properties: {
        loopResult: { type: "object", description: "LoopResult object with id, loopNumber, timestamp, success, summary, toolCalls, status, usage, intent" },
      },
      required: ["loopResult"],
    },
  },
  dev_get_loop_results: {
    description: "Get recent loop results for analysis",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10, description: "Max results to return (default: 10)" },
        since: { type: "number", description: "Timestamp to filter from" },
      },
    },
  },
  dev_get_config: {
    description: "Get current agent-config.json",
    inputSchema: { type: "object", properties: {} },
  },
  dev_save_config: {
    description: "Save updated agent-config.json and append to evolution history",
    inputSchema: {
      type: "object",
      properties: {
        config: { type: "object", description: "New AgentConfig object" },
        evolution: { type: "object", description: "EvolutionEntry describing the changes" },
      },
      required: ["config", "evolution"],
    },
  },
  dev_get_evolution_history: {
    description: "Get evolution history entries",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20, description: "Max entries to return" },
      },
    },
  },

  // === 自己学習ツール ===
  ...learningTools,

  // === タスク管理ツール ===
  ...Object.fromEntries(
    TASK_MANAGEMENT_TOOLS.map(tool => [tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema
    }])
  ),
};

// Handle tool calls
async function handleTool(
  ws: WebSocket,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = connectionBots.get(ws);

  // Check for critical state before executing dangerous tools
  const criticalAbort = checkCriticalState(username, name);
  if (criticalAbort) {
    console.error(`[MCP-WS] Critical state abort: ${name} blocked for ${username}`);
    return criticalAbort;
  }

  switch (name) {
    case "minecraft_connect": {
      const host = (args.host as string) || process.env.MC_HOST || "localhost";
      const port = (args.port as number) || parseInt(process.env.MC_PORT || "25565");
      // Fixed username from env var (set by agent on startup)
      const botUsername = process.env.BOT_USERNAME || (args.username as string);
      const version = args.version as string | undefined;
      const agentType = (args.agentType as string) || "game";

      if (!botUsername) {
        throw new Error("username is required (or set BOT_USERNAME env var)");
      }

      // Check if bot already exists (reconnection case)
      if (botManager.isConnected(botUsername)) {
        connectionBots.set(ws, botUsername);
        connectionAgentTypes.set(ws, agentType);
        console.error(`[MCP-WS-Server] Reconnected WebSocket to existing bot: ${botUsername} (agentType: ${agentType})`);

        // Ensure viewer is running for this bot
        const viewerPort = botManager.getViewerPort(botUsername) || botManager.startViewer(botUsername);
        const viewerInfo = viewerPort ? ` (viewer: http://localhost:${viewerPort})` : "";

        return `Reconnected to existing bot ${botUsername}${viewerInfo}`;
      }

      const result = await botManager.connect({ host, port, username: botUsername, version });
      connectionBots.set(ws, botUsername);
      connectionAgentTypes.set(ws, agentType);
      console.error(`[MCP-WS-Server] Set agentType for ${botUsername}: ${agentType}`);
      return result;
    }

    case "minecraft_disconnect": {
      if (!username) throw new Error("Not connected to any bot");
      await botManager.disconnect(username);
      connectionBots.delete(ws);
      return "Disconnected";
    }

    case "minecraft_get_state": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await handleStateTool("minecraft_get_state", args);
    }

    case "minecraft_chat": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      await botManager.chat(username, args.message as string);
      return `Sent: ${args.message}`;
    }

    case "minecraft_get_chat_messages": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const clear = args.clear !== false;
      const messages = botManager.getChatMessages(username, clear);
      return JSON.stringify(messages);
    }


    case "agent_board_read": {
      return readBoard(args.last_n_lines as number | undefined);
    }

    case "agent_board_write": {
      return writeBoard(args.agent_name as string, args.message as string);
    }

    case "agent_board_wait": {
      return await waitForNewMessage(
        (args.timeout_seconds as number) || 30,
        args.filter as string | undefined
      );
    }

    case "agent_board_clear": {
      return clearBoard();
    }

    case "subscribe_events": {
      const subUsername = args.username as string;
      if (!subUsername) throw new Error("username is required");

      let subs = connectionSubscriptions.get(ws);
      if (!subs) {
        subs = new Set();
        connectionSubscriptions.set(ws, subs);
      }
      subs.add(subUsername);
      console.log(`[MCP-WS-Server] Connection subscribed to events for: ${subUsername}`);
      return `Subscribed to events for ${subUsername}`;
    }

    case "search_tools": {
      const query = (args.query as string) || "";
      const detail = (args.detail as "brief" | "full") || "brief";

      // IMPORTANT: search_tools always searches ALL tools (Progressive Disclosure)
      // Only tools/list is filtered by agent type
      const availableTools = new Set(Object.keys(tools));
      console.error(`[search_tools handler] availableTools size: ${availableTools.size}`);
      console.error(`[search_tools handler] Has minecraft_survival_routine: ${availableTools.has('minecraft_survival_routine')}`);

      // Search for matching tools
      const matchedTools = searchTools(query, availableTools);
      console.error(`[search_tools handler] matchedTools: ${matchedTools.join(', ')}`);

      if (detail === "brief") {
        // Return brief info: name and category only
        const results = matchedTools.map(name => {
          const metadata = TOOL_METADATA[name];
          return {
            name,
            category: metadata?.category || "unknown",
            priority: metadata?.priority || 0,
          };
        });
        return JSON.stringify({ query, count: results.length, tools: results }, null, 2);
      } else {
        // Return full info: name, category, description, and input schema
        const results = matchedTools.map(name => {
          const metadata = TOOL_METADATA[name];
          const toolDef = tools[name as keyof typeof tools];
          return {
            name,
            category: metadata?.category || "unknown",
            tags: metadata?.tags || [],
            description: toolDef?.description || "",
            inputSchema: toolDef?.inputSchema || {},
          };
        });
        return JSON.stringify({ query, count: results.length, tools: results }, null, 2);
      }
    }

    // Dev Agent tools
    case "dev_subscribe": {
      devAgentConnections.add(ws);
      console.log(`[MCP-WS-Server] Dev Agent subscribed. Total: ${devAgentConnections.size}`);
      return `Subscribed as Dev Agent. You will receive tool execution logs.`;
    }

    case "dev_get_tool_logs": {
      const logs = getToolLogs({
        tool: args.tool as string | undefined,
        result: args.result as "success" | "failure" | "timeout" | undefined,
        since: args.since as number | undefined,
        limit: (args.limit as number) || 50,
      });
      return JSON.stringify(logs, null, 2);
    }

    case "dev_get_failure_summary": {
      const since = args.since as number | undefined;
      let logs = toolExecutionLogs.filter(l => l.result === "failure");
      if (since) {
        logs = logs.filter(l => l.timestamp > since);
      }

      // Group by tool
      const summary: Record<string, { count: number; errors: string[]; examples: ToolExecutionLog[] }> = {};
      for (const log of logs) {
        if (!summary[log.tool]) {
          summary[log.tool] = { count: 0, errors: [], examples: [] };
        }
        summary[log.tool].count++;
        if (log.error && !summary[log.tool].errors.includes(log.error)) {
          summary[log.tool].errors.push(log.error);
        }
        if (summary[log.tool].examples.length < 3) {
          summary[log.tool].examples.push(log);
        }
      }

      return JSON.stringify(summary, null, 2);
    }

    case "dev_clear_logs": {
      toolExecutionLogs.length = 0;
      try {
        writeFileSync(TOOL_LOG_FILE, "");
      } catch (e) {
        // Ignore
      }
      return "Tool logs cleared";
    }

    // === Dev Agent v2 tools ===
    case "dev_publish_loop_result": {
      const loopResult = args.loopResult as LoopResult;
      if (!loopResult) throw new Error("loopResult is required");

      // Store in memory
      loopResults.push(loopResult);
      if (loopResults.length > MAX_LOOP_RESULTS) {
        loopResults.shift();
      }

      // Persist to file
      try {
        ensureLogDir();
        appendFileSync(LOOP_RESULT_FILE, JSON.stringify(loopResult) + "\n");
      } catch (e) {
        console.error("[MCP-WS-Server] Failed to write loop result:", e);
      }

      // Notify Dev Agents
      const loopNotification = {
        jsonrpc: "2.0",
        method: "notifications/loopResult",
        params: loopResult,
      };
      const loopJson = JSON.stringify(loopNotification);

      devAgentConnections.forEach((devWs) => {
        if (devWs.readyState === WebSocket.OPEN) {
          devWs.send(loopJson);
        }
      });

      console.log(`[MCP-WS-Server] Loop result #${loopResult.loopNumber} published (success=${loopResult.success})`);
      return `Loop result #${loopResult.loopNumber} published`;
    }

    case "dev_get_loop_results": {
      const limit = (args.limit as number) || 10;
      const since = args.since as number | undefined;

      let results = [...loopResults];
      if (since) {
        results = results.filter(r => r.timestamp > since);
      }
      results = results.slice(-limit);

      return JSON.stringify(results, null, 2);
    }

    case "dev_get_config": {
      try {
        const configContent = readFileSync(AGENT_CONFIG_FILE, "utf-8");
        return configContent;
      } catch (e) {
        throw new Error(`Failed to read agent-config.json: ${e}`);
      }
    }

    case "dev_save_config": {
      const config = args.config as Record<string, unknown>;
      const evolution = args.evolution as Record<string, unknown>;

      if (!config) throw new Error("config is required");

      try {
        // Save config
        writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
        console.log(`[MCP-WS-Server] Agent config saved (version ${config.version})`);

        // Append evolution entry
        if (evolution) {
          appendFileSync(EVOLUTION_HISTORY_FILE, JSON.stringify(evolution) + "\n");
          console.log(`[MCP-WS-Server] Evolution entry appended`);
        }

        return `Config saved (version ${config.version})`;
      } catch (e) {
        throw new Error(`Failed to save config: ${e}`);
      }
    }

    case "dev_get_evolution_history": {
      const limit = (args.limit as number) || 20;

      try {
        if (!existsSync(EVOLUTION_HISTORY_FILE)) {
          return "[]";
        }
        const content = readFileSync(EVOLUTION_HISTORY_FILE, "utf-8");
        const entries = content
          .trim()
          .split("\n")
          .filter(line => line.trim())
          .map(line => JSON.parse(line));

        return JSON.stringify(entries.slice(-limit), null, 2);
      } catch (e) {
        throw new Error(`Failed to read evolution history: ${e}`);
      }
    }


    // === High-level action tools ===
    case "minecraft_gather_resources": {
      const username = args.username as string;
      const items = args.items as Array<{ name: string; count: number }>;
      const maxDistance = (args.maxDistance as number) || 32;

      // Use local botManager instead of the one imported by high-level-actions
      // to ensure we're using the same instance where the bot is registered
      const results: string[] = [];

      for (const item of items) {
        let collected = 0;
        const targetCount = item.count;
        let attempts = 0;
        const maxAttempts = targetCount * 3;

        while (collected < targetCount && attempts < maxAttempts) {
          attempts++;

          try {
            const findResult = botManager.findBlock(username, item.name, maxDistance);

            if (findResult.includes("No") || findResult.includes("not found")) {
              break;
            }

            const posMatch = findResult.match(/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/);
            if (!posMatch) {
              break;
            }

            const x = parseFloat(posMatch[1]);
            const y = parseFloat(posMatch[2]);
            const z = parseFloat(posMatch[3]);

            const moveResult = await botManager.moveTo(username, x, y, z);
            if (!moveResult.includes("Reached") && !moveResult.includes("Moved")) {
              continue;
            }

            const invBefore = botManager.getInventory(username);
            const beforeCount = invBefore.find(i => i.name === item.name)?.count || 0;

            await botManager.digBlock(username, Math.floor(x), Math.floor(y), Math.floor(z));
            await botManager.collectNearbyItems(username);

            const invAfter = botManager.getInventory(username);
            const afterCount = invAfter.find(i => i.name === item.name)?.count || 0;
            const gained = afterCount - beforeCount;

            if (gained > 0) {
              collected += gained;
            }

            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (err) {
            console.error(`[GatherResources] Error: ${err}`);
            continue;
          }
        }

        results.push(`${item.name}: ${collected}/${targetCount}`);
      }

      const inventory = botManager.getInventory(username);
      const invStr = inventory.map(i => `${i.name}(${i.count})`).join(", ");

      return `Gathering complete. ${results.join(", ")}. Inventory: ${invStr}`;
    }

    case "minecraft_build_structure": {
      const username = args.username as string;
      const type = args.type as "shelter" | "wall" | "platform" | "tower";
      const size = args.size as "small" | "medium" | "large";
      return await minecraft_build_structure(username, type, size);
    }

    case "minecraft_craft_chain": {
      const username = args.username as string;
      const target = args.target as string;
      const autoGather = (args.autoGather as boolean) || false;
      return await minecraft_craft_chain(username, target, autoGather);
    }

    case "minecraft_survival_routine": {
      const username = args.username as string;
      const priority = args.priority as "food" | "shelter" | "tools" | "auto";
      return await minecraft_survival_routine(username, priority);
    }

    case "minecraft_explore_area": {
      const username = args.username as string;
      const radius = args.radius as number;
      const target = args.target as string | undefined;
      return await minecraft_explore_area(username, radius, target);
    }

    case "minecraft_validate_survival_environment": {
      const username = args.username as string;
      const searchRadius = (args.searchRadius as number) || 100;
      return await minecraft_validate_survival_environment(username, searchRadius);
    }

    // === 自己学習ツール ===
    case "log_experience":
    case "get_recent_experiences":
    case "reflect_and_learn":
    case "save_rule":
    case "get_rules":
    case "get_reflection_insights":
    case "remember_location":
    case "recall_locations":
    case "forget_location":
    case "save_memory":
    case "recall_memory":
    case "forget_memory":
    case "migrate_memory":
    case "list_agent_skills":
    case "get_agent_skill": {
      return await handleLearningTool(name, args);
    }

    // === タスク管理ツール ===
    case "task_create": {
      return await taskCreate(args as any);
    }

    case "task_list": {
      return await taskList(args as any);
    }

    case "task_get": {
      return await taskGet(args as any);
    }

    case "task_update": {
      return await taskUpdate(args as any);
    }

    // === Combat tools ===
    case "minecraft_get_status":
    case "minecraft_get_nearby_entities":
    case "minecraft_attack":
    case "minecraft_eat":
    case "minecraft_equip_armor":
    case "minecraft_equip_weapon":
    case "minecraft_flee":
    case "minecraft_respawn": {
      return await handleCombatTool(name, args);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Handle JSON-RPC requests
async function handleRequest(ws: WebSocket, request: JSONRPCRequest): Promise<JSONRPCResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'tools/list': {
        const agentType = connectionAgentTypes.get(ws) || "game";

        // Filter tools based on agent type
        const allTools = Object.entries(tools);
        const filteredTools = agentType === "dev"
          ? allTools  // Dev Agent gets all tools
          : allTools.filter(([name]) => GAME_AGENT_TOOLS.has(name));  // Game Agent gets basic tools only (complex ops via skills)

        const toolList = filteredTools.map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));

        console.error(`[MCP-WS-Server] tools/list for agentType=${agentType}: ${toolList.length} tools`);
        return { jsonrpc: '2.0', id, result: { tools: toolList } };
      }

      case 'tools/call': {
        const toolName = params?.name as string;
        const toolArgs = (params?.arguments || {}) as Record<string, unknown>;

        if (!toolName) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name' }
          };
        }

        // Auto-connect disabled for debugging
        // const skipAutoConnect = ["minecraft_connect", "minecraft_disconnect", "dev_subscribe", "subscribe_events"].includes(toolName);
        // if (!skipAutoConnect) {
        //   // ... auto-connect logic
        // }

        const startTime = Date.now();
        const agentName = connectionBots.get(ws) || "unknown";

        try {
          const rawResult = await handleTool(ws, toolName, toolArgs);
          // Check for failure patterns and throw if detected
          const result = throwOnFailureResult(toolName, rawResult);
          const duration = Date.now() - startTime;

          // Record successful execution (skip dev_* tools to avoid noise)
          if (!toolName.startsWith("dev_") && !toolName.startsWith("subscribe_")) {
            recordToolExecution(toolName, toolArgs, "success", result, undefined, duration, agentName);
          }

          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: result }] }
          };
        } catch (toolError) {
          const duration = Date.now() - startTime;
          const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);
          console.error(`[MCP-WS-Server] Tool error in ${toolName}: ${errorMessage}`);

          // Record failed execution
          if (!toolName.startsWith("dev_")) {
            recordToolExecution(toolName, toolArgs, "failure", undefined, errorMessage, duration, agentName);
          }

          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32603, message: errorMessage, data: { tool: toolName, args: toolArgs } }
          };
        }
      }

      case 'ping': {
        return { jsonrpc: '2.0', id, result: { pong: true, timestamp: Date.now() } };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: errorMessage }
    };
  }
}

// Start WebSocket server
function startServer(port: number = 8765) {
  const wss = new WebSocketServer({ port });

  console.log(`[MCP-WS-Server] Starting on port ${port}...`);

  wss.on('connection', (ws: WebSocket, req) => {
    const clientAddr = req.socket.remoteAddress;
    console.log(`[MCP-WS-Server] Client connected from ${clientAddr}`);

    // Track connection for event broadcasting
    activeConnections.add(ws);

    ws.on('message', async (data: Buffer) => {
      try {
        const request = JSON.parse(data.toString()) as JSONRPCRequest;
        const botName = connectionBots.get(ws) || 'new';
        const timestamp = new Date().toLocaleTimeString('ja-JP');

        // Log request
        if (request.method === 'tools/call') {
          const toolName = request.params?.name as string;
          const toolArgs = request.params?.arguments;
          console.log(`[${timestamp}] ${botName}: ${toolName} ${JSON.stringify(toolArgs)}`);
        } else {
          console.log(`[${timestamp}] ${botName}: ${request.method}`);
        }

        const response = await handleRequest(ws, request);

        // Log response status
        if (response.error) {
          console.log(`[${timestamp}] ${botName}: -> ERROR ${response.error.code}: ${response.error.message}`);
        }

        ws.send(JSON.stringify(response));
      } catch (error) {
        console.error('[MCP-WS-Server] Parse error:', error);
        const errorResponse: JSONRPCResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32700, message: 'Parse error' }
        };
        ws.send(JSON.stringify(errorResponse));
      }
    });

    ws.on('close', () => {
      const username = connectionBots.get(ws);
      console.log(`[MCP-WS-Server] Client disconnected: ${clientAddr} (bot: ${username || 'none'})`);
      // Remove from active connections
      activeConnections.delete(ws);
      // Note: We don't disconnect the bot here - it persists for reconnection
    });

    ws.on('error', (error) => {
      console.error(`[MCP-WS-Server] WebSocket error:`, error);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'server/ready',
      params: {
        name: 'mineflayer-mcp-server',
        version: '1.0.0',
        tools: Object.keys(tools),
        connectedBots: botManager.getAllBots(),
      }
    }));
  });

  wss.on('listening', () => {
    console.log(`[MCP-WS-Server] Mineflayer MCP WebSocket Server running on ws://localhost:${port}`);
    console.log(`[MCP-WS-Server] Available tools: ${Object.keys(tools).join(', ')}`);
  });

  wss.on('error', (error) => {
    console.error('[MCP-WS-Server] Server error:', error);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[MCP-WS-Server] Shutting down...');
    botManager.disconnectAll();
    wss.close(() => {
      console.log('[MCP-WS-Server] Server closed');
      process.exit(0);
    });
  });

  return wss;
}

// Main entry point
const port = parseInt(process.env.MCP_WS_PORT || '8765', 10);
startServer(port);
