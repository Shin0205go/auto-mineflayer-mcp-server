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
  minecraft_look_around: {
    description: "Scan surrounding blocks",
    inputSchema: {
      type: "object",
      properties: { radius: { type: "number", default: 5 } },
    },
  },
  minecraft_place_block: {
    description: "Place a block at position. In survival mode, requires the block in inventory.",
    inputSchema: {
      type: "object",
      properties: {
        block_type: { type: "string", description: "Block type (e.g., 'cobblestone', 'oak_planks')" },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
        use_command: { type: "boolean", description: "Use /setblock command (requires OP). Default false for survival." },
      },
      required: ["block_type", "x", "y", "z"],
    },
  },
  minecraft_dig_block: {
    description: "Dig a block at position. In survival mode, actually mines the block.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
        use_command: { type: "boolean", description: "Use /setblock air (requires OP). Default false for survival." },
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
    description: "Attack the nearest hostile mob or a specific entity",
    inputSchema: {
      type: "object",
      properties: {
        entity_name: { type: "string" },
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
  minecraft_flee: {
    description: "Run away from danger",
    inputSchema: {
      type: "object",
      properties: {
        distance: { type: "number", default: 20 },
      },
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
      const botUsername = args.username as string;
      const version = args.version as string | undefined;

      if (!botUsername) {
        throw new Error("username is required");
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
      await botManager.moveTo(username, args.x as number, args.y as number, args.z as number);
      const newPos = botManager.getPosition(username);
      return `Moved to (${newPos?.x.toFixed(1)}, ${newPos?.y.toFixed(1)}, ${newPos?.z.toFixed(1)})`;
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

    case "minecraft_look_around": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const radius = (args.radius as number) || 5;
      const blocks = await botManager.lookAround(username, radius);

      // Summarize blocks
      const counts: Record<string, number> = {};
      for (const b of blocks) {
        counts[b.name] = (counts[b.name] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const summary = sorted.map(([name, count]) => `${name}: ${count}`).join("\n");
      return `Found ${blocks.length} blocks within ${radius} block radius:\n\n${summary}`;
    }

    case "minecraft_place_block": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const useCommand = (args.use_command as boolean) || false;
      const result = await botManager.placeBlock(
        username,
        args.block_type as string,
        args.x as number,
        args.y as number,
        args.z as number,
        useCommand
      );
      return result.message;
    }

    case "minecraft_dig_block": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const useCommand = (args.use_command as boolean) || false;
      return await botManager.digBlock(username, args.x as number, args.y as number, args.z as number, useCommand);
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

    case "minecraft_flee": {
      if (!username) throw new Error("Not connected. Call minecraft_connect first.");
      const distance = (args.distance as number) || 20;
      return await botManager.flee(username, distance);
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

        const result = await handleTool(ws, toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: result }] }
        };
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
        console.log(`[MCP-WS-Server] ${connectionBots.get(ws) || 'new'}: ${request.method}`);

        const response = await handleRequest(ws, request);
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
