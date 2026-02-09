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
import { learningTools, handleLearningTool, getAgentSkill } from "./tools/learning.js";
import { appendFileSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ToolExecutionLog, ToolExecutionContext } from "./types/tool-log.js";
import type { LoopResult } from "./types/agent-config.js";
import { StabilityAnalyzer } from "./stability-analyzer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Tool execution log storage
const TOOL_LOG_FILE = join(__dirname, "..", "logs", "tool-execution.jsonl");
const toolExecutionLogs: ToolExecutionLog[] = [];
const MAX_LOGS_IN_MEMORY = 500;

// Dev Agent subscriptions (for receiving tool logs)
const devAgentConnections = new Set<WebSocket>();

// Stability analyzer
const stabilityAnalyzer = new StabilityAnalyzer();

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

// Tools that are always allowed (safe/recovery actions)
const SAFE_TOOLS = new Set([
  "minecraft_connect",
  "minecraft_disconnect",
  "minecraft_get_position",
  "minecraft_get_status",
  "minecraft_get_surroundings",
  "minecraft_get_inventory",
  "minecraft_get_equipment",
  "minecraft_get_nearby_entities",
  "minecraft_get_biome",
  "minecraft_get_chat_messages",
  "minecraft_chat",
  "minecraft_eat",           // Recovery action
  "minecraft_flee",          // Safety action
  "minecraft_sleep",         // Safety action
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
  // Stability analysis tools
  "dev_get_stability_metrics",
  "dev_get_unstable_disturbances",
  "dev_get_failed_responses",
  "dev_get_failure_modes",
  "dev_get_most_unstable_mode",
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

    if (hp <= CRITICAL_HP_THRESHOLD) {
      return `【緊急中断】HP=${hp}（危険水準）。このツールは実行できません。` +
        `\n\n即座に以下のいずれかを実行してください:` +
        `\n1. minecraft_eat で食事（インベントリに食料があれば）` +
        `\n2. minecraft_flee で安全な場所へ逃走` +
        `\n3. スキルを終了して親エージェントに報告` +
        `\n\n現在の状態: HP=${hp}/20, 食料=${statusObj.food}/20`;
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

  // Record for stability analysis
  stabilityAnalyzer.onToolExecution(agentName, {
    tool,
    success: result === "success",
    duration,
    error
  });

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
  "minecraft_get_surroundings",
  "minecraft_get_status",
  "minecraft_get_equipment",
  "minecraft_get_position",
  "minecraft_get_inventory",
  "minecraft_look_around",
  "minecraft_get_entities",
  "minecraft_find_entities",   // "No cow found" is valid info, not an error
  "minecraft_find_block",      // "No oak_log found" is valid info, not an error
  "minecraft_move_to",         // "Path blocked" is gameplay info, not an error
  "minecraft_craft",           // Missing materials is info, not error
  "minecraft_smelt",           // Missing furnace/fuel is info, not error
  "agent_board_read",
  "get_recent_experiences",
  "get_skills",
  "recall_locations",
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

// Track all active WebSocket connections for event broadcasting
const activeConnections = new Set<WebSocket>();

// Listen for game events from BotManager and push to clients
botManager.on("gameEvent", (username: string, event: { type: string; message: string; timestamp: number; data?: Record<string, unknown> }) => {
  // Record disturbance for stability analysis
  const systemState = botManager.getSystemState(username);
  if (systemState) {
    stabilityAnalyzer.onGameEvent(username, {
      type: event.type,
      message: event.message,
      priority: 'medium' // TODO: get actual priority from event
    }, systemState);
  }

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
  minecraft_get_surroundings: {
    description: "詳細な周囲情報を取得。移動可能方向、光レベル、時刻、天気、危険（溶岩/敵）、近くの資源（座標付き）、動物など。状況判断に重要！",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_find_block: {
    description: "Find specific block type nearby and get its exact coordinates",
    inputSchema: {
      type: "object",
      properties: {
        block_name: { type: "string", description: "Block to find (e.g., 'oak_planks', 'stone', 'iron_ore')" },
        max_distance: { type: "number", default: 64, description: "Search radius (default: 64)" },
      },
      required: ["block_name"],
    },
  },
  minecraft_check_infrastructure: {
    description: "Check for nearby crafting tables and furnaces + saved locations. CALL THIS FIRST before crafting complex items or smelting!",
    inputSchema: {
      type: "object",
      properties: {
        max_distance: { type: "number", description: "Search radius (default: 64)" },
      },
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
  minecraft_get_equipment: {
    description: "Get detailed equipment in each slot (head, chest, legs, feet, hands)",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_get_nearby_entities: {
    description: "Get nearby entities (mobs, players, animals)",
    inputSchema: {
      type: "object",
      properties: {
        range: { type: "number", default: 32, description: "Detection range (default: 32)" },
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
    description: "Jump and place blocks below to climb up. Uses cobblestone/dirt/stone from inventory. Max 20 blocks.",
    inputSchema: {
      type: "object",
      properties: {
        height: { type: "number", default: 5, description: "How many blocks to go up (default: 5, max: 20)" },
      },
    },
  },
  minecraft_tunnel: {
    description: "Dig a 1x2 tunnel in a direction. Efficient for mining, escaping underground, or creating paths. Auto-equips pickaxe and collects items. Reports ores found! Note: For going UP, use minecraft_pillar_up instead.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["north", "south", "east", "west", "down", "up"], description: "Direction to dig (for up, use minecraft_pillar_up)" },
        length: { type: "number", default: 10, description: "How many blocks to dig (default: 10)" },
      },
      required: ["direction"],
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
  minecraft_fish: {
    description: "Fish using a fishing rod. Great for getting food (cod, salmon) and treasure (enchanted books, bows). Requires: fishing rod (3 sticks + 2 string) and nearby water.",
    inputSchema: {
      type: "object",
      properties: {
        duration: { type: "number", default: 30, description: "How long to fish in seconds (default: 30)" },
      },
    },
  },
  minecraft_trade_villager: {
    description: "Trade with a nearby villager or wandering trader. Without tradeIndex, lists available trades. With tradeIndex, executes that trade.",
    inputSchema: {
      type: "object",
      properties: {
        tradeIndex: { type: "number", description: "Index of trade to execute (0-based). Omit to list trades." },
      },
    },
  },
  minecraft_respawn: {
    description: "LAST RESORT ONLY! Intentionally die and respawn. Use ONLY when: HP <= 2 (1 heart) AND no food AND no escape possible. Loses ALL inventory! Try eating, fleeing, or pillar_up first.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why respawning (e.g., 'stuck underground no food')" },
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
        max_distance: { type: "number", default: 64, description: "Search radius in blocks (default: 64)" },
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
        max_blocks: { type: "number", default: 256, description: "Maximum distance to explore (default: 256)" },
      },
      required: ["target_biome"],
    },
  },
  minecraft_list_recipes: {
    description: "Get all craftable item recipes by category. Use this to learn what you can make in Minecraft. Categories: tools, weapons, armor, basics, food, building",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category: tools, weapons, armor, basics, food, building (omit for all)" },
      },
    },
  },
  minecraft_list_craftable: {
    description: "Check what you can craft RIGHT NOW with current inventory. Shows: (1) items you can craft immediately, (2) items you're 1 material away from crafting. Use this to decide what to make next!",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_list_chest: {
    description: "Check what's in nearest chest. Use after respawn to see what you saved, or before crafting to check materials.",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_store_in_chest: {
    description: "Store items in a chest. WHEN TO USE: (1) After crafting backup tools - store spares, (2) After mining ores/ingots - store what you don't need now, (3) Before going far from base, (4) Before fighting mobs, (5) Before going underground. TIP: Craft chest (8 planks) near spawn first!",
    inputSchema: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Item to store (e.g., 'iron_ingot', 'diamond', 'stone_pickaxe')" },
        count: { type: "number", description: "How many to store (default: all)" },
      },
      required: ["item_name"],
    },
  },
  minecraft_take_from_chest: {
    description: "Take items from chest. Use after respawn to get back your stored tools! Also use when you need a specific item for crafting.",
    inputSchema: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Item to take (e.g., 'stone_pickaxe', 'food')" },
        count: { type: "number", description: "How many to take (default: all)" },
      },
      required: ["item_name"],
    },
  },
  // === Additional Mineflayer API Tools ===
  minecraft_wake: {
    description: "Wake up from bed. Use when bot is sleeping and you need to act.",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_elytra_fly: {
    description: "Start elytra flying. Must be falling/gliding with elytra equipped. Use firework rockets for boost.",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_mount: {
    description: "Mount an entity (horse, donkey, pig, boat, minecart). Entity must be within 5 blocks.",
    inputSchema: {
      type: "object",
      properties: {
        entity_name: { type: "string", description: "Entity to mount (e.g., 'horse', 'boat'). If omitted, mounts nearest mountable." },
      },
    },
  },
  minecraft_dismount: {
    description: "Dismount from current vehicle (horse, boat, minecart, etc.)",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_activate_block: {
    description: "Activate a block (button, lever, door, trapdoor, gate, etc.). Right-click action.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Block X coordinate" },
        y: { type: "number", description: "Block Y coordinate" },
        z: { type: "number", description: "Block Z coordinate" },
      },
      required: ["x", "y", "z"],
    },
  },
  minecraft_enchant: {
    description: "Enchant an item using enchanting table. Requires lapis lazuli and XP levels.",
    inputSchema: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Item to enchant (e.g., 'diamond_sword', 'iron_pickaxe')" },
        level: { type: "number", default: 1, description: "Enchantment level (1-3)" },
      },
      required: ["item_name"],
    },
  },
  minecraft_use_anvil: {
    description: "Use anvil to repair, combine, or rename items. Costs XP levels.",
    inputSchema: {
      type: "object",
      properties: {
        target_item: { type: "string", description: "Item to repair/rename (e.g., 'diamond_pickaxe')" },
        material_item: { type: "string", description: "Material for repair (e.g., 'diamond') or item to combine" },
        new_name: { type: "string", description: "New name for the item (optional)" },
      },
      required: ["target_item"],
    },
  },
  minecraft_update_sign: {
    description: "Write text on a sign. Sign must be within 4 blocks. Use newlines to separate lines.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Sign X coordinate" },
        y: { type: "number", description: "Sign Y coordinate" },
        z: { type: "number", description: "Sign Z coordinate" },
        text: { type: "string", description: "Text to write (use newlines for multiple lines)" },
        back: { type: "boolean", default: false, description: "Write on back of sign (1.20+)" },
      },
      required: ["x", "y", "z", "text"],
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

  // === 安定性分析ツール ===
  dev_get_stability_metrics: {
    description: "Get stability metrics (success rate, settlement time) for each disturbance type",
    inputSchema: { type: "object", properties: {} },
  },
  dev_get_unstable_disturbances: {
    description: "Get list of disturbance types with stabilization rate < 80%",
    inputSchema: { type: "object", properties: {} },
  },
  dev_get_failed_responses: {
    description: "Get failed disturbance responses for analysis",
    inputSchema: {
      type: "object",
      properties: {
        disturbanceType: { type: "string", description: "Filter by disturbance type" },
        limit: { type: "number", default: 10, description: "Max responses to return" },
      },
    },
  },
  dev_get_failure_modes: {
    description: "Get eigenmode analysis (conceptual): failure patterns with pseudo-eigenvalues, dominant variables",
    inputSchema: { type: "object", properties: {} },
  },
  dev_get_most_unstable_mode: {
    description: "Get the most unstable failure mode (highest positive pseudo-eigenvalue)",
    inputSchema: { type: "object", properties: {} },
  },

  // === 自己学習ツール ===
  ...learningTools,
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

      if (!botUsername) {
        throw new Error("username is required (or set BOT_USERNAME env var)");
      }

      // Check if bot already exists (reconnection case)
      if (botManager.isConnected(botUsername)) {
        connectionBots.set(ws, botUsername);
        console.error(`[MCP-WS-Server] Reconnected WebSocket to existing bot: ${botUsername}`);

        // Ensure viewer is running for this bot
        const viewerPort = botManager.getViewerPort(botUsername) || botManager.startViewer(botUsername);
        const viewerInfo = viewerPort ? ` (viewer: http://localhost:${viewerPort})` : "";

        return `Reconnected to existing bot ${botUsername}${viewerInfo}`;
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
      const targetY = args.y as number;
      const bot = botManager.getBot(username);
      if (bot) {
        const currentY = bot.entity.position.y;
        const heightDiff = targetY - currentY;
        if (heightDiff > 10) {
          return `Target is ${heightDiff.toFixed(0)} blocks higher than current position. Pathfinder cannot climb that high. Use minecraft_pillar_up with height=${Math.ceil(heightDiff)} to climb up first, then use move_to for horizontal movement.`;
        }
      }
      const moveResult = await botManager.moveTo(username, args.x as number, targetY, args.z as number);
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

    case "minecraft_get_surroundings": {
      if (!username) {
        // Try to find any connected bot
        const connectedBots = botManager.getAllBots();
        if (connectedBots.length === 0) {
          throw new Error("Not connected. Call minecraft_connect first.");
        }
        // Use the first connected bot
        const botUsername = connectedBots[0];
        connectionBots.set(ws, botUsername);
        return botManager.getSurroundings(botUsername);
      }
      return botManager.getSurroundings(username);
    }

    case "minecraft_find_block": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const blockName = args.block_name as string;
      const maxDistance = (args.max_distance as number) || 64;
      return botManager.findBlock(username, blockName, maxDistance);
    }

    case "minecraft_check_infrastructure": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const { handleEnvironmentTool } = await import("./tools/environment.js");
      return handleEnvironmentTool("minecraft_check_infrastructure", args);
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
      try {
        return await botManager.craftItem(username, args.item_name as string, (args.count as number) || 1);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const inventory = botManager.getInventory(username);
        const inventoryStr = inventory.map(item => `${item.name}(${item.count})`).join(", ");
        return `Cannot craft ${args.item_name}: ${errorMsg}. Inventory: ${inventoryStr}`;
      }
    }

    case "minecraft_smelt": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      try {
        return await botManager.smeltItem(username, args.item_name as string, (args.count as number) || 1);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const inventory = botManager.getInventory(username);
        const inventoryStr = inventory.map(item => `${item.name}(${item.count})`).join(", ");
        return `Cannot smelt ${args.item_name}: ${errorMsg}. Inventory: ${inventoryStr}`;
      }
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
      if (!username) {
        const connectedBots = botManager.getAllBots();
        if (connectedBots.length === 0) {
          throw new Error("Not connected. Call minecraft_connect first.");
        }
        const botUsername = connectedBots[0];
        connectionBots.set(ws, botUsername);
        return botManager.getStatus(botUsername);
      }
      return botManager.getStatus(username);
    }

    case "minecraft_get_equipment": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return botManager.getEquipment(username);
    }

    case "minecraft_get_nearby_entities": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const range = (args.range as number) || 32;
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
      const height = (args.height as number) || 5;
      return await botManager.pillarUp(username, height);
    }

    case "minecraft_tunnel": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const direction = args.direction as "north" | "south" | "east" | "west" | "down" | "up";
      if (direction === "up") {
        const height = (args.length as number) || 10;
        return await botManager.pillarUp(username, height);
      }
      const length = (args.length as number) || 10;
      return await botManager.digTunnel(username, direction, length);
    }

    case "minecraft_flee": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const distance = (args.distance as number) || 20;
      return await botManager.flee(username, distance);
    }

    case "minecraft_fish": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const duration = (args.duration as number) || 30;
      return await botManager.fish(username, duration);
    }

    case "minecraft_trade_villager": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const tradeIndex = args.tradeIndex as number | undefined;
      return await botManager.tradeWithVillager(username, tradeIndex);
    }

    case "minecraft_respawn": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const reason = args.reason as string | undefined;
      return await botManager.respawn(username, reason);
    }

    case "minecraft_get_biome": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.getBiome(username);
    }

    case "minecraft_find_entities": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const entityType = args.entity_type as string | undefined;
      const maxDistance = (args.max_distance as number) || 64;
      return botManager.findEntities(username, entityType, maxDistance);
    }

    case "minecraft_explore_for_biome": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const targetBiome = args.target_biome as string;
      const direction = (args.direction as "north" | "south" | "east" | "west" | "random") || "random";
      const maxBlocks = (args.max_blocks as number) || 256;
      return await botManager.exploreForBiome(username, targetBiome, direction, maxBlocks);
    }

    case "minecraft_list_recipes": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const category = args.category as string | undefined;
      return await botManager.listAllRecipes(username, category);
    }

    case "minecraft_list_craftable": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.listCraftableNow(username);
    }

    case "minecraft_list_chest": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.listChest(username);
    }

    case "minecraft_store_in_chest": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const itemName = args.item_name as string;
      const count = args.count as number | undefined;
      return await botManager.storeInChest(username, itemName, count);
    }

    case "minecraft_take_from_chest": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const itemName = args.item_name as string;
      const count = args.count as number | undefined;
      return await botManager.takeFromChest(username, itemName, count);
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

    // === Stability Analysis Tools ===

    case "dev_get_stability_metrics": {
      const metrics = stabilityAnalyzer.getMetrics();
      const result = Array.from(metrics.entries()).map(([, metric]) => metric);
      return JSON.stringify(result, null, 2);
    }

    case "dev_get_unstable_disturbances": {
      const unstable = stabilityAnalyzer.getUnstableDisturbances();
      return JSON.stringify(unstable, null, 2);
    }

    case "dev_get_failed_responses": {
      const disturbanceType = args.disturbanceType as string | undefined;
      const limit = (args.limit as number) || 10;

      if (!disturbanceType) {
        throw new Error("disturbanceType is required");
      }

      const failed = stabilityAnalyzer.getFailedResponses(disturbanceType);
      return JSON.stringify(failed.slice(0, limit), null, 2);
    }

    case "dev_get_failure_modes": {
      const modes = stabilityAnalyzer.analyzeFailureModes();
      return JSON.stringify(modes, null, 2);
    }

    case "dev_get_most_unstable_mode": {
      const mode = stabilityAnalyzer.getMostUnstableMode();
      if (!mode) {
        return JSON.stringify({ message: "All modes are stable" });
      }
      return JSON.stringify(mode, null, 2);
    }

    // === Additional Mineflayer API Tools ===
    case "minecraft_wake": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.wake(username);
    }

    case "minecraft_elytra_fly": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.elytraFly(username);
    }

    case "minecraft_mount": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.mount(username, args.entity_name as string | undefined);
    }

    case "minecraft_dismount": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.dismount(username);
    }

    case "minecraft_activate_block": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;
      return await botManager.activateBlock(username, x, y, z);
    }

    case "minecraft_enchant": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const itemName = args.item_name as string;
      const level = (args.level as number) || 1;
      return await botManager.enchant(username, itemName, level);
    }

    case "minecraft_use_anvil": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const targetItem = args.target_item as string;
      const materialItem = args.material_item as string | undefined;
      const newName = args.new_name as string | undefined;
      return await botManager.useAnvil(username, targetItem, materialItem, newName);
    }

    case "minecraft_update_sign": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;
      const text = args.text as string;
      const back = (args.back as boolean) || false;
      return await botManager.updateSign(username, x, y, z, text, back);
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

    // Load stability analysis data
    stabilityAnalyzer.loadResponses();
    console.log(`[MCP-WS-Server] Stability analyzer initialized`);

    // Print eigenmode analysis if data exists
    setTimeout(() => {
      const modes = stabilityAnalyzer.analyzeFailureModes();
      if (modes.length > 0) {
        stabilityAnalyzer.printEigenmodeAnalysis();
      }
    }, 1000);
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
