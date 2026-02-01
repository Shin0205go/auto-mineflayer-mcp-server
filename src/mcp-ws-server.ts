#!/usr/bin/env node

/**
 * MCP WebSocket Server
 *
 * Exposes the MCP tools via WebSocket.
 * Each connection can have its own bot (identified by username).
 */

import { WebSocketServer, WebSocket } from 'ws';
import { botManager } from "./bot-manager.js";
import { readBoard, writeBoard, waitForNewMessage, clearBoard, logToBoard } from "./tools/coordination.js";

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

// Track which bot each connection is using
const connectionBots = new WeakMap<WebSocket, string>();

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
  minecraft_list_dropped_items: {
    description: "List all dropped items nearby (for debugging pickup issues)",
    inputSchema: {
      type: "object",
      properties: {
        range: { type: "number", default: 10 },
      },
    },
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
  minecraft_attack: {
    description: "Attack once. For continuous combat, use minecraft_fight instead",
    inputSchema: {
      type: "object",
      properties: {
        entity_name: { type: "string" },
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
  minecraft_equip_armor: {
    description: "Equip armor from inventory",
    inputSchema: { type: "object", properties: {} },
  },
  minecraft_equip_weapon: {
    description: "Equip the best weapon from inventory",
    inputSchema: {
      type: "object",
      properties: {
        weapon_name: { type: "string" },
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

    case "minecraft_list_dropped_items": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const range = (args.range as number) || 10;
      return botManager.listDroppedItems(username, range);
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

    case "minecraft_attack": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.attack(username, args.entity_name as string | undefined);
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

    case "minecraft_equip_armor": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.equipArmor(username);
    }

    case "minecraft_equip_weapon": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      return await botManager.equipWeapon(username, args.weapon_name as string | undefined);
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

        // Get bot username for logging
        const botUser = connectionBots.get(ws) || "?";

        // Log tool call to board (skip board tools to avoid infinite loop)
        const skipLogTools = ["agent_board_read", "agent_board_write", "agent_board_wait", "agent_board_clear"];
        if (!skipLogTools.includes(toolName)) {
          const argsStr = Object.keys(toolArgs).length > 0
            ? ` ${JSON.stringify(toolArgs)}`.substring(0, 80)
            : "";
          logToBoard(botUser, `→ ${toolName}${argsStr}`);
        }

        try {
          const result = await handleTool(ws, toolName, toolArgs);

          // Log result (truncated)
          if (!skipLogTools.includes(toolName)) {
            const resultStr = result.substring(0, 100).replace(/\n/g, " ");
            logToBoard(botUser, `← ${toolName}: ${resultStr}${result.length > 100 ? "..." : ""}`);
          }

          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: result }] }
          };
        } catch (toolError) {
          // Enhanced error logging for tool calls
          const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);
          const stack = toolError instanceof Error ? toolError.stack : undefined;
          console.error(`[MCP-WS-Server] Tool error in ${toolName}:`);
          console.error(`  Args: ${JSON.stringify(toolArgs)}`);
          console.error(`  Error: ${errorMessage}`);
          if (stack) {
            console.error(`  Stack: ${stack.split('\n').slice(1, 4).join('\n        ')}`);
          }

          // Log error to board
          if (!skipLogTools.includes(toolName)) {
            logToBoard(botUser, `✗ ${toolName}: ERROR ${errorMessage.substring(0, 50)}`);
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
