/**
 * MCP Schema Definitions for Core Tools
 *
 * Tools: mc_execute, mc_connect, mc_chat, mc_status, mc_reconnect, mc_reload
 * All complex wrapper tools have been removed — agents write mineflayer code
 * directly via mc_execute.
 */

import {
  mc_status,
  mc_chat,
  mc_connect,
  mc_reconnect,
} from "./core-tools.js";
import { mc_execute } from "./mc-execute.js";
import { registry } from "../tool-handler-registry.js";
import { botManager } from "../bot-manager/index.js";

export const coreTools = {
  mc_status: {
    description: "Get bot status: HP, hunger, position, inventory, nearby threats and resources.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  mc_chat: {
    description: "Read unread chat messages (and optionally send one). Call before every action for team coordination.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "Message to send (omit to read only)" },
      },
      required: [],
    },
  },

  mc_connect: {
    description: "Connect to or disconnect from a Minecraft server.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["connect", "disconnect"], default: "connect" },
        username: { type: "string", description: "Bot username (required for connect)" },
        host: { type: "string", default: "localhost" },
        port: { type: "number", default: 25565 },
        version: { type: "string" },
      },
      required: ["action"],
    },
  },

  mc_reconnect: {
    description: "Disconnect and reconnect using the previous connection info (host/port/username). Use when the bot is stuck or disconnected and needs a fresh connection.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  mc_execute: {
    description: `Execute JavaScript code directly against the raw mineflayer bot. The sandbox exposes:
- bot: raw mineflayer Bot instance (full API)
- Movements: mineflayer-pathfinder Movements class
- goals: pathfinder goals (GoalNear, GoalBlock, GoalXZ, GoalY, GoalFollow, etc.)
- Vec3: vec3 constructor
- await status(): { hp, hunger, position, inventory, nearbyEntities, warnings, ... }
- await wait(ms): delay up to 30s
- log("msg"): debug log
- getMessages(): chat history array
- await reconnect(): reconnect bot
- await chat(msg): send chat message

Example patterns:
  // Move with pathfinder
  const movements = new Movements(bot); bot.pathfinder.setMovements(movements);
  await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1));

  // Mine a block
  const block = bot.findBlock({ matching: bot.registry.blocksByName['oak_log'].id, maxDistance: 32 });
  if (block) await bot.dig(block);

  // Craft
  const recipes = bot.recipesFor(bot.registry.itemsByName['crafting_table'].id, null, 1, null);
  if (recipes[0]) await bot.craft(recipes[0], 1, null);

  // Attack mob
  const mob = bot.nearestEntity(e => e.name === 'zombie');
  if (mob) await bot.attack(mob);`,
    inputSchema: {
      type: "object" as const,
      properties: {
        code: { type: "string", description: "JavaScript code to execute. Use mineflayer bot API directly. All async operations need await. Last expression value is returned." },
        timeout: { type: "number", default: 120000, description: "Max execution time in ms (default 120000, max 600000). Use longer timeouts for gameplay loops." },
      },
      required: ["code"],
    },
  },
};

/**
 * Handle core tool execution
 */
export async function handleCoreTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const impl = (registry.coreTools || {}) as Record<string, Function>;
  const fn = impl[name];

  // Fast path: registry has the handler (normal case + after reload)
  if (fn) {
    switch (name) {
      case "mc_status":
        return await fn();
      case "mc_chat":
        return await fn(args.message);
      case "mc_connect":
        return await fn({
          action: (args.action as string) || "connect",
          username: args.username, host: args.host, port: args.port, version: args.version,
        });
      case "mc_reconnect":
        return await fn();
      case "mc_execute":
        return await fn(args.code as string, (args.timeout as number) || 120000);
    }
  }

  // Fallback: use static imports (before registry is populated)
  switch (name) {
    case "mc_status": return await mc_status();
    case "mc_chat": return await mc_chat(args.message as any);
    case "mc_connect": return await mc_connect({ action: (args.action as any) || "connect", username: args.username as any, host: args.host as any, port: args.port as any, version: args.version as any });
    case "mc_reconnect": return await mc_reconnect();
    case "mc_execute": return await mc_execute(args.code as string, (args.timeout as number) || 120000, args.username as string | undefined);
    default: throw new Error(`Unknown core tool: ${name}`);
  }
}
