/**
 * MCP Schema Definitions for Tier 1 Core Tools
 *
 * These 10 tools are always visible in tools/list.
 * They replace 48+ individual tools for a simpler LLM experience.
 */

import {
  mc_status,
  mc_gather,
  mc_craft,
  mc_farm,
  mc_build,
  mc_navigate,
  mc_combat,
  mc_drop,
  mc_eat,
  mc_store,
  mc_chat,
  mc_connect,
  mc_flee,
  minecraft_pillar_up,
  mc_smelt,
  mc_tunnel,
} from "./core-tools.js";
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

  mc_gather: {
    description: "Find, move to, mine, and collect a block type (wood/stone/ore). Single type per call.",
    inputSchema: {
      type: "object" as const,
      properties: {
        block: { type: "string", description: "Block name (e.g., 'oak_log', 'iron_ore')" },
        count: { type: "number", default: 1 },
        max_distance: { type: "number", default: 32 },
      },
      required: ["block"],
    },
  },

  mc_craft: {
    description: "Craft an item with auto dependency resolution. Set autoGather=true to collect missing materials.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item: { type: "string", description: "Item name (e.g., 'wooden_pickaxe', 'furnace')" },
        count: { type: "number", default: 1 },
        autoGather: { type: "boolean", default: false },
      },
      required: ["item"],
    },
  },

  mc_build: {
    description: "Build a structure at current position. Need 50+ blocks for small, 150+ for medium.",
    inputSchema: {
      type: "object" as const,
      properties: {
        preset: { type: "string", enum: ["shelter", "wall", "platform", "tower"] },
        size: { type: "string", enum: ["small", "medium", "large"], default: "small" },
      },
      required: ["preset"],
    },
  },

  mc_navigate: {
    description: "Move to coordinates, a block type, or an entity. Provide x/y/z OR target_block OR target_entity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
        target_block: { type: "string", description: "Block to navigate to (e.g., 'crafting_table')" },
        target_entity: { type: "string", description: "Entity to navigate to (e.g., 'cow', 'villager')" },
        max_distance: { type: "number", default: 32 },
      },
      required: [],
    },
  },

  mc_combat: {
    description: "Attack an entity, auto-equip best weapon, collect drops. Omit target for nearest hostile. For dangerous mobs like blaze/ghast use flee_at_hp=10.",
    inputSchema: {
      type: "object" as const,
      properties: {
        target: { type: "string", description: "Entity name (e.g., 'zombie', 'cow', 'blaze')" },
        flee_at_hp: { type: "number", default: 6, description: "Flee when HP drops below this (default 6). Use 10 for blazes/ghasts." },
      },
      required: [],
    },
  },

  mc_drop: {
    description: "Drop/discard items from inventory to free space. Essential before gathering when inventory is full.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: { type: "string", description: "Item to drop (e.g., 'dirt', 'cobblestone')" },
        count: { type: "number", description: "Number to drop (omit to drop all)" },
      },
      required: ["item_name"],
    },
  },

  mc_eat: {
    description: "Eat food to restore hunger. Cooks raw meat if furnace nearby.",
    inputSchema: {
      type: "object" as const,
      properties: {
        food: { type: "string", description: "Food name (optional, auto-selects best)" },
      },
      required: [],
    },
  },

  mc_store: {
    description: 'Chest operations: "list" contents, "deposit" items, "withdraw" items, "deposit_all_except" bulk-store.',
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["list", "deposit", "withdraw", "deposit_all_except"] },
        item_name: { type: "string" },
        count: { type: "number" },
        chest_x: { type: "number" },
        chest_y: { type: "number" },
        chest_z: { type: "number" },
        keep_items: { type: "array", items: { type: "string" }, description: "Items to keep with deposit_all_except" },
      },
      required: ["action"],
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

  mc_smelt: {
    description: "Smelt items in nearby furnace (requires fuel). Use for raw_iron, raw_gold, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: { type: "string", description: "Item to smelt (e.g., 'raw_iron')" },
        count: { type: "number", default: 1 },
      },
      required: ["item_name"],
    },
  },

  mc_flee: {
    description: "Run away from nearest hostile mob.",
    inputSchema: {
      type: "object" as const,
      properties: {
        distance: { type: "number", default: 20 },
      },
      required: [],
    },
  },

  mc_place_block: {
    description: "Place a block at coordinates (furnace, crafting_table, chest, torch, etc.).",
    inputSchema: {
      type: "object" as const,
      properties: {
        block_type: { type: "string", description: "Block to place (e.g., 'furnace', 'chest')" },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
      },
      required: ["block_type", "x", "y", "z"],
    },
  },

  mc_farm: {
    description: "Full farming sequence: till dirt → plant wheat_seeds → apply bone_meal → harvest wheat → craft bread → eat. Requires stone_hoe + wheat_seeds in inventory. Use when you need food and have seeds.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  mc_tunnel: {
    description: "Dig a tunnel in any direction. Use 'up' to staircase-mine upward (safe way to escape ravines/caves). Auto-equips pickaxe, detects lava.",
    inputSchema: {
      type: "object" as const,
      properties: {
        direction: { type: "string", enum: ["north", "south", "east", "west", "up", "down"], description: "Direction to dig. 'up' = staircase mining upward." },
        length: { type: "number", default: 10, description: "Number of blocks to dig" },
      },
      required: ["direction"],
    },
  },

  minecraft_pillar_up: {
    description: "Build a pillar upward by jump-placing blocks (cobblestone/dirt). Use to climb out of caves or reach higher locations. Max 15 blocks per call.",
    inputSchema: {
      type: "object" as const,
      properties: {
        height: { type: "number", description: "Number of blocks to pillar up (default: 1, max: 15)" },
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
};

/**
 * Handle Tier 1 core tool execution
 * Uses registry for hot-reload support. Falls back to static imports.
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
      case "mc_gather":
        return await fn(args.block, (args.count as number) || 1, (args.max_distance as number) || 32);
      case "mc_craft":
        return await fn(args.item, (args.count as number) || 1, (args.autoGather as boolean) || false);
      case "mc_farm":
        return await fn();
      case "mc_build":
        return await fn(args.preset, (args.size as string) || "small");
      case "mc_navigate":
        return await fn({
          x: args.x, y: args.y, z: args.z,
          target_block: args.target_block, target_entity: args.target_entity,
          max_distance: args.max_distance,
        });
      case "mc_combat":
        return await fn(args.target, (args.flee_at_hp as number) || 6);
      case "mc_drop":
        return await fn(args.item_name, args.count);
      case "mc_eat":
        return await fn(args.food);
      case "mc_store":
        return await fn(args.action, args.item_name, args.count, args.chest_x, args.chest_y, args.chest_z, args.keep_items);
      case "mc_chat":
        return await fn(args.message);
      case "mc_connect":
        return await fn({
          action: (args.action as string) || "connect",
          username: args.username, host: args.host, port: args.port, version: args.version,
        });
      case "mc_flee":
        return await fn((args.distance as number) || 20);
      case "minecraft_pillar_up":
        return await fn((args.height as number) || 1);
      case "mc_smelt":
        return await fn(args.item_name as string, (args.count as number) || 1);
      case "mc_tunnel":
        return await fn(args.direction as string, (args.length as number) || 10);
    }
  }

  // Fallback: use static imports (before registry is populated)
  switch (name) {
    case "mc_status": return await mc_status();
    case "mc_gather": return await mc_gather(args.block as string, (args.count as number) || 1, (args.max_distance as number) || 32);
    case "mc_craft": return await mc_craft(args.item as string, (args.count as number) || 1, (args.autoGather as boolean) || false);
    case "mc_farm": return await mc_farm();
    case "mc_build": return await mc_build(args.preset as any, (args.size as any) || "small");
    case "mc_navigate": return await mc_navigate({ x: args.x as any, y: args.y as any, z: args.z as any, target_block: args.target_block as any, target_entity: args.target_entity as any, max_distance: args.max_distance as any });
    case "mc_combat": return await mc_combat(args.target as any, (args.flee_at_hp as number) || 6);
    case "mc_eat": return await mc_eat(args.food as any);
    case "mc_store": return await mc_store(args.action as any, args.item_name as any, args.count as any, args.chest_x as any, args.chest_y as any, args.chest_z as any, args.keep_items as any);
    case "mc_chat": return await mc_chat(args.message as any);
    case "mc_connect": return await mc_connect({ action: (args.action as any) || "connect", username: args.username as any, host: args.host as any, port: args.port as any, version: args.version as any });
    case "mc_flee": return await mc_flee((args.distance as number) || 20);
    case "minecraft_pillar_up": return await minecraft_pillar_up((args.height as number) || 1);
    case "mc_smelt": return await mc_smelt(args.item_name as string, (args.count as number) || 1);
    case "mc_tunnel": return await mc_tunnel(args.direction as string, (args.length as number) || 10);
    case "mc_place_block": {
      const username = botManager.requireSingleBot();
      const result = await botManager.placeBlock(username, args.block_type as string, args.x as number, args.y as number, args.z as number);
      return result.message;
    }
    case "mc_drop": return await mc_drop(args.item_name as string, args.count as number | undefined);
    default: throw new Error(`Unknown core tool: ${name}`);
  }
}
