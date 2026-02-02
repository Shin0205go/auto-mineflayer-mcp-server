#!/usr/bin/env node

/**
 * MCP WebSocket Server
 *
 * Exposes the MCP tools via WebSocket.
 * Each connection can have its own bot (identified by username).
 */

import { WebSocketServer, WebSocket } from 'ws';
import { botManager } from "./bot-manager.js";
import { readBoard, writeBoard, waitForNewMessage, clearBoard } from "./tools/coordination.js";
import { appendFileSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ToolExecutionLog, ToolExecutionContext } from "./types/tool-log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Tool execution log storage
const TOOL_LOG_FILE = join(__dirname, "..", "logs", "tool-execution.jsonl");
const toolExecutionLogs: ToolExecutionLog[] = [];
const MAX_LOGS_IN_MEMORY = 500;

// Dev Agent subscriptions (for receiving tool logs)
const devAgentConnections = new Set<WebSocket>();

// Ensure logs directory exists
function ensureLogDir() {
  const logDir = join(__dirname, "..", "logs");
  if (!existsSync(logDir)) {
    const { mkdirSync } = require("fs");
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
  activeConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      const botUsername = connectionBots.get(ws);
      const subscriptions = connectionSubscriptions.get(ws);
      const isSubscribed = subscriptions?.has(username) || false;
      if (botUsername === username || isSubscribed) {
        ws.send(json);
      }
    }
  });
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
      },
      required: ["username"],
    },
  },
  minecraft_disconnect: {
    description: "Disconnect from the Minecraft server",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_get_position: {
    description: "Get the bot's current position",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_move_to: {
    description: "Move the bot to a specific position using pathfinder",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
      },
      required: ["x", "y", "z"],
    },
  },
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
  minecraft_get_events: {
    description: "Get recent game events (damage, item pickup, hostile spawns, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        clear: { type: "boolean", default: true, description: "Clear events after reading" },
        last_n: { type: "number", description: "Only get last N events" },
      },
    },
  },
  minecraft_get_surroundings: {
    description: "Get immediate surroundings - which directions are passable, blocked, what's above/below",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_find_block: {
    description: "Find specific block type nearby and get its exact coordinates",
    inputSchema: {
      type: "object",
      properties: {
        block_name: { type: "string", description: "Block to find (e.g., 'oak_planks', 'stone', 'iron_ore')" },
        max_distance: { type: "number", default: 10 },
      },
      required: ["block_name"],
    },
  },
  minecraft_place_block: {
    description: "Place a block from your inventory at the specified position. You must have the block in your inventory first!",
    inputSchema: {
      type: "object",
      properties: {
        block_type: { type: "string", description: "Block type from your inventory (e.g., 'cobblestone', 'oak_planks')" },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
      },
      required: ["block_type", "x", "y", "z"],
    },
  },
  minecraft_dig_block: {
    description: "Mine/dig a block at the specified position. The block will drop as an item that you can collect.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
      },
      required: ["x", "y", "z"],
    },
  },
  minecraft_collect_items: {
    description: "Collect nearby dropped items by moving to them",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_get_inventory: {
    description: "Get bot's inventory",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_craft: {
    description: "Craft an item",
    inputSchema: {
      type: "object",
      properties: {
        item_name: { type: "string" },
        count: { type: "number", default: 1 },
      },
      required: ["item_name"],
    },
  },
  minecraft_smelt: {
    description: "Smelt items in a furnace (ore to ingot, food to cooked). Needs furnace within 4 blocks and fuel in inventory.",
    inputSchema: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Item to smelt (e.g., raw_iron, raw_beef)" },
        count: { type: "number", default: 1 },
      },
      required: ["item_name"],
    },
  },
  minecraft_sleep: {
    description: "Sleep in a bed to skip the night. Needs bed within 4 blocks. Only works at night.",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_use_item: {
    description: "Use/activate the held item (right-click). For bucket, flint_and_steel, ender_eye, etc.",
    inputSchema: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Item to equip and use (optional, uses held item if not specified)" },
      },
    },
  },
  minecraft_drop_item: {
    description: "Drop items from inventory onto the ground (for sharing with other bots)",
    inputSchema: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Item to drop" },
        count: { type: "number", description: "How many to drop (default: all)" },
      },
      required: ["item_name"],
    },
  },
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
  // Event subscription
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
  // Combat tools
  minecraft_get_status: {
    description: "Get bot's health, hunger, and equipment status",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_get_nearby_entities: {
    description: "Get nearby entities (mobs, players, animals)",
    inputSchema: {
      type: "object",
      properties: {
        range: { type: "number", default: 16 },
        type: { type: "string", enum: ["all", "hostile", "passive", "player"] },
      },
    },
  },
  minecraft_fight: {
    description: "Fight an entity until it dies or health is low. Auto-equips weapon, approaches, attacks repeatedly, and flees if HP drops below threshold",
    inputSchema: {
      type: "object",
      properties: {
        entity_name: { type: "string", description: "Entity to fight (e.g., 'zombie'). If not specified, fights nearest hostile" },
        flee_health: { type: "number", default: 6, description: "Flee when HP drops to this (default: 6 = 3 hearts)" },
      },
    },
  },
  minecraft_eat: {
    description: "Eat food from inventory to restore hunger",
    inputSchema: {
      type: "object",
      properties: {
        food_name: { type: "string" },
      },
    },
  },
  minecraft_equip_item: {
    description: "Equip any item from inventory (pickaxe, axe, sword, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Item to equip (e.g., 'wooden_pickaxe', 'stone_axe')" },
      },
      required: ["item_name"],
    },
  },
  minecraft_pillar_up: {
    description: "Jump and place blocks below to climb up (useful when stuck or need to reach higher places)",
    inputSchema: {
      type: "object",
      properties: {
        height: { type: "number", default: 1, description: "How many blocks to go up" },
      },
    },
  },
  minecraft_flee: {
    description: "Run away from danger",
    inputSchema: {
      type: "object",
      properties: {
        distance: { type: "number", default: 20 },
      },
    },
  },
  minecraft_get_biome: {
    description: "Get current biome information. Useful for finding where specific mobs spawn (e.g., sheep spawn in plains, meadow, forest)",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_find_entities: {
    description: "Find nearby entities (mobs, animals, players). Use to locate sheep, cows, pigs, etc.",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: { type: "string", description: "Filter by entity type (e.g., 'sheep', 'cow', 'zombie')" },
        max_distance: { type: "number", default: 32, description: "Search radius in blocks" },
      },
    },
  },
  minecraft_explore_for_biome: {
    description: "Walk in a direction looking for a specific biome type. Use when you need to find sheep (plains, meadow) or other biome-specific resources",
    inputSchema: {
      type: "object",
      properties: {
        target_biome: { type: "string", description: "Biome to find (e.g., 'plains', 'forest', 'desert')" },
        direction: { type: "string", enum: ["north", "south", "east", "west", "random"], default: "random" },
        max_blocks: { type: "number", default: 200, description: "Maximum distance to explore" },
      },
      required: ["target_biome"],
    },
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
};

