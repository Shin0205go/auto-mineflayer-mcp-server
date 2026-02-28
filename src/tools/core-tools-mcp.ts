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
  mc_build,
  mc_navigate,
  mc_combat,
  mc_eat,
  mc_store,
  mc_chat,
  mc_connect,
} from "./core-tools.js";
import { registry } from "../tool-handler-registry.js";
import { botManager } from "../bot-manager/index.js";

export const coreTools = {
  mc_status: {
    description:
      "Get comprehensive bot status: HP, hunger, position, time, inventory summary, nearby threats, resources, and infrastructure. Call this first to understand the situation. Replaces get_status + get_position + get_inventory + get_surroundings + get_nearby_entities + check_infrastructure.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  mc_gather: {
    description:
      "Gather a specific block/resource. Automatically finds, moves to, mines, and collects. Use for wood, stone, ore, etc. Single item type per call.",
    inputSchema: {
      type: "object" as const,
      properties: {
        block: {
          type: "string",
          description:
            "Block to gather (e.g., 'oak_log', 'cobblestone', 'iron_ore', 'sand')",
        },
        count: {
          type: "number",
          description: "Number to collect (default: 1)",
          default: 1,
        },
        max_distance: {
          type: "number",
          description: "Search radius in blocks (default: 32)",
          default: 32,
        },
      },
      required: ["block"],
    },
  },

  mc_craft: {
    description:
      "Craft an item with automatic dependency resolution. Resolves recipe chains (e.g., wooden_pickaxe crafts planks→sticks→pickaxe). Returns missing items on failure. Set autoGather=true to auto-collect missing materials.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item: {
          type: "string",
          description:
            "Item to craft (e.g., 'crafting_table', 'wooden_pickaxe', 'furnace', 'iron_pickaxe')",
        },
        count: {
          type: "number",
          description: "Number to craft (default: 1)",
          default: 1,
        },
        autoGather: {
          type: "boolean",
          description:
            "Automatically gather missing materials (default: false)",
          default: false,
        },
      },
      required: ["item"],
    },
  },

  mc_build: {
    description:
      "Build a predefined structure at current position. Auto-levels ground and selects materials from inventory. Need 50+ blocks for small, 150+ for medium.",
    inputSchema: {
      type: "object" as const,
      properties: {
        preset: {
          type: "string",
          enum: ["shelter", "wall", "platform", "tower"],
          description: "Structure type",
        },
        size: {
          type: "string",
          enum: ["small", "medium", "large"],
          description: "Structure size (default: small)",
          default: "small",
        },
      },
      required: ["preset"],
    },
  },

  mc_navigate: {
    description:
      "Move to coordinates, a block type, or an entity. Handles pathfinding, long-distance segment navigation, and chunk loading automatically.",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: { type: "number", description: "X coordinate" },
        y: { type: "number", description: "Y coordinate" },
        z: { type: "number", description: "Z coordinate" },
        target_block: {
          type: "string",
          description:
            "Block type to navigate to (e.g., 'crafting_table', 'iron_ore'). Finds nearest.",
        },
        target_entity: {
          type: "string",
          description:
            "Entity to navigate to (e.g., 'cow', 'villager', player name)",
        },
        max_distance: {
          type: "number",
          description: "Search radius for block/entity targets (default: 32)",
          default: 32,
        },
      },
      required: [],
    },
  },

  mc_combat: {
    description:
      "Fight a target entity. Auto-equips best weapon, attacks until dead or HP drops to flee threshold, then collects drops. Use for hunting animals or fighting mobs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        target: {
          type: "string",
          description:
            "Entity to attack (e.g., 'zombie', 'cow', 'skeleton'). If omitted, attacks nearest hostile.",
        },
        flee_at_hp: {
          type: "number",
          description: "HP threshold to flee (default: 4)",
          default: 4,
        },
      },
      required: [],
    },
  },

  mc_eat: {
    description:
      "Eat food to restore hunger. Auto-selects best food from inventory. If raw meat and furnace nearby, cooks first then eats. Returns error if no food available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        food: {
          type: "string",
          description:
            "Specific food to eat (optional). If omitted, eats best available.",
        },
      },
      required: [],
    },
  },

  mc_store: {
    description:
      'Unified chest operations. Actions: "list" shows contents, "deposit" stores items, "withdraw" takes items, "deposit_all_except" bulk-stores keeping tools/armor.',
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["list", "deposit", "withdraw", "deposit_all_except"],
          description: "Operation type",
        },
        item_name: {
          type: "string",
          description: "Item for deposit/withdraw (not needed for list)",
        },
        count: {
          type: "number",
          description: "Item count (default: all)",
        },
        chest_x: { type: "number", description: "Chest X (optional, uses nearest)" },
        chest_y: { type: "number", description: "Chest Y (optional)" },
        chest_z: { type: "number", description: "Chest Z (optional)" },
        keep_items: {
          type: "array",
          items: { type: "string" },
          description:
            "Items to keep when using deposit_all_except (tools/armor always kept)",
        },
      },
      required: ["action"],
    },
  },

  mc_chat: {
    description:
      "Send and/or read chat messages in one call. Always reads unread messages. Use for team coordination and responding to player commands.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "Message to send (optional). Omit to just read.",
        },
      },
      required: [],
    },
  },

  mc_smelt: {
    description: "Smelt items in a furnace. Requires a furnace nearby and fuel (coal/wood). Use for raw_iron, raw_gold, raw_copper, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: { type: "string", description: "Item to smelt (e.g., 'raw_iron', 'raw_gold', 'sand')" },
        count: { type: "number", description: "Number to smelt (default: 1)", default: 1 },
      },
      required: ["item_name"],
    },
  },

  mc_flee: {
    description: "Run away from nearest hostile mob. Use when in danger.",
    inputSchema: {
      type: "object" as const,
      properties: {
        distance: { type: "number", description: "Distance to flee in blocks (default: 20)", default: 20 },
      },
      required: [],
    },
  },

  mc_place_block: {
    description: "Place a block from inventory at specific coordinates. Use for furnace, crafting_table, chest, torch, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        block_type: { type: "string", description: "Block to place (e.g., 'furnace', 'crafting_table', 'chest', 'torch')" },
        x: { type: "number", description: "X coordinate" },
        y: { type: "number", description: "Y coordinate" },
        z: { type: "number", description: "Z coordinate" },
      },
      required: ["block_type", "x", "y", "z"],
    },
  },

  mc_connect: {
    description:
      "Connect to or disconnect from a Minecraft server.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["connect", "disconnect"],
          description: "Connect or disconnect",
          default: "connect",
        },
        username: {
          type: "string",
          description: "Bot username (required for connect)",
        },
        host: {
          type: "string",
          description: "Server host (default: localhost)",
          default: "localhost",
        },
        port: {
          type: "number",
          description: "Server port (default: 25565)",
          default: 25565,
        },
        version: {
          type: "string",
          description: "Minecraft version (optional, auto-detect)",
        },
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
      case "mc_build":
        return await fn(args.preset, (args.size as string) || "small");
      case "mc_navigate":
        return await fn({
          x: args.x, y: args.y, z: args.z,
          target_block: args.target_block, target_entity: args.target_entity,
          max_distance: args.max_distance,
        });
      case "mc_combat":
        return await fn(args.target, (args.flee_at_hp as number) || 4);
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
    }
  }

  // New Tier1 tools (not in registry, use botManager directly)
  switch (name) {
    case "mc_smelt": {
      const username = botManager.requireSingleBot();
      return await botManager.smeltItem(username, args.item_name as string, (args.count as number) || 1);
    }
    case "mc_flee": {
      const username = botManager.requireSingleBot();
      return await botManager.flee(username, (args.distance as number) || 20);
    }
    case "mc_place_block": {
      const username = botManager.requireSingleBot();
      const result = await botManager.placeBlock(username, args.block_type as string, args.x as number, args.y as number, args.z as number);
      return result.message;
    }
  }

  // Fallback: use static imports (before registry is populated)
  switch (name) {
    case "mc_status": return await mc_status();
    case "mc_gather": return await mc_gather(args.block as string, (args.count as number) || 1, (args.max_distance as number) || 32);
    case "mc_craft": return await mc_craft(args.item as string, (args.count as number) || 1, (args.autoGather as boolean) || false);
    case "mc_build": return await mc_build(args.preset as any, (args.size as any) || "small");
    case "mc_navigate": return await mc_navigate({ x: args.x as any, y: args.y as any, z: args.z as any, target_block: args.target_block as any, target_entity: args.target_entity as any, max_distance: args.max_distance as any });
    case "mc_combat": return await mc_combat(args.target as any, (args.flee_at_hp as number) || 4);
    case "mc_eat": return await mc_eat(args.food as any);
    case "mc_store": return await mc_store(args.action as any, args.item_name as any, args.count as any, args.chest_x as any, args.chest_y as any, args.chest_z as any, args.keep_items as any);
    case "mc_chat": return await mc_chat(args.message as any);
    case "mc_connect": return await mc_connect({ action: (args.action as any) || "connect", username: args.username as any, host: args.host as any, port: args.port as any, version: args.version as any });
    case "mc_smelt": {
      const username = botManager.requireSingleBot();
      return await botManager.smeltItem(username, args.item_name as string, (args.count as number) || 1);
    }
    case "mc_flee": {
      const username = botManager.requireSingleBot();
      return await botManager.flee(username, (args.distance as number) || 20);
    }
    case "mc_place_block": {
      const username = botManager.requireSingleBot();
      const result = await botManager.placeBlock(username, args.block_type as string, args.x as number, args.y as number, args.z as number);
      return result.message;
    }
    default: throw new Error(`Unknown core tool: ${name}`);
  }
}