// Handle tool calls
async function handleTool(
  ws: WebSocket,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = connectionBots.get(ws);

  switch (name) {
    case "minecraft_connect": {
      const host = (args.host as string) || process.env.MC_HOST || "localhost";
      const port = (args.port as number) || parseInt(process.env.MC_PORT || "25565");
      // Fixed username from env var (set by agent on startup)
      const botUsername = process.env.BOT_USERNAME || (args.username as string);
      const version = args.version as string | undefined;

      if (!botUsername) {
        throw new Error("username is required (or set BOT_USERNAME env var)");
      }

      // Check if bot already exists (reconnection case)
      if (botManager.isConnected(botUsername)) {
        connectionBots.set(ws, botUsername);
        console.error(`[MCP-WS-Server] Reconnected WebSocket to existing bot: ${botUsername}`);
        return `Reconnected to existing bot ${botUsername}`;
      }

      const result = await botManager.connect({ host, port, username: botUsername, version });
      connectionBots.set(ws, botUsername);
      return result;
    }

    case "minecraft_disconnect": {
      if (!username) throw new Error("Not connected to any bot");
      await botManager.disconnect(username);
      connectionBots.delete(ws);
      return "Disconnected";
    }

    case "minecraft_get_position": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const pos = botManager.getPosition(username);
      if (!pos) throw new Error("Bot not found");
      return JSON.stringify(pos);
    }

    case "minecraft_move_to": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const moveResult = await botManager.moveTo(username, args.x as number, args.y as number, args.z as number);
      return moveResult;
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

    case "minecraft_get_events": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const clear = args.clear !== false;
      const lastN = args.last_n as number | undefined;
      const events = botManager.getGameEvents(username, clear, lastN);
      if (events.length === 0) {
        return "No recent events";
      }
      return events.map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString("ja-JP");
        return `[${time}] ${e.type}: ${e.message}`;
      }).join("\n");
    }

    case "minecraft_get_surroundings": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return botManager.getSurroundings(username);
    }

    case "minecraft_find_block": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const blockName = args.block_name as string;
      const maxDistance = (args.max_distance as number) || 10;
      return botManager.findBlock(username, blockName, maxDistance);
    }

    case "minecraft_place_block": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      // Always use survival mode (no /setblock command)
      const result = await botManager.placeBlock(
        username,
        args.block_type as string,
        args.x as number,
        args.y as number,
        args.z as number,
        false  // survival mode only
      );
      return result.message;
    }

    case "minecraft_dig_block": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      // Always use survival mode (actual mining)
      return await botManager.digBlock(username, args.x as number, args.y as number, args.z as number, false);
    }

    case "minecraft_collect_items": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.collectNearbyItems(username);
    }

    case "minecraft_get_inventory": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const items = botManager.getInventory(username);
      if (items.length === 0) return "Inventory is empty";
      return items.map((i) => `${i.name}: ${i.count}`).join("\n");
    }

    case "minecraft_craft": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.craftItem(username, args.item_name as string, (args.count as number) || 1);
    }

    case "minecraft_smelt": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.smeltItem(username, args.item_name as string, (args.count as number) || 1);
    }

    case "minecraft_sleep": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.sleep(username);
    }

    case "minecraft_use_item": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.useItem(username, args.item_name as string | undefined);
    }

    case "minecraft_drop_item": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.dropItem(username, args.item_name as string, args.count as number | undefined);
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

    // Combat tools
    case "minecraft_get_status": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return botManager.getStatus(username);
    }

    case "minecraft_get_nearby_entities": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const range = (args.range as number) || 16;
      const type = (args.type as string) || "all";
      return botManager.getNearbyEntities(username, range, type);
    }

    case "minecraft_fight": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const entityName = args.entity_name as string | undefined;
      const fleeHealth = (args.flee_health as number) || 6;
      return await botManager.fight(username, entityName, fleeHealth);
    }

    case "minecraft_eat": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.eat(username, args.food_name as string | undefined);
    }

    case "minecraft_equip_item": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.equipItem(username, args.item_name as string);
    }

    case "minecraft_pillar_up": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const height = (args.height as number) || 1;
      return await botManager.pillarUp(username, height);
    }

    case "minecraft_flee": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const distance = (args.distance as number) || 20;
      return await botManager.flee(username, distance);
    }

    case "minecraft_get_biome": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.getBiome(username);
    }

    case "minecraft_find_entities": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const entityType = args.entity_type as string | undefined;
      const maxDistance = (args.max_distance as number) || 32;
      return botManager.findEntities(username, entityType, maxDistance);
    }

    case "minecraft_explore_for_biome": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const targetBiome = args.target_biome as string;
      const direction = (args.direction as "north" | "south" | "east" | "west" | "random") || "random";
      const maxBlocks = (args.max_blocks as number) || 200;
      return await botManager.exploreForBiome(username, targetBiome, direction, maxBlocks);
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
        const toolList = Object.entries(tools).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
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

        const startTime = Date.now();
        const agentName = connectionBots.get(ws) || "unknown";

        try {
          const result = await handleTool(ws, toolName, toolArgs);
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
